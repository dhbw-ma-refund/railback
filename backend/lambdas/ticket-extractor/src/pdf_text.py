"""PDF text-layer extraction — second tier of the ticket-extractor cascade.

This module is intentionally conservative: false negatives over false positives.
If we cannot confidently parse a field, we omit it from the returned dict
rather than guessing. The user can always fall through to MANUAL.

Strategy:
    1. `extract_pdf_text(raw_bytes)` opens the bytes via pymupdf and concatenates
       the text-layer of every page. Returns None on parse failure / empty doc.
    2. `parse_pdf_text(text)` runs a battery of German DB-ticket regexes
       (each defined as a module-level constant for unit-testability) and
       returns a dict containing only the fields we successfully matched.

The field names returned mirror `ExtractionResult` in `schema.py` — the caller
(extract.py) merges them into an `ExtractionResult(method="PDF_TEXT", ...)`.

DB_SCHEMA.md (root of repo) is authoritative for field naming. Update both
together when a field is added/renamed.
"""

from __future__ import annotations

import io
import logging
import re
from datetime import date
from typing import Optional

import fitz  # pymupdf

log = logging.getLogger(__name__)

# Defensive page-iteration caps — shared with `aztec.py`. Real DB tickets are
# 1–2 pages (sammeltickets max ~4). A crafted multi-page PDF could otherwise
# OOM the Lambda (pixmap path in aztec.py) or accumulate hundreds of MB of
# concatenated text. We cap both paths to the same low ceiling.
MAX_PDF_PAGES = 5
MAX_TEXT_BYTES = 2 * 1024 * 1024  # 2 MB — real ticket text-layers are <50 KB


# ---------------------------------------------------------------------------
# Regex constants — exposed at module level so each can be unit-tested in
# isolation by name. Naming convention: `_RE_<FIELD>`.
# ---------------------------------------------------------------------------

