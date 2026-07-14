// Phase-3b unit tests for the TicketRepo write-path adapter methods.
// Covers create, createFromRoute, patch (18-case sparse-GSI matrix),
// delete, adminList, scanEmailWatchdog, enumerateAllTicketIdsForUser,
// anonymiseUserTickets.

import { makeBackend, makeDb } from "./helpers.js";

const backend = makeBackend();
const raw = makeDb();

const NS = "t3b";
const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

function em(suffix: string) { return `${NS}.${suffix}@it.de`; }
function tid(suffix: string) { return `T_${NS}_${suffix}`; }

async function delTicket(email: string, id: string) {
  // Adapter normalises email in the PK (F7 2026-07-08).
  await raw.ticket._delete(`USER#${email.toLowerCase()}`, `TICKET#${id}`);
  await raw.ticketOwner._delete(`TICKET#${id}`, "OWNER");
}

async function getRaw(email: string, id: string): Promise<Record<string, unknown> | null> {
  return (await raw.ticket._get(`USER#${email.toLowerCase()}`, `TICKET#${id}`)).unwrap();
}

// -----------------------------------------------------------------------------
// tickets.create
// -----------------------------------------------------------------------------

describe("TicketRepo.create", () => {
  test("initial DTO shape + atomic TicketOwner; RAW# is upload-confirm's job", async () => {
    const e = em("create.ok");
    const id = tid("CREATE");
    const t = await backend.tickets.create({
      email: e,
      ticketId: id,
      filename: "ticket.pdf",
      s3_key: `raw/${e}/${id}.pdf`,
      mimeType: "application/pdf",
      contentType: "application/pdf",
      sizeBytes: 5000,
      uploadedAt: NOW,
    });
    expect(t.ticket_state).toBe("VALIDATING");
    expect(t.extraction_status).toBe("PROCESSING");
    expect(t.extraction_method).toBe("BARCODE");
    expect(t.extraction_confidence).toBe(0);
    expect(t.state_timeline).toEqual([{ state: "VALIDATING", at: NOW }]);
    expect(t.uploaded_at).toBe(NOW);

    // Owner row present
    const owner = await backend.ticketOwners.get(id);
    expect(owner).not.toBeNull();
    expect(owner!.email).toBe(e);

    // F6 (2026-07-08): the RAW# sibling row is NOT written by tickets.create
    // anymore. upload-confirm is the sole writer of RAW# rows; writing a
    // placeholder here left `s3_bucket: ""` in the row forever (upload-confirm
    // is idempotent and returns early when RAW# already exists).
    const rawUp = await backend.blobs.getRawUpload(e, id);
    expect(rawUp).toBeNull();

    // Cleanup — RAW# no-op is safe / defensive.
    await raw.rawUpload._delete(`USER#${e}`, `RAW#${id}`);
    await delTicket(e, id);
  });

  test("conflict on duplicate ticketId → AdapterError ERR_CONFLICT", async () => {
    const e = em("create.dup");
    const id = tid("DUP");
    const args = {
      email: e, ticketId: id, filename: "f", s3_key: "k",
      mimeType: "application/pdf", contentType: "application/pdf",
      sizeBytes: 10, uploadedAt: NOW,
    };
    await backend.tickets.create(args);
    await expect(backend.tickets.create(args)).rejects.toMatchObject({
      code: "ERR_CONFLICT",
    });
    await raw.rawUpload._delete(`USER#${e}`, `RAW#${id}`);
    await delTicket(e, id);
  });
});

// -----------------------------------------------------------------------------
// tickets.createFromRoute
// -----------------------------------------------------------------------------

