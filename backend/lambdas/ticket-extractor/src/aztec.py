"""Aztec barcode decode — wraps `zxing-cpp` over PDF / image bytes.

Step 1 of the extraction cascade (see `extract.py`). The public surface
is one function:

    decode_aztec(raw_bytes, content_type) -> bytes | None

Returns the **decoded payload** of the first Aztec barcode found, or
`None` if no Aztec was decoded for any reason (wrong content type, no
barcode present, only non-Aztec codes found, zxing-cpp missing, decode
exception). The caller is expected to feed that payload to
`uic_918_3.parse_uic_918_3` — separating the two stages keeps each
module's failure mode well-defined.

zxing-cpp ships native (manylinux) wheels. In dev environments without
those wheels (e.g. an unusual arch), the import is allowed to fail —
the cascade gracefully falls through to PDF-text / MANUAL. The warning
is logged once at import time, not on every invocation.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING, Any

from .logging_setup import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Optional native deps — zxing-cpp + pymupdf + pillow. All three carry
# native wheels; if any is missing, we degrade to "Aztec stage produces
# None" rather than crash the Lambda. The cascade in `extract.py` knows
# how to fall through.
# ---------------------------------------------------------------------------

try:
    import zxingcpp  # type: ignore[import-untyped]
except Exception as exc:  # pragma: no cover - import-time path
    zxingcpp = None  # type: ignore[assignment]
    logger.warning(
        "zxing-cpp import failed; Aztec decoding disabled",
        extra={"error": repr(exc)},
    )

try:
    import pymupdf  # type: ignore[import-untyped]
except Exception:  # pragma: no cover - import-time path
    try:
        import fitz as pymupdf  # type: ignore[no-redef]
    except Exception as exc:  # pragma: no cover
        pymupdf = None  # type: ignore[assignment]
        logger.warning(
            "pymupdf import failed; PDF-page rasterisation disabled",
            extra={"error": repr(exc)},
        )

try:
    from PIL import Image  # type: ignore[import-untyped]
except Exception as exc:  # pragma: no cover
    Image = None  # type: ignore[assignment]
    logger.warning(
        "Pillow import failed; image decoding disabled",
        extra={"error": repr(exc)},
    )

if TYPE_CHECKING:  # pragma: no cover
    from PIL.Image import Image as PILImage


# ---------------------------------------------------------------------------
# Defensive caps — DoS protection. The presigned-POST policy caps raw
# uploads at 10 MB (CLAUDE.md), and real DB tickets are 1–2 pages. These
# constants are a defence-in-depth layer in case the upload-side policy
# is ever bypassed (admin upload, lifecycle restore, mis-scoped IAM).
# Kept locally to avoid an import cycle with pdf_text.py (which also
# defines MAX_PDF_PAGES with the same value).
# ---------------------------------------------------------------------------

MAX_PDF_PAGES = 5
MAX_RAW_BYTES = 15 * 1024 * 1024  # 15 MB — 10 MB policy cap + headroom


# ---------------------------------------------------------------------------
# Content-type sniffing — gated cheaply so we don't waste CPU rasterising
# a JSON file as a PDF.
# ---------------------------------------------------------------------------


def _looks_like_pdf(raw_bytes: bytes, content_type: str | None) -> bool:
    if content_type and content_type.lower().startswith("application/pdf"):
        return True
    # Magic-byte fallback — PDFs always start with `%PDF-` (per PDF spec).
    return raw_bytes[:5] == b"%PDF-"


def _looks_like_image(content_type: str | None) -> bool:
    return bool(content_type and content_type.lower().startswith("image/"))


# ---------------------------------------------------------------------------
# Internal helpers — separated so unit tests can monkeypatch the module
# boundaries cleanly.
# ---------------------------------------------------------------------------


def _scan_image_for_aztec(img: Any) -> bytes | None:
    """Run zxing-cpp on a PIL image, return the first Aztec payload found.

    `formats=BarcodeFormat.Aztec` tells zxing to skip non-Aztec
    candidates entirely — saves work and avoids matching the QR codes
    DB also prints on some tickets.
    """
    if zxingcpp is None:
        return None
    try:
        results = zxingcpp.read_barcodes(img, formats=zxingcpp.BarcodeFormat.Aztec)
    except Exception as exc:
        logger.debug(
            "zxing-cpp raised on image scan; treating as no-barcode",
            extra={"error": repr(exc)},
        )
        return None

    for barcode in results or []:
        # Defence in depth — even with the `formats=` filter, double-check
        # the symbol class. `barcode.bytes` returns the raw decoded bytes
        # (pre-text-mode transcoding).
        if getattr(barcode, "format", None) != zxingcpp.BarcodeFormat.Aztec:
            continue
        payload = getattr(barcode, "bytes", None)
        if payload:
            return bytes(payload)
    return None


def _scan_pdf_for_aztec(raw_bytes: bytes) -> bytes | None:
    """Rasterise each PDF page (up to MAX_PDF_PAGES) and run zxing-cpp on it.

    DB tickets normally embed the Aztec on page 1, but we iterate all
    pages up to the cap defensively — multi-page sammeltickets exist.
    The hard cap protects against a crafted PDF with thousands of pages
    OOM-ing the Lambda (at 2x zoom an A4 page is ~12 MB of raw RGB; 100
    pages exceeds typical Lambda memory).
    """
    if pymupdf is None or Image is None:
        return None
    # Defensive size cap before opening — defense-in-depth against any path
    # where the presigned-POST 10 MB cap is bypassed (admin upload, S3
    # lifecycle restore, mis-scoped IAM). 15 MB tolerates the policy cap +
    # a small fudge factor.
    if len(raw_bytes) > MAX_RAW_BYTES:
        logger.warning(
            "aztec: raw bytes exceed defensive cap; refusing rasterisation",
            extra={"size": len(raw_bytes), "cap": MAX_RAW_BYTES},
        )
        return None
    try:
        doc = pymupdf.open(stream=raw_bytes, filetype="pdf")
    except Exception as exc:
        logger.debug(
            "pymupdf failed to open PDF stream", extra={"error": repr(exc)}
        )
        return None

    try:
        if doc.page_count > MAX_PDF_PAGES:
            logger.debug(
                "aztec: page_count exceeds cap; skipping rasterisation",
                extra={"page_count": doc.page_count, "cap": MAX_PDF_PAGES},
            )
            return None
        for page in doc:
            try:
                # 2x zoom — Aztec on DB tickets is small (~2cm); the
                # default 72-DPI render is too coarse for reliable
                # zxing-cpp detection. 2x ~= 144 DPI keeps memory
                # bounded while giving the decoder enough resolution.
                pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2))
                img = Image.frombytes(
                    "RGB", (pix.width, pix.height), pix.samples
                )
            except Exception as exc:
                logger.debug(
                    "pymupdf page rasterisation failed; skipping",
                    extra={"error": repr(exc)},
                )
                continue
            payload = _scan_image_for_aztec(img)
            if payload:
                return payload
    finally:
        try:
            doc.close()
        except Exception:  # pragma: no cover
            pass
    return None


def _scan_image_bytes_for_aztec(raw_bytes: bytes) -> bytes | None:
    """Open an image from bytes via PIL and scan it."""
    if Image is None:
        return None
    try:
        img = Image.open(io.BytesIO(raw_bytes))
        img.load()
    except Exception as exc:
        logger.debug(
            "PIL failed to open image stream", extra={"error": repr(exc)}
        )
        return None
    return _scan_image_for_aztec(img)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def decode_aztec(raw_bytes: bytes, content_type: str | None) -> bytes | None:
    """Decode the first Aztec barcode found in `raw_bytes`.

    Args:
        raw_bytes: the file contents (PDF, JPG, PNG, …).
        content_type: the S3-reported `Content-Type`, may be `None`.

    Returns:
        The decoded barcode payload as raw bytes, or `None` if no Aztec
        could be decoded. Never raises — any exception is logged at
        debug-level and the function returns `None` so the cascade can
        fall through.
    """
    if not raw_bytes:
        return None

    if zxingcpp is None:
        # Already warned at import time; no need to spam per-invocation.
        return None

    if _looks_like_pdf(raw_bytes, content_type):
        return _scan_pdf_for_aztec(raw_bytes)
    if _looks_like_image(content_type):
        return _scan_image_bytes_for_aztec(raw_bytes)

    # Neither PDF nor image — could still be an image with a missing /
    # generic content_type. Try PIL as a last resort; it'll quickly
    # reject non-images.
    if Image is not None:
        payload = _scan_image_bytes_for_aztec(raw_bytes)
        if payload:
            return payload

    return None