# Fahrkartennummer / Auftragsnummer: DB labels these as "Auftragsnummer"
# (sometimes "Auftrag") followed by an alphanumeric 10–14 character code.
# We anchor on the label to avoid greedy-matching arbitrary IDs elsewhere
# in the page.
_RE_FAHRKARTENNUMMER = re.compile(
    r"""
    Auftrag(?:s\s*nummer)?     # Auftrag / Auftragsnummer / Auftrag  s  nummer
    \s*[:\-]?\s*               # optional label punctuation
    ([A-Z0-9]{8,14})           # the code itself — uppercase alphanum, 8–14 chars
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Preis: "12,34 €" or "Preis: 12,34 EUR" — German decimal comma.
# We deliberately accept both "€" and "EUR" and optionally an explicit label.
_RE_PREIS = re.compile(
    r"""
    (?:Preis\s*[:\-]?\s*)?     # optional "Preis:" label
    (\d{1,4},\d{2})            # the number itself (German decimal)
    \s*
    (?:€|EUR)                  # currency suffix is required to disambiguate
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Abreisedatum: a date in DD.MM.YYYY form that appears near "Hinfahrt" /
# "Abfahrt" / "Reisetag". We allow the keyword to be either before (within
# 60 chars) or on the same line. The DD.MM.YYYY → YYYY-MM-DD conversion
# happens in `_parse_german_date_to_iso` below so the value we persist
# matches `iso8601DateSchema` (^\d{4}-\d{2}-\d{2}$) used by
# `@railback/lib/schemas/ticket.ts` and DB_SCHEMA.md. Without conversion
# admin-side GSI1 keys (TRAIN#<nr>#<date>) and DTO validation on the user
# side would both drift (P2 — external review 2026-06-29).
_RE_ABREISEDATUM = re.compile(
    r"""
    (?:Hinfahrt|Abfahrt|Reisetag|Reisedatum|Datum)
    [^\n\r]{0,60}?             # any non-newline chars, lazy, capped
    (\d{2}\.\d{2}\.\d{4})      # DD.MM.YYYY — converted to ISO before persist
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _parse_german_date_to_iso(german: str) -> Optional[str]:
    """Convert DD.MM.YYYY → YYYY-MM-DD with calendar validation.

    Returns None on malformed input or impossible dates (e.g. 31.02.2026,
    32.13.2026, year < 2000 / > 2100). Conservative bounds protect against
    OCR-style garbage that happens to match the regex shape.
    """
    parts = german.split(".")
    if len(parts) != 3:
        return None
    try:
        dd, mm, yyyy = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None
    if not (2000 <= yyyy <= 2100):
        return None
    try:
        return date(yyyy, mm, dd).isoformat()
    except ValueError:
        # impossible calendar date — drop rather than persist garbage
        return None

# Abfahrtszeit: HH:MM after one of the trip-leg keywords. Same proximity
# constraint as the date regex.
_RE_ABFAHRTSZEIT = re.compile(
    r"""
    (?:Abfahrt|Hinfahrt|ab\b)
    [^\n\r]{0,60}?
    (\d{2}:\d{2})              # HH:MM
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Zugnummer: ICE/IC/EC/RE/RB/S/TGV plus 2–5 digits. The space between prefix
# and number is optional (real tickets sometimes render "ICE123" vs "ICE 123").
_RE_ZUGNUMMER = re.compile(
    r"""
    \b
    (ICE|IC|EC|RE|RB|S|TGV)    # train category
    \s*
    (\d{2,5})                  # train number
    \b
    """,
    re.VERBOSE,  # case-sensitive — DB renders categories in uppercase
)

# Bahnhöfe — "Von: X Nach: Y" labelled form, or the arrow form
# "Mannheim Hbf → Karlsruhe Hbf". The station regex itself is permissive:
# letters (incl. umlauts), spaces, dots, parens; stops at the separator.
#
# The arrow form intentionally accepts ONLY `→` and `->` (no em-dash /
# en-dash). Em-dash / en-dash appear routinely in German prose ("Reise –
# Bitte beachten Sie...", "01.01. – 31.12.") and would let the regex
# false-match arbitrary text. Real DB-ticket renderings use the Unicode
# arrow or the ASCII variant — dashes are a typographic separator, not
# a "from-to" marker.
_STATION_CHARS = r"[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9 .()/'-]{1,40}?"

_RE_VON_NACH = re.compile(
    rf"""
    Von\s*[:\-]?\s*({_STATION_CHARS})
    \s*[\n\r]*\s*
    Nach\s*[:\-]?\s*({_STATION_CHARS})
    (?:\s*[\n\r]|$)
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Arrow form — line-anchored to avoid mid-sentence matches. Both sides must
# start with an uppercase letter (DB station names are Title-Case in render).
_RE_ARROW = re.compile(
    rf"""
    (?:^|[\n\r])\s*
    ([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9 .()/'-]{{1,40}}?)
    \s*
    (?:→|->)                    # arrow only — em-dash / en-dash dropped
    \s*
    ([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9 .()/'-]{{1,40}}?)
    (?:\s*[\n\r]|$)
    """,
    re.VERBOSE,
)

# Name: "Herr Hans Müller" / "Frau Maria Schmidt" — DB tickets place a
# salutation line near the top. We accept salutations Herr/Frau and capture
# Vorname + Nachname. The name parts must begin with an uppercase letter
# (Unicode), can contain hyphens, and the full match is anchored to a line
# boundary on the left to avoid mid-sentence matches.
_RE_NAME_SALUTATION = re.compile(
    r"""
    (?:^|[\n\r])\s*
    (?:Herr|Frau)\s+
    ([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]{1,30})   # Vorname
    \s+
    ([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]{1,30})   # Nachname
    \b
    """,
    re.VERBOSE,
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_pdf_text(raw_bytes: bytes) -> Optional[str]:
    """Open a PDF from bytes and return its concatenated text-layer.

    Returns None on:
        - pymupdf failure to open the bytes (corrupt / not-a-PDF)
        - empty doc (zero pages)
        - all pages have empty text

    Never raises — callers in the cascade rely on this to fall through to
    MANUAL.
    """
    if not raw_bytes:
        return None

    try:
        doc = fitz.open(stream=io.BytesIO(raw_bytes).getvalue(), filetype="pdf")
    except Exception as exc:  # pymupdf raises various low-level errors
        log.debug("pymupdf could not open bytes as PDF", exc_info=exc)
        return None

    try:
        if doc.page_count == 0:
            return None

        # Hard page cap — see MAX_PDF_PAGES (DoS defence). Real DB tickets
        # are 1–2 pages; anything beyond MAX_PDF_PAGES is either a crafted
        # multi-page PDF or a non-ticket and we refuse to drown in pixmaps
        # / text concat.
        if doc.page_count > MAX_PDF_PAGES:
            log.debug(
                "extract_pdf_text: page_count %s exceeds cap %s; returning None",
                doc.page_count,
                MAX_PDF_PAGES,
            )
            return None

        chunks: list[str] = []
        total_bytes = 0
        for page in doc:
            try:
                txt = page.get_text() or ""
            except Exception as exc:  # one bad page shouldn't kill the whole doc
                log.debug("pymupdf get_text failed on page", exc_info=exc)
                txt = ""
            if txt:
                chunks.append(txt)
                # Crude byte estimate (utf-8 over-counts only for non-BMP);
                # we want to break early if a single page exploded the size.
                total_bytes += len(txt.encode("utf-8", errors="ignore"))
                if total_bytes > MAX_TEXT_BYTES:
                    log.debug(
                        "extract_pdf_text: accumulated text exceeds %s bytes; truncating",
                        MAX_TEXT_BYTES,
                    )
                    break

        if not chunks:
            return None
        return "\n".join(chunks)
    finally:
        doc.close()


def parse_pdf_text(text: str) -> dict[str, str]:
    """Run all DB-ticket regexes over `text` and return whatever matched.

    Absent fields are OMITTED (not present in the dict as None) so callers
    can use `.get` / merge semantics naturally. Keys match `ExtractionResult`
    field names so the caller can splat the dict into the model constructor.
    """
    out: dict[str, str] = {}
    if not text:
        return out

    # Fahrkartennummer
    m = _RE_FAHRKARTENNUMMER.search(text)
    if m:
        out["fahrt_fahrkartennummer"] = m.group(1).upper()

    # Preis — German decimal comma → ISO dot for the schema field
    m = _RE_PREIS.search(text)
    if m:
        out["fahrt_fahrkartenpreis"] = m.group(1).replace(",", ".")

    # Abreisedatum — schema/DB demand YYYY-MM-DD (iso8601DateSchema). The
    # regex captures DD.MM.YYYY (typical German display form); convert
    # before persist. Invalid calendar dates drop silently — conservative-
    # over-precise principle.
    m = _RE_ABREISEDATUM.search(text)
    if m:
        iso = _parse_german_date_to_iso(m.group(1))
        if iso:
            out["fahrt_abreisedatum"] = iso

    # Abfahrtszeit
    m = _RE_ABFAHRTSZEIT.search(text)
    if m:
        out["fahrt_abfahrtszeit_plan"] = m.group(1)

    # Zugnummer + Zugkategorie
    m = _RE_ZUGNUMMER.search(text)
    if m:
        kat, nummer = m.group(1), m.group(2)
        out["fahrt_zugkategorie_plan"] = kat
        out["fahrt_zugnummer_plan"] = f"{kat} {nummer}"

    # Bahnhöfe — try labelled form first, fall back to arrow form
    m = _RE_VON_NACH.search(text)
    if m:
        out["fahrt_abreisebahnhof"] = m.group(1).strip()
        out["fahrt_zielbahnhof"] = m.group(2).strip()
    else:
        m = _RE_ARROW.search(text)
        if m:
            von = m.group(1).strip()
            nach = m.group(2).strip()
            # Defensive: skip if either side looks too short / clearly noise.
            if len(von) >= 2 and len(nach) >= 2:
                out["fahrt_abreisebahnhof"] = von
                out["fahrt_zielbahnhof"] = nach

    # Name
    m = _RE_NAME_SALUTATION.search(text)
    if m:
        out["vorname_aus_ticket"] = m.group(1)
        out["nachname_aus_ticket"] = m.group(2)

    return out
