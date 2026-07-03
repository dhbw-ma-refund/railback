NS = "td001"
NOW = "2026-01-01T00:00:00Z"


def item(train_nr, date, seg_id, **extra):
    return {"pk": f"TRAIN#{train_nr}#{date}", "sk": f"SEG#{seg_id}",
            "origin_eva": 8000001, "destination_eva": 8000002,
            "departure_time": "08:00", "arrival_time": "09:00",
            "delay_minutes": 0, "recorded_at": NOW,
            "gsi1_pk": f"STATION#8000001#{date}", "gsi1_sk": "08:00",
            **extra}


class TestTrainSegmentDelayConnector:
    def test_put_success(self, db):
        assert db.train_delay.put(item("ICE1", "2026-01-01", f"{NS}_PUT")).is_ok()
        db.train_delay._delete(f"TRAIN#ICE1#2026-01-01", f"SEG#{NS}_PUT")

    def test_get_found(self, db):
        db.train_delay.put(item("ICE2", "2026-01-02", f"{NS}_GET"))
        assert db.train_delay.get("ICE2", "2026-01-02", f"{NS}_GET").unwrap()["origin_eva"] == 8000001
        db.train_delay._delete("TRAIN#ICE2#2026-01-02", f"SEG#{NS}_GET")

    def test_get_not_found_returns_none(self, db):
        assert db.train_delay.get("GHOST", "2099-01-01", "GHOST_SEG").unwrap() is None

    def test_update_existing(self, db):
        db.train_delay.put(item("ICE3", "2026-01-03", f"{NS}_UPD"))
        db.train_delay.update("ICE3", "2026-01-03", f"{NS}_UPD", {"delay_minutes": 15})
        assert db.train_delay.get("ICE3", "2026-01-03", f"{NS}_UPD").unwrap()["delay_minutes"] == 15
        db.train_delay._delete("TRAIN#ICE3#2026-01-03", f"SEG#{NS}_UPD")

    def test_update_empty_dict_is_noop(self, db):
        db.train_delay.put(item("ICE4", "2026-01-04", f"{NS}_EMP"))
        assert db.train_delay.update("ICE4", "2026-01-04", f"{NS}_EMP", {}).is_ok()
        assert db.train_delay.get("ICE4", "2026-01-04", f"{NS}_EMP").unwrap()["delay_minutes"] == 0
        db.train_delay._delete("TRAIN#ICE4#2026-01-04", f"SEG#{NS}_EMP")

    def test_list_for_train_empty(self, db):
        r = db.train_delay.list_for_train("GHOST", "2099-01-01")
        assert r.is_ok()
        assert r.unwrap() == []

    def test_list_for_train_single(self, db):
        db.train_delay.put(item("ICE5", "2026-02-01", f"{NS}_LFT"))
        r = db.train_delay.list_for_train("ICE5", "2026-02-01")
        assert r.is_ok()
        assert len(r.unwrap()) == 1
        db.train_delay._delete("TRAIN#ICE5#2026-02-01", f"SEG#{NS}_LFT")

    def test_list_for_train_multiple(self, db):
        segs = [f"{NS}_LFTM_A", f"{NS}_LFTM_B", f"{NS}_LFTM_C"]
        for s in segs:
            db.train_delay.put(item("ICE6", "2026-02-02", s))
        r = db.train_delay.list_for_train("ICE6", "2026-02-02")
        assert r.is_ok()
        assert len(r.unwrap()) == 3
        for s in segs:
            db.train_delay._delete("TRAIN#ICE6#2026-02-02", f"SEG#{s}")

    def test_list_for_train_only_returns_that_train(self, db):
        db.train_delay.put(item("ICE7A", "2026-02-03", f"{NS}_ISO"))
        db.train_delay.put(item("ICE7B", "2026-02-03", f"{NS}_ISO"))
        r = db.train_delay.list_for_train("ICE7A", "2026-02-03")
        assert r.is_ok()
        assert all("TRAIN#ICE7A#2026-02-03" == i["pk"] for i in r.unwrap())
        db.train_delay._delete("TRAIN#ICE7A#2026-02-03", f"SEG#{NS}_ISO")
        db.train_delay._delete("TRAIN#ICE7B#2026-02-03", f"SEG#{NS}_ISO")

    def test_route_lookup_returns_segments_in_time_range(self, db):
        db.train_delay.put(item("ICE8", "2026-03-01", f"{NS}_RL_A",
                                gsi1_pk="STATION#8000001#2026-03-01", gsi1_sk="08:00"))
        db.train_delay.put(item("ICE8", "2026-03-01", f"{NS}_RL_B",
                                gsi1_pk="STATION#8000001#2026-03-01", gsi1_sk="09:00"))
        db.train_delay.put(item("ICE8", "2026-03-01", f"{NS}_RL_C",
                                gsi1_pk="STATION#8000001#2026-03-01", gsi1_sk="14:00"))
        r = db.train_delay.route_lookup(8000001, "2026-03-01", "07:00", "10:00")
        assert r.is_ok()
        sks = [i["gsi1_sk"] for i in r.unwrap()]
        assert "08:00" in sks
        assert "09:00" in sks
        assert "14:00" not in sks
        for seg in [f"{NS}_RL_A", f"{NS}_RL_B", f"{NS}_RL_C"]:
            db.train_delay._delete("TRAIN#ICE8#2026-03-01", f"SEG#{seg}")

    def test_route_lookup_empty_range(self, db):
        r = db.train_delay.route_lookup(9999999, "2099-01-01", "00:00", "01:00")
        assert r.is_ok()
        assert r.unwrap() == []
