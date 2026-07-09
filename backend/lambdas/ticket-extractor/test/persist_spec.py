"""Persist tests — moto-backed DDB.

These assert the actual UpdateItem behaviour by reading the row back
after each call. Boundary mocking would have hidden the
ExpressionAttributeNames/Values shape issues so we do it for real.
"""

from __future__ import annotations

from typing import Any

import pytest

from src import ddb, persist
from src.schema import ExtractionResult


@pytest.fixture(autouse=True)
def _inject_ddb_resource(ddb_resource: Any) -> Any:
    """Wire the moto resource into the ddb module's cache for each test.

    We reset to None afterwards so subsequent tests get a clean lazy-init
    (matters because each test's moto context is its own).
    """
    ddb._set_resource(ddb_resource)
    yield
    ddb._set_resource(None)


# ---------------------------------------------------------------------------
# persist_result
# ---------------------------------------------------------------------------


def test_persist_result_writes_barcode_fields(ddb_table: Any, seed_ticket: Any) -> None:
    """Happy path: BARCODE result → status/method/confidence/GSI2 keys + fields."""
    email = "alice@example.com"
    ticket_id = "tkt_001"
    seed_ticket(ddb_table, email, ticket_id)

    result = ExtractionResult(
        method="BARCODE",
        confidence=1.0,
        barcode_uid="ABC12345",
        vorname_aus_ticket="Hans",
        nachname_aus_ticket="Müller",
        fahrt_fahrkartennummer="ABC12345",
        fahrt_fahrkartenpreis="29.90",
    )

    ok = persist.persist_result("railback", email, ticket_id, result)
    assert ok is True

    item = ddb_table.get_item(
        Key={"pk": "USER#alice@example.com", "sk": "TICKET#tkt_001"}
    )["Item"]

    assert item["extraction_status"] == "DONE"
    assert item["extraction_method"] == "BARCODE"
    assert float(item["extraction_confidence"]) == 1.0
    assert item["barcode_uid"] == "ABC12345"
    assert item["vorname_aus_ticket"] == "Hans"
    assert item["nachname_aus_ticket"] == "Müller"
    assert item["fahrt_fahrkartennummer"] == "ABC12345"
    assert item["fahrt_fahrkartenpreis"] == "29.90"
    # GSI2 keys ONLY for BARCODE
    assert item["gsi2_pk"] == "BARCODE"
    assert item["gsi2_sk"] == "ABC12345"
    # updated_at present + ISO-8601
    assert "updated_at" in item
    assert item["updated_at"].endswith("+00:00")


def test_persist_result_pdf_text_no_gsi2(ddb_table: Any, seed_ticket: Any) -> None:
    """PDF_TEXT result → no GSI2 keys written (only BARCODE earns those)."""
    email = "bob@example.com"
    ticket_id = "tkt_002"
    seed_ticket(ddb_table, email, ticket_id)

    result = ExtractionResult(
        method="PDF_TEXT",
        confidence=0.95,
        fahrt_zugnummer_plan="ICE 123",
        fahrt_zugkategorie_plan="ICE",
    )

    ok = persist.persist_result("railback", email, ticket_id, result)
    assert ok is True

    item = ddb_table.get_item(
        Key={"pk": "USER#bob@example.com", "sk": "TICKET#tkt_002"}
    )["Item"]
    assert item["extraction_method"] == "PDF_TEXT"
    assert item["fahrt_zugnummer_plan"] == "ICE 123"
    assert "gsi2_pk" not in item
    assert "gsi2_sk" not in item
    # None-valued optional fields must NOT be written
    assert "barcode_uid" not in item


def test_persist_result_manual_no_fields(ddb_table: Any, seed_ticket: Any) -> None:
    """MANUAL result → just status/method/confidence/updated_at; no trip fields."""
    email = "carol@example.com"
    ticket_id = "tkt_003"
    seed_ticket(ddb_table, email, ticket_id)

    result = ExtractionResult(method="MANUAL", confidence=0.0)

    ok = persist.persist_result("railback", email, ticket_id, result)
    assert ok is True

    item = ddb_table.get_item(
        Key={"pk": "USER#carol@example.com", "sk": "TICKET#tkt_003"}
    )["Item"]
    assert item["extraction_method"] == "MANUAL"
    assert float(item["extraction_confidence"]) == 0.0
    assert item["extraction_status"] == "DONE"
    assert "gsi2_pk" not in item
    assert "fahrt_zugnummer_plan" not in item


