NS = "sm001"
NOW = "2026-01-01T00:00:00Z"
E = f"{NS}@it.de"


def item(tid, **extra):
    return {"pk": f"USER#{E}", "sk": f"TICKET#{tid}#MANDATE",
            "mandate_id": f"MID_{tid}", "mandate_state": "ISSUED",
            "fee_amount": "5.00", "issued_at": NOW, **extra}


class TestSepaMandateConnector:
    def test_put_success(self, db):
        assert db.mandate.put(item("T_SM_PUT")).is_ok()
        db.mandate._delete(f"USER#{E}", "TICKET#T_SM_PUT#MANDATE")

    def test_get_found(self, db):
        db.mandate.put(item("T_SM_GET"))
        assert db.mandate.get(E, "T_SM_GET").unwrap()["mandate_state"] == "ISSUED"
        db.mandate._delete(f"USER#{E}", "TICKET#T_SM_GET#MANDATE")

    def test_get_not_found_returns_none(self, db):
        assert db.mandate.get("ghost.sm001@it.de", "T_GHOST").unwrap() is None

    def test_update_existing(self, db):
        db.mandate.put(item("T_SM_UPD"))
        db.mandate.update(E, "T_SM_UPD", {"mandate_state": "SUBMITTED"})
        assert db.mandate.get(E, "T_SM_UPD").unwrap()["mandate_state"] == "SUBMITTED"
        db.mandate._delete(f"USER#{E}", "TICKET#T_SM_UPD#MANDATE")

    def test_update_empty_dict_is_noop(self, db):
        db.mandate.put(item("T_SM_EMP"))
        assert db.mandate.update(E, "T_SM_EMP", {}).is_ok()
        assert db.mandate.get(E, "T_SM_EMP").unwrap()["mandate_state"] == "ISSUED"
        db.mandate._delete(f"USER#{E}", "TICKET#T_SM_EMP#MANDATE")

    def test_stamp_pain008_built_succeeds_first_time(self, db):
        db.mandate.put(item("T_SM_STAMP"))
        r = db.mandate.stamp_pain008_built(E, "T_SM_STAMP", "BATCH_001", "pain008/BATCH_001.xml", "2026-07-05T10:00:00.000Z")
        assert r.is_ok()
        row = db.mandate.get(E, "T_SM_STAMP").unwrap()
        assert row["pain008_batch_id"] == "BATCH_001"
        assert row["pain008_s3_key"] == "pain008/BATCH_001.xml"
        assert row["pain008_built_at"] == "2026-07-05T10:00:00.000Z"
        db.mandate._delete(f"USER#{E}", "TICKET#T_SM_STAMP#MANDATE")

    def test_stamp_pain008_built_conflict_on_second_call(self, db):
        from db.base import ConflictError
        db.mandate.put(item("T_SM_CONF"))
        db.mandate.stamp_pain008_built(E, "T_SM_CONF", "BATCH_A", "pain008/BATCH_A.xml", "2026-07-05T10:00:00.000Z")
        r = db.mandate.stamp_pain008_built(E, "T_SM_CONF", "BATCH_B", "pain008/BATCH_B.xml", "2026-07-05T11:00:00.000Z")
        assert r.is_err()
        assert isinstance(r.error, ConflictError)
        row = db.mandate.get(E, "T_SM_CONF").unwrap()
        assert row["pain008_batch_id"] == "BATCH_A"
        db.mandate._delete(f"USER#{E}", "TICKET#T_SM_CONF#MANDATE")
