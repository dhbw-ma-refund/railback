// handler.spec.ts — end-to-end handler coverage.
//
// Asserts the cron entrypoint runs both passes, returns the aggregated
// summary, and isolates failures: a Pass A throw doesn't stop Pass B, and
// vice-versa.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@railback/lib/storage";
import { sha256Hex } from "@railback/lib/util/hash";
import { normaliseEmail, userPk, mandateSk } from "@railback/lib/storage/ddb/keys";

import { _setNow, handler } from "../src/handler.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import {
  getRawRow,
  seedMandate,
  seedTicketWithBlobs,
  seedUserActive,
  seedUserScheduledForDeletion,
  setTestNow,
} from "./fixtures.js";

const NOW = new Date("2026-06-26T12:00:00.000Z");

describe("handler", () => {
  beforeEach(() => {
    installTestEnv();
    _setNow(() => NOW);
    setTestNow(NOW.getTime());
  });
  afterEach(() => {
    setTestNow(null);
    _setNow(null);
    teardownTestEnv();
  });

  it("runs both passes and returns aggregated SweepResult", async () => {
    // Pass A: one user with a ticket + mandate.
    const { email: deletingUser } = await seedUserScheduledForDeletion({ email: "del@example.com" });
    const { ticketId: tA } = await seedTicketWithBlobs({ email: deletingUser });
    await seedMandate({ email: deletingUser, ticketId: tA });

    // Pass B: an active user with an expired ISSUED mandate.
    const { email: liveUser } = await seedUserActive({ email: "live@example.com" });
    const { ticketId: tB } = await seedTicketWithBlobs({ email: liveUser });
    await seedMandate({ email: liveUser, ticketId: tB, state: "ISSUED", expiresAtOffsetSec: -3600 });

    const result = await handler();

    expect(result.cascaded_users).toBe(1);
    expect(result.anonymised_tickets).toBe(1);
    expect(result.anonymised_mandates).toBe(1);
    expect(result.deleted_blobs).toBe(3); // raw + rendered + 1 beleg
    expect(result.expired_mandates).toBe(1);
  });

  it("single user qualifies for BOTH passes: Pass A's mandate anonymisation wins, no double-count", async () => {
    // The task spec calls out this race: "a ticket whose user is being
    // anonymised in Pass A whose mandate is also expired will be processed
    // by exactly one pass per invocation — Pass A's mandate anonymisation
    // wins". The locked invariant is that listExpiringISSUED skips
    // anonymised PKs, so Pass B (which runs second) sees nothing.
    const { email } = await seedUserScheduledForDeletion({ email: "both@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });
    // ISSUED + already-expired mandate: a candidate for both passes.
    await seedMandate({
      email,
      ticketId,
      state: "ISSUED",
      expiresAtOffsetSec: -3600,
      seedAuditTrail: true,
    });

    const result = await handler();

    // Pass A counted the mandate exactly once.
    expect(result.cascaded_users).toBe(1);
    expect(result.anonymised_mandates).toBe(1);
    // Pass B saw nothing — anonymised PKs are skipped by listExpiringISSUED.
    expect(result.expired_mandates).toBe(0);

    // The mandate now lives at the anonymised PK.
    expect(getRawRow(userPk(normaliseEmail(email)), mandateSk(ticketId))).toBeNull();
    const anonPk = `USER#sha256:${sha256Hex(normaliseEmail(email))}`;
    const anonMandate = getRawRow<Record<string, unknown>>(anonPk, mandateSk(ticketId));
    expect(anonMandate).not.toBeNull();
    // PII gone.
    expect(anonMandate!.iban_enc).toBeUndefined();
    // mandate_state preserved verbatim (Pass A doesn't flip it; Pass B
    // skipped the row). It's still ISSUED — that's correct for the 10y
    // archive (snapshot of the row at anonymisation time).
    expect(anonMandate!.mandate_state).toBe("ISSUED");
    // pain008 audit-trail survived.
    expect(anonMandate!.pain008_s3_key).toBeDefined();
  });

  it("Pass A throws internally → Pass B still runs and contributes its count", async () => {
    const { email: liveUser } = await seedUserActive({ email: "live2@example.com" });
    const { ticketId: tB } = await seedTicketWithBlobs({ email: liveUser });
    await seedMandate({ email: liveUser, ticketId: tB, state: "ISSUED", expiresAtOffsetSec: -3600 });

    // Force Pass A to blow up at the user scan.
    const spy = vi
      .spyOn(db().users, "scanDeletionScheduledExpired")
      .mockRejectedValueOnce(new Error("scan-explode"));

    const result = await handler();
    spy.mockRestore();

    expect(result.cascaded_users).toBe(0);
    expect(result.anonymised_tickets).toBe(0);
    expect(result.expired_mandates).toBe(1);
  });

  it("Pass B throws internally → Pass A's count stays in the summary", async () => {
    const { email } = await seedUserScheduledForDeletion({ email: "del3@example.com" });
    await seedTicketWithBlobs({ email });

    const spy = vi
      .spyOn(db().mandates, "listExpiringISSUED")
      .mockRejectedValueOnce(new Error("expire-explode"));

    const result = await handler();
    spy.mockRestore();

    expect(result.cascaded_users).toBe(1);
    expect(result.anonymised_tickets).toBe(1);
    expect(result.expired_mandates).toBe(0);
  });

  it("empty world → all counters zero", async () => {
    const result = await handler();
    expect(result).toEqual({
      cascaded_users: 0,
      anonymised_tickets: 0,
      anonymised_mandates: 0,
      deleted_templates: 0,
      deleted_blobs: 0,
      expired_mandates: 0,
    });
  });
});
