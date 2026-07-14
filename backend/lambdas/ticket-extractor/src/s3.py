"""S3 GetObject helper — the only place in the Lambda that touches boto3 S3.

Architectural boundary mirrors the Node lambdas: storage I/O is isolated in
one module per service so tests can DI-mock at the module boundary and the
rest of the codebase stays SDK-agnostic.

The default client is lazy-initialised at first call — Lambda cold-start
penalty is paid once per container, not on import.
"""

from __future__ import annotations

import os
import urllib.error
import urllib.parse
import urllib.request
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


def _public_read_enabled() -> bool:
    """True when the demo public-read fetch path is enabled.

    In the student-sandbox deploy no principal (execution role, user, or the
    Cognito pool role) has `s3:GetObject` on the raw/ belege/ prefixes, so a
    boto3 GetObject always returns AccessDenied and the ticket can never leave
    VALIDATING. But uploads are written with `ACL: public-read` (see
    railback-db S3BlobConnector), so the object is fetchable anonymously over
    its public HTTPS URL. Setting RAILBACK_S3_PUBLIC_READ=1 makes fetch_bytes
    take that path. DEMO-ONLY; unset it in any deploy that grants real
    GetObject so we go back through boto3 (signed, private).
    """
    return os.environ.get("RAILBACK_S3_PUBLIC_READ", "").strip() not in ("", "0", "false", "False")


def _public_object_url(bucket: str, key: str) -> str:
    """Virtual-hosted-style public URL for a bucket object.

    Region comes from AWS_REGION (always set by the Lambda runtime) or
    RAILBACK_AWS_REGION, defaulting to eu-north-1. The key is passed through
    urllib quote so path segments with reserved chars are encoded, but "/" is
    kept as a path separator.
    """
    region = (
        os.environ.get("AWS_REGION")
        or os.environ.get("RAILBACK_AWS_REGION")
        or "eu-north-1"
    )
    quoted_key = urllib.parse.quote(key, safe="/")
    return f"https://{bucket}.s3.{region}.amazonaws.com/{quoted_key}"


def _fetch_bytes_public(bucket: str, key: str) -> tuple[bytes, Optional[str]]:
    """Anonymous HTTPS GET of a public-read object → (body_bytes, content_type).

    Mirrors the size-cap + content-type contract of the boto3 path. Raises
    S3FetchError on any HTTP/URL error or when the object exceeds the cap.
    """
    url = _public_object_url(bucket, key)
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310 (fixed https S3 URL)
            # Reject oversize via Content-Length before reading, matching the
            # boto3 branch's defense-in-depth.
            cl = resp.headers.get("Content-Length")
            if cl is not None and cl.isdigit() and int(cl) > MAX_OBJECT_BYTES:
                raise S3FetchError(
                    f"S3 public object {url} size {cl} exceeds cap {MAX_OBJECT_BYTES}"
                )
            body = resp.read(MAX_OBJECT_BYTES + 1)
            content_type = resp.headers.get("Content-Type")
    except urllib.error.HTTPError as exc:
        raise S3FetchError(
            f"S3 public GET failed for {url}: HTTP {exc.code} {exc.reason}"
        ) from exc
    except urllib.error.URLError as exc:
        raise S3FetchError(f"S3 public GET failed for {url}: {exc}") from exc

    if len(body) > MAX_OBJECT_BYTES:
        raise S3FetchError(
            f"S3 public object {url} body size exceeds cap {MAX_OBJECT_BYTES}"
        )
    return body, content_type


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
    # Demo public-read path: fetch anonymously over the object's public HTTPS
    # URL when RAILBACK_S3_PUBLIC_READ is set (the account has no s3:GetObject
    # on raw/ belege/, but objects are uploaded ACL: public-read). Skipped when
    # a client is explicitly injected — tests DI a client and must keep
    # exercising the boto3 branch.
    if client is None and _public_read_enabled():
        return _fetch_bytes_public(bucket, key)

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