describe("TicketRepo.createFromRoute", () => {
  test("READY + MANUAL_ROUTE + fahrt_* fields populated", async () => {
    const e = em("route.ok");
    const id = tid("ROUTE");
    const t = await backend.tickets.createFromRoute({
      email: e, ticketId: id,
      trainNr: "ICE100", date: "2026-08-15",
      fromStation: "Hbf", fromEva: 8000105,
      toStation: "Ost", toEva: 8000261,
      abfahrtszeit_plan: "10:00", ankunftszeit_plan: "12:00",
      fahrkartennummer: "FK1", fahrkartenpreis: "50.00",
      is_zeitkarte: false,
    });
    expect(t.ticket_state).toBe("READY");
    expect(t.extraction_method).toBe("MANUAL_ROUTE");
    expect(t.extraction_status).toBe("DONE");
    expect(t.fahrt_zugnummer_plan).toBe("ICE100");
    expect(t.fahrt_abreisedatum).toBe("2026-08-15");
    expect(t.fahrt_abreisebahnhof).toBe("Hbf");
    expect(t.fahrt_zielbahnhof).toBe("Ost");
    expect(t.state_timeline[0]!.state).toBe("READY");

    // GSI1 was set because fahrt_zugnummer_plan + fahrt_abreisedatum both present.
    const row = await getRaw(e, id);
    expect(row!["gsi1_pk"]).toBe("TRAIN#ICE100#2026-08-15");
    expect(row!["gsi1_sk"]).toBe(`TICKET#${id}`);

    // Owner row atomically created.
    expect(await backend.ticketOwners.get(id)).not.toBeNull();

    await delTicket(e, id);
  });
});

// -----------------------------------------------------------------------------
// tickets.patch — 18-case sparse-GSI matrix
// -----------------------------------------------------------------------------

/**
 * Seed a plain ticket (no email pipeline fields set). Returns the ticketId.
 * Skips the raw-upload row so cleanup is single-row.
 */
async function seedPlainTicket(email: string, id: string): Promise<void> {
  await backend.tickets.create({
    email, ticketId: id, filename: "f", s3_key: "k",
    mimeType: "application/pdf", contentType: "application/pdf",
    sizeBytes: 1, uploadedAt: NOW,
  });
  // Move to READY (out of VALIDATING) so email-pipeline cases can start cleanly.
  await backend.tickets.patch(email, id, { ticket_state: "READY" });
}

async function cleanupPatchTicket(email: string, id: string): Promise<void> {
  await raw.rawUpload._delete(`USER#${email}`, `RAW#${id}`);
  await delTicket(email, id);
}

