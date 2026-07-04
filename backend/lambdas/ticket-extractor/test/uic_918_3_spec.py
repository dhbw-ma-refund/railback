"""UIC 918.3 parser wrapper — tests against a fake `OT` class.

Strategy: the vendored `onlineticket.OT` class wants real DB ticket
bytes to be useful, and we will not ship a real ticket sample for
privacy + GPL reasons. So we monkeypatch the class attribute on the
module under test (`uic_918_3.OT`) to a fake that returns canned
`.header` and `.data['ticket']` block lists. That gives us full
control over the field-translation matrix AND the signature-validity
gate.

The fake mirrors the relevant shape:

    ot.header = {"signature_validity": "VALID", ...}
    ot.data = {
        "ticket": [
            <object with .__class__.__name__ == "OT_U_HEAD" and .data dict>,
            <object with .__class__.__name__ == "OT_0080BL"  and .data dict>,
            <object with .__class__.__name__ == "OT_0080VU"  and .data dict>,
        ]
    }

Each fake block carries the minimal attributes the wrapper reads.
`signature_validity` lives on `ot.header`, NOT as a child block — the
real vendored parser populates it via `dict_read(self.generic)` (see
vendor/onlineticket.py:84,492). Default is 'VALID' so the happy-path
fixtures don't need to repeat it; sig-gate tests override explicitly.
"""

from __future__ import annotations

import datetime
from typing import Any

import pytest

from src import uic_918_3


# ---------------------------------------------------------------------------
# Fake-block helpers
# ---------------------------------------------------------------------------


def _make_block(class_name: str, data: dict[str, Any]) -> Any:
    """Build an instance whose class.__name__ matches `class_name`."""
    cls = type(class_name, (), {})
    inst = cls()
    inst.data = data
    return inst


def _make_ot(blocks: list[Any], signature_validity: str | None = "VALID") -> Any:
    """Build a fake `OT` instance carrying the given blocks.

    `signature_validity` defaults to 'VALID' so happy-path tests don't
    have to repeat it. Pass an INVALID string (or None) to exercise the
    signature-validity gate.
    """

    class _FakeOT:
        def __init__(self, _payload: bytes) -> None:
            self.header = {"signature_validity": signature_validity}
            self.data = {"ticket": blocks}

    return _FakeOT


# ---------------------------------------------------------------------------
# Happy path — every field flows through correctly.
# ---------------------------------------------------------------------------


def test_parse_uic_918_3_translates_all_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    """Full-fat translation: 8+ fields all populated, correct shapes."""
    gueltig_von = datetime.datetime(2026, 7, 4, 8, 30)
    blocks = [
        _make_block(
            "OT_U_HEAD",
            {
                "auftragsnummer": b"ABCD1234",
                "creation_date": datetime.datetime(2026, 6, 30, 10, 0),
            },
        ),
        _make_block(
            "OT_0080BL",
            {
                "data": {
                    "Vorname, Name": ["Erika", "Mustermann"],
                    "H-Start-Bf": "Frankfurt(Main)Hbf",
                    "H-Ziel-Bf": "München Hbf",
                    "Gültig von": gueltig_von,
                }
            },
        ),
        _make_block(
            "OT_0080VU",
            {"efs": [{"preis": 7995}]},
        ),
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks))

    result = uic_918_3.parse_uic_918_3(b"any-non-empty-bytes")

    assert result is not None
    assert result["barcode_uid"] == "ABCD1234"
    assert result["vorname_aus_ticket"] == "Erika"
    assert result["nachname_aus_ticket"] == "Mustermann"
    assert result["fahrt_fahrkartennummer"] == "ABCD1234"
    assert result["fahrt_fahrkartenpreis"] == "79.95"
    assert result["fahrt_abreisebahnhof"] == "Frankfurt(Main)Hbf"
    assert result["fahrt_zielbahnhof"] == "München Hbf"
    assert result["fahrt_abreisedatum"] == "2026-07-04"
    assert result["fahrt_abfahrtszeit_plan"] == "08:30"


def test_parse_uic_918_3_with_hash_separated_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Some carriers ship 'Vorname, Name' as a `Vorname#Nachname` string
    instead of a 2-list. The split helper must handle both."""
    blocks = [
        _make_block("OT_U_HEAD", {"auftragsnummer": b"XYZ987"}),
        _make_block(
            "OT_0080BL",
            {"data": {"Vorname, Name": "Max#Mustermann"}},
        ),
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks))

    result = uic_918_3.parse_uic_918_3(b"payload")
    assert result is not None
    assert result["vorname_aus_ticket"] == "Max"
    assert result["nachname_aus_ticket"] == "Mustermann"


def test_parse_uic_918_3_falls_back_to_personenname(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If `Vorname, Name` is missing, `Personenname` (023) is the fallback."""
    blocks = [
        _make_block("OT_U_HEAD", {"auftragsnummer": b"PN001234"}),
        _make_block(
            "OT_0080BL",
            {"data": {"Personenname": "Anna, Beispiel"}},
        ),
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks))

    result = uic_918_3.parse_uic_918_3(b"payload")
    assert result is not None
    assert result["vorname_aus_ticket"] == "Anna"
    assert result["nachname_aus_ticket"] == "Beispiel"


