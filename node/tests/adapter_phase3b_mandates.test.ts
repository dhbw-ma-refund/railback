// Phase-3b unit tests for MandateRepo write-path adapter methods.
// Covers issue, markSubmitted/Debited/Reversed/Disputed/Expired/Cancelled,
// getByMandateId, listPendingBatches, listByBatchId, listExpiringISSUED,
// anonymiseUserMandates.

import { makeBackend, makeDb } from "./helpers.js";

const backend = makeBackend();
const raw = makeDb();

const NS = "m3b";
const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

function em(suffix: string) { return `${NS}.${suffix}@it.de`; }
function tid(suffix: string) { return `T_${NS}_${suffix}`; }

async function delMandate(email: string, id: string) {
  // Adapter normalises email to lowercase in the PK (F7 2026-07-08); match
  // that here so cleanup targets the row that was actually written.
  await raw.mandate._delete(`USER#${email.toLowerCase()}`, `TICKET#${id}#MANDATE`);
}

const baseMandate = () => ({
  ticketId: "unused-passed-explicitly-below",
  fee_amount: "0.75",
  iban_enc: "IBAN_ENC",
  bic_enc: "BIC_ENC",
  kontoinhaber_snapshot: "Max Mustermann",
  user_consent_at: NOW,
  user_consent_ip: "127.0.0.1",
  user_consent_user_agent: "jest",
  vorabankuendigung_sent_at: NOW,
});

// -----------------------------------------------------------------------------
// mandates.issue
// -----------------------------------------------------------------------------

describe("MandateRepo.issue", () => {
  test("creates a mandate with ISSUED state + ULID/UUID mandate_id + expires_at", async () => {
    const e = em("issue");
    const id = tid("ISS");
    const m = await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    expect(m.mandate_state).toBe("ISSUED");
    expect(m.sequence_type).toBe("OOFF");
    expect(m.mandate_id).toBeTruthy();
    expect(m.fee_amount).toBe("0.75");
    expect(m.issued_at).toBeTruthy();
    expect(m.expires_at).toBeTruthy();
    // expires_at ≈ issued_at + 36 months
    expect(Date.parse(m.expires_at) - Date.parse(m.issued_at)).toBeGreaterThan(0);

    const got = await backend.mandates.get(e, id);
    expect(got).not.toBeNull();
    expect(got!.mandate_state).toBe("ISSUED");
    await delMandate(e, id);
  });

  test("conflict on duplicate issue → AdapterError ERR_CONFLICT", async () => {
    const e = em("issue.dup");
    const id = tid("DUP");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await expect(
      backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id }),
    ).rejects.toMatchObject({ code: "ERR_CONFLICT" });
    await delMandate(e, id);
  });
});

// -----------------------------------------------------------------------------
// Mandate state-machine transitions (each transition + wrong-prev conflict)
// -----------------------------------------------------------------------------

