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
