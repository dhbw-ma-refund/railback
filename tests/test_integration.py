"""
Integration tests against DynamoDB Local (Podman, port 4434).

Run:
    DYNAMODB_ENDPOINT_URL=http://localhost:4434 pytest tests/test_integration.py -v

Each test class owns a unique namespace (email prefix) so tests are independent.
"""

import os
import sys
import boto3
import pytest

os.environ.setdefault("DYNAMODB_ENDPOINT_URL", "http://localhost:4434")
os.environ.setdefault("RAILBACK_DDB_TABLE", "railback_inttest")

ENDPOINT = os.environ["DYNAMODB_ENDPOINT_URL"]
TABLE_NAME = os.environ["RAILBACK_DDB_TABLE"]
REGION = "eu-central-1"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.base import Ok, Err, safe
from db.connector import RailBackConnector


# ---------------------------------------------------------------------------
# Result type — pure Python, no DB needed
# ---------------------------------------------------------------------------

class TestResultType:
    def test_ok_is_ok(self):
        assert Ok(42).is_ok()
        assert not Ok(42).is_err()

    def test_ok_unwrap(self):
        assert Ok("hello").unwrap() == "hello"

    def test_ok_none(self):
        r = Ok(None)
        assert r.is_ok()
        assert r.unwrap() is None

    def test_err_is_err(self):
        r = Err(ValueError("boom"))
        assert r.is_err()
        assert not r.is_ok()

    def test_err_unwrap_raises_original_exception(self):
        exc = ValueError("bad input")
        with pytest.raises(ValueError, match="bad input"):
            Err(exc).unwrap()

    def test_ok_structural_pattern_match(self):
        match Ok(99):
            case Ok(value=v):
                assert v == 99
            case _:
                pytest.fail("should match Ok")

    def test_err_structural_pattern_match(self):
        match Err(RuntimeError("x")):
            case Err(error=e):
                assert str(e) == "x"
            case _:
                pytest.fail("should match Err")


# ---------------------------------------------------------------------------
# @safe decorator — pure Python, no DB needed
# ---------------------------------------------------------------------------

class TestSafeDecorator:
    def test_passes_through_ok_result(self):
        @safe
        def fn():
            return Ok(1)
        assert fn().unwrap() == 1

    def test_catches_client_error(self):
        from botocore.exceptions import ClientError
        @safe
        def fn():
            raise ClientError({"Error": {"Code": "ValidationException", "Message": "x"}}, "Op")
        assert fn().is_err()

    def test_catches_generic_exception(self):
        @safe
        def fn():
            raise RuntimeError("unexpected")
        assert fn().is_err()

    def test_catches_connection_error(self):
        @safe
        def fn():
            raise ConnectionError("no route to host")
        assert fn().is_err()

    def test_catches_timeout(self):
        @safe
        def fn():
            raise TimeoutError("endpoint timed out")
        assert fn().is_err()

    def test_preserves_function_name(self):
        @safe
        def my_function():
            return Ok(None)
        assert my_function.__name__ == "my_function"

    def test_err_does_not_raise_on_caller(self):
        @safe
        def fn():
            raise RuntimeError("boom")
        r = fn()
        with pytest.raises(RuntimeError):
            r.unwrap()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def ddb_client():
    return boto3.client(
        "dynamodb",
        region_name=REGION,
        endpoint_url=ENDPOINT,
        aws_access_key_id="fake",
        aws_secret_access_key="fake",
    )