describe("MandateRepo state-machine transitions", () => {
  test("markSubmitted ISSUED → SUBMITTED", async () => {
    const e = em("mkSubmitted");
    const id = tid("SUB");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await backend.mandates.markSubmitted(e, id, NOW);
    const m = await backend.mandates.get(e, id);
    expect(m!.mandate_state).toBe("SUBMITTED");
    expect((m as unknown as Record<string, unknown>)["pain008_submitted_at"]).toBe(NOW);
    await delMandate(e, id);
  });

  test("markSubmitted on wrong prev-state throws ERR_CONFLICT", async () => {
    const e = em("mkSubmittedBad");
    const id = tid("SUBBAD");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await backend.mandates.markSubmitted(e, id, NOW);
    // Now in SUBMITTED — calling again should fail (prev != ISSUED)
    await expect(backend.mandates.markSubmitted(e, id, NOW)).rejects.toMatchObject({
      code: "ERR_CONFLICT",
    });
    await delMandate(e, id);
  });

  test("markDebited SUBMITTED → DEBITED", async () => {
    const e = em("mkDebited");
    const id = tid("DEB");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await backend.mandates.markSubmitted(e, id, NOW);
    await backend.mandates.markDebited(e, id, LATER);
    const m = await backend.mandates.get(e, id);
    expect(m!.mandate_state).toBe("DEBITED");
    expect(m!.debited_at).toBe(LATER);
    await delMandate(e, id);
  });

  test("markDebited from ISSUED throws ERR_CONFLICT (wrong prev)", async () => {
    const e = em("mkDebitedBad");
    const id = tid("DEBBAD");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await expect(backend.mandates.markDebited(e, id, NOW)).rejects.toMatchObject({
      code: "ERR_CONFLICT",
    });
    await delMandate(e, id);
  });

  test("markReversed DEBITED → REVERSED", async () => {
    const e = em("mkReversed");
    const id = tid("REV");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await backend.mandates.markSubmitted(e, id, NOW);
    await backend.mandates.markDebited(e, id, NOW);
    await backend.mandates.markReversed(e, id, { reversedAt: LATER, reason: "MS03" });
    const m = await backend.mandates.get(e, id);
    expect(m!.mandate_state).toBe("REVERSED");
    expect(m!.reversed_reason).toBe("MS03");
    expect(m!.reversed_at).toBe(LATER);
    await delMandate(e, id);
  });

  test("markReversed from ISSUED throws ERR_CONFLICT", async () => {
    const e = em("mkReversedBad");
    const id = tid("REVBAD");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await expect(
      backend.mandates.markReversed(e, id, { reversedAt: NOW, reason: "x" }),
    ).rejects.toMatchObject({ code: "ERR_CONFLICT" });
    await delMandate(e, id);
  });

  test("markDisputed valid from DEBITED / SUBMITTED / REVERSED", async () => {
    // From SUBMITTED
    const e1 = em("mkDisputedSub");
    const id1 = tid("DISPSUB");
    await backend.mandates.issue(e1, id1, { ...baseMandate(), ticketId: id1 });
    await backend.mandates.markSubmitted(e1, id1, NOW);
    await backend.mandates.markDisputed(e1, id1, LATER);
    expect((await backend.mandates.get(e1, id1))!.mandate_state).toBe("DISPUTED");
    await delMandate(e1, id1);

    // From DEBITED
    const e2 = em("mkDisputedDeb");
    const id2 = tid("DISPDEB");
    await backend.mandates.issue(e2, id2, { ...baseMandate(), ticketId: id2 });
    await backend.mandates.markSubmitted(e2, id2, NOW);
    await backend.mandates.markDebited(e2, id2, NOW);
    await backend.mandates.markDisputed(e2, id2, LATER);
    expect((await backend.mandates.get(e2, id2))!.mandate_state).toBe("DISPUTED");
    await delMandate(e2, id2);

    // From REVERSED
    const e3 = em("mkDisputedRev");
    const id3 = tid("DISPREV");
    await backend.mandates.issue(e3, id3, { ...baseMandate(), ticketId: id3 });
    await backend.mandates.markSubmitted(e3, id3, NOW);
    await backend.mandates.markDebited(e3, id3, NOW);
    await backend.mandates.markReversed(e3, id3, { reversedAt: NOW, reason: "MS03" });
    await backend.mandates.markDisputed(e3, id3, LATER);
    expect((await backend.mandates.get(e3, id3))!.mandate_state).toBe("DISPUTED");
    await delMandate(e3, id3);
  });

  test("markDisputed from ISSUED throws ERR_CONFLICT", async () => {
    const e = em("mkDisputedBad");
    const id = tid("DISPBAD");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await expect(backend.mandates.markDisputed(e, id, NOW)).rejects.toMatchObject({
      code: "ERR_CONFLICT",
    });
    await delMandate(e, id);
  });

  test("markExpired ISSUED → EXPIRED", async () => {
    const e = em("mkExpired");
    const id = tid("EXP");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await backend.mandates.markExpired(e, id);
    expect((await backend.mandates.get(e, id))!.mandate_state).toBe("EXPIRED");
    await delMandate(e, id);
  });

  test("markExpired from SUBMITTED throws ERR_CONFLICT", async () => {
    const e = em("mkExpiredBad");
    const id = tid("EXPBAD");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await backend.mandates.markSubmitted(e, id, NOW);
    await expect(backend.mandates.markExpired(e, id)).rejects.toMatchObject({
      code: "ERR_CONFLICT",
    });
    await delMandate(e, id);
  });

  test("markCancelled valid from ISSUED and SUBMITTED", async () => {
    const eA = em("mkCancIss");
    const idA = tid("CANI");
    await backend.mandates.issue(eA, idA, { ...baseMandate(), ticketId: idA });
    await backend.mandates.markCancelled(eA, idA);
    expect((await backend.mandates.get(eA, idA))!.mandate_state).toBe("CANCELLED");
    await delMandate(eA, idA);

    const eB = em("mkCancSub");
    const idB = tid("CANS");
    await backend.mandates.issue(eB, idB, { ...baseMandate(), ticketId: idB });
    await backend.mandates.markSubmitted(eB, idB, NOW);
    await backend.mandates.markCancelled(eB, idB);
    expect((await backend.mandates.get(eB, idB))!.mandate_state).toBe("CANCELLED");
    await delMandate(eB, idB);
  });

  test("markCancelled from DEBITED throws ERR_CONFLICT", async () => {
    const e = em("mkCancBad");
    const id = tid("CANBAD");
    await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    await backend.mandates.markSubmitted(e, id, NOW);
    await backend.mandates.markDebited(e, id, NOW);
    await expect(backend.mandates.markCancelled(e, id)).rejects.toMatchObject({
      code: "ERR_CONFLICT",
    });
    await delMandate(e, id);
  });
});

