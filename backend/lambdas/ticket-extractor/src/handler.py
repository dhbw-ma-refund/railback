"""Lambda entry point — S3 ObjectCreated event handler.

Wiring:
    S3 PutObject (raw/<email-hash>/<ticketId>.<ext>)
        → S3 event notification
            → this Lambda
                → DDB GetItem(TICKET#<id>, OWNER)  -- resolve email
                    → S3 GetObject(bucket, key)
                        → run_cascade(...)
                            → DDB UpdateItem(USER#<email>, TICKET#<id>)

Race-tolerance:
    The S3 event can fire BEFORE `POST /upload-confirm` lands the RAW#
    sibling row. We do NOT read RAW#. The TicketOwner row (TICKET#<id>,
    OWNER) is written transactionally with the UserTicket row at ticket
    creation (POST /upload), so it is guaranteed present by the time
    the user receives a presigned-POST URL — and therefore before any
    bytes hit S3.

Confused-deputy guard:
    The S3 key carries an email-hash (one-way fingerprint). We resolve
    it to the canonical email via TicketOwner and then verify
    `email_hash(canonical_email) == hash_from_key`. Mismatch → skip
    (something malicious or accidental wrote to the wrong prefix).

Error policy:
    - Per-record try/except: one bad record never poisons the rest.
    - Past owner-lookup, any unexpected exception triggers
      `fail_result(...)` so the user's `extraction_status` polling sees
      a terminal state. The inner fail_result call is itself wrapped in
      try/except — best-effort, never raises out of the handler.
    - The function returns a summary dict (records_processed + per-method
      counts) for CloudWatch log readability.
"""

from __future__ import annotations

import hmac
import os
import urllib.parse
from typing import Any

from botocore.exceptions import ClientError

from .ddb import get_ticket_owner
from .extract import run_cascade
from .keys import email_hash, parse_raw_key
from .logging_setup import email_fingerprint, get_logger, init_logging
from .persist import fail_result, persist_result
from .s3 import S3FetchError, fetch_bytes

# Initialise structured-JSON logging at import time so Lambda's cold-start
# log lines (including unexpected import-time exceptions) come out shaped.
init_logging()
logger = get_logger(__name__)


def _safe_error(exc: BaseException) -> str:
    """Render an exception for logging without leaking sensitive request data.

    `repr(exc)` on a botocore `ClientError` can embed the full request
    structure (which includes the DDB `Key={"PK": "USER#<email>", ...}`).
    On the post-owner-lookup paths we strip down to `<ClassName>: <code>`
    for ClientError, otherwise `<ClassName>: <str(exc)>` truncated to a
    bounded length. The traceback is recovered via the logger's
    `exc_info=True` path when needed — repr is *only* for the structured
    log field.
    """
    if isinstance(exc, ClientError):
        code = exc.response.get("Error", {}).get("Code", "unknown") if hasattr(exc, "response") else "unknown"
        return f"{type(exc).__name__}: {code}"
    msg = str(exc)
    if len(msg) > 200:
        msg = msg[:200] + "…"
    return f"{type(exc).__name__}: {msg}"


def _table_name() -> str:
    """Resolve the DDB table from env. Default "railback" for tests."""
    return os.environ.get("RAILBACK_DDB_TABLE", "railback")


