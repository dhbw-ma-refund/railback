NS = "t001"
NOW = "2026-06-01T10:00:00+02:00"


def email(suffix=""):
    return f"{NS}{suffix}@it.de"


def ticket(email, tid, **extra):
    return {
        "pk": f"USER#{email}", "sk": f"TICKET#{tid}",
        "gsi1_pk": f"TRAIN#IC 1#{NOW[:10]}", "gsi1_sk": f"TICKET#{tid}",
        "gsi2_pk": "BARCODE", "gsi2_sk": f"bc_{tid}",
        "ticket_state": "READY",
        "uploaded_at": NOW, "updated_at": NOW,
        **extra,
    }


class TestTicketConnector:
    def test_put_success(self, db):
        e, tid = email("put"), "T_PUT"
        assert db.ticket.put(ticket(e, tid)).is_ok()
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_put_overwrites_existing(self, db):
        e, tid = email("overwrite"), "T_OVR"
        db.ticket.put(ticket(e, tid, ticket_state="VALIDATING"))
        db.ticket.put(ticket(e, tid, ticket_state="READY"))
        assert db.ticket.get(e, tid).unwrap()["ticket_state"] == "READY"
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_get_found(self, db):
        e, tid = email("get"), "T_GET"
        db.ticket.put(ticket(e, tid))
        r = db.ticket.get(e, tid)
        assert r.is_ok()
        assert r.unwrap()["ticket_state"] == "READY"
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_get_not_found_returns_none(self, db):
        assert db.ticket.get("ghost.t001@it.de", "T_GHOST").unwrap() is None

    def test_update_existing(self, db):
        e, tid = email("upd"), "T_UPD"
        db.ticket.put(ticket(e, tid))
        db.ticket.update(e, tid, {"ticket_state": "EMAIL_SENDING"})
        assert db.ticket.get(e, tid).unwrap()["ticket_state"] == "EMAIL_SENDING"
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_update_multiple_fields(self, db):
        e, tid = email("updm"), "T_UPDM"
        db.ticket.put(ticket(e, tid))
        db.ticket.update(e, tid, {"ticket_state": "DONE", "fahrt_zugnummer_plan": "RE 12"})
        i = db.ticket.get(e, tid).unwrap()
        assert i["ticket_state"] == "DONE"
        assert i["fahrt_zugnummer_plan"] == "RE 12"
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_update_empty_dict_is_noop(self, db):
        e, tid = email("emptyupd"), "T_EMP"
        db.ticket.put(ticket(e, tid, ticket_state="READY"))
        assert db.ticket.update(e, tid, {}).is_ok()
        assert db.ticket.get(e, tid).unwrap()["ticket_state"] == "READY"
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_list_for_user_empty(self, db):
        r = db.ticket.list_for_user("ghost.t001.list@it.de")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_list_for_user_returns_only_tickets(self, db):
        e, tid, beleg_id = email("lfu"), "T_LFU", "B_LFU"
        db.ticket.put(ticket(e, tid))
        db.receipt.put({"pk": f"USER#{e}", "sk": f"TICKET#{tid}#BELEG#{beleg_id}", "typ": "TAXI", "uploaded_at": NOW})
        db.mandate.put({"pk": f"USER#{e}", "sk": f"TICKET#{tid}#MANDATE", "mandate_state": "ISSUED", "issued_at": NOW})
        r = db.ticket.list_for_user(e)
        assert r.is_ok()
        sks = [i["sk"] for i in r.unwrap()]
        assert f"TICKET#{tid}" in sks
        assert f"TICKET#{tid}#BELEG#{beleg_id}" not in sks
        assert f"TICKET#{tid}#MANDATE" not in sks
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")
        db.receipt._delete(f"USER#{e}", f"TICKET#{tid}#BELEG#{beleg_id}")
        db.mandate._delete(f"USER#{e}", f"TICKET#{tid}#MANDATE")

    def test_list_for_user_multiple_tickets(self, db):
        e = email("lfumulti")
        tids = [f"T_LFUM{i}" for i in range(4)]
        for tid in tids:
            db.ticket.put(ticket(e, tid))
        r = db.ticket.list_for_user(e)
        assert r.is_ok()
        sks = [i["sk"] for i in r.unwrap()]
        for tid in tids:
            assert f"TICKET#{tid}" in sks
        for tid in tids:
            db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_get_by_train_empty(self, db):
        r = db.ticket.get_by_train("IC 9999", "2099-01-01")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_get_by_train_found(self, db):
        e, tid = email("gbt"), "T_GBT"
        train_nr, date = "IC 777", "2026-09-01"
        i = ticket(e, tid)
        i["gsi1_pk"] = f"TRAIN#{train_nr}#{date}"
        db.ticket.put(i)
        r = db.ticket.get_by_train(train_nr, date)
        assert r.is_ok()
        assert any(i["sk"] == f"TICKET#{tid}" for i in r.unwrap())
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_get_by_train_multiple(self, db):
        e = email("gbtmulti")
        train_nr, date = "IC 888", "2026-09-02"
        tids = [f"T_GBTM{i}" for i in range(3)]
        for tid in tids:
            i = ticket(e, tid)
            i["gsi1_pk"] = f"TRAIN#{train_nr}#{date}"
            db.ticket.put(i)
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
        e, tid, uid = email("bc"), "T_BC", "bc_unique_001"
        i = ticket(e, tid)
        i["gsi2_sk"] = uid
        db.ticket.put(i)
        r = db.ticket.check_barcode_duplicate(uid)
        assert r.is_ok()
        assert r.unwrap() is not None
        assert r.unwrap()["gsi2_sk"] == uid
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_list_email_pending_finds_item(self, db):
        e, tid = email("epend"), "T_EPEND"
        ts = "2026-06-01T08:00:00+02:00"
        i = ticket(e, tid)
        i["gsi_email_pending_pk"] = "EMAIL_PENDING"
        i["gsi_email_pending_sk"] = ts
        i["ticket_state"] = "EMAIL_SENDING"
        db.ticket.put(i)
        r = db.ticket.list_email_pending()
        assert r.is_ok()
        assert any(i["sk"] == f"TICKET#{tid}" for i in r.unwrap())
        db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")

    def test_list_email_pending_ordered_oldest_first(self, db):
        e = email("epord")
        pairs = [
            ("T_EPORD_A", "2026-06-01T06:00:00+02:00"),
            ("T_EPORD_B", "2026-06-01T08:00:00+02:00"),
            ("T_EPORD_C", "2026-06-01T10:00:00+02:00"),
        ]
        for tid, ts in pairs:
            i = ticket(e, tid)
            i["gsi_email_pending_pk"] = "EMAIL_PENDING"
            i["gsi_email_pending_sk"] = ts
            i["ticket_state"] = "EMAIL_SENDING"
            db.ticket.put(i)
        r = db.ticket.list_email_pending()
        assert r.is_ok()
        pending = [i for i in r.unwrap() if i["sk"] in {f"TICKET#{tid}" for tid, _ in pairs}]
        timestamps = [i["gsi_email_pending_sk"] for i in pending]
        assert timestamps == sorted(timestamps)
        for tid, _ in pairs:
            db.ticket._delete(f"USER#{e}", f"TICKET#{tid}")
