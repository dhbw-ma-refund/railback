NOW = "2026-01-01T00:00:00Z"


def user_item(email):
    return {"pk": f"USER#{email}", "sk": "PROFILE",
            "name": "Test User", "gsi1_pk": "USER", "gsi1_sk": f"EMAIL#{email}"}


def ticket_item(email, tid, **extra):
    return {"pk": f"USER#{email}", "sk": f"TICKET#{tid}",
            "train_nr": "ICE1", "travel_date": "2026-01-01",
            "gsi1_pk": "TRAIN#ICE1#2026-01-01", "gsi1_sk": f"EMAIL#{email}",
            **extra}


def owner_item(tid, email):
    return {"pk": f"TICKET#{tid}", "sk": "OWNER", "email": email}


def beleg_item(email, tid, bid):
    return {"pk": f"USER#{email}", "sk": f"TICKET#{tid}#BELEG#{bid}",
            "filename": "r.pdf", "typ": "TAXI",
            "s3_bucket": "bucket", "s3_key": f"b/{bid}.pdf", "uploaded_at": NOW}


def mandate_item(email, tid):
    return {"pk": f"USER#{email}", "sk": f"TICKET#{tid}#MANDATE",
            "mandate_id": f"MID_{tid}", "mandate_state": "ISSUED",
            "fee_amount": "5.00", "issued_at": NOW}


def raw_item(email, tid):
    return {"pk": f"USER#{email}", "sk": f"RAW#{tid}",
            "filename": "t.pdf", "s3_bucket": "bucket",
            "s3_key": f"raw/{tid}.pdf", "uploaded_at": NOW}


def rendered_item(email, tid):
    return {"pk": f"USER#{email}", "sk": f"RENDERED#{tid}",
            "s3_bucket": "bucket", "s3_key": f"rendered/{tid}.pdf", "rendered_at": NOW}


NS_D = "del001"
E_D = f"{NS_D}@it.de"


class TestSimpleDeletes:
    def test_delete_admin(self, db):
        email = f"adm.{NS_D}@it.de"
        db.admin.put({"pk": f"ADMIN#{email}", "sk": "PROFILE", "name": "A",
                      "gsi1_pk": "ADMIN", "gsi1_sk": f"EMAIL#{email}"})
        assert db.delete_admin(email).is_ok()
        assert db.admin.get(email).unwrap() is None

    def test_delete_ticket_owner(self, db):
        tid = f"DEL_TO_{NS_D}"
        db.ticket_owner.put(owner_item(tid, E_D))
        assert db.delete_ticket_owner(tid).is_ok()
        assert db.ticket_owner.get(tid).unwrap() is None

    def test_delete_raw_upload(self, db):
        tid = f"DEL_RAW_{NS_D}"
        db.raw_upload.put(raw_item(E_D, tid))
        assert db.delete_raw_upload(E_D, tid).is_ok()
        assert db.raw_upload.get(E_D, tid).unwrap() is None

    def test_delete_rendered_pdf(self, db):
        tid = f"DEL_RPD_{NS_D}"
        db.rendered_pdf.put(rendered_item(E_D, tid))
        assert db.delete_rendered_pdf(E_D, tid).is_ok()
        assert db.rendered_pdf.get(E_D, tid).unwrap() is None

    def test_delete_receipt(self, db):
        tid, bid = f"DEL_REC_T_{NS_D}", f"DEL_REC_B_{NS_D}"
        db.receipt.put(beleg_item(E_D, tid, bid))
        assert db.delete_receipt(E_D, tid, bid).is_ok()
        assert db.receipt.get(E_D, tid, bid).unwrap() is None

    def test_delete_mandate(self, db):
        tid = f"DEL_MAN_{NS_D}"
        db.mandate.put(mandate_item(E_D, tid))
        assert db.delete_mandate(E_D, tid).is_ok()
        assert db.mandate.get(E_D, tid).unwrap() is None

    def test_delete_sepa_report(self, db):
        db.sepa_report.put({"pk": "SEPA#REPORT#2026-06-01", "sk": f"REPORT#DEL_{NS_D}",
                            "report_type": "CAMT054", "s3_bucket": "b",
                            "s3_key": "x.xml", "parsed_at": NOW})
        assert db.delete_sepa_report("2026-06-01", f"DEL_{NS_D}").is_ok()
        assert db.sepa_report.get("2026-06-01", f"DEL_{NS_D}").unwrap() is None

    def test_delete_train_delay(self, db):
        db.train_delay.put({"pk": "TRAIN#ICE9#2026-06-01", "sk": f"SEG#DEL_{NS_D}",
                            "origin_eva": 1, "destination_eva": 2,
                            "departure_time": "10:00", "arrival_time": "11:00",
                            "delay_minutes": 0, "recorded_at": NOW})
        assert db.delete_train_delay("ICE9", "2026-06-01", f"DEL_{NS_D}").is_ok()
        assert db.train_delay.get("ICE9", "2026-06-01", f"DEL_{NS_D}").unwrap() is None

    def test_delete_route_template(self, db):
        db.route_template.put({"pk": f"USER#{E_D}", "sk": f"TEMPLATE#DEL_{NS_D}",
                               "origin_eva": 1, "destination_eva": 2,
                               "label": "X", "created_at": NOW})
        assert db.delete_route_template(E_D, f"DEL_{NS_D}").is_ok()
        assert db.route_template.get(E_D, f"DEL_{NS_D}").unwrap() is None