describe("TicketRepo.patch — 18-case sparse-GSI matrix", () => {
  const e = em("patch");

  test("case 1: READY→EMAIL_SENDING + SENDING + attempts=1 + last_attempt ⇒ keys SET", async () => {
    const id = tid("C1");
    await seedPlainTicket(e, id);
    const t = await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING",
      email_status: "SENDING",
      email_attempts: 1,
      email_last_attempt: NOW,
    });
    expect(t.ticket_state).toBe("EMAIL_SENDING");
    expect(t.email_status).toBe("SENDING");
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBe("EMAIL_PENDING");
    expect(row!["gsi_email_pending_sk"]).toBe(NOW);
    await cleanupPatchTicket(e, id);
  });

  test("case 2: from #1 → email_status=SENT ⇒ keys REMOVE", async () => {
    const id = tid("C2");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "SENDING",
      email_attempts: 1, email_last_attempt: NOW,
    });
    const t = await backend.tickets.patch(e, id, { email_status: "SENT" });
    expect(t.email_status).toBe("SENT");
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    expect(row!["gsi_email_pending_sk"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 3: from #1 → FAILED_TRANSIENT + attempts=2 ⇒ keys still SET (attempts<3)", async () => {
    const id = tid("C3");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "SENDING",
      email_attempts: 1, email_last_attempt: NOW,
    });
    const t = await backend.tickets.patch(e, id, {
      email_status: "FAILED_TRANSIENT", email_attempts: 2,
    });
    expect(t.email_status).toBe("FAILED_TRANSIENT");
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBe("EMAIL_PENDING");
    await cleanupPatchTicket(e, id);
  });

  test("case 4: from #3 → attempts=3 ⇒ keys REMOVE", async () => {
    const id = tid("C4");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "FAILED_TRANSIENT",
      email_attempts: 2, email_last_attempt: NOW,
    });
    // Confirm baseline set
    expect((await getRaw(e, id))!["gsi_email_pending_pk"]).toBe("EMAIL_PENDING");
    await backend.tickets.patch(e, id, { email_attempts: 3 });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 5: from #3 → attempts=3 + status=FAILED ⇒ keys REMOVE", async () => {
    const id = tid("C5");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "FAILED_TRANSIENT",
      email_attempts: 2, email_last_attempt: NOW,
    });
    await backend.tickets.patch(e, id, {
      email_status: "FAILED", email_attempts: 3,
    });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 6: from #1 → ticket_state=PENDING_DB_PAYMENT ⇒ keys REMOVE", async () => {
    const id = tid("C6");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "SENDING",
      email_attempts: 1, email_last_attempt: NOW,
    });
    await backend.tickets.patch(e, id, { ticket_state: "PENDING_DB_PAYMENT" });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 7: from #1 → ticket_state=EMAIL_FAILED ⇒ keys REMOVE", async () => {
    const id = tid("C7");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "SENDING",
      email_attempts: 1, email_last_attempt: NOW,
    });
    await backend.tickets.patch(e, id, { ticket_state: "EMAIL_FAILED" });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 8: seed EMAIL_SENDING + FAILED_TRANSIENT + attempts=2 + last_attempt=iso ⇒ keys SET", async () => {
    const id = tid("C8");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "FAILED_TRANSIENT",
      email_attempts: 2, email_last_attempt: NOW,
    });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBe("EMAIL_PENDING");
    expect(row!["gsi_email_pending_sk"]).toBe(NOW);
    await cleanupPatchTicket(e, id);
  });

  test("case 9: from #8 patch email_last_attempt=null ⇒ keys REMOVE", async () => {
    const id = tid("C9");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "FAILED_TRANSIENT",
      email_attempts: 2, email_last_attempt: NOW,
    });
    // TicketPatch doesn't declare email_last_attempt clearable via null on the
    // typed side, but the connector honours clear[] uniformly — use clear.
    await backend.tickets.patch(e, id, {
      clear: ["email_last_attempt"],
    });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    expect(row!["email_last_attempt"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 10: seed EMAIL_SENDING + SENDING + attempts=0 + last_attempt=iso ⇒ keys SET", async () => {
    const id = tid("C10");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "SENDING",
      email_attempts: 0, email_last_attempt: NOW,
    });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBe("EMAIL_PENDING");
    await cleanupPatchTicket(e, id);
  });

  test("case 11: from #10 → email_status=DELIVERED ⇒ keys REMOVE", async () => {
    const id = tid("C11");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "SENDING",
      email_attempts: 0, email_last_attempt: NOW,
    });
    await backend.tickets.patch(e, id, { email_status: "DELIVERED" });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 12: from #10 → email_status=BOUNCED ⇒ keys REMOVE", async () => {
    const id = tid("C12");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "SENDING",
      email_attempts: 0, email_last_attempt: NOW,
    });
    await backend.tickets.patch(e, id, { email_status: "BOUNCED" });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 13: EMAIL_SENDING + FAILED_TRANSIENT + attempts=2 + last_attempt undefined ⇒ keys NOT SET", async () => {
    const id = tid("C13");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "FAILED_TRANSIENT",
      email_attempts: 2,
      // email_last_attempt intentionally omitted
    });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    expect(row!["gsi_email_pending_sk"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 14: idempotency — no-change patch on keys-SET ticket ⇒ keys still SET", async () => {
    const id = tid("C14");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "SENDING",
      email_attempts: 1, email_last_attempt: NOW,
    });
    // Empty patch — should just refresh updated_at, keys stay SET.
    await backend.tickets.patch(e, id, {});
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBe("EMAIL_PENDING");
    expect(row!["gsi_email_pending_sk"]).toBe(NOW);
    await cleanupPatchTicket(e, id);
  });

  test("case 15: idempotency — empty patch on keys-CLEAR ticket ⇒ keys still CLEAR", async () => {
    const id = tid("C15");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {});
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    expect(row!["gsi_email_pending_sk"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 16: state_timeline appended on state change; NOT appended on same-state patch", async () => {
    const id = tid("C16");
    await seedPlainTicket(e, id);
    // seedPlainTicket already patched to READY (2 entries: VALIDATING + READY)
    let after = await backend.tickets.patch(e, id, { ticket_state: "EMAIL_SENDING" });
    expect(after.state_timeline.length).toBe(3);
    expect(after.state_timeline[after.state_timeline.length - 1]!.state).toBe("EMAIL_SENDING");

    // Same-state patch shouldn't append.
    after = await backend.tickets.patch(e, id, { admin_note: "unchanged-state" });
    expect(after.state_timeline.length).toBe(3);
    await cleanupPatchTicket(e, id);
  });

  test("case 17: SENDING attempts=2 → attempts=3 single patch ⇒ keys REMOVE", async () => {
    const id = tid("C17");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "SENDING",
      email_attempts: 2, email_last_attempt: NOW,
    });
    // Baseline: keys SET (attempts=2 < 3)
    expect((await getRaw(e, id))!["gsi_email_pending_pk"]).toBe("EMAIL_PENDING");
    await backend.tickets.patch(e, id, { email_attempts: 3 });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });

  test("case 18: clear[email_status,email_attempts,email_last_attempt] on keys-SET ticket ⇒ keys REMOVE", async () => {
    const id = tid("C18");
    await seedPlainTicket(e, id);
    await backend.tickets.patch(e, id, {
      ticket_state: "EMAIL_SENDING", email_status: "SENDING",
      email_attempts: 1, email_last_attempt: NOW,
    });
    expect((await getRaw(e, id))!["gsi_email_pending_pk"]).toBe("EMAIL_PENDING");
    await backend.tickets.patch(e, id, {
      clear: ["email_status", "email_attempts", "email_last_attempt"],
    });
    const row = await getRaw(e, id);
    expect(row!["gsi_email_pending_pk"]).toBeUndefined();
    expect(row!["email_status"]).toBeUndefined();
    expect(row!["email_attempts"]).toBeUndefined();
    expect(row!["email_last_attempt"]).toBeUndefined();
    await cleanupPatchTicket(e, id);
  });
});

