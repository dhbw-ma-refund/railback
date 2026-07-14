import { makeDb } from "./helpers.js";

const db = makeDb();
const NS = "t001ts";
const NOW = "2026-06-01T10:00:00+02:00";

function email(suffix = "") { return `${NS}${suffix}@it.de`; }
function ticket(e: string, tid: string, extra: Record<string, unknown> = {}) {
  return {
    pk: `USER#${e}`, sk: `TICKET#${tid}`,
    gsi1_pk: `TRAIN#IC 1#${NOW.slice(0, 10)}`, gsi1_sk: `TICKET#${tid}`,
    gsi2_pk: "BARCODE", gsi2_sk: `bc_${tid}`,
    ticket_state: "READY",
    uploaded_at: NOW, updated_at: NOW,
    ...extra,
  };
}

describe("TicketConnector", () => {
  test("put and get", async () => {
    const [e, tid] = [email("get"), "T_GET"];
    await db.ticket.put(ticket(e, tid));
    const r = await db.ticket.get(e, tid);
    expect(r.isOk()).toBe(true);
    expect((r.unwrap() as any)["ticket_state"]).toBe("READY");
    await db.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });

  test("get not found returns null", async () => {
    expect((await db.ticket.get("ghost.t001ts@it.de", "T_GHOST")).unwrap()).toBeNull();
  });

  test("listForUser returns only plain tickets", async () => {
    const e = email("lfu");
    const tid = "T_LFU";
    await db.ticket.put(ticket(e, tid));
    await db.receipt.put({ pk: `USER#${e}`, sk: `TICKET#${tid}#BELEG#B1`, typ: "TAXI", uploaded_at: NOW });
    await db.mandate.put({ pk: `USER#${e}`, sk: `TICKET#${tid}#MANDATE`, mandate_state: "ISSUED", issued_at: NOW });
    const r = await db.ticket.listForUser(e);
    expect(r.isOk()).toBe(true);
    const sks = (r.unwrap() as any[]).map((i) => i["sk"]);
    expect(sks).toContain(`TICKET#${tid}`);
    expect(sks).not.toContain(`TICKET#${tid}#BELEG#B1`);
    expect(sks).not.toContain(`TICKET#${tid}#MANDATE`);
    await db.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
    await db.receipt._delete(`USER#${e}`, `TICKET#${tid}#BELEG#B1`);
    await db.mandate._delete(`USER#${e}`, `TICKET#${tid}#MANDATE`);
  });

  test("listForUser limit counts plain tickets only", async () => {
    const e = email("lfulmix");
    const tids = ["T_LFULMIX0", "T_LFULMIX1", "T_LFULMIX2", "T_LFULMIX3"];
    for (const tid of tids) {
      await db.ticket.put(ticket(e, tid));
      await db.receipt.put({ pk: `USER#${e}`, sk: `TICKET#${tid}#BELEG#B1`, typ: "TAXI", uploaded_at: NOW });
    }
    const r = await db.ticket.listForUser(e, 2);
    expect(r.isOk()).toBe(true);
    const items = r.unwrap() as any[];
    expect(items).toHaveLength(2);
    for (const i of items) {
      expect((i["sk"] as string).slice("TICKET#".length)).not.toContain("#");
    }
    for (const tid of tids) {
      await db.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
      await db.receipt._delete(`USER#${e}`, `TICKET#${tid}#BELEG#B1`);
    }
  });

  test("getByTrain empty", async () => {
    const r = await db.ticket.getByTrain("IC 9999", "2099-01-01");
    expect(r.isOk()).toBe(true);
    expect(r.unwrap()).toEqual([]);
  });

  test("getByTrain found", async () => {
    const e = email("gbt");
    const tid = "T_GBT";
    const i = ticket(e, tid);
    (i as any)["gsi1_pk"] = "TRAIN#IC 777#2026-09-01";
    await db.ticket.put(i);
    const r = await db.ticket.getByTrain("IC 777", "2026-09-01");
    expect(r.isOk()).toBe(true);
    expect((r.unwrap() as any[]).some((x) => x["sk"] === `TICKET#${tid}`)).toBe(true);
    await db.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });

  test("checkBarcodeDuplicate not found", async () => {
    const r = await db.ticket.checkBarcodeDuplicate("ghost_barcode_uid_ts_001");
    expect(r.isOk()).toBe(true);
    expect(r.unwrap()).toBeNull();
  });

  test("checkBarcodeDuplicate found", async () => {
    const e = email("bc");
    const tid = "T_BC";
    const uid = "bc_unique_ts_001";
    const i = { ...ticket(e, tid), gsi2_sk: uid };
    await db.ticket.put(i);
    const r = await db.ticket.checkBarcodeDuplicate(uid);
    expect(r.isOk()).toBe(true);
    const row = r.unwrap() as Record<string, unknown> | null;
    expect(row).not.toBeNull();
    // GSI2 is KEYS_ONLY — the connector must refetch the full item. Assert a
    // NON-key attribute is present (undefined if we returned the raw index
    // hit). Guards the P1b regression.
    expect(row!["ticket_state"]).toBe("READY");
    expect(row!["uploaded_at"]).toBe(NOW);
    await db.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });

  test("listEmailPending finds item", async () => {
    const e = email("epend");
    const tid = "T_EPEND";
    const i = {
      ...ticket(e, tid),
      gsi_email_pending_pk: "EMAIL_PENDING",
      gsi_email_pending_sk: "2026-06-01T08:00:00+02:00",
      ticket_state: "EMAIL_SENDING",
    };
    await db.ticket.put(i);
    const r = await db.ticket.listEmailPending(25);
    expect(r.isOk()).toBe(true);
    const rows = r.unwrap() as Record<string, unknown>[];
    const found = rows.find((x) => x["sk"] === `TICKET#${tid}`);
    expect(found).toBeDefined();
    // GSI_EMAIL_PENDING is KEYS_ONLY — full item must be refetched so the
    // sweeper gets email / ticket_state / attempts. Guards P1b.
    expect(found!["ticket_state"]).toBe("EMAIL_SENDING");
    expect(found!["pk"]).toBe(`USER#${e}`);
    await db.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });
});
