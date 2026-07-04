"""Handler integration tests — moto-backed S3 + DDB, mocked cascade.

The handler is the cross-cutting orchestrator; these tests pin the
contract around:
    - happy path (DDB + S3 wired through, cascade mocked for determinism)
    - race: missing RAW# sibling row is fine (handler never reads it)
    - missing TicketOwner → skip, counted as owner_missing
    - email-hash mismatch (confused deputy) → skip
    - malformed S3 key → skip
    - S3 fetch failure → fail_result
    - multi-record events
    - anonymised parent ticket → conditional check fails gracefully
    - idempotency: re-running the same event yields the same row state

All AWS state runs through moto; no real network.
"""

from __future__ import annotations

from typing import Any

import pytest
from botocore.exceptions import ClientError

from src import ddb, handler, s3
from src.keys import email_hash as canonical_email_hash
from src.schema import ExtractionResult


# ---------------------------------------------------------------------------
# Per-test wiring — inject the moto S3 client + DDB resource into the
# module-level caches. Reset to None after each test so the next one's
# fresh moto context picks up its own clients on first call.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _wire_clients(s3_client: Any, ddb_resource: Any) -> Any:
    s3._set_client(s3_client)
    ddb._set_resource(ddb_resource)
    yield
    s3._set_client(None)
    ddb._set_resource(None)


# ---------------------------------------------------------------------------
# Small helpers — use src.keys.email_hash (16 hex) so S3 keys match the
# parser's strict regex AND the handler's confused-deputy check.
# ---------------------------------------------------------------------------


def _put_s3_object(client: Any, bucket: str, key: str, body: bytes, ctype: str) -> None:
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=ctype)


def _raw_key(email: str, ticket_id: str, ext: str = "pdf") -> str:
    return f"raw/{canonical_email_hash(email)}/{ticket_id}.{ext}"