@pytest.fixture(scope="session", autouse=True)
def table(ddb_client):
    """Create (or recreate) the test table once for the whole session."""
    existing = ddb_client.list_tables()["TableNames"]
    if TABLE_NAME in existing:
        ddb_client.delete_table(TableName=TABLE_NAME)
        ddb_client.get_waiter("table_not_exists").wait(TableName=TABLE_NAME)

    ddb_client.create_table(
        TableName=TABLE_NAME,
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "PK",                   "AttributeType": "S"},
            {"AttributeName": "SK",                   "AttributeType": "S"},
            {"AttributeName": "GSI1_PK",              "AttributeType": "S"},
            {"AttributeName": "GSI1_SK",              "AttributeType": "S"},
            {"AttributeName": "GSI2_PK",              "AttributeType": "S"},
            {"AttributeName": "GSI2_SK",              "AttributeType": "S"},
            {"AttributeName": "GSI_EMAIL_PENDING_PK", "AttributeType": "S"},
            {"AttributeName": "GSI_EMAIL_PENDING_SK", "AttributeType": "S"},
            {"AttributeName": "GSI3_PK",              "AttributeType": "S"},
            {"AttributeName": "GSI3_SK",              "AttributeType": "S"},
        ],
        GlobalSecondaryIndexes=[
            {"IndexName": "GSI1",
             "KeySchema": [{"AttributeName": "GSI1_PK", "KeyType": "HASH"},
                           {"AttributeName": "GSI1_SK", "KeyType": "RANGE"}],
             "Projection": {"ProjectionType": "ALL"}},
            {"IndexName": "GSI2",
             "KeySchema": [{"AttributeName": "GSI2_PK", "KeyType": "HASH"},
                           {"AttributeName": "GSI2_SK", "KeyType": "RANGE"}],
             "Projection": {"ProjectionType": "ALL"}},
            {"IndexName": "GSI_EMAIL_PENDING",
             "KeySchema": [{"AttributeName": "GSI_EMAIL_PENDING_PK", "KeyType": "HASH"},
                           {"AttributeName": "GSI_EMAIL_PENDING_SK", "KeyType": "RANGE"}],
             "Projection": {"ProjectionType": "ALL"}},
            {"IndexName": "GSI3",
             "KeySchema": [{"AttributeName": "GSI3_PK", "KeyType": "HASH"},
                           {"AttributeName": "GSI3_SK", "KeyType": "RANGE"}],
             "Projection": {"ProjectionType": "ALL"}},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    ddb_client.get_waiter("table_exists").wait(TableName=TABLE_NAME)


@pytest.fixture(scope="session")
def db():
    resource = boto3.resource(
        "dynamodb",
        region_name=REGION,
        endpoint_url=ENDPOINT,
        aws_access_key_id="fake",
        aws_secret_access_key="fake",
    )
    return RailBackConnector(table=resource.Table(TABLE_NAME))


@pytest.fixture(scope="session")
def bad_db():
    """Connector pointing at an unreachable endpoint."""
    from botocore.config import Config
    cfg = Config(connect_timeout=1, read_timeout=1, retries={"max_attempts": 0})
    resource = boto3.resource(
        "dynamodb",
        region_name=REGION,
        endpoint_url="http://localhost:19999",
        aws_access_key_id="fake",
        aws_secret_access_key="fake",
        config=cfg,
    )
    return RailBackConnector(table=resource.Table(TABLE_NAME))


# ---------------------------------------------------------------------------
# UserConnector
# ---------------------------------------------------------------------------

class TestUserConnectorIntegration:
    NS = "u001"

    def email(self, suffix=""):
        return f"{self.NS}{suffix}@it.de"

    def base_item(self, email, **extra):
        return {
            "PK": f"USER#{email}", "SK": "PROFILE",
            "GSI1_PK": "USER", "GSI1_SK": f"EMAIL#{email}",
            "user_state": "ACTIVE", "hashed_password": "x",
            "vorname": "Test", "nachname": "User",
            "created_at": "2026-01-01T00:00:00Z",
            "datenschutz_einwilligung": True, "agb_akzeptiert": True,
            **extra,
        }

    def test_put_success(self, db):
        email = self.email("put")
        r = db.user.put(self.base_item(email))
        assert r.is_ok()
        db.user._delete(f"USER#{email}", "PROFILE")

    def test_put_overwrites_existing(self, db):
        email = self.email("overwrite")
        db.user.put(self.base_item(email, vorname="First"))
        db.user.put(self.base_item(email, vorname="Second"))
        r = db.user.get(email)
        assert r.is_ok()
        assert r.unwrap()["vorname"] == "Second"
        db.user._delete(f"USER#{email}", "PROFILE")

    def test_get_found(self, db):
        email = self.email("get")
        db.user.put(self.base_item(email))
        r = db.user.get(email)
        assert r.is_ok()
        assert r.unwrap()["vorname"] == "Test"
        db.user._delete(f"USER#{email}", "PROFILE")

    def test_get_not_found_returns_none(self, db):
        r = db.user.get("ghost.u001@it.de")
        assert r.is_ok()
        assert r.unwrap() is None

    def test_update_existing(self, db):
        email = self.email("upd")
        db.user.put(self.base_item(email))
        db.user.update(email, {"vorname": "Updated"})
        r = db.user.get(email)
        assert r.unwrap()["vorname"] == "Updated"
        db.user._delete(f"USER#{email}", "PROFILE")

    def test_update_multiple_fields(self, db):
        email = self.email("updmulti")
        db.user.put(self.base_item(email))
        db.user.update(email, {"vorname": "A", "nachname": "B", "user_state": "INACTIVE"})
        r = db.user.get(email)
        item = r.unwrap()
        assert item["vorname"] == "A"
        assert item["nachname"] == "B"
        assert item["user_state"] == "INACTIVE"
        db.user._delete(f"USER#{email}", "PROFILE")

    def test_update_nonexistent_creates_item(self, db):
        email = self.email("upsert")
        db.user.update(email, {"vorname": "Upserted"})
        r = db.user.get(email)
        assert r.is_ok()
        item = r.unwrap()
        assert item is not None
        assert item["vorname"] == "Upserted"
        db.user._delete(f"USER#{email}", "PROFILE")

    def test_update_empty_dict_is_noop(self, db):
        email = self.email("emptyupd")
        db.user.put(self.base_item(email, vorname="Before"))
        r = db.user.update(email, {})
        assert r.is_ok()
        after = db.user.get(email).unwrap()
        assert after["vorname"] == "Before"
        db.user._delete(f"USER#{email}", "PROFILE")

    def test_list_all_empty(self, db):
        # Use a namespace that has no users
        r = db.user.list_all()
        # May have items from other tests, just verify Ok
        assert r.is_ok()

    def test_list_all_finds_user(self, db):
        email = self.email("list")
        db.user.put(self.base_item(email))
        r = db.user.list_all()
        assert r.is_ok()
        gsi_sks = [u["GSI1_SK"] for u in r.unwrap()]
        assert f"EMAIL#{email}" in gsi_sks
        db.user._delete(f"USER#{email}", "PROFILE")

    def test_list_all_multiple_users(self, db):
        emails = [self.email(f"listm{i}") for i in range(3)]
        for e in emails:
            db.user.put(self.base_item(e))
        r = db.user.list_all()
        assert r.is_ok()
        gsi_sks = [u["GSI1_SK"] for u in r.unwrap()]
        for e in emails:
            assert f"EMAIL#{e}" in gsi_sks
        for e in emails:
            db.user._delete(f"USER#{e}", "PROFILE")


# ---------------------------------------------------------------------------
# AdminConnector
# ---------------------------------------------------------------------------

class TestAdminConnectorIntegration:
    NS = "a001"

    def email(self, suffix=""):
        return f"{self.NS}{suffix}@it.de"

    def base_item(self, email, **extra):
        return {
            "PK": f"ADMIN#{email}", "SK": "PROFILE",
            "GSI1_PK": "ADMIN", "GSI1_SK": f"EMAIL#{email}",
            "hashed_password": "x",
            "created_at": "2026-01-01T00:00:00Z",
            **extra,
        }

    def test_put_success(self, db):
        email = self.email("put")
        assert db.admin.put(self.base_item(email)).is_ok()
        db.admin._delete(f"ADMIN#{email}", "PROFILE")

    def test_put_overwrites_existing(self, db):
        email = self.email("overwrite")
        db.admin.put(self.base_item(email, hashed_password="old"))
        db.admin.put(self.base_item(email, hashed_password="new"))
        r = db.admin.get(email)
        assert r.unwrap()["hashed_password"] == "new"
        db.admin._delete(f"ADMIN#{email}", "PROFILE")

    def test_get_found(self, db):
        email = self.email("get")
        db.admin.put(self.base_item(email))
        r = db.admin.get(email)
        assert r.is_ok()
        assert r.unwrap()["hashed_password"] == "x"
        db.admin._delete(f"ADMIN#{email}", "PROFILE")

    def test_get_not_found_returns_none(self, db):
        r = db.admin.get("ghost.a001@it.de")
        assert r.is_ok()
        assert r.unwrap() is None

    def test_update_existing(self, db):
        email = self.email("upd")
        db.admin.put(self.base_item(email))
        db.admin.update(email, {"hashed_password": "updated_hash"})
        r = db.admin.get(email)
        assert r.unwrap()["hashed_password"] == "updated_hash"
        db.admin._delete(f"ADMIN#{email}", "PROFILE")

    def test_update_nonexistent_creates_item(self, db):
        email = self.email("upsert")
        db.admin.update(email, {"hashed_password": "new_hash"})
        r = db.admin.get(email)
        assert r.unwrap() is not None
        assert r.unwrap()["hashed_password"] == "new_hash"
        db.admin._delete(f"ADMIN#{email}", "PROFILE")

    def test_update_empty_dict_is_noop(self, db):
        email = self.email("emptyupd")
        db.admin.put(self.base_item(email, hashed_password="original"))
        assert db.admin.update(email, {}).is_ok()
        assert db.admin.get(email).unwrap()["hashed_password"] == "original"
        db.admin._delete(f"ADMIN#{email}", "PROFILE")

    def test_list_all_finds_admin(self, db):
        email = self.email("list")
        db.admin.put(self.base_item(email))
        r = db.admin.list_all()
        assert r.is_ok()
        gsi_sks = [a["GSI1_SK"] for a in r.unwrap()]
        assert f"EMAIL#{email}" in gsi_sks
        db.admin._delete(f"ADMIN#{email}", "PROFILE")

    def test_list_all_multiple_admins(self, db):
        emails = [self.email(f"listm{i}") for i in range(3)]
        for e in emails:
            db.admin.put(self.base_item(e))
        r = db.admin.list_all()
        gsi_sks = [a["GSI1_SK"] for a in r.unwrap()]
        for e in emails:
            assert f"EMAIL#{e}" in gsi_sks
        for e in emails:
            db.admin._delete(f"ADMIN#{e}", "PROFILE")


# ---------------------------------------------------------------------------
# TicketConnector
# ---------------------------------------------------------------------------

class TestTicketConnectorIntegration:
    NS = "t001"
    NOW = "2026-06-01T10:00:00+02:00"

    def email(self, suffix=""):
        return f"{self.NS}{suffix}@it.de"

    def ticket(self, email, tid, **extra):
        return {
            "PK": f"USER#{email}", "SK": f"TICKET#{tid}",
            "GSI1_PK": f"TRAIN#IC 1#{self.NOW[:10]}", "GSI1_SK": f"TICKET#{tid}",
            "GSI2_PK": "BARCODE", "GSI2_SK": f"bc_{tid}",
            "ticket_state": "READY",
            "uploaded_at": self.NOW, "updated_at": self.NOW,
            **extra,
        }

    def test_put_success(self, db):
        e, tid = self.email("put"), "T_PUT"
        assert db.ticket.put(self.ticket(e, tid)).is_ok()
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_put_overwrites_existing(self, db):
        e, tid = self.email("overwrite"), "T_OVR"
        db.ticket.put(self.ticket(e, tid, ticket_state="VALIDATING"))
        db.ticket.put(self.ticket(e, tid, ticket_state="READY"))
        r = db.ticket.get(e, tid)
        assert r.unwrap()["ticket_state"] == "READY"
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_get_found(self, db):
        e, tid = self.email("get"), "T_GET"
        db.ticket.put(self.ticket(e, tid))
        r = db.ticket.get(e, tid)
        assert r.is_ok()
        assert r.unwrap()["ticket_state"] == "READY"
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_get_not_found_returns_none(self, db):
        r = db.ticket.get("ghost.t001@it.de", "T_GHOST")
        assert r.is_ok()
        assert r.unwrap() is None

    def test_update_existing(self, db):
        e, tid = self.email("upd"), "T_UPD"
        db.ticket.put(self.ticket(e, tid))
        db.ticket.update(e, tid, {"ticket_state": "EMAIL_SENDING"})
        assert db.ticket.get(e, tid).unwrap()["ticket_state"] == "EMAIL_SENDING"
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_update_multiple_fields(self, db):
        e, tid = self.email("updm"), "T_UPDM"
        db.ticket.put(self.ticket(e, tid))
        db.ticket.update(e, tid, {"ticket_state": "DONE", "fahrt_zugnummer_plan": "RE 12"})
        item = db.ticket.get(e, tid).unwrap()
        assert item["ticket_state"] == "DONE"
        assert item["fahrt_zugnummer_plan"] == "RE 12"
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_update_nonexistent_creates_item(self, db):
        e, tid = self.email("upsert"), "T_UPS"
        db.ticket.update(e, tid, {"ticket_state": "VALIDATING"})
        r = db.ticket.get(e, tid)
        assert r.unwrap() is not None
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_update_empty_dict_is_noop(self, db):
        e, tid = self.email("emptyupd"), "T_EMP"
        db.ticket.put(self.ticket(e, tid, ticket_state="READY"))
        assert db.ticket.update(e, tid, {}).is_ok()
        assert db.ticket.get(e, tid).unwrap()["ticket_state"] == "READY"
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_list_for_user_empty(self, db):
        r = db.ticket.list_for_user("ghost.t001.list@it.de")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_list_for_user_returns_only_tickets(self, db):
        e, tid = self.email("lfu"), "T_LFU"
        beleg_id = "B_LFU"
        db.ticket.put(self.ticket(e, tid))
        db.receipt.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#BELEG#{beleg_id}",
                        "typ": "TAXI", "uploaded_at": self.NOW})
        db.mandate.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#MANDATE",
                        "mandate_state": "ISSUED", "issued_at": self.NOW})
        r = db.ticket.list_for_user(e)
        assert r.is_ok()
        sks = [i["SK"] for i in r.unwrap()]
        assert f"TICKET#{tid}" in sks
        assert f"TICKET#{tid}#BELEG#{beleg_id}" not in sks
        assert f"TICKET#{tid}#MANDATE" not in sks
        # cleanup
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")
        db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{beleg_id}")
        db.mandate._delete(f"USER#{e}", f"TICKET#{tid}#MANDATE")

    def test_list_for_user_multiple_tickets(self, db):
        e = self.email("lfumulti")
        tids = [f"T_LFUM{i}" for i in range(4)]
        for tid in tids:
            db.ticket.put(self.ticket(e, tid))
        r = db.ticket.list_for_user(e)
        assert r.is_ok()
        sks = [i["SK"] for i in r.unwrap()]
        for tid in tids:
            assert f"TICKET#{tid}" in sks
        assert len([s for s in sks if s.startswith("TICKET#")]) == 4
        for tid in tids:
            db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_list_for_user_excludes_mandate_from_results(self, db):
        e, tid = self.email("mandexcl"), "T_MAND"
        db.ticket.put(self.ticket(e, tid))
        db.mandate.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#MANDATE",
                        "mandate_state": "ISSUED", "issued_at": self.NOW})
        r = db.ticket.list_for_user(e)
        sks = [i["SK"] for i in r.unwrap()]
        assert f"TICKET#{tid}#MANDATE" not in sks
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")
        db.mandate._delete(f"USER#{e}", f"TICKET#{tid}#MANDATE")

    def test_list_for_user_excludes_receipts_from_results(self, db):
        e, tid, bid = self.email("belgexcl"), "T_BELG", "B001"
        db.ticket.put(self.ticket(e, tid))
        db.receipt.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#BELEG#{bid}",
                        "typ": "TAXI", "uploaded_at": self.NOW})
        r = db.ticket.list_for_user(e)
        sks = [i["SK"] for i in r.unwrap()]
        assert f"TICKET#{tid}#BELEG#{bid}" not in sks
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")
        db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{bid}")

    def test_get_by_train_empty(self, db):
        r = db.ticket.get_by_train("IC 9999", "2099-01-01")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_get_by_train_found(self, db):
        e, tid = self.email("gbt"), "T_GBT"
        train_nr, date = "IC 777", "2026-09-01"
        item = self.ticket(e, tid)
        item["GSI1_PK"] = f"TRAIN#{train_nr}#{date}"
        db.ticket.put(item)
        r = db.ticket.get_by_train(train_nr, date)
        assert r.is_ok()
        assert any(i["SK"] == f"TICKET#{tid}" for i in r.unwrap())
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_get_by_train_multiple(self, db):
        e = self.email("gbtmulti")
        train_nr, date = "IC 888", "2026-09-02"
        tids = [f"T_GBTM{i}" for i in range(3)]
        for tid in tids:
            item = self.ticket(e, tid)
            item["GSI1_PK"] = f"TRAIN#{train_nr}#{date}"
            db.ticket.put(item)
        r = db.ticket.get_by_train(train_nr, date)
        assert r.is_ok()
        assert len(r.unwrap()) == 3
        for tid in tids:
            db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_check_barcode_duplicate_not_found(self, db):
        r = db.ticket.check_barcode_duplicate("ghost_barcode_uid_001")
        assert r.is_ok()
        assert r.unwrap() is None

    def test_check_barcode_duplicate_found(self, db):
        e, tid, uid = self.email("bc"), "T_BC", "bc_unique_001"
        item = self.ticket(e, tid)
        item["GSI2_SK"] = uid
        db.ticket.put(item)
        r = db.ticket.check_barcode_duplicate(uid)
        assert r.is_ok()
        assert r.unwrap() is not None
        assert r.unwrap()["GSI2_SK"] == uid
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_check_barcode_returns_first_match(self, db):
        e, tid, uid = self.email("bcfirst"), "T_BCFIRST", "bc_unique_002"
        item = self.ticket(e, tid)
        item["GSI2_SK"] = uid
        db.ticket.put(item)
        r = db.ticket.check_barcode_duplicate(uid)
        assert r.is_ok()
        assert r.unwrap() is not None
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_list_email_pending_empty(self, db):
        r = db.ticket.list_email_pending()
        assert r.is_ok()
        # may have items from other tests; just verify Ok

    def test_list_email_pending_finds_item(self, db):
        e, tid = self.email("epend"), "T_EPEND"
        ts = "2026-06-01T08:00:00+02:00"
        item = self.ticket(e, tid)
        item["GSI_EMAIL_PENDING_PK"] = "EMAIL_PENDING"
        item["GSI_EMAIL_PENDING_SK"] = ts
        item["ticket_state"] = "EMAIL_SENDING"
        db.ticket.put(item)
        r = db.ticket.list_email_pending()
        assert r.is_ok()
        assert any(i["SK"] == f"TICKET#{tid}" for i in r.unwrap())
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_list_email_pending_ordered_oldest_first(self, db):
        e = self.email("epord")
        pairs = [
            ("T_EPORD_A", "2026-06-01T06:00:00+02:00"),
            ("T_EPORD_B", "2026-06-01T08:00:00+02:00"),
            ("T_EPORD_C", "2026-06-01T10:00:00+02:00"),
        ]
        for tid, ts in pairs:
            item = self.ticket(e, tid)
            item["GSI_EMAIL_PENDING_PK"] = "EMAIL_PENDING"
            item["GSI_EMAIL_PENDING_SK"] = ts
            item["ticket_state"] = "EMAIL_SENDING"
            db.ticket.put(item)
        r = db.ticket.list_email_pending()
        assert r.is_ok()
        pending = [i for i in r.unwrap() if i["SK"] in {f"TICKET#{tid}" for tid, _ in pairs}]
        timestamps = [i["GSI_EMAIL_PENDING_SK"] for i in pending]
        assert timestamps == sorted(timestamps)
        for tid, _ in pairs:
            db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")