def test_persist_result_condition_fails_when_no_parent(ddb_table: Any) -> None:
    """No UserTicket parent row → condition fails → returns False, NO row created."""
    email = "ghost@example.com"
    ticket_id = "tkt_ghost"

    result = ExtractionResult(method="MANUAL", confidence=0.0)

    ok = persist.persist_result("railback", email, ticket_id, result)
    assert ok is False

    # No row was created (defensive — UpdateItem with conditional won't
    # auto-create on a failed condition).
    response = ddb_table.get_item(
        Key={"pk": "USER#ghost@example.com", "sk": "TICKET#tkt_ghost"}
    )
    assert "Item" not in response


def test_persist_result_email_normalised(ddb_table: Any, seed_ticket: Any) -> None:
    """Mixed-case email in persist_result resolves to lowercase PK."""
    canonical = "dave@example.com"
    ticket_id = "tkt_004"
    seed_ticket(ddb_table, canonical, ticket_id)

    result = ExtractionResult(method="MANUAL", confidence=0.0)

    ok = persist.persist_result("railback", "Dave@Example.com", ticket_id, result)
    assert ok is True

    # Row should exist under the canonical PK.
    item = ddb_table.get_item(
        Key={"pk": f"USER#{canonical}", "sk": f"TICKET#{ticket_id}"}
    )["Item"]
    assert item["extraction_method"] == "MANUAL"


# ---------------------------------------------------------------------------
# fail_result
# ---------------------------------------------------------------------------


def test_fail_result_writes_terminal_state(ddb_table: Any, seed_ticket: Any) -> None:
    """fail_result → status=FAILED, ticket_state=INVALID, reason+ttl set.

    The method field is NOT overwritten — that's reserved for *successful*
    cascade outputs (BARCODE / PDF_TEXT / MANUAL). FAILED is an orthogonal
    status (IMPLEMENTATION_PLAN.md row 409, DB_SCHEMA.md L186).
    """
    email = "erin@example.com"
    ticket_id = "tkt_005"
    seed_ticket(ddb_table, email, ticket_id)

    ok = persist.fail_result("railback", email, ticket_id, "s3_fetch_error")
    assert ok is True

    item = ddb_table.get_item(
        Key={"pk": "USER#erin@example.com", "sk": "TICKET#tkt_005"}
    )["Item"]
    assert item["extraction_status"] == "FAILED"
    # State-machine transition: VALIDATING → INVALID.
    assert item["ticket_state"] == "INVALID"
    # Confidence resets to 0; method is left alone (was unset on seed).
    assert float(item["extraction_confidence"]) == 0.0
    assert "extraction_method" not in item  # never overwritten
    assert item["extraction_failed_reason"] == "s3_fetch_error"
    # TTL set to ~90 days from now (epoch seconds — DDB serialises numerics
    # as Decimal on the way back out).
    assert int(item["ttl"]) > 0
    # state_timeline got an INVALID entry appended.
    assert any(e.get("state") == "INVALID" for e in item.get("state_timeline", []))


def test_fail_result_condition_fails_when_no_parent(ddb_table: Any) -> None:
    """fail_result also honours the attribute_exists guard."""
    ok = persist.fail_result("railback", "missing@example.com", "tkt_x", "reason")
    assert ok is False

    response = ddb_table.get_item(
        Key={"pk": "USER#missing@example.com", "sk": "TICKET#tkt_x"}
    )
    assert "Item" not in response


# ---------------------------------------------------------------------------
# State-machine transitions (IMPLEMENTATION_PLAN.md rows 408-409)
# ---------------------------------------------------------------------------


