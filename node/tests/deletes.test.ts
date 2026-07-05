import { makeDb } from "./helpers.js";

const db = makeDb();
const NS = "del001ts";
const NOW = "2026-01-01T00:00:00Z";

function userItem(e: string) {
  return { pk: `USER#${e}`, sk: "PROFILE", name: "Test", gsi1_pk: "USER", gsi1_sk: `EMAIL#${e}` };
}
function ticketItem(e: string, tid: string) {
  return { pk: `USER#${e}`, sk: `TICKET#${tid}`, gsi1_pk: `TRAIN#ICE1#2026-01-01`, gsi1_sk: `TICKET#${tid}`, ticket_state: "READY", uploaded_at: NOW };
}
function ownerItem(tid: string, e: string) {
  return { pk: `TICKET#${tid}`, sk: "OWNER", email: e };
}
function belegItem(e: string, tid: string, bid: string) {
  return { pk: `USER#${e}`, sk: `TICKET#${tid}#BELEG#${bid}`, typ: "TAXI", uploaded_at: NOW };
}
function mandateItem(e: string, tid: string) {
  return { pk: `USER#${e}`, sk: `TICKET#${tid}#MANDATE`, mandate_state: "ISSUED", issued_at: NOW };
}

describe("delete operations", () => {
  test("deleteUser removes all user rows and ticket owners", async () => {
    const e = `del001ts.du@it.de`;
    const tid = "T_DU";
    await db.user.put(userItem(e));
    await db.ticket.put(ticketItem(e, tid));
    await db.ticketOwner.put(ownerItem(tid, e));
    await db.receipt.put(belegItem(e, tid, "B1"));
    await db.mandate.put(mandateItem(e, tid));

    const r = await db.deleteUser(e);
    expect(r.isOk()).toBe(true);
    expect((await db.user.get(e)).unwrap()).toBeNull();
    expect((await db.ticket.get(e, tid)).unwrap()).toBeNull();
    expect((await db.ticketOwner.get(tid)).unwrap()).toBeNull();
  });

  test("deleteUser is idempotent on ghost user", async () => {
    expect((await db.deleteUser("ghost.del001ts@it.de")).isOk()).toBe(true);
  });

  test("deleteTicket removes ticket and all sub-items", async () => {
    const e = `del001ts.dt@it.de`;
    const tid = "T_DT";
    await db.ticket.put(ticketItem(e, tid));
    await db.ticketOwner.put(ownerItem(tid, e));
    await db.receipt.put(belegItem(e, tid, "B1"));
    await db.mandate.put(mandateItem(e, tid));

    const r = await db.deleteTicket(e, tid);
    expect(r.isOk()).toBe(true);
    expect((await db.ticket.get(e, tid)).unwrap()).toBeNull();
    expect((await db.ticketOwner.get(tid)).unwrap()).toBeNull();
    expect((await db.receipt.get(e, tid, "B1")).unwrap()).toBeNull();
    expect((await db.mandate.get(e, tid)).unwrap()).toBeNull();
  });

  test("deleteTicket is idempotent", async () => {
    expect((await db.deleteTicket("ghost.del001ts@it.de", "T_GHOST")).isOk()).toBe(true);
  });
});