def _process_record(record: dict, table_name: str, summary: dict) -> None:
    """Handle one S3 event record.

    Mutates `summary` in place. Never raises — all failure modes get
    accounted for in the counters.
    """
    summary["records_processed"] += 1

    try:
        bucket = record["s3"]["bucket"]["name"]
        raw_key = record["s3"]["object"]["key"]
    except (KeyError, TypeError) as exc:
        logger.error(
            "malformed S3 event record; skipping",
            extra={"error": _safe_error(exc)},
        )
        summary["methods"]["skipped"] += 1
        return

    # S3 percent-encodes spaces and a handful of punctuation in event keys;
    # both put_object and get_object use the decoded form.
    key = urllib.parse.unquote_plus(raw_key)

    # --- Stage 1: parse the convention-encoded key ---------------------
    try:
        key_email_hash, ticket_id, ext = parse_raw_key(key)
    except ValueError as exc:
        logger.warning(
            "S3 key does not match raw/<hash>/<ticketId>.<ext>; skipping",
            extra={"bucket": bucket, "key": key, "error": str(exc)},
        )
        summary["methods"]["skipped"] += 1
        return

    # --- Stage 2: resolve email via TicketOwner ------------------------
    try:
        owner = get_ticket_owner(table_name, ticket_id)
    except Exception as exc:
        logger.error(
            "DDB get_ticket_owner raised; skipping record",
            extra={"ticketId": ticket_id, "error": _safe_error(exc)},
        )
        summary["methods"]["owner_missing"] += 1
        return

    if not owner:
        logger.error(
            "TicketOwner row not found; dangling S3 object",
            extra={"ticketId": ticket_id, "bucket": bucket, "key": key},
        )
        summary["methods"]["owner_missing"] += 1
        return

    email = owner.get("email")
    if not email:
        logger.error(
            "TicketOwner row missing email field; skipping",
            extra={"ticketId": ticket_id},
        )
        summary["methods"]["owner_missing"] += 1
        return

    # --- Stage 3: confused-deputy guard --------------------------------
    expected_hash = email_hash(email)
    # Constant-time compare — both values are computed locally so there's
    # no remote-observable timing channel, but `hmac.compare_digest` is
    # self-documenting about intent and costs nothing.
    if not hmac.compare_digest(expected_hash, key_email_hash):
        logger.error(
            "email-hash in S3 key does not match TicketOwner.email hash; skipping",
            extra={
                "ticketId": ticket_id,
                "key_hash": key_email_hash,
                "expected_hash": expected_hash,
                "email_fingerprint": email_fingerprint(email),
            },
        )
        summary["methods"]["skipped"] += 1
        return

    # Past this point: any failure should attempt to set the ticket's
    # extraction_status to FAILED so the user's polling sees a terminal
    # state.
    try:
        # --- Stage 4: fetch bytes from S3 ------------------------------
        try:
            body, content_type = fetch_bytes(bucket, key)
        except S3FetchError as exc:
            logger.error(
                "S3 GetObject failed; marking extraction FAILED",
                extra={
                    "ticketId": ticket_id,
                    "bucket": bucket,
                    "error": _safe_error(exc),
                },
            )
            _try_fail(table_name, email, ticket_id, "s3_fetch_error")
            summary["methods"]["FAILED"] += 1
            return

        # --- Stage 5: cascade ------------------------------------------
        result = run_cascade(body, content_type)

        # --- Stage 6: persist ------------------------------------------
        persisted = persist_result(table_name, email, ticket_id, result)

        if persisted:
            method_key = result.method
        else:
            # Parent row gone; not an error, but count separately so we
            # can see it in CloudWatch summaries.
            method_key = "parent_missing"
            summary["methods"].setdefault("parent_missing", 0)

        summary["methods"][method_key] = summary["methods"].get(method_key, 0) + 1
        logger.info(
            "record processed",
            extra={
                "ticketId": ticket_id,
                "method": method_key,
                "ext": ext,
            },
        )
    except Exception as exc:
        logger.error(
            "unexpected error processing record; attempting fail_result",
            extra={
                "ticketId": ticket_id,
                "email_fingerprint": email_fingerprint(email),
                "error": _safe_error(exc),
            },
        )
        _try_fail(table_name, email, ticket_id, "unexpected_error")
        summary["methods"]["FAILED"] += 1


def _try_fail(table_name: str, email: str, ticket_id: str, reason: str) -> None:
    """Best-effort `fail_result` — swallows inner exceptions.

    Used from the per-record handler when an unexpected error occurred
    after we already resolved the owner. We never want the failure-marking
    itself to crash the Lambda; the worst case is a ticket stuck in
    PROCESSING until the user retries.
    """
    try:
        fail_result(table_name, email, ticket_id, reason)
    except Exception as exc:  # noqa: BLE001 - intentional swallow
        logger.error(
            "fail_result itself raised; ticket left in PROCESSING",
            extra={
                "ticketId": ticket_id,
                "email_fingerprint": email_fingerprint(email),
                "error": _safe_error(exc),
            },
        )


def lambda_handler(event: dict, context: Any) -> dict:
    """Lambda entry point.

    Args:
        event: an S3 ObjectCreated event (may contain multiple Records).
        context: Lambda context (unused; present for AWS-side contract).

    Returns:
        A summary dict:
            {
                "records_processed": int,
                "methods": {
                    "BARCODE": int,
                    "PDF_TEXT": int,
                    "MANUAL": int,
                    "FAILED": int,
                    "skipped": int,
                    "owner_missing": int,
                    "parent_missing": int (only when relevant),
                },
            }

        CloudWatch indexes this dict as JSON via the structured logger,
        and synchronous callers (tests, manual replays) can read the
        counters directly.
    """
    del context  # unused

    table_name = _table_name()

    summary: dict[str, Any] = {
        "records_processed": 0,
        "methods": {
            "BARCODE": 0,
            "PDF_TEXT": 0,
            "MANUAL": 0,
            "FAILED": 0,
            "skipped": 0,
            "owner_missing": 0,
        },
    }

    records = event.get("Records") if isinstance(event, dict) else None
    if not records:
        logger.warning("invocation with no Records; nothing to do")
        return summary

    for record in records:
        try:
            _process_record(record, table_name, summary)
        except Exception as exc:  # noqa: BLE001 - last-resort isolation
            # _process_record already has its own broad try/except, so
            # this is only reached on a truly unexpected programming
            # error in the handler itself. Log + continue to keep the
            # Lambda alive for the remaining records.
            logger.error(
                "unhandled error in _process_record; continuing",
                extra={"error": _safe_error(exc)},
            )
            summary["methods"]["FAILED"] = summary["methods"].get("FAILED", 0) + 1

    logger.info("invocation complete", extra={"summary": summary})
    return summary
