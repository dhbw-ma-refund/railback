"""UIC 918.3 parser — wraps the vendored GPLv3 `onlineticket.py`.

Step 1b of the extraction cascade (`aztec.decode_aztec` returns the
decoded barcode bytes; this module turns those bytes into a structured
dict whose field names match the RailBack schema).

The vendored module's entry point is the `OT` class (NOT
`OnlineTicket` — the upstream readme refers to "OnlineTicket" as the
*concept*; the class name is `OT`). It takes raw bytes on construction
and exposes a parsed `.data['ticket']` list of `DataBlock` instances,
each carrying the parsed contents of a 918.3 sub-block (`U_HEAD`,
`0080BL`, `0080ID`, `U_TLAY`, …).

The interesting block for our schema is **0080BL** — the German DB
S-block container. Its `.data['data']` dict carries the translated
field names (`'Vorname, Name'`, `'Start-Bf-ID'`, …) declared in the
`typen` map in the vendored source. We pick fields from there plus
`U_HEAD.data['auftragsnummer']` for the ticket UID.

GPLv3 implication: we import from `onlineticket.py` at runtime; we do
not modify or redistribute it. The license file lives next to the
vendored source.
"""

from __future__ import annotations

import io
import re
from decimal import Decimal
from typing import Any

from .logging_setup import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Vendor import — `vendor/` is a sibling package of `src/` (vendor/__init__.py
# is a marker so this works both under pytest's rootdir-driven sys.path and
# inside the deployed Lambda zip where /var/task is on sys.path).
#
# We do NOT mutate sys.path here. An earlier revision prepended the Lambda
# package root to sys.path[0]; that turned out to be an import-shadowing
# footgun (a future `re.py` next to `src/` would replace the stdlib `re`
# module for the vendored parser). The vendor package marker handles
# resolution cleanly without that hazard.
# ---------------------------------------------------------------------------

try:
    from vendor.onlineticket import OT  # type: ignore[import-not-found]
except Exception as exc:  # pragma: no cover - import-time path
    OT = None  # type: ignore[assignment]
    logger.warning(
        "vendored onlineticket.py import failed; UIC 918.3 parsing disabled",
        extra={"error": repr(exc)},
    )


# ---------------------------------------------------------------------------
# Internal helpers — small surface, easy to unit-test in isolation if we
# ever need to without monkeypatching `OT`.
# ---------------------------------------------------------------------------


def _safe_decode(value: Any) -> str | None:
    """Bytes → utf-8 string. Returns None on empty / decode-failure."""
    if value is None:
        return None
    if isinstance(value, bytes):
        try:
            decoded = value.decode("utf-8")
        except UnicodeDecodeError:
            try:
                decoded = value.decode("latin-1")
            except Exception:
                return None
        decoded = decoded.strip("\x00 ").strip()
        return decoded or None
    if isinstance(value, str):
        stripped = value.strip("\x00 ").strip()
        return stripped or None
    return str(value)


def _format_price_eur(cents: Any) -> str | None:
    """Cent-int → "EUR.cc" with 2dp.

    The vendored parser stores `preis` as an int (cents). We surface a
    decimal string so the schema layer (which mirrors zod / DDB Decimal
    semantics) doesn't have to re-parse a float.
    """
    if cents is None:
        return None
    try:
        n = int(cents)
    except (TypeError, ValueError):
        return None
    euros = Decimal(n) / Decimal(100)
    return f"{euros:.2f}"


def _block_data(blocks: list[Any], block_class_name: str) -> dict[str, Any] | None:
    """Find the first block whose class is `block_class_name` and return its `.data`.

    The vendored OT exposes a list of mixed block types; we identify
    them by `__class__.__name__` to avoid importing every concrete
    class (and avoid version-skew if upstream renames a class).
    """
    for block in blocks or []:
        if block.__class__.__name__ == block_class_name:
            data = getattr(block, "data", None)
            if isinstance(data, dict):
                return data
    return None


def _split_name(personenname: Any) -> tuple[str | None, str | None]:
    """Split a DB "Vorname, Name" / "Vorname#Name" field into (vorname, nachname).

    The vendored parser already does `lambda x: x.split("#")` for the
    `028` field, returning a 2-list. Some tickets carry the `023`
    field instead (a plain string with `,` separator). We handle both
    shapes.

    On the no-separator fallback (e.g. an older ticket generation or
    a crafted UIC payload that ships the name as a single string), we
    split on whitespace and treat the last whitespace-segment as the
    nachname and the rest as the vorname. This keeps "Hans Müller" /
    "Anna-Maria von Beispiel" parseable instead of dumping the whole
    string into nachname_aus_ticket.
    """
    if personenname is None:
        return None, None
    if isinstance(personenname, (list, tuple)) and len(personenname) >= 2:
        return _safe_decode(personenname[0]), _safe_decode(personenname[1])
    s = _safe_decode(personenname)
    if not s:
        return None, None
    for sep in ("#", ","):
        if sep in s:
            parts = [p.strip() for p in s.split(sep, 1)]
            return parts[0] or None, parts[1] or None
    # No separator — try whitespace split. Last token = nachname, rest = vorname.
    ws_parts = s.split()
    if len(ws_parts) >= 2:
        nachname = ws_parts[-1]
        vorname = " ".join(ws_parts[:-1])
        return vorname or None, nachname or None
    # Single token / nothing useful — refuse to guess.
    return None, None


_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DATE_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")


def _format_date(value: Any) -> str | None:
    """Coerce a datetime / date / parseable string to `YYYY-MM-DD`.

    Returns None if the result is not a valid ISO date (defence against
    malformed vendored-parser outputs leaking into the DDB schema).
    """
    if value is None:
        return None
    # vendored parser returns datetime.datetime for `creation_date`,
    # `Gültig von`, `Gültig bis`.
    iso = getattr(value, "isoformat", None)
    candidate: str | None = None
    if callable(iso):
        try:
            candidate = (
                value.date().isoformat() if hasattr(value, "date") else value.isoformat()[:10]
            )
        except Exception:
            return None
    else:
        s = _safe_decode(value)
        if s and len(s) >= 10:
            candidate = s[:10]
    if not candidate or not _DATE_RE.match(candidate):
        return None
    return candidate


def _format_time(value: Any) -> str | None:
    """Coerce a datetime / time to `HH:MM`.

    Strictly validates the result against `^[0-2]\\d:[0-5]\\d$` (with 23
    as the hour-cap) — schema-boundary fields must not carry garbage
    strings (e.g. "ab:cd", "24:99") into DDB.
    """
    if value is None:
        return None
    strftime = getattr(value, "strftime", None)
    if callable(strftime):
        try:
            candidate = value.strftime("%H:%M")
        except Exception:
            return None
        return candidate if _TIME_RE.match(candidate) else None
    s = _safe_decode(value)
    if not s:
        return None
    # Handle "HHMM" form.
    if len(s) == 4 and s.isdigit():
        candidate = f"{s[:2]}:{s[2:]}"
        return candidate if _TIME_RE.match(candidate) else None
    if ":" in s:
        candidate = s[:5]
        return candidate if _TIME_RE.match(candidate) else None
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_uic_918_3(decoded_payload: bytes) -> dict[str, Any] | None:
    """Parse a UIC 918.3 payload into RailBack schema fields.

    Args:
        decoded_payload: the raw Aztec barcode bytes (as returned by
            `aztec.decode_aztec`).

    Returns:
        A dict with whichever schema fields could be extracted, plus a
        mandatory `barcode_uid` (UIC 918.3 ticket UID, used as the
        dedup key on GSI2). If `barcode_uid` cannot be determined →
        returns `None` (the cascade falls through to PDF_TEXT). Any
        exception during parsing is caught and surfaces as `None`.
    """
    if OT is None or not decoded_payload:
        return None

    try:
        ot = OT(decoded_payload)
    except Exception as exc:
        logger.warning(
            "OT parsing raised; falling through cascade",
            extra={"error": repr(exc)},
        )
        return None

    try:
        blocks = ot.data.get("ticket") if isinstance(ot.data, dict) else None
        if not blocks:
            return None

        # ----------------------------------------------------------------
        # Signature-validity gate (security-edge).
        # ----------------------------------------------------------------
        # The vendored OT parser exposes a `signature_validity` field on
        # its `.header` dict (declared in `OT.generic`, populated by
        # `dict_read(self.generic)` — see vendor/onlineticket.py:84,492).
        # It's NOT a child block inside `ot.data['ticket']` — that list
        # holds only `OT_U_HEAD` / `OT_0080BL` / `OT_0080VU` / … blocks,
        # never an `OT` itself. An earlier revision searched for a child
        # "OT" block, which was dead code that only ever matched
        # test-fixture synthesised entries.
        #
        # Values are 'VALID' or one of several 'INVALID (...)' strings
        # (or a SignatureVerificationError message). A forged UIC 918.3
        # payload (correct framing, no valid DSA signature) would
        # otherwise be classified as BARCODE with confidence 1.0,
        # bypassing the wizard and (worse) writing the attacker-chosen
        # `barcode_uid` to GSI2 — poisoning the duplicate-detection
        # namespace. If we cannot prove the signature is VALID, we
        # decline BARCODE classification entirely and fall through to
        # PDF_TEXT / MANUAL. The legitimate-ticket path is unaffected
        # because real DB tickets always carry a VALID signature.
        header = ot.header if isinstance(getattr(ot, "header", None), dict) else {}
        sig_validity = header.get("signature_validity")
        if sig_validity != "VALID":
            logger.warning(
                "UIC 918.3 signature_validity is not 'VALID'; declining BARCODE classification",
                extra={"signature_validity": str(sig_validity)[:80] if sig_validity is not None else None},
            )
            return None

        u_head = _block_data(blocks, "OT_U_HEAD") or {}
        bl = _block_data(blocks, "OT_0080BL") or {}
        bl_data = bl.get("data", {}) if isinstance(bl, dict) else {}

        # barcode_uid: the 8-char `auftragsnummer` from U_HEAD. This is
        # what DB calls the "Auftragsnummer" and what we dedup on.
        barcode_uid = _safe_decode(u_head.get("auftragsnummer"))
        if not barcode_uid:
            # Fallback — the `019` S-block ("Vorgangsnr./Flugscheinnr.")
            # carries the same identifier in some ticket generations.
            barcode_uid = _safe_decode(bl_data.get("Vorgangsnr./Flugscheinnr."))
        if not barcode_uid:
            logger.debug("UIC parse missing barcode_uid; declining BARCODE classification")
            return None

        # Name — prefer the structured 028 ("Vorname, Name" — 2-list)
        # over the 023 ("Personenname" — joined string).
        vorname, nachname = _split_name(
            bl_data.get("Vorname, Name") or bl_data.get("Personenname")
        )

        # Stations — 015/H-Start-Bf, 016/H-Ziel-Bf are the human-readable
        # names. 035/Start-Bf-ID, 036/Ziel-Bf-ID are the IBNRs (ints) —
        # useful for cross-referencing with the delay store later, but
        # the schema field is the readable name.
        abreisebahnhof = _safe_decode(bl_data.get("H-Start-Bf"))
        zielbahnhof = _safe_decode(bl_data.get("H-Ziel-Bf"))

        # Price — `0080BL` doesn't carry the trip price directly; the
        # `0080VU` (VDV-KA) block has `preis` (cents). Look there.
        vu = _block_data(blocks, "OT_0080VU") or {}
        efs_list = vu.get("efs") if isinstance(vu, dict) else None
        preis_cents: Any = None
        if isinstance(efs_list, list) and efs_list:
            preis_cents = efs_list[0].get("preis") if isinstance(efs_list[0], dict) else None
        fahrkartenpreis = _format_price_eur(preis_cents)

        # Travel date — `Gültig von` is the start of validity (often the
        # travel day for single-trip tickets). For multi-day tickets
        # this is the first-valid date; the PDF-text fallback can do
        # better, but at the barcode layer this is the canonical hint.
        gueltig_von = bl_data.get("Gültig von")
        abreisedatum = _format_date(gueltig_von) or _format_date(
            u_head.get("creation_date")
        )

        # Trains / departure time / Fahrkartennummer are NOT in the
        # 918.3 payload — they only appear on the printed PDF text
        # layer. We leave them None here; PDF_TEXT extraction (if it
        # runs) would fill them, but for BARCODE-class results we
        # accept these gaps. The schema marks them Optional[str].
        #
        # Note: we surface `barcode_uid` ALSO as `fahrt_fahrkartennummer`.
        # On DB Online-Tickets the printed "Auftragsnummer" (= the
        # `fahrkartennummer` per DB_SCHEMA.md L157, used as EU-form Pflicht-
        # feld 3.2.7) and the UIC 918.3 ticket UID are the same string in
        # the formats we see; carrying it on both schema fields lets the
        # EU-form rendering pick whichever is populated without a
        # special-case. Documented assumption — revisit if a ticket
        # generation ever ships a distinct printed number.
        result: dict[str, Any] = {
            "barcode_uid": barcode_uid,
            "vorname_aus_ticket": vorname,
            "nachname_aus_ticket": nachname,
            "fahrt_fahrkartennummer": barcode_uid,
            "fahrt_fahrkartenpreis": fahrkartenpreis,
            "fahrt_abreisebahnhof": abreisebahnhof,
            "fahrt_zielbahnhof": zielbahnhof,
            "fahrt_abreisedatum": abreisedatum,
            "fahrt_abfahrtszeit_plan": _format_time(gueltig_von),
            "fahrt_ankunftszeit_plan": None,
            "fahrt_zugnummer_plan": None,
            "fahrt_zugkategorie_plan": None,
        }
        # Strip None-valued optional fields to keep the persist layer
        # tidy. `barcode_uid` is always present here by construction.
        return {k: v for k, v in result.items() if v is not None or k == "barcode_uid"}
    except Exception as exc:
        logger.warning(
            "UIC field translation raised; falling through cascade",
            extra={"error": repr(exc)},
        )
        return None


# Keep an unused import out of the linter's way — BytesIO isn't strictly
# required (OT takes raw bytes), but the docstring references the
# possibility of file-like inputs so we keep the import available for
# downstream extension.
_ = io.BytesIO