// -----------------------------------------------------------------------------
// tickets.patch — misc semantic behaviour
// -----------------------------------------------------------------------------

describe("TicketRepo.patch — semantics", () => {
  const e = em("patch.misc");

  test("ERR_NOT_FOUND on missing ticket", async () => {
    await expect(
      backend.tickets.patch(e, tid("GHOST"), { ticket_state: "READY" }),
    ).rejects.toMatchObject({ code: "ERR_NOT_FOUND" });
  });

  test("gsi2 keys derived from barcode_uid", async () => {
    const id = tid("BAR");
    await backend.tickets.create({
      email: e, ticketId: id, filename: "f", s3_key: "k",
      mimeType: "application/pdf", contentType: "application/pdf",
      sizeBytes: 1, uploadedAt: NOW,
    });
    // SET barcode_uid
    const t = await backend.tickets.patch(e, id, { barcode_uid: "UID-XYZ" });
    expect(t.barcode_uid).toBe("UID-XYZ");
    const row = await getRaw(e, id);
    expect(row!["gsi2_pk"]).toBe("BARCODE");
    expect(row!["gsi2_sk"]).toBe("UID-XYZ");
    // Clear it
    await backend.tickets.patch(e, id, { clear: ["barcode_uid"] } as any);
    const row2 = await getRaw(e, id);
    expect(row2!["gsi2_pk"]).toBeUndefined();
    expect(row2!["gsi2_sk"]).toBeUndefined();

    await raw.rawUpload._delete(`USER#${e}`, `RAW#${id}`);
    await delTicket(e, id);
  });

  test("gsi1 (train) keys derived from fahrt_zugnummer_plan + fahrt_abreisedatum", async () => {
    const id = tid("TRAIN");
    await backend.tickets.create({
      email: e, ticketId: id, filename: "f", s3_key: "k",
      mimeType: "application/pdf", contentType: "application/pdf",
      sizeBytes: 1, uploadedAt: NOW,
    });
    await backend.tickets.patch(e, id, {
      fahrt_zugnummer_plan: "ICE500",
      fahrt_abreisedatum: "2026-09-01",
    });
    const row = await getRaw(e, id);
    expect(row!["gsi1_pk"]).toBe("TRAIN#ICE500#2026-09-01");
    expect(row!["gsi1_sk"]).toBe(`TICKET#${id}`);
    await raw.rawUpload._delete(`USER#${e}`, `RAW#${id}`);
    await delTicket(e, id);
  });
});

// -----------------------------------------------------------------------------
// tickets.delete
// -----------------------------------------------------------------------------

