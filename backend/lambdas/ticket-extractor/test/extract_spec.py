"""Cascade orchestrator tests — mock module boundaries.

Strategy: monkeypatch `decode_aztec`, `parse_uic_918_3`, `extract_pdf_text`,
`parse_pdf_text` at the boundary (where `extract.py` imports them). Each
test forces a specific tier to succeed/fail/raise and asserts the cascade
order + fall-through + exception-swallow behaviour.

No real ticket fixtures — we don't ship them (privacy / GPL boundary).
"""

from __future__ import annotations

from typing import Any

import pytest

from src import extract
from src.schema import ExtractionResult


# ---------------------------------------------------------------------------
# Fakes — small helpers so each test reads top-down without inline lambdas.
# ---------------------------------------------------------------------------


def _raise(*_args: Any, **_kwargs: Any) -> Any:
    raise RuntimeError("boom")


def _none(*_args: Any, **_kwargs: Any) -> Any:
    return None


_BARCODE_DICT = {
    "barcode_uid": "ABC12345",
    "vorname_aus_ticket": "Hans",
    "nachname_aus_ticket": "Müller",
    "fahrt_fahrkartennummer": "ABC12345",
}

_PDF_TEXT_DICT = {
    "fahrt_zugnummer_plan": "ICE 123",
    "fahrt_zugkategorie_plan": "ICE",
    "fahrt_abreisedatum": "29.06.2026",
}


# ---------------------------------------------------------------------------
# BARCODE tier
# ---------------------------------------------------------------------------


def test_barcode_wins_over_pdf_text(monkeypatch: pytest.MonkeyPatch) -> None:
    """When Aztec yields a payload AND UIC parses cleanly, we return BARCODE
    and never invoke the PDF-text tier."""
    pdf_calls: list[bytes] = []

    monkeypatch.setattr(extract, "decode_aztec", lambda b, ct: b"\x01\x02")
    monkeypatch.setattr(extract, "parse_uic_918_3", lambda payload: _BARCODE_DICT)

    def _pdf(_b: bytes) -> str:
        pdf_calls.append(_b)
        return "text"

    monkeypatch.setattr(extract, "extract_pdf_text", _pdf)
    monkeypatch.setattr(extract, "parse_pdf_text", lambda t: _PDF_TEXT_DICT)

    result = extract.run_cascade(b"raw", "application/pdf")

    assert result.method == "BARCODE"
    assert result.confidence == 1.0
    assert result.barcode_uid == "ABC12345"
    assert result.vorname_aus_ticket == "Hans"
    assert pdf_calls == []  # PDF tier never invoked


def test_barcode_decode_returns_none_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """No Aztec payload → BARCODE skipped, PDF_TEXT tier runs."""
    monkeypatch.setattr(extract, "decode_aztec", _none)
    monkeypatch.setattr(extract, "parse_uic_918_3", _raise)  # must not be called
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: "DB ticket text")
    monkeypatch.setattr(extract, "parse_pdf_text", lambda _t: _PDF_TEXT_DICT)

    result = extract.run_cascade(b"raw", "application/pdf")

    assert result.method == "PDF_TEXT"
    assert result.confidence == 0.95
    assert result.fahrt_zugnummer_plan == "ICE 123"


def test_barcode_decode_raises_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """decode_aztec raising must NOT crash the cascade — falls through."""
    monkeypatch.setattr(extract, "decode_aztec", _raise)
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: "text")
    monkeypatch.setattr(extract, "parse_pdf_text", lambda _t: _PDF_TEXT_DICT)

    result = extract.run_cascade(b"raw", "application/pdf")

    assert result.method == "PDF_TEXT"


def test_uic_raises_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """parse_uic_918_3 raising must NOT crash — falls through to PDF_TEXT."""
    monkeypatch.setattr(extract, "decode_aztec", lambda b, ct: b"\xff")
    monkeypatch.setattr(extract, "parse_uic_918_3", _raise)
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: "text")
    monkeypatch.setattr(extract, "parse_pdf_text", lambda _t: _PDF_TEXT_DICT)

    result = extract.run_cascade(b"raw", "application/pdf")

    assert result.method == "PDF_TEXT"


def test_uic_missing_barcode_uid_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """UIC parsing succeeds but the dict has no `barcode_uid` → not enough
    signal to claim BARCODE; fall through."""
    monkeypatch.setattr(extract, "decode_aztec", lambda b, ct: b"\xff")
    monkeypatch.setattr(extract, "parse_uic_918_3", lambda _p: {"vorname_aus_ticket": "Hans"})
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: "text")
    monkeypatch.setattr(extract, "parse_pdf_text", lambda _t: _PDF_TEXT_DICT)

    result = extract.run_cascade(b"raw", "application/pdf")

    assert result.method == "PDF_TEXT"


# ---------------------------------------------------------------------------
# PDF_TEXT tier
# ---------------------------------------------------------------------------


