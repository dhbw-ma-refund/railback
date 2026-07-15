NS = "u001"
NOW = "2026-01-01T00:00:00Z"


def item(email, **extra):
    return {
        "pk": f"USER#{email}", "sk": "PROFILE",
        "gsi1_pk": "USER", "gsi1_sk": f"EMAIL#{email}",
        "user_state": "ACTIVE", "hashed_password": "$2b$12$abcdefghijklmnopqrstuv",
        "vorname": "Maria", "nachname": "Müller",
        "telefon": "+49 151 1234567",
        "adresse_strasse": "Musterstraße", "adresse_hausnr": "12a",
        "adresse_plz": "68161", "adresse_ort": "Mannheim", "adresse_land": "DE",
        "iban_enc": "AAECAwQFBgcICQoLDA0ODw==", "bic_enc": "EBESExQVFhcYGRobHB0eHw==",
        "created_at": NOW,
        "datenschutz_einwilligung": True, "agb_akzeptiert": True,
        **extra,
    }


def email(suffix=""):
    return f"{NS}{suffix}@it.de"


class TestUserConnector:
    def test_put_success(self, db):
        e = email("put")
        assert db.user.put(item(e)).is_ok()
        db.user._delete(f"USER#{e}", "PROFILE")

    def test_put_overwrites_existing(self, db):
        e = email("overwrite")
        db.user.put(item(e, vorname="First"))
        db.user.put(item(e, vorname="Second"))
        assert db.user.get(e).unwrap()["vorname"] == "Second"
        db.user._delete(f"USER#{e}", "PROFILE")

    def test_get_found(self, db):
        e = email("get")
        db.user.put(item(e))
        r = db.user.get(e)
        assert r.is_ok()
        assert r.unwrap()["vorname"] == "Maria"
        db.user._delete(f"USER#{e}", "PROFILE")

    def test_get_not_found_returns_none(self, db):
        assert db.user.get("ghost.u001@it.de").unwrap() is None

    def test_update_existing(self, db):
        e = email("upd")
        db.user.put(item(e))
        db.user.update(e, {"vorname": "Updated"})
        assert db.user.get(e).unwrap()["vorname"] == "Updated"
        db.user._delete(f"USER#{e}", "PROFILE")

    def test_update_multiple_fields(self, db):
        e = email("updmulti")
        db.user.put(item(e))
        db.user.update(e, {"vorname": "A", "nachname": "B", "user_state": "INACTIVE"})
        i = db.user.get(e).unwrap()
        assert i["vorname"] == "A"
        assert i["nachname"] == "B"
        assert i["user_state"] == "INACTIVE"
        db.user._delete(f"USER#{e}", "PROFILE")

    def test_update_nonexistent_creates_item(self, db):
        e = email("upsert")
        db.user.update(e, {"vorname": "Upserted"})
        assert db.user.get(e).unwrap()["vorname"] == "Upserted"
        db.user._delete(f"USER#{e}", "PROFILE")

    def test_update_empty_dict_is_noop(self, db):
        e = email("emptyupd")
        db.user.put(item(e, vorname="Before"))
        assert db.user.update(e, {}).is_ok()
        assert db.user.get(e).unwrap()["vorname"] == "Before"
        db.user._delete(f"USER#{e}", "PROFILE")

    def test_list_all_finds_user(self, db):
        e = email("list")
        db.user.put(item(e))
        r = db.user.list_all()
        assert r.is_ok()
        assert f"EMAIL#{e}" in [u["gsi1_sk"] for u in r.unwrap()]
        db.user._delete(f"USER#{e}", "PROFILE")

    def test_list_all_multiple_users(self, db):
        emails = [email(f"listm{i}") for i in range(3)]
        for e in emails:
            db.user.put(item(e))
        r = db.user.list_all()
        assert r.is_ok()
        gsi_sks = [u["gsi1_sk"] for u in r.unwrap()]
        for e in emails:
            assert f"EMAIL#{e}" in gsi_sks
        for e in emails:
            db.user._delete(f"USER#{e}", "PROFILE")

    def test_get_for_admin_returns_ciphertext(self, db):
        # Reversal 2026-07-07: admin reads no longer strip iban_enc/bic_enc.
        e = email("adminget")
        db.user.put(item(e, iban_enc="ENC_IBAN_001", bic_enc="ENC_BIC_001"))
        r = db.user.get_for_admin(e)
        assert r.is_ok()
        data = r.unwrap()
        assert data["iban_enc"] == "ENC_IBAN_001"
        assert data["bic_enc"] == "ENC_BIC_001"
        assert data["vorname"] == "Maria"
        assert db.user.get(e).unwrap()["iban_enc"] == "ENC_IBAN_001"
        db.user._delete(f"USER#{e}", "PROFILE")

    def test_get_for_admin_not_found_returns_none(self, db):
        assert db.user.get_for_admin("ghost.u001.admin@it.de").unwrap() is None