def test_persist_result_transitions_validating_to_ready(
    ddb_table: Any, seed_ticket: Any
) -> None:
    """Successful extraction must move ticket_state VALIDATING → READY and
    append a state_timeline entry (state-machine row 408)."""
    email = "ready@example.com"
    ticket_id = "tkt_ready"
    seed_ticket(ddb_table, email, ticket_id)

    result = ExtractionResult(method="MANUAL", confidence=0.0)
    persist.persist_result("railback", email, ticket_id, result)

    item = ddb_table.get_item(
        Key={"pk": f"USER#{email}", "sk": f"TICKET#{ticket_id}"}
    )["Item"]
    assert item["ticket_state"] == "READY"
    assert any(e.get("state") == "READY" for e in item.get("state_timeline", []))


def test_result_to_fields_clears_gsi2_on_non_barcode(
    ddb_table: Any, seed_ticket: Any
) -> None:
    """Unit-level guarantee: the `_result_to_fields` helper REMOVEs GSI2
    keys for any non-BARCODE classification.

    Note: with the P1 state-machine guard in place (`ticket_state =
    VALIDATING AND extraction_status = PROCESSING`), a non-BARCODE
    `persist_result` cannot follow a successful BARCODE one through the
    public API — the second call no-ops on the conditional. The REMOVE
    branch still exists in the helper as a defensive cleanup for any
    future call site that re-seeds a PROCESSING ticket carrying stale
    GSI2 keys (e.g. an admin-tooling rewind), so we test it at the
    helper boundary directly.
    """
    from src.persist import _result_to_fields

    result = ExtractionResult(method="MANUAL", confidence=0.0)
    fields, remove_fields, _appends = _result_to_fields(result, "tkt_x", "2026-06-29T00:00:00+00:00")

    assert fields["extraction_method"] == "MANUAL"
    assert "gsi2_pk" not in fields
    assert "gsi2_sk" not in fields
    assert "gsi2_pk" in remove_fields
    assert "gsi2_sk" in remove_fields



def test_persist_result_sets_gsi1_when_train_and_date_present(
    ddb_table: Any, seed_ticket: Any
) -> None:
    """When both fahrt_zugnummer_plan and fahrt_abreisedatum are present,
    GSI1_PK/SK are populated for admin's train-by-date queries
    (DB_SCHEMA.md L136-137)."""
    email = "train@example.com"
    ticket_id = "tkt_train"
    seed_ticket(ddb_table, email, ticket_id)

    persist.persist_result(
        "railback",
        email,
        ticket_id,
        ExtractionResult(
            method="PDF_TEXT",
            confidence=0.95,
            fahrt_zugnummer_plan="ICE 597",
            fahrt_abreisedatum="2026-07-04",
        ),
    )
    item = ddb_table.get_item(
        Key={"pk": f"USER#{email}", "sk": f"TICKET#{ticket_id}"}
    )["Item"]
    assert item["gsi1_pk"] == "TRAIN#ICE 597#2026-07-04"
    assert item["gsi1_sk"] == f"TICKET#{ticket_id}"


def test_persist_result_no_gsi1_when_train_missing(
    ddb_table: Any, seed_ticket: Any
) -> None:
    """Without both zugnummer and date, GSI1 is not populated."""
    email = "notrain@example.com"
    ticket_id = "tkt_notrain"
    seed_ticket(ddb_table, email, ticket_id)

    persist.persist_result(
        "railback",
        email,
        ticket_id,
        ExtractionResult(method="MANUAL", confidence=0.0),
    )
    item = ddb_table.get_item(
        Key={"pk": f"USER#{email}", "sk": f"TICKET#{ticket_id}"}
    )["Item"]
    assert "gsi1_pk" not in item


