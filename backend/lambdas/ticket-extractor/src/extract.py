"""Cascade orchestrator — Aztec barcode → PDF text-layer → MANUAL.

`run_cascade` is the single public entry point. It owns the *order* of the
three extraction tiers and the rule that any one tier failing must NOT
prevent the next one from running (and a total failure must NOT crash the
Lambda — MANUAL is always a valid output).

Branch shapes:
    1. BARCODE (confidence 1.0)   — `aztec.decode_aztec` returned payload bytes
                                    AND `uic_918_3.parse_uic_918_3` returned a
                                    dict that includes `barcode_uid`.
    2. PDF_TEXT (confidence 0.95) — content_type smells like a PDF AND
                                    `pdf_text.extract_pdf_text` returned a
                                    non-empty text AND `parse_pdf_text` parsed
                                    at least one informative field.
    3. MANUAL (confidence 0.0)    — terminal fall-through. No fields populated.

Each tier is wrapped in its own try/except so that a bug or unexpected
input in (e.g.) the Aztec decoder cannot prevent PDF-text parsing from
trying. The chosen method is logged for cascade-observability.
"""

from __future__ import annotations

from typing import Any

from .aztec import decode_aztec
from .logging_setup import get_logger
from .pdf_text import extract_pdf_text, parse_pdf_text
from .schema import ExtractionResult
from .uic_918_3 import parse_uic_918_3

logger = get_logger(__name__)


# Fields a PDF_TEXT parse must produce at least one of, for us to classify
# the result as PDF_TEXT (rather than fall through to MANUAL). The rationale:
# a regex hitting one random "12,34 EUR" buried in a footer doesn't make
# PDF-text extraction useful — we want at least one structural field. The
# preis regex requires the "€"/"EUR" currency suffix, so a labelled price
# is a strong-enough signal on its own (a non-ticket PDF rarely carries a
# bare "12,34 EUR" line).
_PDF_TEXT_SIGNAL_FIELDS = frozenset(
    {
        "fahrt_zugnummer_plan",
        "fahrt_abreisebahnhof",
        "fahrt_fahrkartennummer",
        "fahrt_abreisedatum",
        "fahrt_abfahrtszeit_plan",
        "fahrt_fahrkartenpreis",
    }
)


def _try_barcode(raw_bytes: bytes, content_type: str | None) -> ExtractionResult | None:
    """Aztec barcode → UIC 918.3. Returns BARCODE result or None."""
    try:
        payload = decode_aztec(raw_bytes, content_type)
    except Exception as exc:  # defensive — decode_aztec promises never to raise
        logger.warning(
            "decode_aztec raised unexpectedly; falling through",
            extra={"error": repr(exc)},
        )
        return None
    if payload is None:
        return None

    try:
        parsed: dict[str, Any] | None = parse_uic_918_3(payload)
    except Exception as exc:
        logger.warning(
            "parse_uic_918_3 raised unexpectedly; falling through",
            extra={"error": repr(exc)},
        )
        return None
    if not parsed or not parsed.get("barcode_uid"):
        return None

    try:
        return ExtractionResult(method="BARCODE", confidence=1.0, **parsed)
    except Exception as exc:
        # If pydantic rejects the parsed dict (unexpected field, wrong
        # type), prefer falling through over crashing the Lambda.
        logger.warning(
            "ExtractionResult construction failed for BARCODE; falling through",
            extra={"error": repr(exc)},
        )
        return None


def _looks_like_pdf(content_type: str | None) -> bool:
    """Cheap gate before we open a PDF parser on arbitrary bytes."""
    if content_type is None:
        # Be permissive: let pdf_text.extract_pdf_text decide via pymupdf —
        # it'll quickly return None for non-PDFs. The cost of a wrong guess
        # is one cheap header-sniff inside pymupdf.
        return True
    return content_type.lower().startswith("application/pdf")


def _try_pdf_text(raw_bytes: bytes, content_type: str | None) -> ExtractionResult | None:
    """PDF text-layer regex parse. Returns PDF_TEXT result or None."""
    if not _looks_like_pdf(content_type):
        return None

    try:
        text = extract_pdf_text(raw_bytes)
    except Exception as exc:
        logger.warning(
            "extract_pdf_text raised unexpectedly; falling through",
            extra={"error": repr(exc)},
        )
        return None
    if not text:
        return None

    try:
        parsed = parse_pdf_text(text)
    except Exception as exc:
        logger.warning(
            "parse_pdf_text raised unexpectedly; falling through",
            extra={"error": repr(exc)},
        )
        return None

    if not parsed or not (_PDF_TEXT_SIGNAL_FIELDS & parsed.keys()):
        return None

    try:
        return ExtractionResult(method="PDF_TEXT", confidence=0.95, **parsed)
    except Exception as exc:
        logger.warning(
            "ExtractionResult construction failed for PDF_TEXT; falling through",
            extra={"error": repr(exc)},
        )
        return None


def run_cascade(raw_bytes: bytes, content_type: str | None) -> ExtractionResult:
    """Run the extraction cascade.

    Order: BARCODE → PDF_TEXT → MANUAL. Each tier's failure is isolated;
    the function ALWAYS returns an `ExtractionResult` (MANUAL is the
    terminal fall-through).
    """
    result = _try_barcode(raw_bytes, content_type)
    if result is not None:
        logger.info(
            "cascade resolved",
            extra={"method": "BARCODE", "confidence": result.confidence},
        )
        return result

    result = _try_pdf_text(raw_bytes, content_type)
    if result is not None:
        logger.info(
            "cascade resolved",
            extra={"method": "PDF_TEXT", "confidence": result.confidence},
        )
        return result

    logger.info(
        "cascade resolved",
        extra={"method": "MANUAL", "confidence": 0.0},
    )
    return ExtractionResult(method="MANUAL", confidence=0.0)
