import { makeDb } from "./helpers.js";

const db = makeDb();
const NS = "u001ts";
const NOW = "2026-01-01T00:00:00Z";

function email(suffix = "") { return `${NS}${suffix}@it.de`; }
function item(e: string, extra: Record<string, unknown> = {}) {
  return {
    pk: `USER#${e}`, sk: "PROFILE",
    gsi1_pk: "USER", gsi1_sk: `EMAIL#${e}`,
    user_state: "ACTIVE", hashed_password: "$2b$12$abcdefghijklmnopqrstuv",
    vorname: "Maria", nachname: "Müller",
    telefon: "+49 151 1234567",
    adresse_strasse: "Musterstraße", adresse_hausnr: "12a",
    adresse_plz: "68161", adresse_ort: "Mannheim", adresse_land: "DE",
    iban_enc: "AAECAwQFBgcICQoLDA0ODw==", bic_enc: "EBESExQVFhcYGRobHB0eHw==",
    created_at: NOW,
    datenschutz_einwilligung: true, agb_akzeptiert: true,
    ...extra,
  };
}

describe("UserConnector", () => {
  test("put succeeds", async () => {
    const e = email("put");
    expect((await db.user.put(item(e))).isOk()).toBe(true);
    await db.user._delete(`USER#${e}`, "PROFILE");
  });

  test("get found", async () => {
    const e = email("get");
    await db.user.put(item(e));
    const r = await db.user.get(e);
    expect(r.isOk()).toBe(true);
    expect(r.unwrap()?.["vorname"]).toBe("Maria");
    await db.user._delete(`USER#${e}`, "PROFILE");
  });

  test("get not found returns null", async () => {
    const r = await db.user.get("ghost.u001ts@it.de");
    expect(r.isOk()).toBe(true);
    expect(r.unwrap()).toBeNull();
  });

  test("update existing", async () => {
    const e = email("upd");
    await db.user.put(item(e));
    await db.user.update(e, { vorname: "Updated" });
    expect((await db.user.get(e)).unwrap() as any).toMatchObject({ vorname: "Updated" });
    await db.user._delete(`USER#${e}`, "PROFILE");
  });

  test("update empty dict is noop", async () => {
    const e = email("emptyupd");
    await db.user.put(item(e, { vorname: "Before" }));
    expect((await db.user.update(e, {})).isOk()).toBe(true);
    expect((await db.user.get(e)).unwrap() as any).toMatchObject({ vorname: "Before" });
    await db.user._delete(`USER#${e}`, "PROFILE");
  });

  test("listAll finds user", async () => {
    const e = email("list");
    await db.user.put(item(e));
    const r = await db.user.listAll();
    expect(r.isOk()).toBe(true);
    expect((r.unwrap() as any[]).some((u) => u["gsi1_sk"] === `EMAIL#${e}`)).toBe(true);
    await db.user._delete(`USER#${e}`, "PROFILE");
  });

  test("getForAdmin returns full row including iban_enc/bic_enc", async () => {
    // 2026-07-07 reversal (DECISIONS.md): admin sees IBAN/BIC ciphertext;
    // decryption to plaintext lives in admin-handler (backend layer).
    const e = email("adminget");
    await db.user.put(item(e, { iban_enc: "ENC_IBAN", bic_enc: "ENC_BIC" }));
    const r = await db.user.getForAdmin(e);
    expect(r.isOk()).toBe(true);
    const data = r.unwrap() as Record<string, unknown>;
    expect(data).toHaveProperty("iban_enc", "ENC_IBAN");
    expect(data).toHaveProperty("bic_enc", "ENC_BIC");
    expect(data["vorname"]).toBe("Maria");
    expect((await db.user.get(e)).unwrap() as any).toMatchObject({ iban_enc: "ENC_IBAN" });
    await db.user._delete(`USER#${e}`, "PROFILE");
  });

  test("getForAdmin not found returns null", async () => {
    const r = await db.user.getForAdmin("ghost.u001ts.admin@it.de");
    expect(r.isOk()).toBe(true);
    expect(r.unwrap()).toBeNull();
  });

  test("F7: mixed-case email is normalised — put(lower) + get(UPPER) hits same row", async () => {
    // F7 (2026-07-08): raw email interpolated into USER# without lowercase
    // used to split partitions on mixed-case input. Connector.get now
    // normalises identically to @railback/lib/storage/ddb/keys#normaliseEmail.
    const canonical = email("caseinsensitive");
    // Seed the row with the canonical (lowercase) key.
    await db.user.put(item(canonical));
    // Read with a mixed-case variant — MUST resolve to the same row.
    const mixed = canonical.toUpperCase();
    const r1 = await db.user.get(mixed);
    expect(r1.isOk()).toBe(true);
    expect(r1.unwrap()?.["vorname"]).toBe("Maria");
    // And with whitespace padding.
    const padded = `  ${canonical}  `;
    const r2 = await db.user.get(padded);
    expect(r2.isOk()).toBe(true);
    expect(r2.unwrap()?.["vorname"]).toBe("Maria");
    await db.user._delete(`USER#${canonical}`, "PROFILE");
  });
});