def test_parse_uic_918_3_falls_back_to_vorgangsnr_for_uid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When U_HEAD has no `auftragsnummer`, the 019 S-block is the
    secondary source of the ticket UID."""
    blocks = [
        _make_block("OT_U_HEAD", {}),
        _make_block(
            "OT_0080BL",
            {"data": {"Vorgangsnr./Flugscheinnr.": "FALLBACK99"}},
        ),
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks))

    result = uic_918_3.parse_uic_918_3(b"payload")
    assert result is not None
    assert result["barcode_uid"] == "FALLBACK99"


# ---------------------------------------------------------------------------
# Decline paths — must surface None so the cascade can fall through.
# ---------------------------------------------------------------------------


def test_parse_uic_918_3_returns_none_on_missing_uid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No `auftragsnummer` AND no `Vorgangsnr.` → cannot classify as BARCODE."""
    blocks = [
        _make_block("OT_U_HEAD", {}),
        _make_block("OT_0080BL", {"data": {"H-Start-Bf": "Berlin Hbf"}}),
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks))

    assert uic_918_3.parse_uic_918_3(b"payload") is None


def test_parse_uic_918_3_returns_none_on_empty_payload() -> None:
    """Empty bytes is a fast-path None — no OT construction attempted."""
    assert uic_918_3.parse_uic_918_3(b"") is None


def test_parse_uic_918_3_returns_none_when_ot_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the vendored module failed to import, gracefully degrade."""
    monkeypatch.setattr(uic_918_3, "OT", None)
    assert uic_918_3.parse_uic_918_3(b"any-bytes") is None


def test_parse_uic_918_3_returns_none_on_constructor_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`OT(...)` raising on malformed input is caught; cascade falls through."""

    class _BoomOT:
        def __init__(self, _payload: bytes) -> None:
            raise ValueError("malformed UIC 918.3 payload")

    monkeypatch.setattr(uic_918_3, "OT", _BoomOT)
    assert uic_918_3.parse_uic_918_3(b"garbage") is None


def test_parse_uic_918_3_returns_none_on_empty_ticket_blocks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty block list → no UID → None."""
    monkeypatch.setattr(uic_918_3, "OT", _make_ot([]))
    assert uic_918_3.parse_uic_918_3(b"payload") is None


def test_parse_uic_918_3_strips_none_optionals(monkeypatch: pytest.MonkeyPatch) -> None:
    """Optional fields that weren't extracted are absent from the result
    (not None-valued) — keeps the persist layer's update expression
    tidy."""
    blocks = [
        _make_block("OT_U_HEAD", {"auftragsnummer": b"MIN12345"}),
        _make_block("OT_0080BL", {"data": {}}),
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks))

    result = uic_918_3.parse_uic_918_3(b"payload")
    assert result is not None
    assert "barcode_uid" in result
    # vorname/nachname/etc. shouldn't appear at all since they're None.
    assert "vorname_aus_ticket" not in result
    assert "fahrt_abreisebahnhof" not in result
    assert "fahrt_fahrkartenpreis" not in result


def test_parse_uic_918_3_handles_int_preis(monkeypatch: pytest.MonkeyPatch) -> None:
    """Edge-case cent values format correctly (no float-rounding artefacts)."""
    blocks = [
        _make_block("OT_U_HEAD", {"auftragsnummer": b"PRICE001"}),
        _make_block("OT_0080BL", {"data": {}}),
        _make_block("OT_0080VU", {"efs": [{"preis": 1}]}),  # 1 cent
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks))

    result = uic_918_3.parse_uic_918_3(b"payload")
    assert result is not None
    assert result["fahrt_fahrkartenpreis"] == "0.01"


def test_parse_uic_918_3_decodes_bytes_safely(monkeypatch: pytest.MonkeyPatch) -> None:
    """UTF-8 byte fields (including null padding) survive the decode helper."""
    blocks = [
        _make_block("OT_U_HEAD", {"auftragsnummer": b"UTF8AB\x00\x00"}),
        _make_block(
            "OT_0080BL",
            {"data": {"H-Start-Bf": b"K\xc3\xb6ln Hbf"}},  # "Köln Hbf"
        ),
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks))

    result = uic_918_3.parse_uic_918_3(b"payload")
    assert result is not None
    assert result["barcode_uid"] == "UTF8AB"
    assert result["fahrt_abreisebahnhof"] == "Köln Hbf"


# ---------------------------------------------------------------------------
# Signature-validity gate (security-edge: forged-barcode defence)
# ---------------------------------------------------------------------------


def test_parse_uic_918_3_rejects_invalid_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A UIC payload whose OT.header['signature_validity'] != 'VALID' must
    NOT be classified as BARCODE — a forged payload would otherwise sail
    through with confidence 1.0 and poison GSI2. `signature_validity`
    lives on `ot.header` (populated by `dict_read(self.generic)`), not
    as a child block."""
    blocks = [
        _make_block("OT_U_HEAD", {"auftragsnummer": b"FAKE1234"}),
        _make_block("OT_0080BL", {"data": {"H-Start-Bf": "Berlin Hbf"}}),
    ]
    monkeypatch.setattr(
        uic_918_3,
        "OT",
        _make_ot(blocks, signature_validity="INVALID (asn1 decode error)"),
    )

    assert uic_918_3.parse_uic_918_3(b"forged") is None