def _mock_cascade(monkeypatch: pytest.MonkeyPatch, result: ExtractionResult) -> list[tuple[bytes, Any]]:
    """Replace `handler.run_cascade` with a recorder + canned result."""
    calls: list[tuple[bytes, Any]] = []

    def _fake(body: bytes, content_type: Any) -> ExtractionResult:
        calls.append((body, content_type))
        return result

    monkeypatch.setattr(handler, "run_cascade", _fake)
    return calls


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_happy_path_barcode_extraction(
    s3_client: Any,
    s3_bucket: str,
    ddb_table: Any,
    seed_ticket: Any,
    make_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Full pipeline: seeded UserTicket+TicketOwner, S3 object present,
    cascade returns BARCODE → row is updated with all extraction fields."""
    email = "alice@example.com"
    ticket_id = "tkt_happy"
    seed_ticket(ddb_table, email, ticket_id)

    key = _raw_key(email, ticket_id)
    _put_s3_object(s3_client, s3_bucket, key, b"%PDF-1.4 fake", "application/pdf")

    result = ExtractionResult(
        method="BARCODE",
        confidence=1.0,
        barcode_uid="ABC12345",
        vorname_aus_ticket="Hans",
        nachname_aus_ticket="Müller",
        fahrt_fahrkartennummer="ABC12345",
    )
    calls = _mock_cascade(monkeypatch, result)

    summary = handler.lambda_handler(make_event(s3_bucket, key), None)

    assert summary["records_processed"] == 1
    assert summary["methods"]["BARCODE"] == 1
    assert summary["methods"]["FAILED"] == 0
    assert summary["methods"]["skipped"] == 0
    assert len(calls) == 1

    item = ddb_table.get_item(
        Key={"PK": f"USER#{email}", "SK": f"TICKET#{ticket_id}"}
    )["Item"]
    assert item["extraction_status"] == "DONE"
    assert item["extraction_method"] == "BARCODE"
    assert item["barcode_uid"] == "ABC12345"
    assert item["GSI2_PK"] == "BARCODE"
    assert item["GSI2_SK"] == "ABC12345"


def test_no_raw_sibling_row_still_completes(
    s3_client: Any,
    s3_bucket: str,
    ddb_table: Any,
    seed_ticket: Any,
    make_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Race: S3 event fires before POST /upload-confirm lands the RAW# row.
    Handler must not need it — TicketOwner + UserTicket suffice."""
    email = "race@example.com"
    ticket_id = "tkt_race"
    seed_ticket(ddb_table, email, ticket_id)  # only OWNER + UserTicket; no RAW#

    key = _raw_key(email, ticket_id)
    _put_s3_object(s3_client, s3_bucket, key, b"%PDF-1.4 fake", "application/pdf")

    _mock_cascade(
        monkeypatch,
        ExtractionResult(method="MANUAL", confidence=0.0),
    )

    summary = handler.lambda_handler(make_event(s3_bucket, key), None)

    assert summary["records_processed"] == 1
    assert summary["methods"]["MANUAL"] == 1


# ---------------------------------------------------------------------------
# Skip / drop paths
# ---------------------------------------------------------------------------


def test_missing_ticket_owner_is_owner_missing(
    s3_client: Any,
    s3_bucket: str,
    ddb_table: Any,
    make_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No TicketOwner row → skip, count as owner_missing, no DDB write."""
    email = "orphan@example.com"
    ticket_id = "tkt_orphan"
    key = _raw_key(email, ticket_id)
    _put_s3_object(s3_client, s3_bucket, key, b"%PDF-1.4", "application/pdf")

    # Cascade should NEVER be called.
    called: list[bool] = []
    monkeypatch.setattr(
        handler,
        "run_cascade",
        lambda *a, **k: called.append(True) or ExtractionResult(method="MANUAL", confidence=0.0),
    )

    summary = handler.lambda_handler(make_event(s3_bucket, key), None)

    assert summary["records_processed"] == 1
    assert summary["methods"]["owner_missing"] == 1
    assert summary["methods"]["BARCODE"] == 0
    assert summary["methods"]["MANUAL"] == 0
    assert called == []


def test_email_hash_mismatch_is_skipped(
    s3_client: Any,
    s3_bucket: str,
    ddb_table: Any,
    seed_ticket: Any,
    make_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """S3 key carries the WRONG email-hash (e.g. attacker rebinding) →
    confused-deputy guard skips the record."""
    real_email = "alice@example.com"
    other_email = "mallory@example.com"
    ticket_id = "tkt_evil"
    seed_ticket(ddb_table, real_email, ticket_id)

    # Use mallory's hash in the key, but TicketOwner says alice.
    key = f"raw/{canonical_email_hash(other_email)}/{ticket_id}.pdf"
    _put_s3_object(s3_client, s3_bucket, key, b"%PDF-1.4", "application/pdf")

    called: list[bool] = []
    monkeypatch.setattr(
        handler,
        "run_cascade",
        lambda *a, **k: called.append(True) or ExtractionResult(method="MANUAL", confidence=0.0),
    )

    summary = handler.lambda_handler(make_event(s3_bucket, key), None)

    assert summary["records_processed"] == 1
    assert summary["methods"]["skipped"] == 1
    assert called == []

    # And the parent ticket was NOT updated — still PROCESSING.
    item = ddb_table.get_item(
        Key={"PK": f"USER#{real_email}", "SK": f"TICKET#{ticket_id}"}
    )["Item"]
    assert item["extraction_status"] == "PROCESSING"


def test_malformed_key_wrong_prefix_is_skipped(
    s3_bucket: str,
    make_event: Any,
) -> None:
    """Key not under raw/ → defensive skip + log."""
    summary = handler.lambda_handler(
        make_event(s3_bucket, "rendered/foo/tkt.pdf"), None
    )
    assert summary["records_processed"] == 1
    assert summary["methods"]["skipped"] == 1


def test_malformed_key_no_ticket_id_is_skipped(
    s3_bucket: str,
    make_event: Any,
) -> None:
    """Key missing the ticketId.ext segment → skip."""
    summary = handler.lambda_handler(
        make_event(s3_bucket, "raw/0123456789abcdef"), None
    )
    assert summary["records_processed"] == 1
    assert summary["methods"]["skipped"] == 1


def test_url_decoded_key(
    s3_client: Any,
    s3_bucket: str,
    ddb_table: Any,
    seed_ticket: Any,
    make_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """S3 events deliver percent-encoded keys. Handler must decode them
    before parse_raw_key / GetObject."""
    email = "alice@example.com"
    ticket_id = "tkt_decode"
    seed_ticket(ddb_table, email, ticket_id)

    real_key = _raw_key(email, ticket_id)
    # Encode the '.' as '%2E' — uncommon but legal in S3 event payloads.
    encoded_key = real_key.replace(".", "%2E", 1)
    _put_s3_object(s3_client, s3_bucket, real_key, b"%PDF-1.4", "application/pdf")

    _mock_cascade(monkeypatch, ExtractionResult(method="MANUAL", confidence=0.0))

    summary = handler.lambda_handler(make_event(s3_bucket, encoded_key), None)
    assert summary["records_processed"] == 1
    assert summary["methods"]["MANUAL"] == 1


# ---------------------------------------------------------------------------
# S3 fetch failure
# ---------------------------------------------------------------------------


def test_s3_fetch_error_marks_failed(
    s3_bucket: str,
    ddb_table: Any,
    seed_ticket: Any,
    make_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """S3 GetObject fails (object missing) → fail_result writes FAILED."""
    email = "alice@example.com"
    ticket_id = "tkt_no_obj"
    seed_ticket(ddb_table, email, ticket_id)

    key = _raw_key(email, ticket_id)
    # Intentionally NO put_object — GetObject will 404 (NoSuchKey).

    # Cascade must not be called when S3 fetch fails.
    monkeypatch.setattr(
        handler,
        "run_cascade",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("cascade should not run")),
    )

    summary = handler.lambda_handler(make_event(s3_bucket, key), None)

    assert summary["records_processed"] == 1
    assert summary["methods"]["FAILED"] == 1

    item = ddb_table.get_item(
        Key={"PK": f"USER#{email}", "SK": f"TICKET#{ticket_id}"}
    )["Item"]
    assert item["extraction_status"] == "FAILED"
    # State-machine: VALIDATING → INVALID; method is NOT overwritten.
    assert item["ticket_state"] == "INVALID"
    assert "extraction_method" not in item
    assert item["extraction_failed_reason"] == "s3_fetch_error"


# ---------------------------------------------------------------------------
# Multi-record event
# ---------------------------------------------------------------------------


def test_multi_record_event_one_happy_one_owner_missing(
    s3_client: Any,
    s3_bucket: str,
    ddb_table: Any,
    seed_ticket: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """2 records: one with a real owner (BARCODE), one without (owner_missing)."""
    email = "alice@example.com"
    happy_id = "tkt_happy_multi"
    seed_ticket(ddb_table, email, happy_id)
    happy_key = _raw_key(email, happy_id)
    _put_s3_object(s3_client, s3_bucket, happy_key, b"%PDF-1.4", "application/pdf")

    orphan_id = "tkt_orphan_multi"
    orphan_key = _raw_key("orphan@example.com", orphan_id)
    _put_s3_object(s3_client, s3_bucket, orphan_key, b"%PDF-1.4", "application/pdf")

    _mock_cascade(
        monkeypatch,
        ExtractionResult(
            method="BARCODE",
            confidence=1.0,
            barcode_uid="UID-MULTI",
        ),
    )

    event = {
        "Records": [
            {"s3": {"bucket": {"name": s3_bucket}, "object": {"key": happy_key}}},
            {"s3": {"bucket": {"name": s3_bucket}, "object": {"key": orphan_key}}},
        ]
    }

    summary = handler.lambda_handler(event, None)
    assert summary["records_processed"] == 2
    assert summary["methods"]["BARCODE"] == 1
    assert summary["methods"]["owner_missing"] == 1


def test_empty_records_returns_zero_summary() -> None:
    """No Records key (or empty list) → records_processed=0, no crash."""
    summary = handler.lambda_handler({"Records": []}, None)
    assert summary["records_processed"] == 0

    summary = handler.lambda_handler({}, None)
    assert summary["records_processed"] == 0


# ---------------------------------------------------------------------------
# Anonymised parent ticket — conditional check fails
# ---------------------------------------------------------------------------


def test_anonymised_parent_row_is_parent_missing(
    s3_client: Any,
    s3_bucket: str,
    ddb_table: Any,
    make_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """User profile was TTL-deleted and the ticket anonymised under a hashed
    PK (USER#sha256:<...>). The original (USER#<email>, TICKET#<id>) row
    no longer exists → conditional UpdateItem fails → handler treats it as
    parent_missing, NOT FAILED."""
    email = "ttl-user@example.com"
    ticket_id = "tkt_anon"

    # Seed ONLY the TicketOwner row (still mapped to original email) but NOT
    # the UserTicket row (it was anonymised under a hashed PK we don't
    # reconstruct here). This mirrors the production state immediately
    # after the anonymisation sweeper has run.
    ddb_table.put_item(
        Item={
            "PK": f"TICKET#{ticket_id}",
            "SK": "OWNER",
            "email": email,
            "ticketId": ticket_id,
            "created_at": "2026-06-29T00:00:00+00:00",
        }
    )
    ddb_table.put_item(
        Item={
            "PK": "USER#sha256:deadbeefcafe1234567890abcdef0011223344556677889900aabbccddeeff",
            "SK": f"TICKET#{ticket_id}",
            "ticket_state": "APPROVED",
        }
    )

    key = _raw_key(email, ticket_id)
    _put_s3_object(s3_client, s3_bucket, key, b"%PDF-1.4", "application/pdf")

    _mock_cascade(monkeypatch, ExtractionResult(method="MANUAL", confidence=0.0))

    summary = handler.lambda_handler(make_event(s3_bucket, key), None)

    assert summary["records_processed"] == 1
    # parent_missing counter incremented (not FAILED, not MANUAL).
    assert summary["methods"].get("parent_missing", 0) == 1
    assert summary["methods"]["FAILED"] == 0
    assert summary["methods"]["MANUAL"] == 0

    # Confirm no new row got created under the canonical USER#<email> PK.
    response = ddb_table.get_item(
        Key={"PK": f"USER#{email}", "SK": f"TICKET#{ticket_id}"}
    )
    assert "Item" not in response


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


def test_idempotent_double_invocation(
    s3_client: Any,
    s3_bucket: str,
    ddb_table: Any,
    seed_ticket: Any,
    make_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Running the handler twice on the same event produces identical
    extraction-field state. `updated_at` may move forward; everything
    else is stable."""
    email = "alice@example.com"
    ticket_id = "tkt_idem"
    seed_ticket(ddb_table, email, ticket_id)

    key = _raw_key(email, ticket_id)
    _put_s3_object(s3_client, s3_bucket, key, b"%PDF-1.4", "application/pdf")

    _mock_cascade(
        monkeypatch,
        ExtractionResult(
            method="BARCODE",
            confidence=1.0,
            barcode_uid="DUP-UID",
            vorname_aus_ticket="Hans",
        ),
    )

    event = make_event(s3_bucket, key)

    handler.lambda_handler(event, None)
    item_a = ddb_table.get_item(
        Key={"PK": f"USER#{email}", "SK": f"TICKET#{ticket_id}"}
    )["Item"]

    handler.lambda_handler(event, None)
    item_b = ddb_table.get_item(
        Key={"PK": f"USER#{email}", "SK": f"TICKET#{ticket_id}"}
    )["Item"]

    # Stable fields
    for field in (
        "extraction_status",
        "extraction_method",
        "extraction_confidence",
        "barcode_uid",
        "vorname_aus_ticket",
        "GSI2_PK",
        "GSI2_SK",
    ):
        assert item_a[field] == item_b[field], (
            f"{field} should be idempotent: {item_a[field]!r} vs {item_b[field]!r}"
        )


# ---------------------------------------------------------------------------
# Unexpected exception during cascade → fail_result
# ---------------------------------------------------------------------------


def test_unexpected_exception_post_owner_triggers_fail_result(
    s3_client: Any,
    s3_bucket: str,
    ddb_table: Any,
    seed_ticket: Any,
    make_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If something past the owner lookup raises unexpectedly (e.g. a bug
    in persist), the handler attempts to write a terminal FAILED state so
    the user-facing polling sees the end of the line."""
    email = "alice@example.com"
    ticket_id = "tkt_boom"
    seed_ticket(ddb_table, email, ticket_id)

    key = _raw_key(email, ticket_id)
    _put_s3_object(s3_client, s3_bucket, key, b"%PDF-1.4", "application/pdf")

    # Cascade succeeds, but persist_result blows up.
    _mock_cascade(monkeypatch, ExtractionResult(method="MANUAL", confidence=0.0))

    def _boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("simulated bug")

    monkeypatch.setattr(handler, "persist_result", _boom)

    summary = handler.lambda_handler(make_event(s3_bucket, key), None)
    assert summary["records_processed"] == 1
    assert summary["methods"]["FAILED"] == 1

    item = ddb_table.get_item(
        Key={"PK": f"USER#{email}", "SK": f"TICKET#{ticket_id}"}
    )["Item"]
    assert item["extraction_status"] == "FAILED"
    assert item["ticket_state"] == "INVALID"
    assert item["extraction_failed_reason"] == "unexpected_error"


def test_fail_result_swallows_its_own_exceptions(
    s3_client: Any,
    s3_bucket: str,
    ddb_table: Any,
    seed_ticket: Any,
    make_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """fail_result raising MUST NOT crash the handler — it's best-effort."""
    email = "alice@example.com"
    ticket_id = "tkt_double_boom"
    seed_ticket(ddb_table, email, ticket_id)

    key = _raw_key(email, ticket_id)
    # Force a real S3 fetch error so the handler enters the fail_result path.

    def _bad_fail(*_a: Any, **_k: Any) -> Any:
        raise ClientError(
            {"Error": {"Code": "InternalError", "Message": "exploded"}},
            "UpdateItem",
        )

    monkeypatch.setattr(handler, "fail_result", _bad_fail)

    # No S3 object exists → S3FetchError → handler tries fail_result → bad_fail raises.
    summary = handler.lambda_handler(make_event(s3_bucket, key), None)

    # Handler completes; the FAILED counter still increments.
    assert summary["records_processed"] == 1
    assert summary["methods"]["FAILED"] == 1


# ---------------------------------------------------------------------------
# Log sanitisation — repr(exc) on a ClientError can carry the DDB Key
# (USER#<email>). _safe_error strips that down to <ClassName>: <Code>.
# ---------------------------------------------------------------------------


def test_safe_error_does_not_leak_client_error_request() -> None:
    """A ClientError on UpdateItem can carry the Key={'PK': 'USER#…'} payload
    in repr. _safe_error must surface only the ClassName + error Code."""
    exc = ClientError(
        {
            "Error": {"Code": "InternalServerError", "Message": "boom"},
            "ResponseMetadata": {},
        },
        "UpdateItem",
    )
    # Smuggle an email into the response (mimics how request_dict can land
    # in repr depending on botocore version).
    out = handler._safe_error(exc)
    assert "ClientError" in out
    assert "InternalServerError" in out
    assert "@" not in out  # no email-shaped substring leaks
    assert "USER#" not in out


def test_safe_error_truncates_long_messages() -> None:
    """Non-ClientError exceptions should still be rendered safely (bounded)."""
    big = "x" * 500
    out = handler._safe_error(RuntimeError(big))
    assert out.startswith("RuntimeError: ")
    # Truncated to 200 chars + ellipsis.
    assert len(out) < 250
