"""Tests for src/pdf_text.py — the PDF text-layer extractor + regex parser.

PDFs are generated inline via pymupdf (`fitz.open()` → `page.insert_text()`).
This is privacy-safe (no real ticket bundling) and lets us assert exact text
round-trips through the extractor.
"""

from __future__ import annotations

from typing import Optional

import fitz
import pytest

from src.pdf_text import (
    _RE_ABFAHRTSZEIT,
    _RE_ABREISEDATUM,
    _RE_ARROW,
    _RE_FAHRKARTENNUMMER,
    _RE_NAME_SALUTATION,
    _RE_PREIS,
    _RE_VON_NACH,
    _RE_ZUGNUMMER,
    _parse_german_date_to_iso,
    extract_pdf_text,
    parse_pdf_text,
)


# ---------------------------------------------------------------------------
# Helpers — inline PDF generation
# ---------------------------------------------------------------------------


def _build_pdf(body: str) -> bytes:
    """Render `body` as one-page PDF text and return the bytes.

    Uses pymupdf's built-in helvetica font (covers ASCII + a useful slice of
    Latin-1). German umlauts pass through cleanly via insert_text's default
    encoding handling.
    """
    doc = fitz.open()  # empty
    page = doc.new_page()
    # Insert each line separately at increasing y-offsets so the text-layer
    # has predictable line breaks.
    y = 72.0
    for line in body.splitlines() or [body]:
        page.insert_text((72, y), line, fontsize=10)
        y += 14.0
    raw = doc.tobytes()
    doc.close()
    return raw


# ---------------------------------------------------------------------------
# extract_pdf_text — round-trip + failure modes
# ---------------------------------------------------------------------------


class TestExtractPdfText:
    def test_round_trip_known_text(self) -> None:
        body = "Hello RailBack\nFahrkartennummer ABC123XYZ"
        raw = _build_pdf(body)
        out = extract_pdf_text(raw)
        assert out is not None
        assert "Hello RailBack" in out
        assert "ABC123XYZ" in out

    def test_multi_line_concatenation(self) -> None:
        body = "Line one\nLine two\nLine three"
        raw = _build_pdf(body)
        out = extract_pdf_text(raw)
        assert out is not None
        for line in ("Line one", "Line two", "Line three"):
            assert line in out

    def test_returns_none_on_empty_bytes(self) -> None:
        assert extract_pdf_text(b"") is None

    def test_returns_none_on_garbage_bytes(self) -> None:
        # Not a PDF at all — pymupdf will refuse to open.
        assert extract_pdf_text(b"this is definitely not a PDF") is None

    def test_returns_none_on_truncated_pdf_header(self) -> None:
        # Has the magic %PDF marker but is otherwise corrupt.
        assert extract_pdf_text(b"%PDF-1.4\nbroken\x00\x00") is None


# ---------------------------------------------------------------------------
# Individual regex constants — parametrised, 3 positive + 1 negative each
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Auftragsnummer: ABC12345", "ABC12345"),
        ("Auftrag: XJ7K9LMN42", "XJ7K9LMN42"),
        ("Auftragsnummer ZZZ9999ABCD", "ZZZ9999ABCD"),
    ],
)
def test_re_fahrkartennummer_positive(text: str, expected: str) -> None:
    m = _RE_FAHRKARTENNUMMER.search(text)
    assert m is not None
    assert m.group(1) == expected


def test_re_fahrkartennummer_negative() -> None:
    # No label, no anchor — should not match arbitrary IDs.
    assert _RE_FAHRKARTENNUMMER.search("Some random text without that label") is None


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Preis: 12,34 €", "12,34"),
        ("99,99 EUR insgesamt", "99,99"),
        ("Gesamtbetrag 5,00 €", "5,00"),
    ],
)
def test_re_preis_positive(text: str, expected: str) -> None:
    m = _RE_PREIS.search(text)
    assert m is not None
    assert m.group(1) == expected


def test_re_preis_negative() -> None:
    # Number without currency suffix — must not match (ambiguous).
    assert _RE_PREIS.search("Sitznummer 12,34 Wagen 5") is None


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Hinfahrt am 15.07.2026", "15.07.2026"),
        ("Abfahrt: 03.12.2025 um 08:15", "03.12.2025"),
        ("Reisetag 01.01.2027 Hauptbahnhof", "01.01.2027"),
    ],
)
def test_re_abreisedatum_positive(text: str, expected: str) -> None:
    m = _RE_ABREISEDATUM.search(text)
    assert m is not None
    assert m.group(1) == expected


def test_re_abreisedatum_negative() -> None:
    # Date without trip-leg keyword — must not match.
    assert _RE_ABREISEDATUM.search("Geboren am 15.07.1990 in Berlin") is None