describe("TicketRepo.delete", () => {
  test("deletes only the TICKET row (no cascade)", async () => {
    const e = em("del");
    const id = tid("DEL");
    await backend.tickets.create({
      email: e, ticketId: id, filename: "f", s3_key: "k",
      mimeType: "application/pdf", contentType: "application/pdf",
      sizeBytes: 1, uploadedAt: NOW,
    });
    // Owner row should still exist after delete
    await backend.tickets.delete(e, id);
    expect(await backend.tickets.get(e, id)).toBeNull();
    expect(await backend.ticketOwners.get(id)).not.toBeNull();

    // Cleanup owner + raw
    await raw.ticketOwner._delete(`TICKET#${id}`, "OWNER");
    await raw.rawUpload._delete(`USER#${e}`, `RAW#${id}`);
  });
});

// -----------------------------------------------------------------------------
// tickets.adminList
// -----------------------------------------------------------------------------

describe("TicketRepo.adminList", () => {
  const e = em("admin.list");
  const idA = tid("AL_A");
  const idB = tid("AL_B");
  const idC = tid("AL_C");

  beforeAll(async () => {
    // A: train ICE100 on 2026-09-01, READY
    await backend.tickets.createFromRoute({
      email: e, ticketId: idA,
      trainNr: "ICE100", date: "2026-09-01",
      fromStation: "Hbf", fromEva: 8000105,
      toStation: "Ost", toEva: 8000261,
      abfahrtszeit_plan: "10:00", ankunftszeit_plan: "12:00",
      fahrkartennummer: "F1", fahrkartenpreis: "10.00",
      is_zeitkarte: false,
    });
    // B: train ICE100 on 2026-09-01, PENDING_DB_PAYMENT
    await backend.tickets.createFromRoute({
      email: e, ticketId: idB,
      trainNr: "ICE100", date: "2026-09-01",
      fromStation: "Hbf", fromEva: 8000105,
      toStation: "Ost", toEva: 8000261,
      abfahrtszeit_plan: "11:00", ankunftszeit_plan: "13:00",
      fahrkartennummer: "F2", fahrkartenpreis: "20.00",
      is_zeitkarte: false,
    });
    await backend.tickets.patch(e, idB, { ticket_state: "PENDING_DB_PAYMENT" });
    // C: train ICE200 on 2026-09-05 — different partition
    await backend.tickets.createFromRoute({
      email: e, ticketId: idC,
      trainNr: "ICE200", date: "2026-09-05",
      fromStation: "Hbf", fromEva: 8000105,
      toStation: "Ost", toEva: 8000261,
      abfahrtszeit_plan: "12:00", ankunftszeit_plan: "14:00",
      fahrkartennummer: "F3", fahrkartenpreis: "30.00",
      is_zeitkarte: false,
    });
  });
  afterAll(async () => {
    for (const id of [idA, idB, idC]) await delTicket(e, id);
  });

  test("trainNr+date routes through gsi1", async () => {
    const p = await backend.tickets.adminList({
      trainNr: "ICE100", date: "2026-09-01", limit: 10,
    });
    const ids = p.items.map((t) => t.ticketId).sort();
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
    expect(ids).not.toContain(idC);
  });

  test("email-only routes through pk query", async () => {
    const p = await backend.tickets.adminList({ email: e, limit: 10 });
    const ids = p.items.map((t) => t.ticketId).sort();
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
    expect(ids).toContain(idC);
  });

  test("state filter applies on email route", async () => {
    const p = await backend.tickets.adminList({
      email: e, state: "PENDING_DB_PAYMENT", limit: 10,
    });
    const ids = p.items.map((t) => t.ticketId);
    expect(ids).toContain(idB);
    expect(ids).not.toContain(idA);
  });

  // Regression: the unfiltered / state-only / date-only branch is a scan
  // over the single-table backend, which interleaves TrainSegmentDelay
  // (`SEG#…`) rows with tickets. DynamoDB applies `Limit` to items EXAMINED
  // before the FilterExpression runs, so a one-shot `Limit`-page scan could
  // read a page that is entirely segment rows, filter them all out, and
  // return `items: []` with a segment-shaped `nextCursor` — reported by the
  // admin-form colleague as "0 tickets across 30 pages, cursor decodes to
  // TRAIN#…#SEG#…". The adapter now paginates until it collects `limit`
  // matching rows. Seed enough segment rows that a naive Limit=N page would
  // be starved, then assert the tickets still surface.
  describe("scan route (no trainNr+date, no email) skips interleaved SEG# rows", () => {
    const segTrain = "SEGNOISE1";
    const segDate = "2026-09-09";
    const segIds = Array.from({ length: 30 }, (_, i) => `NOISE_${i}`);

    beforeAll(async () => {
      for (const sid of segIds) {
        await raw.trainDelay.put({
          pk: `TRAIN#${segTrain}#${segDate}`,
          sk: `SEG#${sid}`,
          gsi3_pk: `STATION#8000105#${segDate}`,
          gsi3_sk: `${segDate}T10:00#${segTrain}`,
          delayMinutes: 5,
          origin: "Hbf", destination: "Ost",
          origin_eva: 8000105, destination_eva: 8000261,
          planned_departure: `${segDate}T10:00`,
          planned_arrival: `${segDate}T10:30`,
          is_cancelled: false, source: "iris", last_seen_at: NOW,
        });
      }
    });
    afterAll(async () => {
      for (const sid of segIds) {
        await raw.trainDelay._delete(`TRAIN#${segTrain}#${segDate}`, `SEG#${sid}`);
      }
    });

    test("unfiltered scan returns tickets, never a segment-only empty page", async () => {
      const p = await backend.tickets.adminList({ limit: 10 });
      const ids = p.items.map((t) => t.ticketId);
      // Our three seeded tickets (idA/idB/idC from the enclosing describe)
      // must be reachable; segment rows must never appear as tickets.
      expect(ids).toEqual(expect.arrayContaining([idA]));
      for (const t of p.items) {
        // every returned row is a plain ticket (mapTicket only runs on
        // TICKET#<id> rows) — its ticketId must not look like a SEG id.
        expect(t.ticketId.startsWith("NOISE_")).toBe(false);
      }
    });

    test("state-only filter returns matching tickets despite SEG# noise", async () => {
      const p = await backend.tickets.adminList({
        state: "PENDING_DB_PAYMENT", limit: 10,
      });
      const ids = p.items.map((t) => t.ticketId);
      expect(ids).toContain(idB);
    });
  });
});

