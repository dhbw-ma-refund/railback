NOW = "2026-01-01T00:00:00Z"
E = "conn_err@it.de"


class TestConnectionErrors:
    def test_get_returns_err_on_bad_connection(self, bad_db):
        r = bad_db.user.get(E)
        assert r.is_err()

    def test_put_returns_err_on_bad_connection(self, bad_db):
        item = {"pk": f"USER#{E}", "sk": "PROFILE", "name": "X",
                "gsi1_pk": "USER", "gsi1_sk": f"EMAIL#{E}"}
        r = bad_db.user.put(item)
        assert r.is_err()

    def test_update_returns_err_on_bad_connection(self, bad_db):
        r = bad_db.user.update(E, {"name": "Y"})
        assert r.is_err()

    def test_query_returns_err_on_bad_connection(self, bad_db):
        r = bad_db.user.list_all()
        assert r.is_err()

    def test_delete_returns_err_on_bad_connection(self, bad_db):
        r = bad_db.user._delete(f"USER#{E}", "PROFILE")
        assert r.is_err()

    def test_stamp_pain008_built_returns_err_on_bad_connection(self, bad_db):
        r = bad_db.mandate.stamp_pain008_built(E, "T_CE", "B", "s3.xml", "2026-01-01T00:00:00Z")
        assert r.is_err()
