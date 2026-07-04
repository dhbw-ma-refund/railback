"""Pytest fixtures for the ticket-extractor Lambda.

Everything boto3-shaped runs against moto — no real AWS calls. The
`ddb_table` fixture provisions a table named `railback` with the same
PK/SK string schema the production stack uses (mirrors
`@railback/lib/storage/ddb/keys.ts`).
"""
from __future__ import annotations

import hashlib
import os
from collections.abc import Iterator
from typing import Any

import boto3
import pytest
from moto import mock_aws

# ---------------------------------------------------------------------------
# AWS credentials / region — set BEFORE any boto3 client is created so that
# moto's interceptors win the race against real env-var-backed credentials.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def aws_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub AWS credentials so boto3 never tries to reach the metadata service."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SECURITY_TOKEN", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-central-1")
    monkeypatch.setenv("AWS_REGION", "eu-central-1")
    monkeypatch.setenv("RAILBACK_DDB_TABLE", "railback")


# ---------------------------------------------------------------------------
# Mocked AWS — a single `mock_aws()` context wraps both S3 and DynamoDB so
# the two fixtures share state inside one test run.
# ---------------------------------------------------------------------------


@pytest.fixture
def aws_mock() -> Iterator[None]:
    """Activate moto for S3 + DynamoDB for the duration of one test."""
    with mock_aws():
        yield


@pytest.fixture
def s3_client(aws_mock: None) -> Any:
    """A moto-backed boto3 S3 client."""
    return boto3.client("s3", region_name="eu-central-1")


@pytest.fixture
def s3_bucket(s3_client: Any) -> str:
    """Create a default test bucket and return its name."""
    bucket = "railback-test"
    s3_client.create_bucket(
        Bucket=bucket,
        CreateBucketConfiguration={"LocationConstraint": "eu-central-1"},
    )
    return bucket


@pytest.fixture
def ddb_resource(aws_mock: None) -> Any:
    """A moto-backed boto3 DynamoDB resource."""
    return boto3.resource("dynamodb", region_name="eu-central-1")


@pytest.fixture
def ddb_table(ddb_resource: Any) -> Any:
    """Provision the `railback` table with PK/SK string schema.

    Mirrors the prod table shape (single-table design — see DB_SCHEMA.md).
    Tests that need GSIs can add them via `update_table` inside the test
    body; the base table here is the minimum surface area the extractor
    actually writes against.
    """
    table_name = os.environ.get("RAILBACK_DDB_TABLE", "railback")
    table = ddb_resource.create_table(
        TableName=table_name,
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    table.wait_until_exists()
    return table


# ---------------------------------------------------------------------------
# Helpers — small enough to live in conftest, generic enough to share.
# ---------------------------------------------------------------------------


def email_hash(email: str) -> str:
    """One-way fingerprint for email — matches src/keys.py / lib hash convention.

    Lowercase + strip first so `Foo@Bar.de` and `foo@bar.de` collapse to
    the same hash. Hex SHA-256, truncated to **16 chars** to match
    `src.keys.email_hash` and the `_RAW_KEY_RE` regex (`[0-9a-f]{16}`) —
    64 bits is enough entropy to make collisions vanishingly unlikely
    within one customer base, and the length MUST match the parser or
    S3 keys derived here won't match keys derived by the Lambda code.
    """
    normalised = email.strip().lower()
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()[:16]


def make_s3_event(bucket: str, key: str) -> dict[str, Any]:
    """Build a minimal S3 ObjectCreated event matching what Lambda receives.

    Only the fields the handler actually reads
    (`Records[*].s3.bucket.name`, `Records[*].s3.object.key`) are present
    — extra noise from the real event shape just bloats the test.
    """
    return {
        "Records": [
            {
                "eventSource": "aws:s3",
                "eventName": "ObjectCreated:Put",
                "s3": {
                    "bucket": {"name": bucket},
                    "object": {"key": key},
                },
            }
        ]
    }


@pytest.fixture
def make_event() -> Any:
    """Expose `make_s3_event` as a fixture so tests can request it by name."""
    return make_s3_event


@pytest.fixture
def email_fingerprint() -> Any:
    """Expose `email_hash` as a fixture so tests can request it by name."""
    return email_hash


def seed_ticket_owner(table: Any, ticket_id: str, email: str) -> None:
    """Write a minimal TicketOwner row (PK=TICKET#<id>, SK=OWNER)."""
    table.put_item(
        Item={
            "PK": f"TICKET#{ticket_id}",
            "SK": "OWNER",
            "email": email.strip().lower(),
            "ticketId": ticket_id,
            "created_at": "2026-06-29T00:00:00+00:00",
        }
    )


def seed_user_ticket(table: Any, email: str, ticket_id: str) -> None:
    """Write a minimal UserTicket row so UpdateItem's `attribute_exists` guard passes."""
    table.put_item(
        Item={
            "PK": f"USER#{email.strip().lower()}",
            "SK": f"TICKET#{ticket_id}",
            "ticketId": ticket_id,
            "ticket_state": "VALIDATING",
            "extraction_status": "PROCESSING",
            "created_at": "2026-06-29T00:00:00+00:00",
        }
    )


@pytest.fixture
def seed_ticket() -> Any:
    """Combined seeder — TicketOwner + UserTicket — for the common test path."""

    def _seed(table: Any, email: str, ticket_id: str) -> None:
        seed_ticket_owner(table, ticket_id, email)
        seed_user_ticket(table, email, ticket_id)

    return _seed