# ---------------------------------------------------------------------------
# TicketOwnerConnector
# ---------------------------------------------------------------------------

class TestTicketOwnerConnectorIntegration:
    NS = "to001"

    def owner(self, tid, email, **extra):
        return {
            "PK": f"TICKET#{tid}", "SK": "OWNER",
            "email": email, "ticketId": tid,
            "created_at": "2026-01-01T00:00:00Z",
            **extra,
        }

    def test_put_success(self, db):
        tid = f"{self.NS}_PUT"
        assert db.ticket_owner.put(self.owner(tid, "x@x.de")).is_ok()
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")

    def test_put_overwrites_existing(self, db):
        tid = f"{self.NS}_OVR"
        db.ticket_owner.put(self.owner(tid, "first@x.de"))
        db.ticket_owner.put(self.owner(tid, "second@x.de"))
        assert db.ticket_owner.get(tid).unwrap()["email"] == "second@x.de"
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")

    def test_get_found(self, db):
        tid = f"{self.NS}_GET"
        db.ticket_owner.put(self.owner(tid, "owner@x.de"))
        r = db.ticket_owner.get(tid)
        assert r.is_ok()
        assert r.unwrap()["email"] == "owner@x.de"
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")

    def test_get_not_found_returns_none(self, db):
        assert db.ticket_owner.get("GHOST_TICKET_to001").unwrap() is None

    def test_update_existing(self, db):
        tid = f"{self.NS}_UPD"
        db.ticket_owner.put(self.owner(tid, "before@x.de"))
        db.ticket_owner.update(tid, {"email": "after@x.de"})
        assert db.ticket_owner.get(tid).unwrap()["email"] == "after@x.de"
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")

    def test_update_nonexistent_creates_item(self, db):
        tid = f"{self.NS}_UPS"
        db.ticket_owner.update(tid, {"email": "upserted@x.de"})
        r = db.ticket_owner.get(tid)
        assert r.unwrap() is not None
        assert r.unwrap()["email"] == "upserted@x.de"
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")

    def test_update_empty_dict_is_noop(self, db):
        tid = f"{self.NS}_EMP"
        db.ticket_owner.put(self.owner(tid, "stable@x.de"))
        assert db.ticket_owner.update(tid, {}).is_ok()
        assert db.ticket_owner.get(tid).unwrap()["email"] == "stable@x.de"
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")


# ---------------------------------------------------------------------------
# RawUploadConnector
# ---------------------------------------------------------------------------

class TestRawUploadConnectorIntegration:
    NS = "ru001"

    def item(self, email, tid, **extra):
        return {
            "PK": f"USER#{email}", "SK": f"RAW#{tid}",
            "filename": "ticket.pdf",
            "s3_bucket": "bucket", "s3_key": f"raw/{tid}.pdf",
            "uploaded_at": "2026-01-01T00:00:00Z",
            **extra,
        }

    def test_put_success(self, db):
        e, tid = f"{self.NS}@it.de", "RAW_PUT"
        assert db.raw_upload.put(self.item(e, tid)).is_ok()
        db.raw_upload._delete(f"USER#{e}", f"RAW#{tid}")

    def test_put_overwrites_existing(self, db):
        e, tid = f"{self.NS}@it.de", "RAW_OVR"
        db.raw_upload.put(self.item(e, tid, filename="old.pdf"))
        db.raw_upload.put(self.item(e, tid, filename="new.pdf"))
        assert db.raw_upload.get(e, tid).unwrap()["filename"] == "new.pdf"
        db.raw_upload._delete(f"USER#{e}", f"RAW#{tid}")

    def test_get_found(self, db):
        e, tid = f"{self.NS}@it.de", "RAW_GET"
        db.raw_upload.put(self.item(e, tid))
        r = db.raw_upload.get(e, tid)
        assert r.is_ok()
        assert r.unwrap()["filename"] == "ticket.pdf"
        db.raw_upload._delete(f"USER#{e}", f"RAW#{tid}")

    def test_get_not_found_returns_none(self, db):
        assert db.raw_upload.get("ghost.ru001@it.de", "GHOST").unwrap() is None

    def test_update_existing(self, db):
        e, tid = f"{self.NS}@it.de", "RAW_UPD"
        db.raw_upload.put(self.item(e, tid))
        db.raw_upload.update(e, tid, {"filename": "updated.pdf"})
        assert db.raw_upload.get(e, tid).unwrap()["filename"] == "updated.pdf"
        db.raw_upload._delete(f"USER#{e}", f"RAW#{tid}")

    def test_update_nonexistent_creates_item(self, db):
        e, tid = f"{self.NS}@it.de", "RAW_UPS"
        db.raw_upload.update(e, tid, {"filename": "upserted.pdf"})
        r = db.raw_upload.get(e, tid)
        assert r.unwrap() is not None
        db.raw_upload._delete(f"USER#{e}", f"RAW#{tid}")

    def test_update_empty_dict_is_noop(self, db):
        e, tid = f"{self.NS}@it.de", "RAW_EMP"
        db.raw_upload.put(self.item(e, tid, filename="stable.pdf"))
        assert db.raw_upload.update(e, tid, {}).is_ok()
        assert db.raw_upload.get(e, tid).unwrap()["filename"] == "stable.pdf"
        db.raw_upload._delete(f"USER#{e}", f"RAW#{tid}")


# ---------------------------------------------------------------------------
# RenderedPdfConnector
# ---------------------------------------------------------------------------