# P2 regression — DD.MM.YYYY → YYYY-MM-DD conversion (external review 2026-06-29).
# Schema/DB expect iso8601DateSchema (^\d{4}-\d{2}-\d{2}$); the parser previously
# persisted the German display form which broke DTO validation + GSI1 keys.
@pytest.mark.parametrize(
    "german,iso",
    [
        ("15.07.2026", "2026-07-15"),
        ("01.01.2026", "2026-01-01"),
        ("31.12.2030", "2030-12-31"),
        ("03.12.2026", "2026-12-03"),
        ("29.02.2024", "2024-02-29"),  # leap year — must be accepted
    ],
)
def test_parse_german_date_to_iso_positive(german: str, iso: str) -> None:
    assert _parse_german_date_to_iso(german) == iso


@pytest.mark.parametrize(
    "garbage",
    [
        "",
        "not-a-date",
        "15.07",
        "15/07/2026",       # wrong separator
        "32.07.2026",       # impossible day
        "15.13.2026",       # impossible month
        "31.02.2026",       # Feb-31
        "29.02.2025",       # non-leap-year Feb-29
        "15.07.1850",       # year below sane bound
        "15.07.2200",       # year above sane bound
        "aa.bb.cccc",
    ],
)
def test_parse_german_date_to_iso_drops_malformed(garbage: str) -> None:
    assert _parse_german_date_to_iso(garbage) is None


def test_parse_pdf_text_drops_field_on_invalid_calendar_date() -> None:
    """Regex matches DD.MM.YYYY shape but date is impossible → field is omitted,
    not persisted as a garbage string. Conservative-over-precise.
    """
    text = "Deutsche Bahn\nHinfahrt am 31.02.2026\n"
    out = parse_pdf_text(text)
    assert "fahrt_abreisedatum" not in out


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Abfahrt 08:15 Uhr", "08:15"),
        ("Hinfahrt um 14:42", "14:42"),
        ("ab 23:59 Mannheim", "23:59"),
    ],
)
def test_re_abfahrtszeit_positive(text: str, expected: str) -> None:
    m = _RE_ABFAHRTSZEIT.search(text)
    assert m is not None
    assert m.group(1) == expected


def test_re_abfahrtszeit_negative() -> None:
    # Time without trip-leg keyword — must not match.
    assert _RE_ABFAHRTSZEIT.search("Bestellt um 10:30 Uhr") is None


@pytest.mark.parametrize(
    "text,kat,nummer",
    [
        ("ICE 597 nach Hamburg", "ICE", "597"),
        ("Zug RE 4012", "RE", "4012"),
        ("TGV9876 Paris", "TGV", "9876"),
    ],
)
def test_re_zugnummer_positive(text: str, kat: str, nummer: str) -> None:
    m = _RE_ZUGNUMMER.search(text)
    assert m is not None
    assert m.group(1) == kat
    assert m.group(2) == nummer


def test_re_zugnummer_negative() -> None:
    # Lowercase — regex is case-sensitive on purpose (DB renders uppercase).
    assert _RE_ZUGNUMMER.search("ice 597") is None


@pytest.mark.parametrize(
    "text,von,nach",
    [
        ("Von: Mannheim Hbf\nNach: Karlsruhe Hbf\n", "Mannheim Hbf", "Karlsruhe Hbf"),
        ("Von Berlin Hbf Nach Hamburg Hbf\n", "Berlin Hbf", "Hamburg Hbf"),
        ("Von: München\nNach: Köln\n", "München", "Köln"),
    ],
)
def test_re_von_nach_positive(text: str, von: str, nach: str) -> None:
    m = _RE_VON_NACH.search(text)
    assert m is not None
    assert m.group(1).strip() == von
    assert m.group(2).strip() == nach


def test_re_von_nach_negative() -> None:
    # No "Von:" / "Nach:" — must not match.
    assert _RE_VON_NACH.search("Some other content without trip labels") is None


@pytest.mark.parametrize(
    "text,von,nach",
    [
        # Arrow form must be at line start with uppercase station names.
        ("Mannheim Hbf → Karlsruhe Hbf\n", "Mannheim Hbf", "Karlsruhe Hbf"),
        ("Berlin -> Hamburg\n", "Berlin", "Hamburg"),
        ("\nKöln → Frankfurt\n", "Köln", "Frankfurt"),
    ],
)
def test_re_arrow_positive(text: str, von: str, nach: str) -> None:
    m = _RE_ARROW.search(text)
    assert m is not None
    assert m.group(1).strip() == von
    assert m.group(2).strip() == nach


@pytest.mark.parametrize(
    "text",
    [
        # No arrow / dash — must not match.
        "Mannheim Hbf and Karlsruhe Hbf\n",
        # Em-dash / en-dash are German typographic separators (NOT arrows)
        # and would false-match arbitrary prose. The regex must reject them.
        "Frankfurt — Köln\n",
        "Reise – Bitte beachten Sie\n",
        # Mid-line match must be refused (no line-start anchor satisfied).
        "Strecke: Mannheim Hbf → Karlsruhe Hbf\n",
        # Lower-case station name must be refused (DB renders Title-Case).
        "berlin → hamburg\n",
    ],
)
def test_re_arrow_negative(text: str) -> None:
    assert _RE_ARROW.search(text) is None


