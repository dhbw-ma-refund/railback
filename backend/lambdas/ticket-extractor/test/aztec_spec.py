"""Aztec barcode decoder — black-box tests.

Strategy: we don't ship real DB ticket PDFs (privacy + GPL boundary).
Instead we exercise the module's behaviour at well-defined seams:

  - feed a 1x1 white PNG → zxing-cpp finds nothing → returns None
  - feed plain bytes that aren't PDF or image → returns None
  - simulate the zxing-cpp import being missing → returns None
  - simulate a zxing decode exception → returns None
  - happy path: monkeypatch zxing's `read_barcodes` to return a fake
    Aztec result and confirm we surface its `.bytes`
"""

from __future__ import annotations

import io
from typing import Any

import pytest

from src import aztec


# ---------------------------------------------------------------------------
# Fixtures — small inline PNGs/PDFs generated at test time. No real ticket
# fixtures are committed; we only need to drive the cascade branches.
# ---------------------------------------------------------------------------


@pytest.fixture
def white_png_bytes() -> bytes:
    """1x1 white PNG — pillow generates inline so no on-disk fixture needed."""
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (1, 1), color="white").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def tiny_pdf_bytes() -> bytes:
    """A blank single-page PDF — pymupdf generates inline."""
    import pymupdf  # type: ignore[import-untyped]

    doc = pymupdf.open()
    doc.new_page(width=100, height=100)
    out = io.BytesIO()
    doc.save(out)
    doc.close()
    return out.getvalue()


# ---------------------------------------------------------------------------
# Negative paths — must all yield None.
# ---------------------------------------------------------------------------


def test_decode_aztec_empty_bytes_returns_none() -> None:
    """Empty input is a fast-path None — no work attempted."""
    assert aztec.decode_aztec(b"", "application/pdf") is None
    assert aztec.decode_aztec(b"", None) is None


def test_decode_aztec_white_png_returns_none(white_png_bytes: bytes) -> None:
    """A 1x1 white PNG has no barcode → real zxing-cpp returns []."""
    assert aztec.decode_aztec(white_png_bytes, "image/png") is None


def test_decode_aztec_random_garbage_returns_none() -> None:
    """Non-PDF non-image bytes — neither magic-byte nor content-type
    match → cascade exits with None."""
    assert aztec.decode_aztec(b"this is plain text, not a PDF", "text/plain") is None


def test_decode_aztec_blank_pdf_returns_none(tiny_pdf_bytes: bytes) -> None:
    """Blank PDF — rasterised page has no Aztec → None."""
    assert aztec.decode_aztec(tiny_pdf_bytes, "application/pdf") is None


def test_decode_aztec_pdf_via_magic_bytes_returns_none(tiny_pdf_bytes: bytes) -> None:
    """Detect PDF via `%PDF-` prefix when content_type is missing."""
    assert aztec.decode_aztec(tiny_pdf_bytes, None) is None


# ---------------------------------------------------------------------------
# Import-time degradation — zxing-cpp missing must NOT crash; returns None.
# ---------------------------------------------------------------------------