def test_fail_result_does_not_overwrite_prior_success(
    ddb_table: Any, seed_ticket: Any
) -> None:
    """If an earlier replay successfully wrote BARCODE / PDF_TEXT (status
    moved to DONE), a later fail_result must NOT overwrite that success.
    Guarded by ConditionExpression on extraction_status='PROCESSING'."""
    email = "preserve@example.com"
    ticket_id = "tkt_preserve"
    seed_ticket(ddb_table, email, ticket_id)

    # First — successful BARCODE.
    persist.persist_result(
        "railback",
        email,
        ticket_id,
        ExtractionResult(
            method="BARCODE",
            confidence=1.0,
            barcode_uid="GOOD-UID",
            vorname_aus_ticket="Hans",
        ),
    )

    # Second — fail_result attempted (e.g. later replay hits a bug).
    ok = persist.fail_result("railback", email, ticket_id, "later_bug")
    # State-machine guard kicked in → no overwrite.
    assert ok is False

    item = ddb_table.get_item(
        Key={"pk": f"USER#{email}", "sk": f"TICKET#{ticket_id}"}
    )["Item"]
    # Prior success is preserved.
    assert item["extraction_status"] == "DONE"
    assert item["extraction_method"] == "BARCODE"
    assert item["ticket_state"] == "READY"
    assert item["vorname_aus_ticket"] == "Hans"


# ---------------------------------------------------------------------------
# P1 regression — persist_result must not regress ticket_state on at-least-once
# S3 redelivery after the ticket has progressed past VALIDATING
# (external review 2026-06-29).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "live_state",
    [
        "READY",                  # user is mid-wizard
        "EMAIL_SENDING",          # POST /refund landed, render in flight
        "PENDING_DB_PAYMENT",     # admin review queue
        "APPROVED",
        "COMPLETED",
        "REJECTED",
        "INVALID",
        "EMAIL_FAILED",
    ],
)
def test_persist_result_no_regression_past_validating(
    ddb_table: Any, seed_ticket: Any, live_state: str
) -> None:
    """A late S3 ObjectCreated replay arriving after the ticket has left
    VALIDATING must NOT flip `ticket_state` back to READY or rewrite
    extraction fields. The conditional update returns False; the row is
    untouched.
    """
    email = "alice@example.com"
    ticket_id = "tkt_late_replay"
    seed_ticket(ddb_table, email, ticket_id)

    # Advance the ticket past VALIDATING (simulating that user-handler /
    # refund-pdf / admin-handler have already progressed it).
    ddb_table.update_item(
        Key={"pk": f"USER#{email}", "sk": f"TICKET#{ticket_id}"},
        UpdateExpression="SET ticket_state = :s, extraction_status = :d",
        ExpressionAttributeValues={":s": live_state, ":d": "DONE"},
    )

    result = ExtractionResult(
        method="BARCODE",
        confidence=1.0,
        barcode_uid="LATE-UID",
        vorname_aus_ticket="Mallory",
    )
    ok = persist.persist_result(ddb_table.name, email, ticket_id, result)
    assert ok is False, f"replay should be a no-op when ticket_state={live_state}"

    item = ddb_table.get_item(
        Key={"pk": f"USER#{email}", "sk": f"TICKET#{ticket_id}"}
    )["Item"]
    # State / extraction_status preserved; no rewrite happened.
    assert item["ticket_state"] == live_state
    assert item["extraction_status"] == "DONE"
    # Replay's fields did NOT land.
    assert item.get("vorname_aus_ticket") != "Mallory"
    assert item.get("barcode_uid") != "LATE-UID"


def test_persist_result_idempotent_on_second_processing_pass(
    ddb_table: Any, seed_ticket: Any
) -> None:
    """Two near-simultaneous extractor invocations on the same VALIDATING
    ticket: the first wins (flips to READY + DONE); the second's
    conditional fires on `extraction_status = PROCESSING` and is a no-op.
    """
    email = "alice@example.com"
    ticket_id = "tkt_idem"
    seed_ticket(ddb_table, email, ticket_id)

    result = ExtractionResult(method="MANUAL", confidence=0.0)

    first = persist.persist_result(ddb_table.name, email, ticket_id, result)
    assert first is True

    # Second call — extraction_status is now DONE, so the guard rejects.
    second = persist.persist_result(ddb_table.name, email, ticket_id, result)
    assert second is False

    item = ddb_table.get_item(
        Key={"pk": f"USER#{email}", "sk": f"TICKET#{ticket_id}"}
    )["Item"]
    assert item["extraction_status"] == "DONE"
    assert item["ticket_state"] == "READY"
    # Exactly one READY entry on the timeline — no duplicate append from the replay.
    ready_entries = [e for e in item.get("state_timeline", []) if e.get("state") == "READY"]
    assert len(ready_entries) == 1

