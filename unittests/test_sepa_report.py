NS = "sr001"
NOW = "2026-01-01T00:00:00Z"


def item(date, rid, **extra):
    return {"pk": f"SEPA#REPORT#{date}", "sk": f"REPORT#{rid}",
            "report_type": "CAMT054", "s3_bucket": "bucket",
            "s3_key": f"sepa/{date}/{rid}.xml", "parsed_at": NOW, **extra}


class TestSepaReportConnector:
    def test_put_success(self, db):
        assert db.sepa_report.put(item("2026-01-01", "SR_PUT")).is_ok()
        db.sepa_report._delete("SEPA#REPORT#2026-01-01", "REPORT#SR_PUT")

    def test_get_found(self, db):
        db.sepa_report.put(item("2026-01-02", "SR_GET"))
        assert db.sepa_report.get("2026-01-02", "SR_GET").unwrap()["report_type"] == "CAMT054"
        db.sepa_report._delete("SEPA#REPORT#2026-01-02", "REPORT#SR_GET")

    def test_get_not_found_returns_none(self, db):
        assert db.sepa_report.get("2099-01-01", "SR_GHOST").unwrap() is None

    def test_update_existing(self, db):
        db.sepa_report.put(item("2026-01-03", "SR_UPD"))
        db.sepa_report.update("2026-01-03", "SR_UPD", {"report_type": "PAIN002"})
        assert db.sepa_report.get("2026-01-03", "SR_UPD").unwrap()["report_type"] == "PAIN002"
        db.sepa_report._delete("SEPA#REPORT#2026-01-03", "REPORT#SR_UPD")

    def test_update_empty_dict_is_noop(self, db):
        db.sepa_report.put(item("2026-01-05", "SR_EMP"))
        assert db.sepa_report.update("2026-01-05", "SR_EMP", {}).is_ok()
        assert db.sepa_report.get("2026-01-05", "SR_EMP").unwrap()["report_type"] == "CAMT054"
        db.sepa_report._delete("SEPA#REPORT#2026-01-05", "REPORT#SR_EMP")

    def test_list_by_date_empty(self, db):
        r = db.sepa_report.list_by_date("2099-12-31")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_list_by_date_single(self, db):
        db.sepa_report.put(item("2026-02-01", "SR_LBD"))
        r = db.sepa_report.list_by_date("2026-02-01")
        assert r.is_ok()
        assert len(r.unwrap()) == 1
        db.sepa_report._delete("SEPA#REPORT#2026-02-01", "REPORT#SR_LBD")

    def test_list_by_date_multiple(self, db):
        rids = ["SR_LBDM_A", "SR_LBDM_B", "SR_LBDM_C"]
        for rid in rids:
            db.sepa_report.put(item("2026-02-02", rid))
        r = db.sepa_report.list_by_date("2026-02-02")
        assert r.is_ok()
        assert len(r.unwrap()) == 3
        for rid in rids:
            db.sepa_report._delete("SEPA#REPORT#2026-02-02", f"REPORT#{rid}")

    def test_list_by_date_only_returns_that_date(self, db):
        for d in ["2026-02-03", "2026-02-04"]:
            db.sepa_report.put(item(d, "SR_ISO"))
        r = db.sepa_report.list_by_date("2026-02-03")
        assert r.is_ok()
        assert all(i["pk"] == "SEPA#REPORT#2026-02-03" for i in r.unwrap())
        for d in ["2026-02-03", "2026-02-04"]:
            db.sepa_report._delete(f"SEPA#REPORT#{d}", "REPORT#SR_ISO")