class TestRenderedPdfConnectorIntegration:
    NS = "rp001"

    def item(self, email, tid, **extra):
        return {
            "PK": f"USER#{email}", "SK": f"RENDERED#{tid}",
            "s3_bucket": "bucket", "s3_key": f"rendered/{tid}.pdf",
            "rendered_at": "2026-01-01T00:00:00Z",
            **extra,
        }

    def test_put_success(self, db):
        e, tid = f"{self.NS}@it.de", "RPD_PUT"
        assert db.rendered_pdf.put(self.item(e, tid)).is_ok()
        db.rendered_pdf._delete(f"USER#{e}", f"RENDERED#{tid}")

    def test_put_overwrites_existing(self, db):
        e, tid = f"{self.NS}@it.de", "RPD_OVR"
        db.rendered_pdf.put(self.item(e, tid, size_bytes=100))
        db.rendered_pdf.put(self.item(e, tid, size_bytes=200))
        assert db.rendered_pdf.get(e, tid).unwrap()["size_bytes"] == 200
        db.rendered_pdf._delete(f"USER#{e}", f"RENDERED#{tid}")

    def test_get_found(self, db):
        e, tid = f"{self.NS}@it.de", "RPD_GET"
        db.rendered_pdf.put(self.item(e, tid))
        r = db.rendered_pdf.get(e, tid)
        assert r.is_ok()
        assert r.unwrap()["s3_key"] == f"rendered/{tid}.pdf"
        db.rendered_pdf._delete(f"USER#{e}", f"RENDERED#{tid}")

    def test_get_not_found_returns_none(self, db):
        assert db.rendered_pdf.get("ghost.rp001@it.de", "GHOST").unwrap() is None

    def test_update_existing(self, db):
        e, tid = f"{self.NS}@it.de", "RPD_UPD"
        db.rendered_pdf.put(self.item(e, tid))
        db.rendered_pdf.update(e, tid, {"size_bytes": 99999})
        assert db.rendered_pdf.get(e, tid).unwrap()["size_bytes"] == 99999
        db.rendered_pdf._delete(f"USER#{e}", f"RENDERED#{tid}")

    def test_update_nonexistent_creates_item(self, db):
        e, tid = f"{self.NS}@it.de", "RPD_UPS"
        db.rendered_pdf.update(e, tid, {"size_bytes": 1})
        assert db.rendered_pdf.get(e, tid).unwrap() is not None
        db.rendered_pdf._delete(f"USER#{e}", f"RENDERED#{tid}")

    def test_update_empty_dict_is_noop(self, db):
        e, tid = f"{self.NS}@it.de", "RPD_EMP"
        db.rendered_pdf.put(self.item(e, tid, size_bytes=42))
        assert db.rendered_pdf.update(e, tid, {}).is_ok()
        assert db.rendered_pdf.get(e, tid).unwrap()["size_bytes"] == 42
        db.rendered_pdf._delete(f"USER#{e}", f"RENDERED#{tid}")


# ---------------------------------------------------------------------------
# OriginalReceiptConnector
# ---------------------------------------------------------------------------

class TestOriginalReceiptConnectorIntegration:
    NS = "or001"
    NOW = "2026-01-01T00:00:00Z"

    def item(self, email, tid, bid, **extra):
        return {
            "PK": f"USER#{email}", "SK": f"TICKET#{tid}#BELEG#{bid}",
            "filename": "receipt.pdf", "typ": "TAXI",
            "s3_bucket": "bucket", "s3_key": f"belege/{tid}/{bid}.pdf",
            "uploaded_at": self.NOW,
            **extra,
        }

    def test_put_success(self, db):
        e, tid, bid = f"{self.NS}@it.de", "T_OR_PUT", "B_PUT"
        assert db.receipt.put(self.item(e, tid, bid)).is_ok()
        db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{bid}")

    def test_get_found(self, db):
        e, tid, bid = f"{self.NS}@it.de", "T_OR_GET", "B_GET"
        db.receipt.put(self.item(e, tid, bid))
        r = db.receipt.get(e, tid, bid)
        assert r.is_ok()
        assert r.unwrap()["typ"] == "TAXI"
        db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{bid}")

    def test_get_not_found_returns_none(self, db):
        assert db.receipt.get("ghost.or001@it.de", "T_GHOST", "B_GHOST").unwrap() is None

    def test_update_existing(self, db):
        e, tid, bid = f"{self.NS}@it.de", "T_OR_UPD", "B_UPD"
        db.receipt.put(self.item(e, tid, bid))
        db.receipt.update(e, tid, bid, {"typ": "BUS"})
        assert db.receipt.get(e, tid, bid).unwrap()["typ"] == "BUS"
        db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{bid}")

    def test_update_nonexistent_creates_item(self, db):
        e, tid, bid = f"{self.NS}@it.de", "T_OR_UPS", "B_UPS"
        db.receipt.update(e, tid, bid, {"typ": "UBER"})
        assert db.receipt.get(e, tid, bid).unwrap() is not None
        db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{bid}")

    def test_update_empty_dict_is_noop(self, db):
        e, tid, bid = f"{self.NS}@it.de", "T_OR_EMP", "B_EMP"
        db.receipt.put(self.item(e, tid, bid, typ="TAXI"))
        assert db.receipt.update(e, tid, bid, {}).is_ok()
        assert db.receipt.get(e, tid, bid).unwrap()["typ"] == "TAXI"
        db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{bid}")

    def test_list_for_ticket_empty(self, db):
        r = db.receipt.list_for_ticket("ghost.or001@it.de", "T_GHOST")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_list_for_ticket_single(self, db):
        e, tid, bid = f"{self.NS}@it.de", "T_OR_LFT", "B_LFT"
        db.receipt.put(self.item(e, tid, bid))
        r = db.receipt.list_for_ticket(e, tid)
        assert r.is_ok()
        assert len(r.unwrap()) == 1
        assert r.unwrap()[0]["SK"] == f"TICKET#{tid}#BELEG#{bid}"
        db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{bid}")

    def test_list_for_ticket_multiple(self, db):
        e, tid = f"{self.NS}@it.de", "T_OR_LFTM"
        bids = ["B_LFTM_A", "B_LFTM_B", "B_LFTM_C"]
        for bid in bids:
            db.receipt.put(self.item(e, tid, bid))
        r = db.receipt.list_for_ticket(e, tid)
        assert r.is_ok()
        assert len(r.unwrap()) == 3
        for bid in bids:
            db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{bid}")

    def test_list_for_ticket_only_returns_this_ticket(self, db):
        e = f"{self.NS}@it.de"
        # Put receipts for two different tickets
        db.receipt.put(self.item(e, "T_OR_ISO_A", "B1"))
        db.receipt.put(self.item(e, "T_OR_ISO_B", "B1"))
        r = db.receipt.list_for_ticket(e, "T_OR_ISO_A")
        sks = [i["SK"] for i in r.unwrap()]
        assert all("T_OR_ISO_A" in s for s in sks)
        assert all("T_OR_ISO_B" not in s for s in sks)
        db.receipt._delete(f"USER#{e}", "TICKET#T_OR_ISO_A#BELEG#B1")
        db.receipt._delete(f"USER#{e}", "TICKET#T_OR_ISO_B#BELEG#B1")


# ---------------------------------------------------------------------------
# SepaMandateConnector
# ---------------------------------------------------------------------------

class TestSepaMandateConnectorIntegration:
    NS = "sm001"
    NOW = "2026-01-01T00:00:00Z"

    def item(self, email, tid, **extra):
        return {
            "PK": f"USER#{email}", "SK": f"TICKET#{tid}#MANDATE",
            "mandate_id": f"MID_{tid}", "mandate_state": "ISSUED",
            "fee_amount": "5.00", "issued_at": self.NOW,
            **extra,
        }

    def test_put_success(self, db):
        e, tid = f"{self.NS}@it.de", "T_SM_PUT"
        assert db.mandate.put(self.item(e, tid)).is_ok()
        db.mandate._delete(f"USER#{e}", f"TICKET#{tid}#MANDATE")

    def test_get_found(self, db):
        e, tid = f"{self.NS}@it.de", "T_SM_GET"
        db.mandate.put(self.item(e, tid))
        r = db.mandate.get(e, tid)
        assert r.is_ok()
        assert r.unwrap()["mandate_state"] == "ISSUED"
        db.mandate._delete(f"USER#{e}", f"TICKET#{tid}#MANDATE")

    def test_get_not_found_returns_none(self, db):
        assert db.mandate.get("ghost.sm001@it.de", "T_GHOST").unwrap() is None

    def test_update_existing(self, db):
        e, tid = f"{self.NS}@it.de", "T_SM_UPD"
        db.mandate.put(self.item(e, tid))
        db.mandate.update(e, tid, {"mandate_state": "SUBMITTED"})
        assert db.mandate.get(e, tid).unwrap()["mandate_state"] == "SUBMITTED"
        db.mandate._delete(f"USER#{e}", f"TICKET#{tid}#MANDATE")

    def test_update_nonexistent_creates_item(self, db):
        e, tid = f"{self.NS}@it.de", "T_SM_UPS"
        db.mandate.update(e, tid, {"mandate_state": "ISSUED"})
        assert db.mandate.get(e, tid).unwrap() is not None
        db.mandate._delete(f"USER#{e}", f"TICKET#{tid}#MANDATE")

    def test_update_empty_dict_is_noop(self, db):
        e, tid = f"{self.NS}@it.de", "T_SM_EMP"
        db.mandate.put(self.item(e, tid, mandate_state="ISSUED"))
        assert db.mandate.update(e, tid, {}).is_ok()
        assert db.mandate.get(e, tid).unwrap()["mandate_state"] == "ISSUED"
        db.mandate._delete(f"USER#{e}", f"TICKET#{tid}#MANDATE")


# ---------------------------------------------------------------------------
# SepaReportConnector
# ---------------------------------------------------------------------------