// -----------------------------------------------------------------------------
// mandates.getByMandateId
// -----------------------------------------------------------------------------

describe("MandateRepo.getByMandateId", () => {
  test("finds by mandate_id and returns null for unknown", async () => {
    const e = em("byId");
    const id = tid("BYID");
    const issued = await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    const got = await backend.mandates.getByMandateId(issued.mandate_id);
    expect(got).not.toBeNull();
    // Email is normalised (trim + lowercase) before being stored in the PK.
    // See F7 (2026-07-08) — the adapter now matches the backend's
    // normaliseEmail contract to avoid partition-splits on mixed-case input.
    expect(got!.email).toBe(e.toLowerCase());
    expect(got!.ticketId).toBe(id);

    expect(await backend.mandates.getByMandateId("does-not-exist")).toBeNull();
    await delMandate(e, id);
  });

  test("skips USER#sha256: anonymised partitions", async () => {
    const anonPk = `USER#sha256:${NS}mandanon`;
    const id = tid("BYID_ANON");
    const mandateId = "hidden-mandate-id-XYZ";
    await raw.mandate.put({
      pk: anonPk, sk: `TICKET#${id}#MANDATE`,
      mandate_id: mandateId, mandate_state: "ISSUED",
      fee_amount: "0.75",
      issued_at: NOW, expires_at: LATER, sequence_type: "OOFF",
    });
    expect(await backend.mandates.getByMandateId(mandateId)).toBeNull();
    await raw.mandate._delete(anonPk, `TICKET#${id}#MANDATE`);
  });
});

// -----------------------------------------------------------------------------
// mandates.listPendingBatches
// -----------------------------------------------------------------------------

describe("MandateRepo.listPendingBatches", () => {
  test("returns ISSUED mandates with pain008_built_at set and pain008_submitted_at absent", async () => {
    const e = em("pending");
    const idReady = tid("PENDR");
    const idNotBuilt = tid("PENDN");
    const idAlreadyDone = tid("PENDD");

    // Ready: ISSUED + built_at set + submitted_at absent
    await backend.mandates.issue(e, idReady, { ...baseMandate(), ticketId: idReady });
    await raw.mandate._updateWithRemove(
      `USER#${e}`, `TICKET#${idReady}#MANDATE`,
      { pain008_built_at: NOW, pain008_batch_id: "B1" },
    );

    // Not-built: ISSUED, no built_at
    await backend.mandates.issue(e, idNotBuilt, { ...baseMandate(), ticketId: idNotBuilt });

    // Already-done: ISSUED but submitted_at set
    await backend.mandates.issue(e, idAlreadyDone, { ...baseMandate(), ticketId: idAlreadyDone });
    await raw.mandate._updateWithRemove(
      `USER#${e}`, `TICKET#${idAlreadyDone}#MANDATE`,
      { pain008_built_at: NOW, pain008_submitted_at: LATER },
    );

    const pending = await backend.mandates.listPendingBatches();
    const ids = pending.map((m) => m.ticketId);
    expect(ids).toContain(idReady);
    expect(ids).not.toContain(idNotBuilt);
    expect(ids).not.toContain(idAlreadyDone);

    await delMandate(e, idReady);
    await delMandate(e, idNotBuilt);
    await delMandate(e, idAlreadyDone);
  });
});

// -----------------------------------------------------------------------------
// mandates.listByBatchId
// -----------------------------------------------------------------------------

