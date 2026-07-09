"""Persist extraction results onto the UserTicket DDB row.

Two public functions:

    persist_result(table_name, email, ticket_id, result) -> bool
        Writes the happy-path extraction (status="DONE"), transitions
        `ticket_state` VALIDATING → READY (IMPLEMENTATION_PLAN.md row 408,
        DB_SCHEMA.md state-machine), appends a state_timeline entry, and —
        for BARCODE results — sets the GSI2 keys used for cross-user
        duplicate detection (clears them for non-BARCODE results in case
        an earlier replay had successfully written BARCODE). Guarded by
        ConditionExpression `ticket_state="VALIDATING" AND
        extraction_status="PROCESSING"` so a late at-least-once S3
        redelivery after the ticket has progressed past VALIDATING
        (EMAIL_SENDING / PENDING_DB_PAYMENT / APPROVED / REJECTED) will
        NOT reset state back to READY.

    fail_result(table_name, email, ticket_id, reason) -> bool
        Marks the ticket extraction terminal-failed (status="FAILED",
        ticket_state="INVALID" per IMPLEMENTATION_PLAN.md row 409). Guarded
        by ConditionExpression `extraction_status="PROCESSING"` so a later
        replay that hits an unexpected exception will NOT overwrite an
        earlier successful BARCODE / PDF_TEXT result. Clears any stale
        GSI2 keys defensively.

Both functions delegate the actual UpdateItem to
`ddb.update_ticket_extraction`, which carries the
`attribute_exists(PK,SK)` conditional. A False return therefore means
"parent UserTicket row no longer exists OR state-machine guard failed" —
the caller treats both as a normal idempotent skip (logged, not raised).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from .ddb import update_ticket_extraction
from .keys import BARCODE_GSI2_PK, barcode_gsi2_sk
from .logging_setup import email_fingerprint, get_logger
from .schema import ExtractionResult

logger = get_logger(__name__)


def _utc_now_iso() -> str:
    """UTC ISO-8601 with `+00:00` suffix (mirrors the Node `nowIso()` convention)."""
    return datetime.now(tz=timezone.utc).isoformat()


def _gsi1_for_train(zugnummer_plan: Any, abreisedatum: Any, ticket_id: str) -> Optional[dict[str, str]]:
    """Build GSI1 keys for train-by-date lookups.

    DB_SCHEMA.md lines 136-137: `GSI1_PK = TRAIN#<trainNr>#<date>`,
    `GSI1_SK = TICKET#<ticketId>`. The `zugnummer_plan` field already
    carries the kategorie-prefixed form (e.g. "IC 2345" — see
    pdf_text.py's `_RE_ZUGNUMMER` handler) which matches the GSI1_PK
    convention used by `user-handler`'s `/from-route` write path.
    """
    if not zugnummer_plan or not abreisedatum:
        return None
    if not isinstance(zugnummer_plan, str) or not isinstance(abreisedatum, str):
        return None
    return {
        "gsi1_pk": f"TRAIN#{zugnummer_plan}#{abreisedatum}",
        "gsi1_sk": f"TICKET#{ticket_id}",
    }


def _result_to_fields(
    result: ExtractionResult, ticket_id: str, now_iso: str
) -> tuple[dict[str, Any], list[str], dict[str, list[Any]]]:
    """Build the (fields, remove_fields, appends) tuple for a success update.

    - Strips None-valued optional fields so we don't write nulls.
    - Injects `extraction_status`, `extraction_method`, `extraction_confidence`,
      `ticket_state="READY"`, and `updated_at`.
    - For BARCODE results, also sets `GSI2_PK` / `GSI2_SK` to enable
      cross-user duplicate detection on the barcode_uid.
    - For non-BARCODE successes, REMOVEs any stale GSI2 keys so an
      earlier replay that wrote BARCODE doesn't leave the sparse index
      pointing at a row whose `extraction_method` has since regressed.
    - When both `fahrt_zugnummer_plan` and `fahrt_abreisedatum` are
      present, populates GSI1 (train-by-date) for admin queries.
    - Appends a state_timeline entry for the VALIDATING → READY transition.
    """
    dumped = result.model_dump(exclude_none=True)

    method = dumped.pop("method")
    confidence = dumped.pop("confidence")

    fields: dict[str, Any] = dict(dumped)
    fields["extraction_status"] = "DONE"
    fields["extraction_method"] = method
    # DDB doesn't accept Python floats — coerce to Decimal via str() to
    # avoid binary-float drift (Decimal(0.95) keeps the IEEE-754 noise).
    fields["extraction_confidence"] = Decimal(str(confidence))
    fields["updated_at"] = now_iso
    # State-machine transition: VALIDATING → READY (IMPLEMENTATION_PLAN.md row 408).
    fields["ticket_state"] = "READY"

    remove_fields: list[str] = []
    barcode_uid = dumped.get("barcode_uid")
    if method == "BARCODE" and barcode_uid:
        fields["gsi2_pk"] = BARCODE_GSI2_PK
        fields["gsi2_sk"] = barcode_gsi2_sk(barcode_uid)
    else:
        # Defensive REMOVE — clear any stale GSI2 keys from a prior
        # BARCODE-classified replay. Cheap when absent (REMOVE is a no-op
        # on missing attrs).
        remove_fields.extend(["gsi2_pk", "gsi2_sk"])

    # GSI1 train-by-date keys for admin lookups (DB_SCHEMA.md L136-137).
    gsi1 = _gsi1_for_train(
        dumped.get("fahrt_zugnummer_plan"),
        dumped.get("fahrt_abreisedatum"),
        ticket_id,
    )
    if gsi1:
        fields.update(gsi1)

    appends: dict[str, list[Any]] = {
        "state_timeline": [{"state": "READY", "at": now_iso}],
    }

    return fields, remove_fields, appends


def persist_result(
    table_name: str,
    email: str,
    ticket_id: str,
    result: ExtractionResult,
    *,
    client: Optional[Any] = None,
) -> bool:
    """Persist a successful extraction onto the UserTicket row.

    Returns True on success, False when the parent row no longer exists
    OR the state-machine guard rejected the update (e.g. the ticket has
    already left VALIDATING because the user submitted, the admin
    overrode, or an earlier extractor pass already wrote DONE). All
    other DDB errors propagate.

    State-machine guard (P1 — external review 2026-06-29). S3
    ObjectCreated is at-least-once: a delayed redelivery after the
    ticket has progressed to EMAIL_SENDING / PENDING_DB_PAYMENT /
    APPROVED / REJECTED must NOT silently reset state back to READY.
    The condition `ticket_state = "VALIDATING" AND extraction_status =
    "PROCESSING"` makes this update:
      - first replay of a still-VALIDATING ticket → fires, flips to READY
      - second replay (now extraction_status=DONE) → conditional skip
      - late replay after the user has submitted → conditional skip
    Together with `fail_result`'s mirror guard this ensures the
    extractor cannot regress the ticket FSM under any S3-replay
    schedule.
    """
    now_iso = _utc_now_iso()
    fields, remove_fields, appends = _result_to_fields(result, ticket_id, now_iso)

    updated = update_ticket_extraction(
        table_name,
        email,
        ticket_id,
        fields,
        remove_fields=remove_fields,
        appends=appends,
        condition_required=True,
        extra_condition=(
            "#ticket_state = :validating "
            "AND (attribute_not_exists(#extraction_status) "
            "OR #extraction_status = :processing)"
        ),
        extra_condition_names={
            "#ticket_state": "ticket_state",
            "#extraction_status": "extraction_status",
        },
        extra_condition_values={
            ":validating": "VALIDATING",
            ":processing": "PROCESSING",
        },
        client=client,
    )
    if not updated:
        logger.warning(
            "persist_result skipped — parent gone or ticket already past VALIDATING (S3 at-least-once replay)",
            extra={
                "ticketId": ticket_id,
                "email_fingerprint": email_fingerprint(email),
                "method": result.method,
            },
        )
        return False

    logger.info(
        "persisted extraction result",
        extra={
            "ticketId": ticket_id,
            "email_fingerprint": email_fingerprint(email),
            "method": result.method,
            "confidence": result.confidence,
        },
    )
    return True


# 90-day TTL window for INVALID/REJECTED/EMAIL_FAILED per DB_SCHEMA.md L186.
_INVALID_TTL_SECONDS = 90 * 24 * 60 * 60


def fail_result(
    table_name: str,
    email: str,
    ticket_id: str,
    reason: str,
    *,
    client: Optional[Any] = None,
) -> bool:
    """Mark a ticket's extraction terminally failed.

    State-machine: VALIDATING → INVALID (IMPLEMENTATION_PLAN.md row 409).
    Sets extraction_status="FAILED", ticket_state="INVALID", appends a
    state_timeline entry, and writes the 90-day TTL.

    Guarded by `extraction_status="PROCESSING"` so a later replay that
    hits an unexpected exception after a prior successful BARCODE /
    PDF_TEXT write will NOT overwrite the earlier success. Also clears
    any GSI2 keys (defensive — if a prior BARCODE row somehow survived
    in the index, we don't want it pointing at a FAILED row).

    Note: we intentionally do NOT overwrite `extraction_method` to
    "MANUAL" here. MANUAL is a *successful* terminal cascade output
    (confidence 0.0, user fills wizard from scratch); FAILED is an
    orthogonal status. Mixing them would make admin tooling filtering
    `extraction_method=MANUAL` silently include crashed extractions.

    Same `attribute_exists` guard as the happy path — a False return
    means parent row gone OR state-machine guard failed; logged at
    warn-level.
    """
    now_iso = _utc_now_iso()
    # DDB TTL is epoch-seconds (number).
    now_dt = datetime.now(tz=timezone.utc)
    ttl_value = int(now_dt.timestamp()) + _INVALID_TTL_SECONDS

    fields: dict[str, Any] = {
        "extraction_status": "FAILED",
        "extraction_confidence": Decimal("0.0"),
        "extraction_failed_reason": reason,
        "ticket_state": "INVALID",
        "ttl": ttl_value,
        "updated_at": now_iso,
    }

    appends: dict[str, list[Any]] = {
        "state_timeline": [{"state": "INVALID", "at": now_iso}],
    }

    # State-machine guard: only flip a still-PROCESSING ticket to FAILED.
    # If an earlier successful BARCODE / PDF_TEXT write already moved the
    # ticket to extraction_status="DONE", this update is a no-op.
    updated = update_ticket_extraction(
        table_name,
        email,
        ticket_id,
        fields,
        remove_fields=["gsi2_pk", "gsi2_sk"],
        appends=appends,
        condition_required=True,
        extra_condition="attribute_not_exists(#extraction_status) OR #extraction_status = :processing",
        extra_condition_names={"#extraction_status": "extraction_status"},
        extra_condition_values={":processing": "PROCESSING"},
        client=client,
    )

    if not updated:
        logger.warning(
            "fail_result skipped — parent gone or already past PROCESSING (idempotent / preserving prior success)",
            extra={
                "ticketId": ticket_id,
                "email_fingerprint": email_fingerprint(email),
                "reason": reason,
            },
        )
        return False

    logger.error(
        "marked extraction as FAILED",
        extra={
            "ticketId": ticket_id,
            "email_fingerprint": email_fingerprint(email),
            "reason": reason,
        },
    )
    return True
