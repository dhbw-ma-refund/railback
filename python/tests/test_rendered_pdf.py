NS = "rp001"
NOW = "2026-01-01T00:00:00Z"
E = f"{NS}@it.de"


def item(tid, **extra):
    return {"pk": f"USER#{E}", "sk": f"RENDERED#{tid}",
            "s3_bucket": "bucket", "s3_key": f"rendered/{tid}.pdf", "rendered_at": NOW, **extra}


class TestRenderedPdfConnector:
    def test_put_success(self, db):
        assert db.rendered_pdf.put(item("RPD_PUT")).is_ok()
        db.rendered_pdf._delete(f"USER#{E}", "RENDERED#RPD_PUT")

    def test_put_overwrites_existing(self, db):
        db.rendered_pdf.put(item("RPD_OVR", size_bytes=100))
        db.rendered_pdf.put(item("RPD_OVR", size_bytes=200))
        assert db.rendered_pdf.get(E, "RPD_OVR").unwrap()["size_bytes"] == 200
        db.rendered_pdf._delete(f"USER#{E}", "RENDERED#RPD_OVR")

    def test_get_found(self, db):
        db.rendered_pdf.put(item("RPD_GET"))
        assert db.rendered_pdf.get(E, "RPD_GET").unwrap()["s3_key"] == "rendered/RPD_GET.pdf"
        db.rendered_pdf._delete(f"USER#{E}", "RENDERED#RPD_GET")

    def test_get_not_found_returns_none(self, db):
        assert db.rendered_pdf.get("ghost.rp001@it.de", "GHOST").unwrap() is None

    def test_update_existing(self, db):
        db.rendered_pdf.put(item("RPD_UPD"))
        db.rendered_pdf.update(E, "RPD_UPD", {"size_bytes": 99999})
        assert db.rendered_pdf.get(E, "RPD_UPD").unwrap()["size_bytes"] == 99999
        db.rendered_pdf._delete(f"USER#{E}", "RENDERED#RPD_UPD")

    def test_update_empty_dict_is_noop(self, db):
        db.rendered_pdf.put(item("RPD_EMP", size_bytes=42))
        assert db.rendered_pdf.update(E, "RPD_EMP", {}).is_ok()
        assert db.rendered_pdf.get(E, "RPD_EMP").unwrap()["size_bytes"] == 42
        db.rendered_pdf._delete(f"USER#{E}", "RENDERED#RPD_EMP")
