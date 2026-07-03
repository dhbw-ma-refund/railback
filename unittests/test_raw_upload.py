NS = "ru001"
NOW = "2026-01-01T00:00:00Z"
E = f"{NS}@it.de"


def item(tid, **extra):
    return {"pk": f"USER#{E}", "sk": f"RAW#{tid}", "filename": "ticket.pdf",
            "s3_bucket": "bucket", "s3_key": f"raw/{tid}.pdf", "uploaded_at": NOW, **extra}


class TestRawUploadConnector:
    def test_put_success(self, db):
        assert db.raw_upload.put(item("RAW_PUT")).is_ok()
        db.raw_upload._delete(f"USER#{E}", "RAW#RAW_PUT")

    def test_put_overwrites_existing(self, db):
        db.raw_upload.put(item("RAW_OVR", filename="old.pdf"))
        db.raw_upload.put(item("RAW_OVR", filename="new.pdf"))
        assert db.raw_upload.get(E, "RAW_OVR").unwrap()["filename"] == "new.pdf"
        db.raw_upload._delete(f"USER#{E}", "RAW#RAW_OVR")

    def test_get_found(self, db):
        db.raw_upload.put(item("RAW_GET"))
        assert db.raw_upload.get(E, "RAW_GET").unwrap()["filename"] == "ticket.pdf"
        db.raw_upload._delete(f"USER#{E}", "RAW#RAW_GET")

    def test_get_not_found_returns_none(self, db):
        assert db.raw_upload.get("ghost.ru001@it.de", "GHOST").unwrap() is None

    def test_update_existing(self, db):
        db.raw_upload.put(item("RAW_UPD"))
        db.raw_upload.update(E, "RAW_UPD", {"filename": "updated.pdf"})
        assert db.raw_upload.get(E, "RAW_UPD").unwrap()["filename"] == "updated.pdf"
        db.raw_upload._delete(f"USER#{E}", "RAW#RAW_UPD")

    def test_update_empty_dict_is_noop(self, db):
        db.raw_upload.put(item("RAW_EMP", filename="stable.pdf"))
        assert db.raw_upload.update(E, "RAW_EMP", {}).is_ok()
        assert db.raw_upload.get(E, "RAW_EMP").unwrap()["filename"] == "stable.pdf"
        db.raw_upload._delete(f"USER#{E}", "RAW#RAW_EMP")