def test_decode_aztec_returns_none_when_zxingcpp_missing(
    white_png_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If `zxingcpp` failed to import, the function is a no-op."""
    monkeypatch.setattr(aztec, "zxingcpp", None)
    assert aztec.decode_aztec(white_png_bytes, "image/png") is None


# ---------------------------------------------------------------------------
# Exception swallowing — zxing or pymupdf raising must not poison the cascade.
# ---------------------------------------------------------------------------


def test_decode_aztec_swallows_zxing_exception(
    white_png_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`read_barcodes` raising mid-decode → graceful None, no propagation."""

    def boom(*_args: Any, **_kwargs: Any) -> list[Any]:
        raise RuntimeError("zxing-cpp internal error")

    monkeypatch.setattr(aztec.zxingcpp, "read_barcodes", boom)
    assert aztec.decode_aztec(white_png_bytes, "image/png") is None


def test_decode_aztec_swallows_pil_open_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Image bytes that PIL can't open → None (no crash)."""
    assert aztec.decode_aztec(b"\x00\x01not an image\xff", "image/png") is None


def test_decode_aztec_swallows_pymupdf_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Bytes claiming to be a PDF but unparseable → None."""
    fake_pdf = b"%PDF-1.4\n<garbage that pymupdf will reject>"
    assert aztec.decode_aztec(fake_pdf, "application/pdf") is None


# ---------------------------------------------------------------------------
# Happy path — monkeypatch zxing's read_barcodes so we don't need a real
# Aztec sample. Verifies the module surfaces `.bytes` from the first Aztec
# result and ignores non-Aztec barcodes.
# ---------------------------------------------------------------------------


class _FakeBarcode:
    """Minimal stand-in for zxingcpp.Barcode — just .format + .bytes."""

    def __init__(self, fmt: Any, payload: bytes) -> None:
        self.format = fmt
        self.bytes = payload


def test_decode_aztec_returns_payload_on_match(
    white_png_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Happy path: zxing returns an Aztec result, we surface `.bytes`."""
    payload = b"UIC-918-3 fake payload"
    fake_results = [_FakeBarcode(aztec.zxingcpp.BarcodeFormat.Aztec, payload)]
    monkeypatch.setattr(aztec.zxingcpp, "read_barcodes", lambda *a, **kw: fake_results)
    assert aztec.decode_aztec(white_png_bytes, "image/png") == payload


def test_decode_aztec_filters_non_aztec_results(
    white_png_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If zxing returns a QR-only result (shouldn't happen given the
    `formats=Aztec` filter, but defence-in-depth), we still reject it."""
    qr_only = [_FakeBarcode(aztec.zxingcpp.BarcodeFormat.QRCode, b"qr-payload")]
    monkeypatch.setattr(aztec.zxingcpp, "read_barcodes", lambda *a, **kw: qr_only)
    assert aztec.decode_aztec(white_png_bytes, "image/png") is None


def test_decode_aztec_pdf_path_finds_payload(
    tiny_pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PDF branch should also surface a payload when zxing finds one."""
    payload = b"UIC payload from PDF page"
    fake_results = [_FakeBarcode(aztec.zxingcpp.BarcodeFormat.Aztec, payload)]
    monkeypatch.setattr(aztec.zxingcpp, "read_barcodes", lambda *a, **kw: fake_results)
    assert aztec.decode_aztec(tiny_pdf_bytes, "application/pdf") == payload


def test_decode_aztec_missing_content_type_tries_image_fallback(
    white_png_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No content_type, not PDF — final PIL fallback runs and can succeed."""
    payload = b"hello"
    fake_results = [_FakeBarcode(aztec.zxingcpp.BarcodeFormat.Aztec, payload)]
    monkeypatch.setattr(aztec.zxingcpp, "read_barcodes", lambda *a, **kw: fake_results)
    assert aztec.decode_aztec(white_png_bytes, None) == payload


# ---------------------------------------------------------------------------
# DoS defence — page-count cap, raw-size cap
# ---------------------------------------------------------------------------


def test_decode_aztec_rejects_oversize_pdf_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A PDF with more than MAX_PDF_PAGES pages must be refused without
    rasterising any of them. Real DB tickets are 1–2 pages."""
    import pymupdf  # type: ignore[import-untyped]

    doc = pymupdf.open()
    for _ in range(aztec.MAX_PDF_PAGES + 5):
        doc.new_page(width=100, height=100)
    pdf_bytes = doc.tobytes()
    doc.close()

    # If we mistakenly entered the rasterise loop, zxing's read_barcodes
    # would be called — wire it to raise so the test fails loudly.
    def _boom(*_a, **_kw):
        raise AssertionError("rasterisation must NOT happen past the cap")

    monkeypatch.setattr(aztec.zxingcpp, "read_barcodes", _boom)

    assert aztec.decode_aztec(pdf_bytes, "application/pdf") is None


def test_decode_aztec_rejects_oversize_raw_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A raw byte stream above MAX_RAW_BYTES must short-circuit before
    pymupdf.open even runs."""
    huge = b"%PDF-1.4" + b"\x00" * (aztec.MAX_RAW_BYTES + 1)

    def _boom(*_a, **_kw):
        raise AssertionError("pymupdf.open must NOT be invoked")

    monkeypatch.setattr(aztec.pymupdf, "open", _boom)
    assert aztec.decode_aztec(huge, "application/pdf") is None
