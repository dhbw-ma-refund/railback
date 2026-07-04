"""DDB key derivation — Python mirror of @railback/lib's TS source-of-truth.

The canonical source is:
    railback/backend/lib/src/storage/ddb/keys.ts

This module intentionally duplicates a *subset* of that file (the keys this
Lambda actually touches: USER#, TICKET#, TicketOwner, BARCODE GSI2) plus a
small set of extras specific to the extractor:

  - `email_hash(email)`  — SHA-256 fingerprint, first 16 hex chars; used both
    in the raw-S3-key prefix and in JSON-log fingerprints (NEVER raw email).
  - `parse_raw_key(key)` — reverses the convention
        raw/<email-hash>/<ticketId>.<ext>
    that `POST /upload` writes the presigned-POST policy against. The
    extractor reads `email_hash`/`ticketId` from the S3 event key directly
    (race-free w.r.t. the `RAW#<ticketId>` sibling DDB row).

No SDK imports, no I/O — pure derivation. Mirrors the no-side-effects
contract of the TS module so handlers can use these helpers without
worrying about test isolation.
"""

from __future__ import annotations

import hashlib
import re
from typing import Final

# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------


def normalise_email(email: str) -> str:
    """Lowercase + strip — every email-derived key normalises through this.

    Mirrors `normaliseEmail` in keys.ts.
    """
    return email.strip().lower()


# ---------------------------------------------------------------------------
# Primary entity keys
# ---------------------------------------------------------------------------


def user_pk(email: str) -> str:
    """UserProfile / UserTicket / RawUpload / Rendered / Beleg / Mandate /
    RouteTemplate PK. Mirrors `userPk`."""
    return f"USER#{normalise_email(email)}"


USER_PROFILE_SK: Final[str] = "PROFILE"


def ticket_sk(ticketId: str) -> str:
    """UserTicket SK. Mirrors `ticketSk`."""
    return f"TICKET#{ticketId}"


# ---------------------------------------------------------------------------
# TicketOwner row — the (ticketId → email) reverse-lookup index
# ---------------------------------------------------------------------------


def ticket_owner_pk(ticketId: str) -> str:
    """TicketOwner PK. Mirrors `ticketOwnerPk`."""
    return f"TICKET#{ticketId}"


TICKET_OWNER_SK: Final[str] = "OWNER"


# ---------------------------------------------------------------------------
# GSI2 — barcode duplicate-detection
# ---------------------------------------------------------------------------


BARCODE_GSI2_PK: Final[str] = "BARCODE"


def barcode_gsi2_sk(uid: str) -> str:
    """GSI2 SK = the barcode UID itself; GetItem on (BARCODE, uid) yields
    the duplicate. Mirrors `barcodeGsi2Sk`."""
    return uid


# ---------------------------------------------------------------------------
# email_hash — one-way fingerprint used in S3 keys and JSON logs
# ---------------------------------------------------------------------------


def email_hash(email: str) -> str:
    """SHA-256 of the normalised email, first 16 hex chars.

    Used in two places:
      1. the S3 raw-upload key prefix (`raw/<email-hash>/<ticketId>.<ext>`),
         which is IAM-pinned so an attacker cannot rebind a key to another
         user's bucket-prefix.
      2. structured-log fingerprints — we NEVER log raw email addresses.

    16 hex chars = 64 bits, collision-resistant enough for a key-prefix
    namespace within one customer base. NOT a security primitive — do not
    use this as an authentication token.
    """
    digest = hashlib.sha256(normalise_email(email).encode("utf-8")).hexdigest()
    return digest[:16]


# ---------------------------------------------------------------------------
# S3 raw-key parser
# ---------------------------------------------------------------------------


_RAW_KEY_RE = re.compile(
    r"^raw/(?P<hash>[0-9a-f]{16})/(?P<ticketId>[^/.]+)\.(?P<ext>[A-Za-z0-9]+)$"
)


def parse_raw_key(key: str) -> tuple[str, str, str]:
    """Parse `raw/<email-hash>/<ticketId>.<ext>` → (email_hash, ticketId, ext_lower).

    Validates:
      - leading `raw/` prefix
      - email-hash is exactly 16 lowercase hex chars (matches `email_hash` output)
      - ticketId is non-empty and contains no `/` or `.`
      - extension is alphanumeric

    Raises:
        ValueError: when any of the above fails. The caller MUST treat this
        as a defensive log-and-skip — bad keys should never reach this
        Lambda but we don't crash on them either.
    """
    if not isinstance(key, str) or not key:
        raise ValueError(f"raw key is empty or non-string: {key!r}")

    match = _RAW_KEY_RE.match(key)
    if match is None:
        raise ValueError(
            f"raw key does not match 'raw/<16-hex>/<ticketId>.<ext>': {key!r}"
        )

    return (
        match.group("hash"),
        match.group("ticketId"),
        match.group("ext").lower(),
    )