describe("MandateRepo.listByBatchId", () => {
  test("returns only mandates with matching pain008_batch_id", async () => {
    const e = em("byBatch");
    const norm = e.toLowerCase();
    const idA = tid("BA");
    const idB = tid("BB");
    for (const id of [idA, idB]) {
      await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    }
    // Direct raw writes go through BaseConnector — supply the normalised pk
    // so we hit the row that `mandates.issue` actually wrote (F7).
    await raw.mandate._updateWithRemove(
      `USER#${norm}`, `TICKET#${idA}#MANDATE`,
      { pain008_batch_id: `BATCH_${NS}_1`, pain008_built_at: NOW },
    );
    await raw.mandate._updateWithRemove(
      `USER#${norm}`, `TICKET#${idB}#MANDATE`,
      { pain008_batch_id: `BATCH_${NS}_2`, pain008_built_at: NOW },
    );

    const batch1 = await backend.mandates.listByBatchId(`BATCH_${NS}_1`);
    const ids1 = batch1.map((m) => m.ticketId);
    expect(ids1).toContain(idA);
    expect(ids1).not.toContain(idB);

    await delMandate(e, idA);
    await delMandate(e, idB);
  });
});

// -----------------------------------------------------------------------------
// mandates.listExpiringISSUED
// -----------------------------------------------------------------------------

describe("MandateRepo.listExpiringISSUED", () => {
  test("returns ISSUED mandates whose expires_at < now", async () => {
    const e = em("expiring");
    const idPast = tid("EXPP");
    const idFuture = tid("EXPF");
    await backend.mandates.issue(e, idPast, { ...baseMandate(), ticketId: idPast });
    await backend.mandates.issue(e, idFuture, { ...baseMandate(), ticketId: idFuture });
    // Force idPast expires_at into the past
    await raw.mandate._updateWithRemove(
      `USER#${e}`, `TICKET#${idPast}#MANDATE`,
      { expires_at: "2020-01-01T00:00:00.000Z" },
    );
    const out = await backend.mandates.listExpiringISSUED("2026-06-01T00:00:00.000Z");
    const ids = out.map((m) => m.ticketId);
    expect(ids).toContain(idPast);
    expect(ids).not.toContain(idFuture);
    await delMandate(e, idPast);
    await delMandate(e, idFuture);
  });
});

// -----------------------------------------------------------------------------
// mandates.anonymiseUserMandates
// -----------------------------------------------------------------------------

describe("MandateRepo.anonymiseUserMandates", () => {
  test("rewrites pk, strips PII, returns count", async () => {
    const e = em("anon");
    const anonPk = `USER#sha256:${NS}mandanon2`;
    const ids = [tid("MA1"), tid("MA2"), tid("MA3")];
    for (const id of ids) {
      await backend.mandates.issue(e, id, { ...baseMandate(), ticketId: id });
    }

    const result = await backend.mandates.anonymiseUserMandates(e, anonPk);
    expect(result.count).toBe(ids.length);

    // Original rows are gone
    for (const id of ids) {
      expect((await raw.mandate._get(`USER#${e}`, `TICKET#${id}#MANDATE`)).unwrap()).toBeNull();
    }

    // Anonymised rows exist under anonPk with PII stripped
    for (const id of ids) {
      const row = (await raw.mandate._get(anonPk, `TICKET#${id}#MANDATE`)).unwrap();
      expect(row).not.toBeNull();
      expect(row!["iban_enc"]).toBeUndefined();
      expect(row!["bic_enc"]).toBeUndefined();
      expect(row!["kontoinhaber_snapshot"]).toBeUndefined();
      expect(row!["user_consent_ip"]).toBeUndefined();
      expect(row!["user_consent_user_agent"]).toBeUndefined();
      // Non-PII survives
      expect(row!["mandate_state"]).toBe("ISSUED");
      expect(row!["mandate_id"]).toBeTruthy();
    }

    // Cleanup
    for (const id of ids) {
      await raw.mandate._delete(anonPk, `TICKET#${id}#MANDATE`);
    }
  });

  test("no-op returns count=0 when user has no mandates", async () => {
    const e = em("anon.empty");
    const result = await backend.mandates.anonymiseUserMandates(
      e, `USER#sha256:${NS}empty`,
    );
    expect(result.count).toBe(0);
  });
});