def test_pdf_text_wins_when_no_barcode(monkeypatch: pytest.MonkeyPatch) -> None:
    """No Aztec, PDF text-layer yields signal fields → PDF_TEXT result."""
    monkeypatch.setattr(extract, "decode_aztec", _none)
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: "ICE 123 Hinfahrt 29.06.2026")
    monkeypatch.setattr(extract, "parse_pdf_text", lambda _t: _PDF_TEXT_DICT)

    result = extract.run_cascade(b"raw", "application/pdf")

    assert result.method == "PDF_TEXT"
    assert result.confidence == 0.95
    assert result.fahrt_zugnummer_plan == "ICE 123"


def test_pdf_text_skipped_when_content_type_not_pdf(monkeypatch: pytest.MonkeyPatch) -> None:
    """An image upload (`content_type=image/jpeg`) must skip PDF parsing
    entirely — go straight from BARCODE-miss to MANUAL."""
    pdf_calls: list[bytes] = []

    monkeypatch.setattr(extract, "decode_aztec", _none)

    def _pdf(_b: bytes) -> str:
        pdf_calls.append(_b)
        return "text"

    monkeypatch.setattr(extract, "extract_pdf_text", _pdf)
    monkeypatch.setattr(extract, "parse_pdf_text", lambda _t: _PDF_TEXT_DICT)

    result = extract.run_cascade(b"raw", "image/jpeg")

    assert result.method == "MANUAL"
    assert pdf_calls == []


def test_pdf_text_runs_when_content_type_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """Permissive gate: content_type=None lets the PDF tier try anyway.
    pymupdf will quickly reject non-PDFs."""
    monkeypatch.setattr(extract, "decode_aztec", _none)
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: "text")
    monkeypatch.setattr(extract, "parse_pdf_text", lambda _t: _PDF_TEXT_DICT)

    result = extract.run_cascade(b"raw", None)
    assert result.method == "PDF_TEXT"


def test_pdf_text_raise_extract_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """extract_pdf_text raising must NOT crash — falls through to MANUAL."""
    monkeypatch.setattr(extract, "decode_aztec", _none)
    monkeypatch.setattr(extract, "extract_pdf_text", _raise)

    result = extract.run_cascade(b"raw", "application/pdf")
    assert result.method == "MANUAL"


def test_pdf_text_raise_parse_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """parse_pdf_text raising must NOT crash — falls through to MANUAL."""
    monkeypatch.setattr(extract, "decode_aztec", _none)
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: "text")
    monkeypatch.setattr(extract, "parse_pdf_text", _raise)

    result = extract.run_cascade(b"raw", "application/pdf")
    assert result.method == "MANUAL"


def test_pdf_text_empty_text_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """extract_pdf_text returning empty/None → fall through to MANUAL."""
    monkeypatch.setattr(extract, "decode_aztec", _none)
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: None)
    monkeypatch.setattr(extract, "parse_pdf_text", _raise)  # must not be called

    result = extract.run_cascade(b"raw", "application/pdf")
    assert result.method == "MANUAL"


def test_pdf_text_no_signal_fields_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """parse_pdf_text returns a dict with no signal fields → MANUAL."""
    monkeypatch.setattr(extract, "decode_aztec", _none)
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: "junk")
    # Only the name fields hit, not a single trip-signal field → MANUAL.
    monkeypatch.setattr(
        extract,
        "parse_pdf_text",
        lambda _t: {"vorname_aus_ticket": "Hans", "nachname_aus_ticket": "Müller"},
    )

    result = extract.run_cascade(b"raw", "application/pdf")
    assert result.method == "MANUAL"


# ---------------------------------------------------------------------------
# MANUAL fallback
# ---------------------------------------------------------------------------


def test_manual_when_nothing_extracts(monkeypatch: pytest.MonkeyPatch) -> None:
    """All tiers return nothing → MANUAL with no fields populated."""
    monkeypatch.setattr(extract, "decode_aztec", _none)
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: None)

    result = extract.run_cascade(b"raw", "application/pdf")

    assert result.method == "MANUAL"
    assert result.confidence == 0.0
    assert result.barcode_uid is None
    assert result.vorname_aus_ticket is None
    assert result.fahrt_zugnummer_plan is None


def test_manual_when_all_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    """All tiers raise → MANUAL (no crash)."""
    monkeypatch.setattr(extract, "decode_aztec", _raise)
    monkeypatch.setattr(extract, "extract_pdf_text", _raise)

    result = extract.run_cascade(b"raw", "application/pdf")
    assert result.method == "MANUAL"
    assert result.confidence == 0.0


def test_manual_result_is_valid_extraction_result(monkeypatch: pytest.MonkeyPatch) -> None:
    """The MANUAL fallback is a real ExtractionResult that round-trips
    through pydantic — defensive check against a future schema change
    breaking the fallback."""
    monkeypatch.setattr(extract, "decode_aztec", _none)
    monkeypatch.setattr(extract, "extract_pdf_text", lambda _b: None)

    result = extract.run_cascade(b"", None)
    assert isinstance(result, ExtractionResult)
    # round-trips via model_dump
    dumped = result.model_dump(exclude_none=True)
    assert dumped == {"method": "MANUAL", "confidence": 0.0}
