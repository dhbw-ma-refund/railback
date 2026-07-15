NS = "or001"
NOW = "2026-01-01T00:00:00Z"
E = f"{NS}@it.de"


def item(tid, bid, **extra):
    return {"pk": f"USER#{E}", "sk": f"TICKET#{tid}#BELEG#{bid}",
            "filename": "receipt.pdf", "typ": "TAXI",
            "s3_bucket": "railback-uploads", "s3_key": f"belege/{tid}/{bid}.pdf",
            "content_type": "application/pdf", "size_bytes": 51204,
            "uploaded_at": NOW, **extra}


class TestOriginalReceiptConnector:
    def test_put_success(self, db):
        assert db.receipt.put(item("T_OR_PUT", "B_PUT")).is_ok()
        db.receipt._delete(f"USER#{E}", "TICKET#T_OR_PUT#BELEG#B_PUT")

    def test_get_found(self, db):
        db.receipt.put(item("T_OR_GET", "B_GET"))
        assert db.receipt.get(E, "T_OR_GET", "B_GET").unwrap()["typ"] == "TAXI"
        db.receipt._delete(f"USER#{E}", "TICKET#T_OR_GET#BELEG#B_GET")

    def test_get_not_found_returns_none(self, db):
        assert db.receipt.get("ghost.or001@it.de", "T_GHOST", "B_GHOST").unwrap() is None

    def test_update_existing(self, db):
        db.receipt.put(item("T_OR_UPD", "B_UPD"))
        db.receipt.update(E, "T_OR_UPD", "B_UPD", {"typ": "BUS"})
        assert db.receipt.get(E, "T_OR_UPD", "B_UPD").unwrap()["typ"] == "BUS"
        db.receipt._delete(f"USER#{E}", "TICKET#T_OR_UPD#BELEG#B_UPD")

    def test_update_empty_dict_is_noop(self, db):
        db.receipt.put(item("T_OR_EMP", "B_EMP", typ="TAXI"))
        assert db.receipt.update(E, "T_OR_EMP", "B_EMP", {}).is_ok()
        assert db.receipt.get(E, "T_OR_EMP", "B_EMP").unwrap()["typ"] == "TAXI"
        db.receipt._delete(f"USER#{E}", "TICKET#T_OR_EMP#BELEG#B_EMP")

    def test_list_for_ticket_empty(self, db):
        r = db.receipt.list_for_ticket("ghost.or001@it.de", "T_GHOST")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_list_for_ticket_single(self, db):
        db.receipt.put(item("T_OR_LFT", "B_LFT"))
        r = db.receipt.list_for_ticket(E, "T_OR_LFT")
        assert r.is_ok()
        assert len(r.unwrap()) == 1
        assert r.unwrap()[0]["sk"] == "TICKET#T_OR_LFT#BELEG#B_LFT"
        db.receipt._delete(f"USER#{E}", "TICKET#T_OR_LFT#BELEG#B_LFT")

    def test_list_for_ticket_multiple(self, db):
        bids = ["B_LFTM_A", "B_LFTM_B", "B_LFTM_C"]
        for bid in bids:
            db.receipt.put(item("T_OR_LFTM", bid))
        r = db.receipt.list_for_ticket(E, "T_OR_LFTM")
        assert r.is_ok()
        assert len(r.unwrap()) == 3
        for bid in bids:
            db.receipt._delete(f"USER#{E}", f"TICKET#T_OR_LFTM#BELEG#{bid}")

    def test_list_for_ticket_only_returns_this_ticket(self, db):
        db.receipt.put(item("T_OR_ISO_A", "B1"))
        db.receipt.put(item("T_OR_ISO_B", "B1"))
        r = db.receipt.list_for_ticket(E, "T_OR_ISO_A")
        sks = [i["sk"] for i in r.unwrap()]
        assert all("T_OR_ISO_A" in s for s in sks)
        assert all("T_OR_ISO_B" not in s for s in sks)
        db.receipt._delete(f"USER#{E}", "TICKET#T_OR_ISO_A#BELEG#B1")
        db.receipt._delete(f"USER#{E}", "TICKET#T_OR_ISO_B#BELEG#B1")