@pytest.mark.parametrize(
    "text,vorname,nachname",
    [
        ("\nHerr Hans Müller\n", "Hans", "Müller"),
        ("Frau Maria Schmidt\n", "Maria", "Schmidt"),
        ("\nHerr Jean-Paul Sartre\n", "Jean-Paul", "Sartre"),
    ],
)
def test_re_name_salutation_positive(text: str, vorname: str, nachname: str) -> None:
    m = _RE_NAME_SALUTATION.search(text)
    assert m is not None
    assert m.group(1) == vorname
    assert m.group(2) == nachname


def test_re_name_salutation_negative() -> None:
    # No salutation — must not match.
    assert _RE_NAME_SALUTATION.search("Hans Müller fuhr nach Karlsruhe") is None


# ---------------------------------------------------------------------------
# parse_pdf_text — happy path, partial, nothing matches, empty
# ---------------------------------------------------------------------------


HAPPY_PATH_TEXT = """
Deutsche Bahn Fahrkarte
Herr Hans Müller
Auftragsnummer: ABC12345XY
Hinfahrt am 15.07.2026
Abfahrt 08:15 Uhr
Zug ICE 597
Von: Mannheim Hbf
Nach: Karlsruhe Hbf
Preis: 49,90 EUR
"""


class TestParsePdfText:
    def test_happy_path_all_fields(self) -> None:
        out = parse_pdf_text(HAPPY_PATH_TEXT)
        assert out["fahrt_fahrkartennummer"] == "ABC12345XY"
        assert out["fahrt_fahrkartenpreis"] == "49.90"
        assert out["fahrt_abreisedatum"] == "2026-07-15"
        assert out["fahrt_abfahrtszeit_plan"] == "08:15"
        assert out["fahrt_zugkategorie_plan"] == "ICE"
        assert out["fahrt_zugnummer_plan"] == "ICE 597"
        assert out["fahrt_abreisebahnhof"] == "Mannheim Hbf"
        assert out["fahrt_zielbahnhof"] == "Karlsruhe Hbf"
        assert out["vorname_aus_ticket"] == "Hans"
        assert out["nachname_aus_ticket"] == "Müller"

    def test_partial_only_some_fields(self) -> None:
        text = """
        Deutsche Bahn
        Hinfahrt am 03.12.2026
        Zug RE 4012
        """
        out = parse_pdf_text(text)
        # Present:
        assert out["fahrt_abreisedatum"] == "2026-12-03"
        assert out["fahrt_zugkategorie_plan"] == "RE"
        assert out["fahrt_zugnummer_plan"] == "RE 4012"
        # Absent (omitted, not None):
        assert "fahrt_fahrkartennummer" not in out
        assert "fahrt_fahrkartenpreis" not in out
        assert "fahrt_abreisebahnhof" not in out
        assert "vorname_aus_ticket" not in out

    def test_nothing_matches_returns_empty(self) -> None:
        text = "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
        out = parse_pdf_text(text)
        assert out == {}

    def test_empty_string_returns_empty(self) -> None:
        assert parse_pdf_text("") == {}

    def test_arrow_form_bahnhof(self) -> None:
        # Arrow form must be at line start (regex tightened to drop the
        # mid-line "Strecke: X → Y" false-positive class).
        text = "Mannheim Hbf → Karlsruhe Hbf\n"
        out = parse_pdf_text(text)
        assert out["fahrt_abreisebahnhof"] == "Mannheim Hbf"
        assert out["fahrt_zielbahnhof"] == "Karlsruhe Hbf"

    def test_von_nach_takes_precedence_over_arrow(self) -> None:
        # If both forms appear, the labelled "Von/Nach" wins.
        text = """
        Foo → Bar
        Von: Berlin Hbf
        Nach: Hamburg Hbf
        """
        out = parse_pdf_text(text)
        assert out["fahrt_abreisebahnhof"] == "Berlin Hbf"
        assert out["fahrt_zielbahnhof"] == "Hamburg Hbf"


# ---------------------------------------------------------------------------
# Integration: build a real PDF → extract → parse end-to-end
# ---------------------------------------------------------------------------


class TestEndToEnd:
    def test_pdf_round_trip_parses_known_fields(self) -> None:
        raw = _build_pdf(HAPPY_PATH_TEXT)
        text: Optional[str] = extract_pdf_text(raw)
        assert text is not None
        out = parse_pdf_text(text)
        # The PDF text-layer may collapse / reorder whitespace, so we assert
        # only fields that survive a worst-case render. The exact-string
        # asserts live in TestParsePdfText where the input is plain text.
        assert out.get("fahrt_fahrkartennummer") == "ABC12345XY"
        assert out.get("fahrt_zugkategorie_plan") == "ICE"
        assert out.get("fahrt_zugnummer_plan") == "ICE 597"
        assert out.get("fahrt_fahrkartenpreis") == "49.90"
