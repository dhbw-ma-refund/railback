import { makeDb } from "./helpers.js";

const db = makeDb();
const NS = "u001ts";
const NOW = "2026-01-01T00:00:00Z";

function email(suffix = "") { return `${NS}${suffix}@it.de`; }
function item(e: string, extra: Record<string, unknown> = {}) {
  return {
    pk: `USER#${e}`, sk: "PROFILE",
    gsi1_pk: "USER", gsi1_sk: `EMAIL#${e}`,
    user_state: "ACTIVE", hashed_password: "x",
    vorname: "Test", nachname: "User",
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
    expect((r.unwrap() as any)["vorname"]).toBe("Test");
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

  test("getForAdmin strips sensitive fields", async () => {
    const e = email("adminget");
    await db.user.put(item(e, { iban_enc: "ENC_IBAN", bic_enc: "ENC_BIC" }));
    const r = await db.user.getForAdmin(e);
    expect(r.isOk()).toBe(true);
    const data = r.unwrap() as Record<string, unknown>;
    expect(data).not.toHaveProperty("iban_enc");
    expect(data).not.toHaveProperty("bic_enc");
    expect(data["vorname"]).toBe("Test");
    expect((await db.user.get(e)).unwrap() as any).toMatchObject({ iban_enc: "ENC_IBAN" });
    await db.user._delete(`USER#${e}`, "PROFILE");
  });

  test("getForAdmin not found returns null", async () => {
    const r = await db.user.getForAdmin("ghost.u001ts.admin@it.de");
    expect(r.isOk()).toBe(true);
    expect(r.unwrap()).toBeNull();
  });
});