class TestSepaReportConnectorIntegration:
    NS = "sr001"
    NOW = "2026-01-01T00:00:00Z"

    def item(self, date, report_id, **extra):
        return {
            "PK": f"SEPA#REPORT#{date}", "SK": f"REPORT#{report_id}",
            "report_type": "CAMT054",
            "s3_bucket": "bucket", "s3_key": f"sepa/{date}/{report_id}.xml",
            "parsed_at": self.NOW,
            **extra,
        }

    def test_put_success(self, db):
        date, rid = "2026-01-01", "SR_PUT"
        assert db.sepa_report.put(self.item(date, rid)).is_ok()
        db.sepa_report._delete(f"SEPA#REPORT#{date}", f"REPORT#{rid}")

    def test_get_found(self, db):
        date, rid = "2026-01-02", "SR_GET"
        db.sepa_report.put(self.item(date, rid))
        r = db.sepa_report.get(date, rid)
        assert r.is_ok()
        assert r.unwrap()["report_type"] == "CAMT054"
        db.sepa_report._delete(f"SEPA#REPORT#{date}", f"REPORT#{rid}")

    def test_get_not_found_returns_none(self, db):
        assert db.sepa_report.get("2099-01-01", "SR_GHOST").unwrap() is None

    def test_update_existing(self, db):
        date, rid = "2026-01-03", "SR_UPD"
        db.sepa_report.put(self.item(date, rid))
        db.sepa_report.update(date, rid, {"report_type": "PAIN002"})
        assert db.sepa_report.get(date, rid).unwrap()["report_type"] == "PAIN002"
        db.sepa_report._delete(f"SEPA#REPORT#{date}", f"REPORT#{rid}")

    def test_update_nonexistent_creates_item(self, db):
        date, rid = "2026-01-04", "SR_UPS"
        db.sepa_report.update(date, rid, {"report_type": "PAIN001"})
        assert db.sepa_report.get(date, rid).unwrap() is not None
        db.sepa_report._delete(f"SEPA#REPORT#{date}", f"REPORT#{rid}")

    def test_update_empty_dict_is_noop(self, db):
        date, rid = "2026-01-05", "SR_EMP"
        db.sepa_report.put(self.item(date, rid, report_type="CAMT054"))
        assert db.sepa_report.update(date, rid, {}).is_ok()
        assert db.sepa_report.get(date, rid).unwrap()["report_type"] == "CAMT054"
        db.sepa_report._delete(f"SEPA#REPORT#{date}", f"REPORT#{rid}")

    def test_list_by_date_empty(self, db):
        r = db.sepa_report.list_by_date("2099-12-31")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_list_by_date_single(self, db):
        date, rid = "2026-02-01", "SR_LBD"
        db.sepa_report.put(self.item(date, rid))
        r = db.sepa_report.list_by_date(date)
        assert r.is_ok()
        assert len(r.unwrap()) == 1
        db.sepa_report._delete(f"SEPA#REPORT#{date}", f"REPORT#{rid}")

    def test_list_by_date_multiple(self, db):
        date = "2026-02-02"
        rids = ["SR_LBDM_A", "SR_LBDM_B", "SR_LBDM_C"]
        for rid in rids:
            db.sepa_report.put(self.item(date, rid))
        r = db.sepa_report.list_by_date(date)
        assert r.is_ok()
        assert len(r.unwrap()) == 3
        for rid in rids:
            db.sepa_report._delete(f"SEPA#REPORT#{date}", f"REPORT#{rid}")

    def test_list_by_date_only_returns_that_date(self, db):
        dates = ["2026-02-03", "2026-02-04"]
        for d in dates:
            db.sepa_report.put(self.item(d, "SR_ISO"))
        r = db.sepa_report.list_by_date("2026-02-03")
        assert r.is_ok()
        assert all(i["PK"] == "SEPA#REPORT#2026-02-03" for i in r.unwrap())
        for d in dates:
            db.sepa_report._delete(f"SEPA#REPORT#{d}", "REPORT#SR_ISO")


# ---------------------------------------------------------------------------
# TrainSegmentDelayConnector
# ---------------------------------------------------------------------------

class TestTrainSegmentDelayConnectorIntegration:
    NS = "tsd001"
    NOW = "2026-01-01T00:00:00Z"

    def item(self, train_nr, date, seg_id, **extra):
        return {
            "PK": f"TRAIN#{train_nr}#{date}", "SK": f"SEG#{seg_id}",
            "GSI3_PK": f"STATION#8000001#{date}", "GSI3_SK": f"10:00#{train_nr}",
            "delayMinutes": 0, "origin": "A", "destination": "B",
            "origin_eva": 8000001, "destination_eva": 8000002,
            "planned_departure": "10:00", "planned_arrival": "10:30",
            "is_cancelled": False, "source": "iris",
            "finalized_at": self.NOW,
            **extra,
        }

    def test_put_success(self, db):
        assert db.train_delay.put(self.item("TSD_PUT", "2026-03-01", "SEG1")).is_ok()
        db.train_delay._delete("TRAIN#TSD_PUT#2026-03-01", "SEG#SEG1")

    def test_get_found(self, db):
        db.train_delay.put(self.item("TSD_GET", "2026-03-02", "SEG1"))
        r = db.train_delay.get("TSD_GET", "2026-03-02", "SEG1")
        assert r.is_ok()
        assert r.unwrap()["delayMinutes"] == 0
        db.train_delay._delete("TRAIN#TSD_GET#2026-03-02", "SEG#SEG1")

    def test_get_not_found_returns_none(self, db):
        assert db.train_delay.get("TSD_GHOST", "2099-01-01", "SEG_GHOST").unwrap() is None

    def test_update_existing(self, db):
        db.train_delay.put(self.item("TSD_UPD", "2026-03-03", "SEG1"))
        db.train_delay.update("TSD_UPD", "2026-03-03", "SEG1", {"delayMinutes": 45})
        assert db.train_delay.get("TSD_UPD", "2026-03-03", "SEG1").unwrap()["delayMinutes"] == 45
        db.train_delay._delete("TRAIN#TSD_UPD#2026-03-03", "SEG#SEG1")

    def test_update_nonexistent_creates_item(self, db):
        db.train_delay.update("TSD_UPS", "2026-03-04", "SEG1", {"delayMinutes": 5})
        assert db.train_delay.get("TSD_UPS", "2026-03-04", "SEG1").unwrap() is not None
        db.train_delay._delete("TRAIN#TSD_UPS#2026-03-04", "SEG#SEG1")

    def test_update_empty_dict_is_noop(self, db):
        db.train_delay.put(self.item("TSD_EMP", "2026-03-05", "SEG1", delayMinutes=10))
        assert db.train_delay.update("TSD_EMP", "2026-03-05", "SEG1", {}).is_ok()
        assert db.train_delay.get("TSD_EMP", "2026-03-05", "SEG1").unwrap()["delayMinutes"] == 10
        db.train_delay._delete("TRAIN#TSD_EMP#2026-03-05", "SEG#SEG1")

    def test_list_for_train_empty(self, db):
        r = db.train_delay.list_for_train("TSD_GHOST", "2099-01-01")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_list_for_train_single(self, db):
        db.train_delay.put(self.item("TSD_LFT", "2026-03-06", "SEG1"))
        r = db.train_delay.list_for_train("TSD_LFT", "2026-03-06")
        assert r.is_ok()
        assert len(r.unwrap()) == 1
        db.train_delay._delete("TRAIN#TSD_LFT#2026-03-06", "SEG#SEG1")

    def test_list_for_train_multiple(self, db):
        segs = ["SEG1", "SEG2", "SEG3"]
        for s in segs:
            db.train_delay.put(self.item("TSD_LFTM", "2026-03-07", s))
        r = db.train_delay.list_for_train("TSD_LFTM", "2026-03-07")
        assert r.is_ok()
        assert len(r.unwrap()) == 3
        for s in segs:
            db.train_delay._delete("TRAIN#TSD_LFTM#2026-03-07", f"SEG#{s}")

    def test_route_lookup_no_results(self, db):
        r = db.train_delay.route_lookup(9999999, "2099-01-01", "00:00#", "23:59#")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_route_lookup_found(self, db):
        train_nr, date, eva = "TSD_RL_A", "2026-03-08", 8000555
        item = self.item(train_nr, date, "SEG1",
                         GSI3_PK=f"STATION#{eva}#{date}",
                         GSI3_SK=f"14:00#{train_nr}",
                         origin_eva=eva, planned_departure="14:00")
        db.train_delay.put(item)
        r = db.train_delay.route_lookup(eva, date, "13:00#", "15:00#")
        assert r.is_ok()
        assert any(i["SK"] == "SEG#SEG1" for i in r.unwrap())
        db.train_delay._delete(f"TRAIN#{train_nr}#{date}", "SEG#SEG1")

    def test_route_lookup_outside_time_range_not_returned(self, db):
        train_nr, date, eva = "TSD_RL_B", "2026-03-09", 8000556
        item = self.item(train_nr, date, "SEG1",
                         GSI3_PK=f"STATION#{eva}#{date}",
                         GSI3_SK=f"23:00#{train_nr}",
                         origin_eva=eva, planned_departure="23:00")
        db.train_delay.put(item)
        r = db.train_delay.route_lookup(eva, date, "06:00#", "09:00#")
        assert r.is_ok()
        assert not any(i["SK"] == "SEG#SEG1" for i in r.unwrap())
        db.train_delay._delete(f"TRAIN#{train_nr}#{date}", "SEG#SEG1")

    def test_route_lookup_multiple_trains_in_range(self, db):
        date, eva = "2026-03-10", 8000557
        trains = [("TSD_RL_C1", "10:00"), ("TSD_RL_C2", "11:00"), ("TSD_RL_C3", "12:00")]
        for train_nr, dep in trains:
            item = self.item(train_nr, date, "SEG1",
                             GSI3_PK=f"STATION#{eva}#{date}",
                             GSI3_SK=f"{dep}#{train_nr}",
                             origin_eva=eva, planned_departure=dep)
            db.train_delay.put(item)
        r = db.train_delay.route_lookup(eva, date, "09:00#", "13:00#")
        assert r.is_ok()
        assert len(r.unwrap()) >= 3
        for train_nr, _ in trains:
            db.train_delay._delete(f"TRAIN#{train_nr}#{date}", "SEG#SEG1")


