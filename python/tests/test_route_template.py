NS = "rt001"
NOW = "2026-01-01T00:00:00Z"
E = f"{NS}@it.de"


def item(tid, **extra):
    return {"pk": f"USER#{E}", "sk": f"TEMPLATE#{tid}",
            "origin_eva": 8000001, "destination_eva": 8000105,
            "label": "Home to Work", "created_at": NOW, **extra}


class TestRouteTemplateConnector:
    def test_put_success(self, db):
        assert db.route_template.put(item("T_RT_PUT")).is_ok()
        db.route_template._delete(f"USER#{E}", "TEMPLATE#T_RT_PUT")

    def test_get_found(self, db):
        db.route_template.put(item("T_RT_GET"))
        assert db.route_template.get(E, "T_RT_GET").unwrap()["label"] == "Home to Work"
        db.route_template._delete(f"USER#{E}", "TEMPLATE#T_RT_GET")

    def test_get_not_found_returns_none(self, db):
        assert db.route_template.get("ghost.rt001@it.de", "T_GHOST").unwrap() is None

    def test_update_existing(self, db):
        db.route_template.put(item("T_RT_UPD"))
        db.route_template.update(E, "T_RT_UPD", {"label": "Updated Label"})
        assert db.route_template.get(E, "T_RT_UPD").unwrap()["label"] == "Updated Label"
        db.route_template._delete(f"USER#{E}", "TEMPLATE#T_RT_UPD")

    def test_update_empty_dict_is_noop(self, db):
        db.route_template.put(item("T_RT_EMP"))
        assert db.route_template.update(E, "T_RT_EMP", {}).is_ok()
        assert db.route_template.get(E, "T_RT_EMP").unwrap()["label"] == "Home to Work"
        db.route_template._delete(f"USER#{E}", "TEMPLATE#T_RT_EMP")

    def test_list_for_user_empty(self, db):
        r = db.route_template.list_for_user("ghost.rt001@it.de")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_list_for_user_single(self, db):
        db.route_template.put(item("T_RT_LFU"))
        r = db.route_template.list_for_user(E)
        assert r.is_ok()
        assert any(i["sk"] == "TEMPLATE#T_RT_LFU" for i in r.unwrap())
        db.route_template._delete(f"USER#{E}", "TEMPLATE#T_RT_LFU")

    def test_list_for_user_multiple(self, db):
        tids = ["T_RT_LFUM_A", "T_RT_LFUM_B", "T_RT_LFUM_C"]
        for tid in tids:
            db.route_template.put(item(tid))
        r = db.route_template.list_for_user(E)
        assert r.is_ok()
        sks = [i["sk"] for i in r.unwrap()]
        for tid in tids:
            assert f"TEMPLATE#{tid}" in sks
        for tid in tids:
            db.route_template._delete(f"USER#{E}", f"TEMPLATE#{tid}")

    def test_list_for_user_only_returns_this_user(self, db):
        other = "other.rt001@it.de"
        db.route_template.put({**item("T_RT_ISO"), "pk": f"USER#{E}"})
        db.route_template.put({**item("T_RT_ISO"), "pk": f"USER#{other}"})
        r = db.route_template.list_for_user(E)
        assert r.is_ok()
        assert all(i["pk"] == f"USER#{E}" for i in r.unwrap())
        db.route_template._delete(f"USER#{E}", "TEMPLATE#T_RT_ISO")
        db.route_template._delete(f"USER#{other}", "TEMPLATE#T_RT_ISO")