NS_DT = "delt001"
E_DT = f"{NS_DT}@it.de"


class TestDeleteTicket:
    def test_removes_ticket_owner_and_children(self, db):
        tid = f"T_DT_{NS_DT}"
        bid = f"B_DT_{NS_DT}"
        db.ticket.put(ticket_item(E_DT, tid))
        db.ticket_owner.put(owner_item(tid, E_DT))
        db.receipt.put(beleg_item(E_DT, tid, bid))
        db.mandate.put(mandate_item(E_DT, tid))
        db.raw_upload.put(raw_item(E_DT, tid))
        db.rendered_pdf.put(rendered_item(E_DT, tid))

        assert db.delete_ticket(E_DT, tid).is_ok()

        assert db.ticket.get(E_DT, tid).unwrap() is None
        assert db.ticket_owner.get(tid).unwrap() is None
        assert db.receipt.get(E_DT, tid, bid).unwrap() is None
        assert db.mandate.get(E_DT, tid).unwrap() is None
        assert db.raw_upload.get(E_DT, tid).unwrap() is None
        assert db.rendered_pdf.get(E_DT, tid).unwrap() is None

    def test_idempotent_on_already_deleted(self, db):
        tid = f"T_DT_IDEM_{NS_DT}"
        assert db.delete_ticket(E_DT, tid).is_ok()


NS_DU = "delu001"
E_DU = f"{NS_DU}@it.de"


class TestDeleteUser:
    def test_removes_profile_and_all_tickets(self, db):
        tid_a = f"T_DU_A_{NS_DU}"
        tid_b = f"T_DU_B_{NS_DU}"
        db.user.put(user_item(E_DU))
        db.ticket.put(ticket_item(E_DU, tid_a))
        db.ticket_owner.put(owner_item(tid_a, E_DU))
        db.ticket.put(ticket_item(E_DU, tid_b))
        db.ticket_owner.put(owner_item(tid_b, E_DU))

        assert db.delete_user(E_DU).is_ok()

        assert db.user.get(E_DU).unwrap() is None
        assert db.ticket.get(E_DU, tid_a).unwrap() is None
        assert db.ticket_owner.get(tid_a).unwrap() is None
        assert db.ticket.get(E_DU, tid_b).unwrap() is None
        assert db.ticket_owner.get(tid_b).unwrap() is None

    def test_idempotent_on_already_deleted(self, db):
        assert db.delete_user(f"ghost.{NS_DU}@it.de").is_ok()
