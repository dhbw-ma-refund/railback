NS = "a001"
NOW = "2026-01-01T00:00:00Z"


def item(email, **extra):
    return {
        "pk": f"ADMIN#{email}", "sk": "PROFILE",
        "gsi1_pk": "ADMIN", "gsi1_sk": f"EMAIL#{email}",
        "hashed_password": "x",
        "created_at": NOW,
        **extra,
    }


def email(suffix=""):
    return f"{NS}{suffix}@it.de"


class TestAdminConnector:
    def test_put_success(self, db):
        e = email("put")
        assert db.admin.put(item(e)).is_ok()
        db.admin._delete(f"ADMIN#{e}", "PROFILE")

    def test_put_overwrites_existing(self, db):
        e = email("overwrite")
        db.admin.put(item(e, hashed_password="old"))
        db.admin.put(item(e, hashed_password="new"))
        assert db.admin.get(e).unwrap()["hashed_password"] == "new"
        db.admin._delete(f"ADMIN#{e}", "PROFILE")

    def test_get_found(self, db):
        e = email("get")
        db.admin.put(item(e))
        assert db.admin.get(e).unwrap()["hashed_password"] == "x"
        db.admin._delete(f"ADMIN#{e}", "PROFILE")

    def test_get_not_found_returns_none(self, db):
        assert db.admin.get("ghost.a001@it.de").unwrap() is None

    def test_update_existing(self, db):
        e = email("upd")
        db.admin.put(item(e))
        db.admin.update(e, {"hashed_password": "updated"})
        assert db.admin.get(e).unwrap()["hashed_password"] == "updated"
        db.admin._delete(f"ADMIN#{e}", "PROFILE")

    def test_update_nonexistent_creates_item(self, db):
        e = email("upsert")
        db.admin.update(e, {"hashed_password": "new"})
        assert db.admin.get(e).unwrap() is not None
        db.admin._delete(f"ADMIN#{e}", "PROFILE")

    def test_update_empty_dict_is_noop(self, db):
        e = email("emptyupd")
        db.admin.put(item(e, hashed_password="original"))
        assert db.admin.update(e, {}).is_ok()
        assert db.admin.get(e).unwrap()["hashed_password"] == "original"
        db.admin._delete(f"ADMIN#{e}", "PROFILE")

    def test_list_all_finds_admin(self, db):
        e = email("list")
        db.admin.put(item(e))
        r = db.admin.list_all()
        assert r.is_ok()
        assert f"EMAIL#{e}" in [a["gsi1_sk"] for a in r.unwrap()]
        db.admin._delete(f"ADMIN#{e}", "PROFILE")

    def test_list_all_multiple(self, db):
        emails = [email(f"listm{i}") for i in range(3)]
        for e in emails:
            db.admin.put(item(e))
        r = db.admin.list_all()
        gsi_sks = [a["gsi1_sk"] for a in r.unwrap()]
        for e in emails:
            assert f"EMAIL#{e}" in gsi_sks
        for e in emails:
            db.admin._delete(f"ADMIN#{e}", "PROFILE")
