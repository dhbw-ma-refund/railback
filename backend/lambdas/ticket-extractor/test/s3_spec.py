"""S3 fetch_bytes — defensive size-cap tests.

The handler relies entirely on the presigned-POST policy (10 MB raw cap)
to bound object size. fetch_bytes adds a defense-in-depth size check in
case the upload-side policy is ever bypassed (admin upload, lifecycle
restore, S3 batch operations, mis-scoped IAM).
"""

from __future__ import annotations

from typing import Any

import pytest

from src import s3


def test_fetch_bytes_rejects_oversize_object(
    s3_client: Any, s3_bucket: str
) -> None:
    """Object whose ContentLength exceeds MAX_OBJECT_BYTES must raise
    S3FetchError BEFORE the body is read into memory."""
    key = "raw/0123456789abcdef/oversize.pdf"
    payload = b"%PDF-1.4" + b"\x00" * (s3.MAX_OBJECT_BYTES + 1)
    s3_client.put_object(
        Bucket=s3_bucket, Key=key, Body=payload, ContentType="application/pdf"
    )

    with pytest.raises(s3.S3FetchError):
        s3.fetch_bytes(s3_bucket, key, client=s3_client)


def test_fetch_bytes_accepts_within_cap(s3_client: Any, s3_bucket: str) -> None:
    """A small, within-cap object is fetched normally."""
    key = "raw/0123456789abcdef/normal.pdf"
    payload = b"%PDF-1.4 small body"
    s3_client.put_object(
        Bucket=s3_bucket, Key=key, Body=payload, ContentType="application/pdf"
    )

    body, ctype = s3.fetch_bytes(s3_bucket, key, client=s3_client)
    assert body == payload
    assert ctype == "application/pdf"


# --- Demo public-read fetch path (RAILBACK_S3_PUBLIC_READ) -----------------


class _FakeResp:
    """Minimal context-manager stand-in for urllib.request.urlopen()."""

    def __init__(self, body: bytes, content_type: str | None, content_length=None):
        self._body = body
        self.headers = {}
        if content_type is not None:
            self.headers["Content-Type"] = content_type
        if content_length is not None:
            self.headers["Content-Length"] = str(content_length)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, n: int = -1) -> bytes:
        return self._body if n < 0 else self._body[:n]


def test_public_url_construction(monkeypatch: Any) -> None:
    """Region + key are composed into a virtual-hosted-style HTTPS URL."""
    monkeypatch.setenv("AWS_REGION", "eu-north-1")
    url = s3._public_object_url("railback", "raw/abc/01TICKET.pdf")
    assert url == "https://railback.s3.eu-north-1.amazonaws.com/raw/abc/01TICKET.pdf"


def test_public_read_gate_disabled_by_default(monkeypatch: Any) -> None:
    monkeypatch.delenv("RAILBACK_S3_PUBLIC_READ", raising=False)
    assert s3._public_read_enabled() is False
    monkeypatch.setenv("RAILBACK_S3_PUBLIC_READ", "0")
    assert s3._public_read_enabled() is False
    monkeypatch.setenv("RAILBACK_S3_PUBLIC_READ", "1")
    assert s3._public_read_enabled() is True


def test_fetch_bytes_uses_public_path_when_enabled(monkeypatch: Any) -> None:
    """With the flag set and NO injected client, fetch_bytes fetches over
    the public HTTPS URL instead of calling boto3."""
    monkeypatch.setenv("RAILBACK_S3_PUBLIC_READ", "1")
    monkeypatch.setenv("AWS_REGION", "eu-north-1")
    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        return _FakeResp(b"%PDF-1.4 public body", "application/pdf")

    monkeypatch.setattr(s3.urllib.request, "urlopen", fake_urlopen)
    body, ctype = s3.fetch_bytes("railback", "raw/abc/01TICKET.pdf")
    assert body == b"%PDF-1.4 public body"
    assert ctype == "application/pdf"
    assert captured["url"] == "https://railback.s3.eu-north-1.amazonaws.com/raw/abc/01TICKET.pdf"


def test_fetch_bytes_public_rejects_oversize(monkeypatch: Any) -> None:
    monkeypatch.setenv("RAILBACK_S3_PUBLIC_READ", "1")

    def fake_urlopen(req, timeout=None):
        return _FakeResp(b"x", "application/pdf", content_length=s3.MAX_OBJECT_BYTES + 1)

    monkeypatch.setattr(s3.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(s3.S3FetchError):
        s3.fetch_bytes("railback", "raw/abc/big.pdf")


def test_fetch_bytes_public_http_error_raises(monkeypatch: Any) -> None:
    monkeypatch.setenv("RAILBACK_S3_PUBLIC_READ", "1")

    def fake_urlopen(req, timeout=None):
        raise s3.urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, None)

    monkeypatch.setattr(s3.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(s3.S3FetchError):
        s3.fetch_bytes("railback", "raw/abc/private.pdf")


def test_injected_client_bypasses_public_path(monkeypatch: Any, s3_client: Any, s3_bucket: str) -> None:
    """Even with the flag set, an explicitly injected client keeps the boto3
    path — so existing DI tests are unaffected."""
    monkeypatch.setenv("RAILBACK_S3_PUBLIC_READ", "1")
    key = "raw/0123456789abcdef/di.pdf"
    payload = b"%PDF-1.4 di body"
    s3_client.put_object(Bucket=s3_bucket, Key=key, Body=payload, ContentType="application/pdf")
    body, ctype = s3.fetch_bytes(s3_bucket, key, client=s3_client)
    assert body == payload
    assert ctype == "application/pdf"
