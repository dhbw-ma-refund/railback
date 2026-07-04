NS = "to001"
NOW = "2026-01-01T00:00:00Z"


def owner(tid, email, **extra):
    return {"pk": f"TICKET#{tid}", "sk": "OWNER", "email": email, "ticketId": tid, "created_at": NOW, **extra}


class TestTicketOwnerConnector:
    def test_put_success(self, db):
        tid = f"{NS}_PUT"
        assert db.ticket_owner.put(owner(tid, "x@x.de")).is_ok()
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")

    def test_put_overwrites_existing(self, db):
        tid = f"{NS}_OVR"
        db.ticket_owner.put(owner(tid, "first@x.de"))
        db.ticket_owner.put(owner(tid, "second@x.de"))
        assert db.ticket_owner.get(tid).unwrap()["email"] == "second@x.de"
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")

    def test_get_found(self, db):
        tid = f"{NS}_GET"
        db.ticket_owner.put(owner(tid, "owner@x.de"))
        r = db.ticket_owner.get(tid)
        assert r.is_ok()
        assert r.unwrap()["email"] == "owner@x.de"
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")

    def test_get_not_found_returns_none(self, db):
        assert db.ticket_owner.get("GHOST_TICKET_to001").unwrap() is None

    def test_update_existing(self, db):
        tid = f"{NS}_UPD"
        db.ticket_owner.put(owner(tid, "before@x.de"))
        db.ticket_owner.update(tid, {"email": "after@x.de"})
        assert db.ticket_owner.get(tid).unwrap()["email"] == "after@x.de"
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")

    def test_update_empty_dict_is_noop(self, db):
        tid = f"{NS}_EMP"
        db.ticket_owner.put(owner(tid, "stable@x.de"))
        assert db.ticket_owner.update(tid, {}).is_ok()
        assert db.ticket_owner.get(tid).unwrap()["email"] == "stable@x.de"
        db.ticket_owner._delete(f"TICKET#{tid}", "OWNER")