# ---------------------------------------------------------------------------
# RouteTemplateConnector
# ---------------------------------------------------------------------------

class TestRouteTemplateConnectorIntegration:
    NS = "rt001"
    NOW = "2026-01-01T00:00:00Z"

    def item(self, email, tid, **extra):
        return {
            "PK": f"USER#{email}", "SK": f"TEMPLATE#{tid}",
            "templateId": tid, "label": "Test Route",
            "from_station": "A", "to_station": "B",
            "from_eva": 1, "to_eva": 2,
            "created_at": self.NOW, "updated_at": self.NOW,
            **extra,
        }

    def test_put_success(self, db):
        e, tid = f"{self.NS}@it.de", "TMP_PUT"
        assert db.route_template.put(self.item(e, tid)).is_ok()
        db.route_template._delete(f"USER#{e}", f"TEMPLATE#{tid}")

    def test_get_found(self, db):
        e, tid = f"{self.NS}@it.de", "TMP_GET"
        db.route_template.put(self.item(e, tid))
        r = db.route_template.get(e, tid)
        assert r.is_ok()
        assert r.unwrap()["label"] == "Test Route"
        db.route_template._delete(f"USER#{e}", f"TEMPLATE#{tid}")

    def test_get_not_found_returns_none(self, db):
        assert db.route_template.get("ghost.rt001@it.de", "TMP_GHOST").unwrap() is None

    def test_update_existing(self, db):
        e, tid = f"{self.NS}@it.de", "TMP_UPD"
        db.route_template.put(self.item(e, tid))
        db.route_template.update(e, tid, {"label": "Updated"})
        assert db.route_template.get(e, tid).unwrap()["label"] == "Updated"
        db.route_template._delete(f"USER#{e}", f"TEMPLATE#{tid}")

    def test_update_nonexistent_creates_item(self, db):
        e, tid = f"{self.NS}@it.de", "TMP_UPS"
        db.route_template.update(e, tid, {"label": "Upserted"})
        assert db.route_template.get(e, tid).unwrap() is not None
        db.route_template._delete(f"USER#{e}", f"TEMPLATE#{tid}")

    def test_update_empty_dict_is_noop(self, db):
        e, tid = f"{self.NS}@it.de", "TMP_EMP"
        db.route_template.put(self.item(e, tid, label="Stable"))
        assert db.route_template.update(e, tid, {}).is_ok()
        assert db.route_template.get(e, tid).unwrap()["label"] == "Stable"
        db.route_template._delete(f"USER#{e}", f"TEMPLATE#{tid}")

    def test_list_for_user_empty(self, db):
        r = db.route_template.list_for_user("ghost.rt001@it.de")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_list_for_user_single(self, db):
        e, tid = f"{self.NS}@it.de", "TMP_LFU"
        db.route_template.put(self.item(e, tid))
        r = db.route_template.list_for_user(e)
        assert r.is_ok()
        assert any(i["SK"] == f"TEMPLATE#{tid}" for i in r.unwrap())
        db.route_template._delete(f"USER#{e}", f"TEMPLATE#{tid}")

    def test_list_for_user_multiple(self, db):
        e = f"{self.NS}@it.de"
        tids = ["TMP_LFUM_A", "TMP_LFUM_B", "TMP_LFUM_C"]
        for tid in tids:
            db.route_template.put(self.item(e, tid))
        r = db.route_template.list_for_user(e)
        assert r.is_ok()
        sks = [i["SK"] for i in r.unwrap()]
        for tid in tids:
            assert f"TEMPLATE#{tid}" in sks
        for tid in tids:
            db.route_template._delete(f"USER#{e}", f"TEMPLATE#{tid}")

    def test_list_for_user_only_returns_this_user(self, db):
        e1, e2 = f"{self.NS}_A@it.de", f"{self.NS}_B@it.de"
        db.route_template.put(self.item(e1, "TMP_ISO"))
        db.route_template.put(self.item(e2, "TMP_ISO"))
        r = db.route_template.list_for_user(e1)
        assert r.is_ok()
        assert all(i["PK"] == f"USER#{e1}" for i in r.unwrap())
        db.route_template._delete(f"USER#{e1}", "TEMPLATE#TMP_ISO")
        db.route_template._delete(f"USER#{e2}", "TEMPLATE#TMP_ISO")


# ---------------------------------------------------------------------------
# RailBackConnector — simple deletes
# ---------------------------------------------------------------------------

class TestSimpleDeletesIntegration:
    NS = "sd001"
    NOW = "2026-01-01T00:00:00Z"

    def test_delete_admin_success(self, db):
        e = f"{self.NS}_admin@it.de"
        db.admin.put({"PK": f"ADMIN#{e}", "SK": "PROFILE",
                      "GSI1_PK": "ADMIN", "GSI1_SK": f"EMAIL#{e}",
                      "hashed_password": "x", "created_at": self.NOW})
        r = db.delete_admin(e)
        assert r.is_ok()
        assert db.admin.get(e).unwrap() is None

    def test_delete_admin_nonexistent_is_ok(self, db):
        assert db.delete_admin("ghost.sd001.admin@it.de").is_ok()

    def test_delete_ticket_owner_success(self, db):
        tid = "SD001_TO"
        db.ticket_owner.put({"PK": f"TICKET#{tid}", "SK": "OWNER",
                             "email": "x@x.de", "ticketId": tid,
                             "created_at": self.NOW})
        r = db.delete_ticket_owner(tid)
        assert r.is_ok()
        assert db.ticket_owner.get(tid).unwrap() is None

    def test_delete_ticket_owner_nonexistent_is_ok(self, db):
        assert db.delete_ticket_owner("SD001_TO_GHOST").is_ok()

    def test_delete_raw_upload_success(self, db):
        e, tid = f"{self.NS}@it.de", "SD001_RAW"
        db.raw_upload.put({"PK": f"USER#{e}", "SK": f"RAW#{tid}",
                           "filename": "f.pdf", "s3_bucket": "b", "s3_key": "k",
                           "uploaded_at": self.NOW})
        r = db.delete_raw_upload(e, tid)
        assert r.is_ok()
        assert db.raw_upload.get(e, tid).unwrap() is None

    def test_delete_raw_upload_nonexistent_is_ok(self, db):
        assert db.delete_raw_upload(f"{self.NS}@it.de", "SD001_RAW_GHOST").is_ok()

    def test_delete_rendered_pdf_success(self, db):
        e, tid = f"{self.NS}@it.de", "SD001_RPD"
        db.rendered_pdf.put({"PK": f"USER#{e}", "SK": f"RENDERED#{tid}",
                             "s3_bucket": "b", "s3_key": "k",
                             "rendered_at": self.NOW})
        r = db.delete_rendered_pdf(e, tid)
        assert r.is_ok()
        assert db.rendered_pdf.get(e, tid).unwrap() is None

    def test_delete_rendered_pdf_nonexistent_is_ok(self, db):
        assert db.delete_rendered_pdf(f"{self.NS}@it.de", "SD001_RPD_GHOST").is_ok()

    def test_delete_receipt_success(self, db):
        e, tid, bid = f"{self.NS}@it.de", "SD001_T", "SD001_B"
        db.receipt.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#BELEG#{bid}",
                        "typ": "TAXI", "uploaded_at": self.NOW})
        r = db.delete_receipt(e, tid, bid)
        assert r.is_ok()
        assert db.receipt.get(e, tid, bid).unwrap() is None

    def test_delete_receipt_nonexistent_is_ok(self, db):
        assert db.delete_receipt(f"{self.NS}@it.de", "SD001_T_GHOST", "SD001_B_GHOST").is_ok()

    def test_delete_mandate_success(self, db):
        e, tid = f"{self.NS}@it.de", "SD001_MAND_T"
        db.mandate.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#MANDATE",
                        "mandate_state": "ISSUED", "issued_at": self.NOW})
        r = db.delete_mandate(e, tid)
        assert r.is_ok()
        assert db.mandate.get(e, tid).unwrap() is None

    def test_delete_mandate_nonexistent_is_ok(self, db):
        assert db.delete_mandate(f"{self.NS}@it.de", "SD001_MAND_GHOST").is_ok()

    def test_delete_sepa_report_success(self, db):
        date, rid = "2026-04-01", "SD001_SR"
        db.sepa_report.put({"PK": f"SEPA#REPORT#{date}", "SK": f"REPORT#{rid}",
                            "report_type": "CAMT054", "parsed_at": self.NOW,
                            "s3_bucket": "b", "s3_key": "k"})
        r = db.delete_sepa_report(date, rid)
        assert r.is_ok()
        assert db.sepa_report.get(date, rid).unwrap() is None

    def test_delete_sepa_report_nonexistent_is_ok(self, db):
        assert db.delete_sepa_report("2099-01-01", "SD001_SR_GHOST").is_ok()

    def test_delete_train_delay_success(self, db):
        train_nr, date, seg = "SD001_TN", "2026-04-01", "SD001_SEG"
        db.train_delay.put({"PK": f"TRAIN#{train_nr}#{date}", "SK": f"SEG#{seg}",
                            "GSI3_PK": f"STATION#1#{date}", "GSI3_SK": f"10:00#{train_nr}",
                            "delayMinutes": 0, "origin": "A", "destination": "B",
                            "origin_eva": 1, "destination_eva": 2,
                            "planned_departure": "10:00", "planned_arrival": "10:30",
                            "is_cancelled": False, "source": "iris",
                            "finalized_at": self.NOW})
        r = db.delete_train_delay(train_nr, date, seg)
        assert r.is_ok()
        assert db.train_delay.get(train_nr, date, seg).unwrap() is None

    def test_delete_train_delay_nonexistent_is_ok(self, db):
        assert db.delete_train_delay("SD001_TN_GHOST", "2099-01-01", "SD001_SEG_GHOST").is_ok()

    def test_delete_route_template_success(self, db):
        e, tid = f"{self.NS}@it.de", "SD001_TMP"
        db.route_template.put({"PK": f"USER#{e}", "SK": f"TEMPLATE#{tid}",
                               "templateId": tid, "label": "X",
                               "created_at": self.NOW, "updated_at": self.NOW})
        r = db.delete_route_template(e, tid)
        assert r.is_ok()
        assert db.route_template.get(e, tid).unwrap() is None

    def test_delete_route_template_nonexistent_is_ok(self, db):
        assert db.delete_route_template(f"{self.NS}@it.de", "SD001_TMP_GHOST").is_ok()


