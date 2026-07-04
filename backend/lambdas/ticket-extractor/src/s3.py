"""S3 GetObject helper — the only place in the Lambda that touches boto3 S3.

Architectural boundary mirrors the Node lambdas: storage I/O is isolated in
one module per service so tests can DI-mock at the module boundary and the
rest of the codebase stays SDK-agnostic.

The default client is lazy-initialised at first call — Lambda cold-start
penalty is paid once per container, not on import.
"""

from __future__ import annotations

from typing import Any, Optional

import boto3
from botocore.exceptions import ClientError

# Defensive size cap before we `.read()` the body into memory. The
# presigned-POST policy caps raw uploads at 10 MB (CLAUDE.md); we tolerate
# a small fudge factor for content-length-range quirks and reject anything
# beyond that. This is defense-in-depth against any path where the
# upload-side policy is bypassed (admin upload, S3 batch operations,
# lifecycle restore, mis-scoped IAM credentials).
MAX_OBJECT_BYTES = 12 * 1024 * 1024  # 12 MB

# Module-level client cache. Tests use _set_client to override; production
# callers should leave this alone and let lazy-init handle it.
_client: Any = None


class S3FetchError(RuntimeError):
    """Raised by `fetch_bytes` when S3 returns an error (NoSuchKey,
    AccessDenied, etc.) or when the object exceeds MAX_OBJECT_BYTES.
    The caller logs + skips the record — this is a typed sentinel so the
    handler can distinguish S3 failures from extraction failures."""


def _get_client() -> Any:
    """Lazy-init the module-level S3 client."""
    global _client
    if _client is None:
        _client = boto3.client("s3")
    return _client


def _set_client(client: Any) -> None:
    """Test seam — DI override of the module-level client.

    Mirrors the `_setSesClient` / `_setDdbClient` pattern used in the Node
    lambdas. Pass `None` to reset to lazy-init on next call.
    """
    global _client
    _client = client


def fetch_bytes(
    bucket: str,
    key: str,
    *,
    client: Optional[Any] = None,
) -> tuple[bytes, Optional[str]]:
    """GetObject(bucket, key) → (body_bytes, content_type).

    Args:
        bucket: S3 bucket name (from the event record).
        key: S3 object key (already URL-decoded by the caller).
        client: optional boto3 S3 client for DI. Defaults to the
            module-level cached client.

    Returns:
        A tuple `(body_bytes, content_type)`. `content_type` is None when
        S3 returns no ContentType header (rare — typically only on
        legacy objects).

    Raises:
        S3FetchError: on any ClientError from boto3 (NoSuchKey,
            AccessDenied, etc.) OR when the object exceeds
            MAX_OBJECT_BYTES — the original exception is chained.
    """
    c = client if client is not None else _get_client()
    try:
        response = c.get_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        raise S3FetchError(
            f"S3 GetObject failed for s3://{bucket}/{key}: {exc}"
        ) from exc

    # Defensive size cap — refuse oversize objects BEFORE the .read().
    # ContentLength is always present on a successful GetObject response.
    content_length = response.get("ContentLength")
    if isinstance(content_length, int) and content_length > MAX_OBJECT_BYTES:
        raise S3FetchError(
            f"S3 object s3://{bucket}/{key} size {content_length} exceeds cap {MAX_OBJECT_BYTES}"
        )

    body = response["Body"].read()
    # Belt-and-braces: even if ContentLength was missing or lied, drop
    # anything that materialised past the cap.
    if len(body) > MAX_OBJECT_BYTES:
        raise S3FetchError(
            f"S3 object s3://{bucket}/{key} body size {len(body)} exceeds cap {MAX_OBJECT_BYTES}"
        )
    content_type = response.get("ContentType")
    return body, content_type
