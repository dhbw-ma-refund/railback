NS = "wt001"
DATE = "2026-05-01"
NOW = f"{DATE}T09:00:00Z"

ALICE = f"alice.{NS}@it.de"
BOB = f"bob.{NS}@it.de"
ADMIN_A = f"adm_a.{NS}@it.de"
ADMIN_B = f"adm_b.{NS}@it.de"

TRAIN_1 = f"ICE_WT1_{NS}"
TRAIN_2 = f"ICE_WT2_{NS}"
STATION_A = 7000001  # departure station for both trains (to test range filter)
STATION_B = 7000002

T_A1 = f"T_A1_{NS}"   # alice, train 1
T_A2 = f"T_A2_{NS}"   # alice, train 1
T_B1 = f"T_B1_{NS}"   # bob, train 2

B_A1_1 = f"B_A11_{NS}"
B_A1_2 = f"B_A12_{NS}"
B_A2_1 = f"B_A21_{NS}"
B_B1_1 = f"B_B11_{NS}"

BC_A1 = f"bc_a1_{NS}"
BC_A2 = f"bc_a2_{NS}"
BC_B1 = f"bc_b1_{NS}"

SEG_1A = f"S1A_{NS}"   # train 1, departs STATION_A at 08:00
SEG_1B = f"S1B_{NS}"   # train 1, departs STATION_B at 09:10
SEG_2A = f"S2A_{NS}"   # train 2, departs STATION_A at 11:00 (out of range)

TMPL_A1 = f"TM_A1_{NS}"
TMPL_A2 = f"TM_A2_{NS}"
TMPL_B1 = f"TM_B1_{NS}"

SEPA_DATE = "2026-05-01"
SEPA_R1 = f"SR1_{NS}"
SEPA_R2 = f"SR2_{NS}"