# ---------------------------------------------------------------------------
# RailBackConnector.delete_ticket — cascade
# ---------------------------------------------------------------------------

class TestDeleteTicketIntegration:
    NS = "dt001"
    NOW = "2026-01-01T00:00:00Z"

    def put_full_ticket(self, db, e, tid, beleg_ids=None):
        db.ticket.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}",
                       "GSI1_PK": f"TRAIN#IC 1#{self.NOW[:10]}", "GSI1_SK": f"TICKET#{tid}",
                       "ticket_state": "READY", "uploaded_at": self.NOW, "updated_at": self.NOW})
        db.ticket_owner.put({"PK": f"TICKET#{tid}", "SK": "OWNER",
                             "email": e, "ticketId": tid, "created_at": self.NOW})
        db.raw_upload.put({"PK": f"USER#{e}", "SK": f"RAW#{tid}",
                           "s3_bucket": "b", "s3_key": "k", "uploaded_at": self.NOW})
        db.rendered_pdf.put({"PK": f"USER#{e}", "SK": f"RENDERED#{tid}",
                             "s3_bucket": "b", "s3_key": "k", "rendered_at": self.NOW})
        db.mandate.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#MANDATE",
                        "mandate_state": "ISSUED", "issued_at": self.NOW})
        for bid in (beleg_ids or []):
            db.receipt.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#BELEG#{bid}",
                            "typ": "TAXI", "uploaded_at": self.NOW})

    def test_delete_ticket_minimal(self, db):
        e, tid = f"{self.NS}_minimal@it.de", "DT_MINIMAL"
        db.ticket.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}",
                       "GSI1_PK": "TRAIN#X#2026-01-01", "GSI1_SK": f"TICKET#{tid}",
                       "ticket_state": "READY", "uploaded_at": self.NOW, "updated_at": self.NOW})
        r = db.delete_ticket(e, tid)
        assert r.is_ok()
        assert db.ticket.get(e, tid).unwrap() is None

    def test_delete_ticket_full_cascade(self, db):
        e, tid = f"{self.NS}_full@it.de", "DT_FULL"
        self.put_full_ticket(db, e, tid, beleg_ids=["B1", "B2"])
        r = db.delete_ticket(e, tid)
        assert r.is_ok()
        assert db.ticket.get(e, tid).unwrap() is None
        assert db.ticket_owner.get(tid).unwrap() is None
        assert db.raw_upload.get(e, tid).unwrap() is None
        assert db.rendered_pdf.get(e, tid).unwrap() is None
        assert db.mandate.get(e, tid).unwrap() is None
        assert db.receipt.list_for_ticket(e, tid).unwrap() == []

    def test_delete_ticket_nonexistent_is_ok(self, db):
        r = db.delete_ticket(f"{self.NS}_ghost@it.de", "DT_GHOST")
        assert r.is_ok()

    def test_delete_ticket_does_not_affect_other_tickets(self, db):
        e = f"{self.NS}_iso@it.de"
        self.put_full_ticket(db, e, "DT_ISO_A")
        self.put_full_ticket(db, e, "DT_ISO_B")
        db.delete_ticket(e, "DT_ISO_A")
        assert db.ticket.get(e, "DT_ISO_B").unwrap() is not None
        assert db.ticket_owner.get("DT_ISO_B").unwrap() is not None
        assert db.raw_upload.get(e, "DT_ISO_B").unwrap() is not None
        assert db.rendered_pdf.get(e, "DT_ISO_B").unwrap() is not None
        assert db.mandate.get(e, "DT_ISO_B").unwrap() is not None
        # cleanup
        db.delete_ticket(e, "DT_ISO_B")

    def test_delete_ticket_prefix_collision_safe(self, db):
        """delete_ticket("abc") must not delete items belonging to ticket "abcX"."""
        e = f"{self.NS}_prefix@it.de"
        tid_short, tid_long = "DT_PREFIX", "DT_PREFIX_X"
        for tid in [tid_short, tid_long]:
            db.ticket.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}",
                           "GSI1_PK": "TRAIN#X#2026-01-01", "GSI1_SK": f"TICKET#{tid}",
                           "ticket_state": "READY", "uploaded_at": self.NOW, "updated_at": self.NOW})
            db.receipt.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#BELEG#B1",
                            "typ": "TAXI", "uploaded_at": self.NOW})
        db.delete_ticket(e, tid_short)
        # The short ticket is gone
        assert db.ticket.get(e, tid_short).unwrap() is None
        assert db.receipt.get(e, tid_short, "B1").unwrap() is None
        # The long ticket must survive
        assert db.ticket.get(e, tid_long).unwrap() is not None
        assert db.receipt.get(e, tid_long, "B1").unwrap() is not None
        # cleanup
        db.delete_ticket(e, tid_long)

    def test_delete_ticket_with_multiple_receipts(self, db):
        e, tid = f"{self.NS}_mreceipt@it.de", "DT_MRECEIPT"
        self.put_full_ticket(db, e, tid, beleg_ids=["B1", "B2", "B3", "B4", "B5"])
        r = db.delete_ticket(e, tid)
        assert r.is_ok()
        assert db.receipt.list_for_ticket(e, tid).unwrap() == []

    def test_delete_ticket_only_deletes_aux_for_this_user(self, db):
        e1, e2, tid = f"{self.NS}_usr1@it.de", f"{self.NS}_usr2@it.de", "DT_USRISO"
        db.ticket.put({"PK": f"USER#{e1}", "SK": f"TICKET#{tid}",
                       "GSI1_PK": "TRAIN#X#2026-01-01", "GSI1_SK": f"TICKET#{tid}",
                       "ticket_state": "READY", "uploaded_at": self.NOW, "updated_at": self.NOW})
        db.raw_upload.put({"PK": f"USER#{e2}", "SK": f"RAW#{tid}",
                           "s3_bucket": "b", "s3_key": "k", "uploaded_at": self.NOW})
        db.delete_ticket(e1, tid)
        # e2's RAW upload for the same ticket_id must NOT be deleted
        assert db.raw_upload.get(e2, tid).unwrap() is not None
        db.raw_upload._delete(f"USER#{e2}", f"RAW#{tid}")


# ---------------------------------------------------------------------------
# RailBackConnector.delete_user — cascade
# ---------------------------------------------------------------------------