def test_parse_uic_918_3_rejects_missing_signature_validity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Fail-closed: if the header carries no signature_validity at all
    (or None), we cannot prove the payload is genuine and must decline.
    Belt-and-braces against a vendored-parser upgrade that renames the
    field or a mock that forgets to populate it."""
    blocks = [
        _make_block("OT_U_HEAD", {"auftragsnummer": b"NOSIG001"}),
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks, signature_validity=None))

    assert uic_918_3.parse_uic_918_3(b"headerless") is None


def test_parse_uic_918_3_accepts_valid_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sanity-check the inverse: an explicit 'VALID' signature must pass."""
    blocks = [
        _make_block("OT_U_HEAD", {"auftragsnummer": b"REAL1234"}),
    ]
    monkeypatch.setattr(
        uic_918_3, "OT", _make_ot(blocks, signature_validity="VALID")
    )

    result = uic_918_3.parse_uic_918_3(b"genuine")
    assert result is not None
    assert result["barcode_uid"] == "REAL1234"


# ---------------------------------------------------------------------------
# Strict date/time formatters (schema-boundary defence)
# ---------------------------------------------------------------------------


def test_format_time_rejects_garbage_strings() -> None:
    """The schema field is HH:MM — non-time strings must surface as None."""
    assert uic_918_3._format_time("ab:cd") is None
    assert uic_918_3._format_time("24:99") is None  # invalid hour AND minute
    assert uic_918_3._format_time("xx") is None
    assert uic_918_3._format_time(None) is None


def test_format_time_accepts_well_formed() -> None:
    """Real time inputs round-trip."""
    assert uic_918_3._format_time("08:30") == "08:30"
    assert uic_918_3._format_time("0830") == "08:30"
    # 23:59 is the latest valid value.
    assert uic_918_3._format_time("23:59") == "23:59"


def test_format_date_rejects_garbage_strings() -> None:
    """The schema field is YYYY-MM-DD — non-date strings must surface as None.

    Note: the regex enforces shape (YYYY-MM-DD with month 01-12 and day
    01-31) but does NOT do full calendar validation (Feb 30 passes). That's
    acceptable — the goal is to keep the DDB-side field from getting
    string garbage, not to assert the date is real.
    """
    assert uic_918_3._format_date("not-a-date") is None
    assert uic_918_3._format_date("2026-13-01") is None  # invalid month
    assert uic_918_3._format_date("2026-00-01") is None  # zero month
    assert uic_918_3._format_date("2026-01-32") is None  # day > 31
    assert uic_918_3._format_date(None) is None


def test_format_date_accepts_well_formed() -> None:
    """Real ISO date inputs round-trip."""
    assert uic_918_3._format_date("2026-07-04") == "2026-07-04"


# ---------------------------------------------------------------------------
# Name splitting — whitespace fallback (defence against single-string names)
# ---------------------------------------------------------------------------


def test_split_name_whitespace_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """A name carried as a single whitespace-separated string (no #, no ,)
    must split on whitespace: last token = nachname, rest = vorname.
    Defends against an attacker-crafted payload that bypasses the structured
    fields and a legitimate older-generation ticket that ships only 023."""
    blocks = [
        _make_block("OT_U_HEAD", {"auftragsnummer": b"WSNAME01"}),
        _make_block("OT_0080BL", {"data": {"Personenname": "Hans Müller"}}),
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks))

    result = uic_918_3.parse_uic_918_3(b"payload")
    assert result is not None
    assert result["vorname_aus_ticket"] == "Hans"
    assert result["nachname_aus_ticket"] == "Müller"


def test_split_name_whitespace_multi_part(monkeypatch: pytest.MonkeyPatch) -> None:
    """Compound vornames: 'Anna-Maria von Beispiel' → vorname='Anna-Maria von',
    nachname='Beispiel'."""
    blocks = [
        _make_block("OT_U_HEAD", {"auftragsnummer": b"WSNAME02"}),
        _make_block(
            "OT_0080BL",
            {"data": {"Personenname": "Anna-Maria von Beispiel"}},
        ),
    ]
    monkeypatch.setattr(uic_918_3, "OT", _make_ot(blocks))

    result = uic_918_3.parse_uic_918_3(b"payload")
    assert result is not None
    assert result["vorname_aus_ticket"] == "Anna-Maria von"
    assert result["nachname_aus_ticket"] == "Beispiel"
