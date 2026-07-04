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