class TestDeleteUserIntegration:
    NS = "du001"
    NOW = "2026-01-01T00:00:00Z"

    def put_user(self, db, e, **extra):
        db.user.put({"PK": f"USER#{e}", "SK": "PROFILE",
                     "GSI1_PK": "USER", "GSI1_SK": f"EMAIL#{e}",
                     "user_state": "ACTIVE", "hashed_password": "x",
                     "created_at": self.NOW,
                     "datenschutz_einwilligung": True, "agb_akzeptiert": True,
                     **extra})

    def put_ticket(self, db, e, tid):
        db.ticket.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}",
                       "GSI1_PK": f"TRAIN#IC 1#{self.NOW[:10]}", "GSI1_SK": f"TICKET#{tid}",
                       "ticket_state": "READY", "uploaded_at": self.NOW, "updated_at": self.NOW})
        db.ticket_owner.put({"PK": f"TICKET#{tid}", "SK": "OWNER",
                             "email": e, "ticketId": tid, "created_at": self.NOW})

    def test_delete_user_empty_partition(self, db):
        r = db.delete_user("ghost.du001@it.de")
        assert r.is_ok()

    def test_delete_user_profile_only(self, db):
        e = f"{self.NS}_profile@it.de"
        self.put_user(db, e)
        r = db.delete_user(e)
        assert r.is_ok()
        assert db.user.get(e).unwrap() is None

    def test_delete_user_with_ticket_cascades_ticket_owner(self, db):
        e = f"{self.NS}_withtkt@it.de"
        tid = "DU_TKT"
        self.put_user(db, e)
        self.put_ticket(db, e, tid)
        r = db.delete_user(e)
        assert r.is_ok()
        assert db.user.get(e).unwrap() is None
        assert db.ticket.get(e, tid).unwrap() is None
        assert db.ticket_owner.get(tid).unwrap() is None

    def test_delete_user_with_multiple_tickets_all_owners_deleted(self, db):
        e = f"{self.NS}_multitkt@it.de"
        tids = ["DU_MT1", "DU_MT2", "DU_MT3"]
        self.put_user(db, e)
        for tid in tids:
            self.put_ticket(db, e, tid)
        r = db.delete_user(e)
        assert r.is_ok()
        for tid in tids:
            assert db.ticket_owner.get(tid).unwrap() is None

    def test_delete_user_with_raw_and_rendered(self, db):
        e, tid = f"{self.NS}_raw@it.de", "DU_RAW"
        self.put_user(db, e)
        db.raw_upload.put({"PK": f"USER#{e}", "SK": f"RAW#{tid}",
                           "s3_bucket": "b", "s3_key": "k", "uploaded_at": self.NOW})
        db.rendered_pdf.put({"PK": f"USER#{e}", "SK": f"RENDERED#{tid}",
                             "s3_bucket": "b", "s3_key": "k", "rendered_at": self.NOW})
        r = db.delete_user(e)
        assert r.is_ok()
        assert db.raw_upload.get(e, tid).unwrap() is None
        assert db.rendered_pdf.get(e, tid).unwrap() is None

    def test_delete_user_with_templates(self, db):
        e, tmpl = f"{self.NS}_tmpl@it.de", "DU_TMPL"
        self.put_user(db, e)
        db.route_template.put({"PK": f"USER#{e}", "SK": f"TEMPLATE#{tmpl}",
                               "templateId": tmpl, "label": "X",
                               "created_at": self.NOW, "updated_at": self.NOW})
        r = db.delete_user(e)
        assert r.is_ok()
        assert db.route_template.get(e, tmpl).unwrap() is None

    def test_delete_user_with_receipts_and_mandates(self, db):
        e, tid, bid = f"{self.NS}_rcpt@it.de", "DU_RCPT", "DU_B"
        self.put_user(db, e)
        self.put_ticket(db, e, tid)
        db.receipt.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#BELEG#{bid}",
                        "typ": "TAXI", "uploaded_at": self.NOW})
        db.mandate.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#MANDATE",
                        "mandate_state": "ISSUED", "issued_at": self.NOW})
        r = db.delete_user(e)
        assert r.is_ok()
        assert db.user.get(e).unwrap() is None
        assert db.receipt.get(e, tid, bid).unwrap() is None
        assert db.mandate.get(e, tid).unwrap() is None

    def test_delete_user_does_not_delete_other_user(self, db):
        e1, e2 = f"{self.NS}_usr1@it.de", f"{self.NS}_usr2@it.de"
        self.put_user(db, e1)
        self.put_user(db, e2)
        db.delete_user(e1)
        assert db.user.get(e2).unwrap() is not None
        db.user._delete(f"USER#{e2}", "PROFILE")

    def test_delete_user_full_cascade(self, db):
        """Puts every item type under a user partition and verifies all are gone after delete_user."""
        e, tid, bid, tmpl = f"{self.NS}_full@it.de", "DU_FULL_T", "DU_FULL_B", "DU_FULL_TMPL"
        self.put_user(db, e)
        self.put_ticket(db, e, tid)
        db.raw_upload.put({"PK": f"USER#{e}", "SK": f"RAW#{tid}",
                           "s3_bucket": "b", "s3_key": "k", "uploaded_at": self.NOW})
        db.rendered_pdf.put({"PK": f"USER#{e}", "SK": f"RENDERED#{tid}",
                             "s3_bucket": "b", "s3_key": "k", "rendered_at": self.NOW})
        db.receipt.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#BELEG#{bid}",
                        "typ": "TAXI", "uploaded_at": self.NOW})
        db.mandate.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#MANDATE",
                        "mandate_state": "ISSUED", "issued_at": self.NOW})
        db.route_template.put({"PK": f"USER#{e}", "SK": f"TEMPLATE#{tmpl}",
                               "templateId": tmpl, "label": "X",
                               "created_at": self.NOW, "updated_at": self.NOW})
        r = db.delete_user(e)
        assert r.is_ok()
        assert db.user.get(e).unwrap() is None
        assert db.ticket.get(e, tid).unwrap() is None
        assert db.ticket_owner.get(tid).unwrap() is None
        assert db.raw_upload.get(e, tid).unwrap() is None
        assert db.rendered_pdf.get(e, tid).unwrap() is None
        assert db.receipt.get(e, tid, bid).unwrap() is None
        assert db.mandate.get(e, tid).unwrap() is None
        assert db.route_template.get(e, tmpl).unwrap() is None


# ---------------------------------------------------------------------------
# Connection errors
# ---------------------------------------------------------------------------

class TestConnectionErrors:
    """Verifies that every operation returns Err when DynamoDB is unreachable."""

    def test_user_get_connection_error(self, bad_db):
        assert bad_db.user.get("x@x.de").is_err()

    def test_user_put_connection_error(self, bad_db):
        assert bad_db.user.put({"PK": "USER#x", "SK": "PROFILE"}).is_err()

    def test_user_update_connection_error(self, bad_db):
        assert bad_db.user.update("x@x.de", {"vorname": "x"}).is_err()

    def test_user_list_all_connection_error(self, bad_db):
        assert bad_db.user.list_all().is_err()

    def test_admin_get_connection_error(self, bad_db):
        assert bad_db.admin.get("x@x.de").is_err()

    def test_ticket_get_connection_error(self, bad_db):
        assert bad_db.ticket.get("x@x.de", "T001").is_err()

    def test_ticket_list_for_user_connection_error(self, bad_db):
        assert bad_db.ticket.list_for_user("x@x.de").is_err()

    def test_ticket_check_barcode_connection_error(self, bad_db):
        assert bad_db.ticket.check_barcode_duplicate("uid").is_err()

    def test_ticket_list_email_pending_connection_error(self, bad_db):
        assert bad_db.ticket.list_email_pending().is_err()

    def test_ticket_owner_get_connection_error(self, bad_db):
        assert bad_db.ticket_owner.get("T001").is_err()

    def test_raw_upload_get_connection_error(self, bad_db):
        assert bad_db.raw_upload.get("x@x.de", "T001").is_err()

    def test_rendered_pdf_get_connection_error(self, bad_db):
        assert bad_db.rendered_pdf.get("x@x.de", "T001").is_err()

    def test_receipt_get_connection_error(self, bad_db):
        assert bad_db.receipt.get("x@x.de", "T001", "B001").is_err()

    def test_receipt_list_for_ticket_connection_error(self, bad_db):
        assert bad_db.receipt.list_for_ticket("x@x.de", "T001").is_err()

    def test_mandate_get_connection_error(self, bad_db):
        assert bad_db.mandate.get("x@x.de", "T001").is_err()

    def test_sepa_report_get_connection_error(self, bad_db):
        assert bad_db.sepa_report.get("2026-01-01", "R001").is_err()

    def test_sepa_report_list_by_date_connection_error(self, bad_db):
        assert bad_db.sepa_report.list_by_date("2026-01-01").is_err()

    def test_train_delay_get_connection_error(self, bad_db):
        assert bad_db.train_delay.get("IC 1", "2026-01-01", "SEG1").is_err()

    def test_train_delay_list_for_train_connection_error(self, bad_db):
        assert bad_db.train_delay.list_for_train("IC 1", "2026-01-01").is_err()

    def test_train_delay_route_lookup_connection_error(self, bad_db):
        assert bad_db.train_delay.route_lookup(8000001, "2026-01-01", "10:00#", "12:00#").is_err()

    def test_route_template_get_connection_error(self, bad_db):
        assert bad_db.route_template.get("x@x.de", "TMP1").is_err()

    def test_route_template_list_for_user_connection_error(self, bad_db):
        assert bad_db.route_template.list_for_user("x@x.de").is_err()

    def test_delete_admin_connection_error(self, bad_db):
        assert bad_db.delete_admin("x@x.de").is_err()

    def test_delete_ticket_connection_error(self, bad_db):
        assert bad_db.delete_ticket("x@x.de", "T001").is_err()

    def test_delete_user_connection_error(self, bad_db):
        assert bad_db.delete_user("x@x.de").is_err()


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

class TestPagination:
    """Force DynamoDB Local to paginate by inserting many items."""
    NS = "pg001"
    NOW = "2026-01-01T00:00:00Z"

    def test_query_paginates_all_items(self, db):
        """Insert 100 receipts and verify list_for_ticket returns all 100."""
        e, tid = f"{self.NS}@it.de", "PG_TICKET"
        bids = [f"B_{i:03d}" for i in range(100)]
        for bid in bids:
            db.receipt.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}#BELEG#{bid}",
                            "typ": "TAXI", "uploaded_at": self.NOW})
        r = db.receipt.list_for_ticket(e, tid)
        assert r.is_ok()
        assert len(r.unwrap()) == 100
        for bid in bids:
            db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{bid}")

    def test_list_for_user_paginates_many_tickets(self, db):
        e = f"{self.NS}@it.de"
        tids = [f"PGTICKET_{i:03d}" for i in range(60)]
        for tid in tids:
            db.ticket.put({"PK": f"USER#{e}", "SK": f"TICKET#{tid}",
                           "GSI1_PK": "TRAIN#IC 1#2026-01-01", "GSI1_SK": f"TICKET#{tid}",
                           "ticket_state": "READY", "uploaded_at": self.NOW, "updated_at": self.NOW})
        r = db.ticket.list_for_user(e)
        assert r.is_ok()
        assert len(r.unwrap()) == 60
        for tid in tids:
            db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_list_for_train_paginates_many_segments(self, db):
        train_nr, date = "PG_TRAIN", "2026-05-01"
        segs = [f"SEG_{i:03d}" for i in range(80)]
        for seg in segs:
            db.train_delay.put({
                "PK": f"TRAIN#{train_nr}#{date}", "SK": f"SEG#{seg}",
                "GSI3_PK": f"STATION#8001#{date}", "GSI3_SK": f"10:00#{train_nr}",
                "delayMinutes": 0, "origin": "A", "destination": "B",
                "origin_eva": 8001, "destination_eva": 8002,
                "planned_departure": "10:00", "planned_arrival": "10:30",
                "is_cancelled": False, "source": "iris", "finalized_at": self.NOW,
            })
        r = db.train_delay.list_for_train(train_nr, date)
        assert r.is_ok()
        assert len(r.unwrap()) == 80
        for seg in segs:
            db.train_delay._delete(f"TRAIN#{train_nr}#{date}", f"SEG#{seg}")