// -----------------------------------------------------------------------------
// tickets.scanEmailWatchdog
// -----------------------------------------------------------------------------

describe("TicketRepo.scanEmailWatchdog", () => {
  test("returns EMAIL_SENDING+SENT tickets whose email_last_attempt < cutoff", async () => {
    const e = em("wd");
    const idStuck = tid("WD_STUCK");
    const idFresh = tid("WD_FRESH");

    for (const id of [idStuck, idFresh]) {
      await backend.tickets.create({
        email: e, ticketId: id, filename: "f", s3_key: "k",
        mimeType: "application/pdf", contentType: "application/pdf",
        sizeBytes: 1, uploadedAt: NOW,
      });
      await backend.tickets.patch(e, id, {
        ticket_state: "EMAIL_SENDING", email_status: "SENT",
      });
    }
    // Stuck: last_attempt in the past.
    await backend.tickets.patch(e, idStuck, {
      email_last_attempt: "2020-01-01T00:00:00.000Z",
    });
    // Fresh: last_attempt in the future.
    await backend.tickets.patch(e, idFresh, {
      email_last_attempt: "2099-01-01T00:00:00.000Z",
    });

    const stuck = await backend.tickets.scanEmailWatchdog("2050-01-01T00:00:00.000Z");
    const ids = stuck.map((t) => t.ticketId);
    expect(ids).toContain(idStuck);
    expect(ids).not.toContain(idFresh);

    for (const id of [idStuck, idFresh]) {
      await raw.rawUpload._delete(`USER#${e}`, `RAW#${id}`);
      await delTicket(e, id);
    }
  });
});

// -----------------------------------------------------------------------------
// tickets.enumerateAllTicketIdsForUser
// -----------------------------------------------------------------------------

