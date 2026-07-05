import { makeDb } from "./helpers.js";
import { ConflictError } from "../src/base.js";

const db = makeDb();
const NS = "sm001ts";
const NOW = "2026-01-01T00:00:00Z";
const E = `${NS}@it.de`;

function item(tid: string, extra: Record<string, unknown> = {}) {
  return {
    pk: `USER#${E}`, sk: `TICKET#${tid}#MANDATE`,
    mandate_id: `MID_${tid}`, mandate_state: "ISSUED",
    fee_amount: "5.00", issued_at: NOW, ...extra,
  };
}

describe("SepaMandateConnector", () => {
  test("put and get", async () => {
    await db.mandate.put(item("T_SM_GET"));
    const r = await db.mandate.get(E, "T_SM_GET");
    expect(r.isOk()).toBe(true);
    expect((r.unwrap() as any)["mandate_state"]).toBe("ISSUED");
    await db.mandate._delete(`USER#${E}`, "TICKET#T_SM_GET#MANDATE");
  });

  test("get not found returns null", async () => {
    expect((await db.mandate.get("ghost.sm001ts@it.de", "T_GHOST")).unwrap()).toBeNull();
  });

  test("stamp pain008 succeeds first time", async () => {
    await db.mandate.put(item("T_SM_STAMP"));
    const r = await db.mandate.stampPain008Built(E, "T_SM_STAMP", "BATCH_001", "pain008/B.xml", "2026-07-05T10:00:00Z");
    expect(r.isOk()).toBe(true);
    const row = (await db.mandate.get(E, "T_SM_STAMP")).unwrap() as any;
    expect(row["pain008_batch_id"]).toBe("BATCH_001");
    expect(row["pain008_s3_key"]).toBe("pain008/B.xml");
    await db.mandate._delete(`USER#${E}`, "TICKET#T_SM_STAMP#MANDATE");
  });

  test("stamp pain008 conflict on second call", async () => {
    await db.mandate.put(item("T_SM_CONF"));
    await db.mandate.stampPain008Built(E, "T_SM_CONF", "BATCH_A", "pain008/A.xml", "2026-07-05T10:00:00Z");
    const r = await db.mandate.stampPain008Built(E, "T_SM_CONF", "BATCH_B", "pain008/B.xml", "2026-07-05T11:00:00Z");
    expect(r.isErr()).toBe(true);
    expect((r as any).error).toBeInstanceOf(ConflictError);
    expect(((await db.mandate.get(E, "T_SM_CONF")).unwrap() as any)["pain008_batch_id"]).toBe("BATCH_A");
    await db.mandate._delete(`USER#${E}`, "TICKET#T_SM_CONF#MANDATE");
  });

  test("stamp pain008 on ghost mandate returns ConflictError", async () => {
    const r = await db.mandate.stampPain008Built("ghost.sm001ts@it.de", "T_GHOST_STAMP", "BATCH_X", "s3.xml", "2026-07-05T00:00:00Z");
    expect(r.isErr()).toBe(true);
    expect((r as any).error).toBeInstanceOf(ConflictError);
    expect((await db.mandate.get("ghost.sm001ts@it.de", "T_GHOST_STAMP")).unwrap()).toBeNull();
  });
});