class TestFullWalkthrough:
    def test_complete_scenario(self, db):
        # ---- seed: users and admins ----
        db.user.put({"pk": f"USER#{ALICE}", "sk": "PROFILE", "name": "Alice",
                     "gsi1_pk": "USER", "gsi1_sk": f"EMAIL#{ALICE}"})
        db.user.put({"pk": f"USER#{BOB}", "sk": "PROFILE", "name": "Bob",
                     "gsi1_pk": "USER", "gsi1_sk": f"EMAIL#{BOB}"})
        db.admin.put({"pk": f"ADMIN#{ADMIN_A}", "sk": "PROFILE", "name": "Admin A",
                      "gsi1_pk": "ADMIN", "gsi1_sk": f"EMAIL#{ADMIN_A}"})
        db.admin.put({"pk": f"ADMIN#{ADMIN_B}", "sk": "PROFILE", "name": "Admin B",
                      "gsi1_pk": "ADMIN", "gsi1_sk": f"EMAIL#{ADMIN_B}"})

        # ---- seed: tickets ----
        def mk_ticket(email, tid, train_nr, barcode):
            return {"pk": f"USER#{email}", "sk": f"TICKET#{tid}",
                    "gsi1_pk": f"TRAIN#{train_nr}#{DATE}", "gsi1_sk": f"TICKET#{tid}",
                    "gsi2_pk": "BARCODE", "gsi2_sk": barcode,
                    "ticket_state": "READY", "uploaded_at": NOW, "updated_at": NOW}

        db.ticket.put(mk_ticket(ALICE, T_A1, TRAIN_1, BC_A1))
        db.ticket.put(mk_ticket(ALICE, T_A2, TRAIN_1, BC_A2))
        db.ticket.put(mk_ticket(BOB, T_B1, TRAIN_2, BC_B1))

        # ---- seed: ticket owners ----
        db.ticket_owner.put({"pk": f"TICKET#{T_A1}", "sk": "OWNER", "email": ALICE})
        db.ticket_owner.put({"pk": f"TICKET#{T_A2}", "sk": "OWNER", "email": ALICE})
        db.ticket_owner.put({"pk": f"TICKET#{T_B1}", "sk": "OWNER", "email": BOB})

        # ---- seed: receipts (T_A1 has 2, T_A2 has 1, T_B1 has 1) ----
        def mk_receipt(email, tid, bid):
            return {"pk": f"USER#{email}", "sk": f"TICKET#{tid}#BELEG#{bid}",
                    "filename": f"{bid}.pdf", "typ": "TAXI",
                    "s3_bucket": "bucket", "s3_key": f"{bid}.pdf", "uploaded_at": NOW}

        db.receipt.put(mk_receipt(ALICE, T_A1, B_A1_1))
        db.receipt.put(mk_receipt(ALICE, T_A1, B_A1_2))
        db.receipt.put(mk_receipt(ALICE, T_A2, B_A2_1))
        db.receipt.put(mk_receipt(BOB, T_B1, B_B1_1))

        # ---- seed: mandates (T_A1 and T_B1 only, T_A2 has none) ----
        def mk_mandate(email, tid):
            return {"pk": f"USER#{email}", "sk": f"TICKET#{tid}#MANDATE",
                    "mandate_id": f"MID_{tid}", "mandate_state": "ISSUED",
                    "fee_amount": "5.00", "issued_at": NOW}

        db.mandate.put(mk_mandate(ALICE, T_A1))
        db.mandate.put(mk_mandate(BOB, T_B1))

        # ---- seed: raw uploads and rendered pdfs ----
        def mk_raw(email, tid):
            return {"pk": f"USER#{email}", "sk": f"RAW#{tid}",
                    "filename": f"{tid}.pdf", "s3_bucket": "bucket",
                    "s3_key": f"raw/{tid}.pdf", "uploaded_at": NOW}

        def mk_rendered(email, tid):
            return {"pk": f"USER#{email}", "sk": f"RENDERED#{tid}",
                    "s3_bucket": "bucket", "s3_key": f"rendered/{tid}.pdf", "rendered_at": NOW}

        for email, tid in [(ALICE, T_A1), (ALICE, T_A2), (BOB, T_B1)]:
            db.raw_upload.put(mk_raw(email, tid))
            db.rendered_pdf.put(mk_rendered(email, tid))

        # ---- seed: train delay segments ----
        def mk_seg(train_nr, seg_id, station_eva, dep_time, arr_time):
            return {"pk": f"TRAIN#{train_nr}#{DATE}", "sk": f"SEG#{seg_id}",
                    "origin_eva": station_eva, "destination_eva": station_eva + 1,
                    "departure_time": dep_time, "arrival_time": arr_time,
                    "delay_minutes": 0, "recorded_at": NOW,
                    "gsi1_pk": f"STATION#{station_eva}#{DATE}", "gsi1_sk": dep_time}

        db.train_delay.put(mk_seg(TRAIN_1, SEG_1A, STATION_A, "08:00", "08:55"))
        db.train_delay.put(mk_seg(TRAIN_1, SEG_1B, STATION_B, "09:10", "10:00"))
        db.train_delay.put(mk_seg(TRAIN_2, SEG_2A, STATION_A, "11:00", "12:00"))

        # ---- seed: route templates ----
        def mk_tmpl(email, tid):
            return {"pk": f"USER#{email}", "sk": f"TEMPLATE#{tid}",
                    "origin_eva": STATION_A, "destination_eva": STATION_B,
                    "label": f"Route {tid}", "created_at": NOW}

        db.route_template.put(mk_tmpl(ALICE, TMPL_A1))
        db.route_template.put(mk_tmpl(ALICE, TMPL_A2))
        db.route_template.put(mk_tmpl(BOB, TMPL_B1))

        # ---- seed: sepa reports ----
        db.sepa_report.put({"pk": f"SEPA#REPORT#{SEPA_DATE}", "sk": f"REPORT#{SEPA_R1}",
                            "report_type": "CAMT054", "s3_bucket": "b",
                            "s3_key": f"{SEPA_R1}.xml", "parsed_at": NOW})
        db.sepa_report.put({"pk": f"SEPA#REPORT#{SEPA_DATE}", "sk": f"REPORT#{SEPA_R2}",
                            "report_type": "CAMT054", "s3_bucket": "b",
                            "s3_key": f"{SEPA_R2}.xml", "parsed_at": NOW})

        # ================================================================
        # individual gets
        # ================================================================
        assert db.user.get(ALICE).unwrap()["name"] == "Alice"
        assert db.user.get(BOB).unwrap()["name"] == "Bob"
        assert db.admin.get(ADMIN_A).unwrap() is not None
        assert db.admin.get(ADMIN_B).unwrap() is not None

        assert db.ticket.get(ALICE, T_A1).unwrap()["ticket_state"] == "READY"
        assert db.ticket.get(ALICE, T_A2).unwrap()["ticket_state"] == "READY"
        assert db.ticket.get(BOB, T_B1).unwrap()["ticket_state"] == "READY"

        assert db.ticket_owner.get(T_A1).unwrap()["email"] == ALICE
        assert db.ticket_owner.get(T_A2).unwrap()["email"] == ALICE
        assert db.ticket_owner.get(T_B1).unwrap()["email"] == BOB

        assert db.mandate.get(ALICE, T_A1).unwrap() is not None
        assert db.mandate.get(ALICE, T_A2).unwrap() is None  # T_A2 has no mandate
        assert db.mandate.get(BOB, T_B1).unwrap() is not None

        assert db.raw_upload.get(ALICE, T_A1).unwrap() is not None
        assert db.rendered_pdf.get(ALICE, T_A1).unwrap() is not None
        assert db.receipt.get(ALICE, T_A1, B_A1_1).unwrap() is not None
        assert db.receipt.get(ALICE, T_A1, B_A1_2).unwrap() is not None

        assert db.sepa_report.get(SEPA_DATE, SEPA_R1).unwrap() is not None
        assert db.train_delay.get(TRAIN_1, DATE, SEG_1A).unwrap()["origin_eva"] == STATION_A

        # ================================================================
        # ticket list isolation: users don't see each other's tickets
        # ================================================================
        alice_tickets = db.ticket.list_for_user(ALICE).unwrap()
        bob_tickets = db.ticket.list_for_user(BOB).unwrap()
        alice_sks = {i["sk"] for i in alice_tickets}
        bob_sks = {i["sk"] for i in bob_tickets}

        assert {f"TICKET#{T_A1}", f"TICKET#{T_A2}"} == alice_sks & {f"TICKET#{T_A1}", f"TICKET#{T_A2}"}
        assert f"TICKET#{T_B1}" not in alice_sks
        assert f"TICKET#{T_B1}" in bob_sks
        assert f"TICKET#{T_A1}" not in bob_sks
        assert f"TICKET#{T_A2}" not in bob_sks

        # list_for_user must never include receipt or mandate rows
        for sk in alice_sks | bob_sks:
            assert "#BELEG#" not in sk
            assert not sk.endswith("#MANDATE")

        # ================================================================
        # receipt list isolation: tickets don't see each other's receipts
        # ================================================================
        recs_a1 = db.receipt.list_for_ticket(ALICE, T_A1).unwrap()
        recs_a2 = db.receipt.list_for_ticket(ALICE, T_A2).unwrap()
        recs_b1 = db.receipt.list_for_ticket(BOB, T_B1).unwrap()

        assert len(recs_a1) == 2
        assert len(recs_a2) == 1
        assert len(recs_b1) == 1

        assert all(f"TICKET#{T_A1}#BELEG#" in i["sk"] for i in recs_a1)
        assert all(f"TICKET#{T_A2}#BELEG#" in i["sk"] for i in recs_a2)
        assert all(f"TICKET#{T_B1}#BELEG#" in i["sk"] for i in recs_b1)

        # no cross-contamination
        a1_sks = {i["sk"] for i in recs_a1}
        assert f"TICKET#{T_A2}#BELEG#{B_A2_1}" not in a1_sks
        assert f"TICKET#{T_B1}#BELEG#{B_B1_1}" not in a1_sks

        # ================================================================
        # GSI1 train query isolation: trains don't see each other's tickets
        # ================================================================
        train1_tickets = db.ticket.get_by_train(TRAIN_1, DATE).unwrap()
        train2_tickets = db.ticket.get_by_train(TRAIN_2, DATE).unwrap()
        train1_sks = {i["sk"] for i in train1_tickets}
        train2_sks = {i["sk"] for i in train2_tickets}

        assert f"TICKET#{T_A1}" in train1_sks
        assert f"TICKET#{T_A2}" in train1_sks
        assert f"TICKET#{T_B1}" not in train1_sks
        assert f"TICKET#{T_B1}" in train2_sks
        assert f"TICKET#{T_A1}" not in train2_sks
        assert f"TICKET#{T_A2}" not in train2_sks

        # ================================================================
        # train delay segment isolation
        # ================================================================
        segs_t1 = db.train_delay.list_for_train(TRAIN_1, DATE).unwrap()
        segs_t2 = db.train_delay.list_for_train(TRAIN_2, DATE).unwrap()
        seg_t1_sks = {i["sk"] for i in segs_t1}
        seg_t2_sks = {i["sk"] for i in segs_t2}

        assert len(segs_t1) == 2
        assert len(segs_t2) == 1
        assert f"SEG#{SEG_1A}" in seg_t1_sks
        assert f"SEG#{SEG_1B}" in seg_t1_sks
        assert f"SEG#{SEG_2A}" not in seg_t1_sks
        assert f"SEG#{SEG_2A}" in seg_t2_sks
        assert f"SEG#{SEG_1A}" not in seg_t2_sks

        # route_lookup: time range filter works, STATION_A only sees its own trains
        # SEG_1A departs 08:00, SEG_2A departs 11:00 — both from STATION_A
        in_range = db.train_delay.route_lookup(STATION_A, DATE, "07:00", "10:00").unwrap()
        in_sks = {i["sk"] for i in in_range}
        assert f"SEG#{SEG_1A}" in in_sks      # 08:00 — inside range
        assert f"SEG#{SEG_2A}" not in in_sks  # 11:00 — outside range

        out_range = db.train_delay.route_lookup(STATION_A, DATE, "12:00", "15:00").unwrap()
        assert not any(i["sk"] in {f"SEG#{SEG_1A}", f"SEG#{SEG_2A}"} for i in out_range)

        # STATION_B only sees SEG_1B
        station_b_segs = db.train_delay.route_lookup(STATION_B, DATE, "07:00", "15:00").unwrap()
        station_b_sks = {i["sk"] for i in station_b_segs}
        assert f"SEG#{SEG_1B}" in station_b_sks
        assert f"SEG#{SEG_1A}" not in station_b_sks
        assert f"SEG#{SEG_2A}" not in station_b_sks

        # ================================================================
        # route template isolation
        # ================================================================
        tmpl_alice = db.route_template.list_for_user(ALICE).unwrap()
        tmpl_bob = db.route_template.list_for_user(BOB).unwrap()
        tmpl_alice_sks = {i["sk"] for i in tmpl_alice}
        tmpl_bob_sks = {i["sk"] for i in tmpl_bob}

        assert f"TEMPLATE#{TMPL_A1}" in tmpl_alice_sks
        assert f"TEMPLATE#{TMPL_A2}" in tmpl_alice_sks
        assert f"TEMPLATE#{TMPL_B1}" not in tmpl_alice_sks
        assert f"TEMPLATE#{TMPL_B1}" in tmpl_bob_sks
        assert f"TEMPLATE#{TMPL_A1}" not in tmpl_bob_sks
        assert f"TEMPLATE#{TMPL_A2}" not in tmpl_bob_sks

        # ================================================================
        # GSI1 list_all: users and admins are strictly separate
        # ================================================================
        all_users = db.user.list_all().unwrap()
        all_admins = db.admin.list_all().unwrap()
        user_pks = {i["pk"] for i in all_users}
        admin_pks = {i["pk"] for i in all_admins}

        assert f"USER#{ALICE}" in user_pks
        assert f"USER#{BOB}" in user_pks
        assert f"ADMIN#{ADMIN_A}" not in user_pks
        assert f"ADMIN#{ADMIN_B}" not in user_pks
        assert f"ADMIN#{ADMIN_A}" in admin_pks
        assert f"ADMIN#{ADMIN_B}" in admin_pks
        assert f"USER#{ALICE}" not in admin_pks
        assert f"USER#{BOB}" not in admin_pks

        # ================================================================
        # SEPA report date isolation
        # ================================================================
        reports = db.sepa_report.list_by_date(SEPA_DATE).unwrap()
        report_sks = {i["sk"] for i in reports}
        assert f"REPORT#{SEPA_R1}" in report_sks
        assert f"REPORT#{SEPA_R2}" in report_sks

        no_reports = db.sepa_report.list_by_date("2099-12-31").unwrap()
        assert not any(i["sk"] in {f"REPORT#{SEPA_R1}", f"REPORT#{SEPA_R2}"} for i in no_reports)

        # ================================================================
        # GSI2 barcode dedup: each barcode resolves to its own ticket
        # ================================================================
        found_a1 = db.ticket.check_barcode_duplicate(BC_A1).unwrap()
        found_b1 = db.ticket.check_barcode_duplicate(BC_B1).unwrap()
        assert found_a1 is not None
        assert found_a1["gsi2_sk"] == BC_A1
        assert found_a1["sk"] == f"TICKET#{T_A1}"
        assert found_b1 is not None
        assert found_b1["gsi2_sk"] == BC_B1
        assert found_b1["sk"] == f"TICKET#{T_B1}"
        assert db.ticket.check_barcode_duplicate(f"ghost_bc_{NS}").unwrap() is None

        # ================================================================
        # cleanup
        # ================================================================
        # delete_user cascades: profile, all TICKET# rows, receipts, mandates,
        # raw, rendered, templates under USER#{email}, plus TicketOwner records
        db.delete_user(ALICE)
        db.delete_user(BOB)
        db.delete_admin(ADMIN_A)
        db.delete_admin(ADMIN_B)

        assert db.user.get(ALICE).unwrap() is None
        assert db.user.get(BOB).unwrap() is None
        assert db.ticket.get(ALICE, T_A1).unwrap() is None
        assert db.ticket.get(BOB, T_B1).unwrap() is None
        assert db.ticket_owner.get(T_A1).unwrap() is None
        assert db.ticket_owner.get(T_B1).unwrap() is None
        assert db.receipt.get(ALICE, T_A1, B_A1_1).unwrap() is None
        assert db.mandate.get(ALICE, T_A1).unwrap() is None
        assert db.raw_upload.get(ALICE, T_A1).unwrap() is None
        assert db.rendered_pdf.get(ALICE, T_A1).unwrap() is None
        assert db.route_template.get(ALICE, TMPL_A1).unwrap() is None

        db.delete_sepa_report(SEPA_DATE, SEPA_R1)
        db.delete_sepa_report(SEPA_DATE, SEPA_R2)
        db.delete_train_delay(TRAIN_1, DATE, SEG_1A)
        db.delete_train_delay(TRAIN_1, DATE, SEG_1B)
        db.delete_train_delay(TRAIN_2, DATE, SEG_2A)

        assert db.sepa_report.get(SEPA_DATE, SEPA_R1).unwrap() is None
        assert db.train_delay.get(TRAIN_1, DATE, SEG_1A).unwrap() is None
        assert db.train_delay.get(TRAIN_2, DATE, SEG_2A).unwrap() is None