describe("TicketRepo.enumerateAllTicketIdsForUser", () => {
  test("dedupes across TICKET#, RAW#, RENDERED# rows and sorts", async () => {
    const e = em("enum");
    const idA = tid("EN_A");
    const idB = tid("EN_B");
    await backend.tickets.create({
      email: e, ticketId: idA, filename: "f", s3_key: "k",
      mimeType: "application/pdf", contentType: "application/pdf",
      sizeBytes: 1, uploadedAt: NOW,
    });
    await backend.tickets.createFromRoute({
      email: e, ticketId: idB,
      trainNr: "ICE10", date: "2026-08-01",
      fromStation: "Hbf", fromEva: 8000105,
      toStation: "Ost", toEva: 8000261,
      abfahrtszeit_plan: "10:00", ankunftszeit_plan: "12:00",
      fahrkartennummer: "F", fahrkartenpreis: "10",
      is_zeitkarte: false,
    });
    // Give idA a RENDERED sibling
    await backend.blobs.putRenderedPdf(e, idA, {
      s3_bucket: "b", s3_key: `rendered/${idA}.pdf`,
      size_bytes: 100, rendered_at: NOW,
    });

    const ids = await backend.tickets.enumerateAllTicketIdsForUser(e);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
    expect(new Set(ids).size).toBe(ids.length);

    // Cleanup
    await raw.rawUpload._delete(`USER#${e}`, `RAW#${idA}`);
    await raw.renderedPdf._delete(`USER#${e}`, `RENDERED#${idA}`);
    await delTicket(e, idA);
    await delTicket(e, idB);
  });
});

// -----------------------------------------------------------------------------
// tickets.anonymiseUserTickets
// -----------------------------------------------------------------------------

describe("TicketRepo.anonymiseUserTickets", () => {
  test("rewrites pk, strips PII + email pipeline, preserves state_timeline", async () => {
    const e = em("anon");
    const anonPk = `USER#sha256:${NS}anonhash`;
    const ids = [tid("AN1"), tid("AN2"), tid("AN3")];

    for (const id of ids) {
      await backend.tickets.create({
        email: e, ticketId: id, filename: "f", s3_key: "k",
        mimeType: "application/pdf", contentType: "application/pdf",
        sizeBytes: 1, uploadedAt: NOW,
      });
      // Seed PII + email pipeline
      await backend.tickets.patch(e, id, {
        ticket_state: "EMAIL_SENDING",
        email_status: "SENDING",
        email_attempts: 1,
        email_last_attempt: NOW,
        vorname_aus_ticket: "Max",
        nachname_aus_ticket: "Mustermann",
        fahrt_fahrkartennummer: "FK123",
        antragstellung_ort: "Berlin",
        antragstellung_datum: NOW,
        zusaetzliche_angaben: "notes",
      });
    }

    const result = await backend.tickets.anonymiseUserTickets(e, anonPk, LATER);
    expect(new Set(result.ticketIds)).toEqual(new Set(ids));

    // Original rows are gone
    for (const id of ids) {
      expect(await getRaw(e, id)).toBeNull();
    }

    // Anonymised rows exist under anonPk
    for (const id of ids) {
      const row = (await raw.ticket._get(anonPk, `TICKET#${id}`)).unwrap();
      expect(row).not.toBeNull();
      expect(row!["updated_at"]).toBe(LATER);
      expect(row!["ticket_state"]).toBe("EMAIL_SENDING");
      // state_timeline preserved
      expect(Array.isArray(row!["state_timeline"])).toBe(true);
      // PII removed
      expect(row!["vorname_aus_ticket"]).toBeUndefined();
      expect(row!["nachname_aus_ticket"]).toBeUndefined();
      expect(row!["fahrt_fahrkartennummer"]).toBeUndefined();
      expect(row!["antragstellung_ort"]).toBeUndefined();
      expect(row!["antragstellung_datum"]).toBeUndefined();
      expect(row!["zusaetzliche_angaben"]).toBeUndefined();
      // Email pipeline removed
      expect(row!["email_status"]).toBeUndefined();
      expect(row!["email_attempts"]).toBeUndefined();
      expect(row!["email_last_attempt"]).toBeUndefined();
      expect(row!["gsi_email_pending_pk"]).toBeUndefined();
      expect(row!["gsi_email_pending_sk"]).toBeUndefined();
    }

    // Cleanup
    for (const id of ids) {
      await raw.rawUpload._delete(`USER#${e}`, `RAW#${id}`);
      await raw.ticket._delete(anonPk, `TICKET#${id}`);
      await raw.ticketOwner._delete(`TICKET#${id}`, "OWNER");
    }
  });
});
