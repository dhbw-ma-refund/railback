// expire-mandates.spec.ts — Pass B coverage.
//
// Asserts the mandate-expiry pass flips ISSUED-and-past-expires mandates to
// EXPIRED + mirrors service_fee_state=WAIVED, leaves non-ISSUED mandates
// (SUBMITTED, DEBITED, REVERSED, DISPUTED, EXPIRED, CANCELLED) and
// not-yet-expired ISSUED mandates alone, handles orphan mandates without
// throwing, skips anonymised-PK rows, and is idempotent across re-runs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@railback/lib/storage";
import { sha256Hex } from "@railback/lib/util/hash";
import { normaliseEmail, mandateSk } from "@railback/lib/storage/ddb/keys";

import { _activeMemState } from "@railback/mocks-in-memory";

import { runExpireMandatesPass } from "../src/expire-mandates.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import {
  seedMandate,
  seedTicketWithBlobs,
  seedUserActive,
  setTestNow,
} from "./fixtures.js";

import type { MandateState } from "@railback/lib/types/enums";
import type { SepaMandateItem } from "@railback/lib/types/items";

const NOW = new Date("2026-06-26T12:00:00.000Z");

describe("runExpireMandatesPass", () => {
  beforeEach(() => {
    installTestEnv();
    setTestNow(NOW.getTime());
  });
  afterEach(() => {
    setTestNow(null);
    teardownTestEnv();
  });

  it("ISSUED + expired → EXPIRED, ticket service_fee_state=WAIVED", async () => {
    const { email } = await seedUserActive({ email: "a@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });
    await seedMandate({ email, ticketId, state: "ISSUED", expiresAtOffsetSec: -3600 });

    const result = await runExpireMandatesPass({ now: NOW });
    expect(result.expired_mandates).toBe(1);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate!.mandate_state).toBe("EXPIRED");

    const ticket = await db().tickets.get(email, ticketId);
    expect(ticket!.service_fee_state).toBe("WAIVED");
  });

  // listExpiringISSUED filters on state="ISSUED" — every other state must
  // be untouched even when expires_at is in the past. Parametrised so a
  // future broadening of the state filter (regression risk) breaks loudly.
  const NON_ISSUED_STATES: MandateState[] = [
    "SUBMITTED",
    "DEBITED",
    "REVERSED",
    "DISPUTED",
    "EXPIRED",
    "CANCELLED",
  ];
  for (const state of NON_ISSUED_STATES) {
    it(`${state} with past expires_at → untouched`, async () => {
      const { email } = await seedUserActive({ email: `${state.toLowerCase()}@example.com` });
      const { ticketId } = await seedTicketWithBlobs({ email });
      await seedMandate({ email, ticketId, state, expiresAtOffsetSec: -3600 });

      const result = await runExpireMandatesPass({ now: NOW });
      expect(result.expired_mandates).toBe(0);

      const mandate = await db().mandates.get(email, ticketId);
      expect(mandate!.mandate_state).toBe(state);
    });
  }

  it("ISSUED with future expires_at → untouched", async () => {
    const { email } = await seedUserActive({ email: "c@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });
    await seedMandate({ email, ticketId, state: "ISSUED", expiresAtOffsetSec: 3600, nowMs: NOW.getTime() });

    const result = await runExpireMandatesPass({ now: NOW });
    expect(result.expired_mandates).toBe(0);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate!.mandate_state).toBe("ISSUED");
  });

  it("orphan mandate (ticket missing) → mandate still flips, no throw, log.warn", async () => {
    const { email } = await seedUserActive({ email: "d@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });
    await seedMandate({ email, ticketId, state: "ISSUED", expiresAtOffsetSec: -3600 });
    // Hard-delete the ticket so the mirror patch throws ERR_NOT_FOUND.
    await db().tickets.delete(email, ticketId);

    const result = await runExpireMandatesPass({ now: NOW });
    expect(result.expired_mandates).toBe(1);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate!.mandate_state).toBe("EXPIRED");
  });

  it("markExpired itself throws → mandate stays ISSUED, counter does not increment", async () => {
    // Outer try/catch on the per-mandate loop. Covers the failure path
    // where listExpiringISSUED returned a mandate but markExpired blew
    // up (e.g., row deleted between scan and update — TTL race).
    const { email } = await seedUserActive({ email: "markfail@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });
    await seedMandate({ email, ticketId, state: "ISSUED", expiresAtOffsetSec: -3600 });

    const spy = vi
      .spyOn(db().mandates, "markExpired")
      .mockRejectedValueOnce(new Error("simulated markExpired failure"));

    const result = await runExpireMandatesPass({ now: NOW });
    spy.mockRestore();

    expect(result.expired_mandates).toBe(0);
    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate!.mandate_state).toBe("ISSUED");
  });

  it("transient ticket.patch failure → mandate stays ISSUED, counter=0; retry on next call flips it", async () => {
    // Locked ordering: patch ticket FIRST. If patch throws a non-NOT_FOUND
    // error, we MUST skip markExpired this tick — otherwise the mandate
    // would flip to EXPIRED and listExpiringISSUED would never surface it
    // again, leaving the ticket without WAIVED forever. Second clean run
    // (without the spy) must complete the flip.
    const { email } = await seedUserActive({ email: "patchfail@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });
    await seedMandate({ email, ticketId, state: "ISSUED", expiresAtOffsetSec: -3600 });

    const spy = vi
      .spyOn(db().tickets, "patch")
      .mockRejectedValueOnce(new Error("transient"));

    const r1 = await runExpireMandatesPass({ now: NOW });
    expect(r1.expired_mandates).toBe(0);

    let mandate = await db().mandates.get(email, ticketId);
    expect(mandate!.mandate_state).toBe("ISSUED");
    let ticket = await db().tickets.get(email, ticketId);
    expect(ticket!.service_fee_state).not.toBe("WAIVED");

    // Spy was mockRejectedValueOnce — subsequent calls go through.
    spy.mockRestore();

    const r2 = await runExpireMandatesPass({ now: NOW });
    expect(r2.expired_mandates).toBe(1);

    mandate = await db().mandates.get(email, ticketId);
    expect(mandate!.mandate_state).toBe("EXPIRED");
    ticket = await db().tickets.get(email, ticketId);
    expect(ticket!.service_fee_state).toBe("WAIVED");
  });

  it("anonymised-PK mandate (USER#sha256:…) skipped by listExpiringISSUED", async () => {
    // Anonymised mandate rows are the 10y-archive artefact. They must
    // not re-enter the expiry pipeline — markExpired + service_fee_state
    // mirror on an anonymised row mutates an artefact that is
    // contractually immutable.
    const { email } = await seedUserActive({ email: "anon@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });
    await seedMandate({ email, ticketId, state: "ISSUED", expiresAtOffsetSec: -3600 });

    // Simulate an already-anonymised mandate by relocating the row to a
    // sha256-PK directly.
    const state = _activeMemState();
    if (!state) throw new Error("memory backend not initialised");
    const liveBucket = state.rows.get(`USER#${normaliseEmail(email)}`);
    expect(liveBucket).toBeDefined();
    const sk = mandateSk(ticketId);
    const mandateItem = liveBucket!.get(sk) as SepaMandateItem;
    expect(mandateItem).toBeDefined();
    liveBucket!.delete(sk);
    const anonPk = `USER#sha256:${sha256Hex(normaliseEmail(email))}`;
    let anonBucket = state.rows.get(anonPk);
    if (!anonBucket) {
      anonBucket = new Map();
      state.rows.set(anonPk, anonBucket);
    }
    anonBucket.set(sk, { ...mandateItem, PK: anonPk });

    const result = await runExpireMandatesPass({ now: NOW });
    expect(result.expired_mandates).toBe(0);

    // Mandate state at the anonymised PK is still ISSUED — not touched.
    const anonRow = anonBucket.get(sk) as SepaMandateItem;
    expect(anonRow.mandate_state).toBe("ISSUED");
  });

  it("idempotent: re-run does not re-process EXPIRED mandates", async () => {
    const { email } = await seedUserActive({ email: "e@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });
    await seedMandate({ email, ticketId, state: "ISSUED", expiresAtOffsetSec: -3600 });

    const r1 = await runExpireMandatesPass({ now: NOW });
    expect(r1.expired_mandates).toBe(1);

    const r2 = await runExpireMandatesPass({ now: NOW });
    expect(r2.expired_mandates).toBe(0);
  });

  it("multiple expired mandates → all flip in one pass", async () => {
    const { email } = await seedUserActive({ email: "f@example.com" });
    const { ticketId: t1 } = await seedTicketWithBlobs({ email });
    const { ticketId: t2 } = await seedTicketWithBlobs({ email });
    await seedMandate({ email, ticketId: t1, state: "ISSUED", expiresAtOffsetSec: -7200 });
    await seedMandate({ email, ticketId: t2, state: "ISSUED", expiresAtOffsetSec: -3600 });

    const result = await runExpireMandatesPass({ now: NOW });
    expect(result.expired_mandates).toBe(2);

    expect((await db().mandates.get(email, t1))!.mandate_state).toBe("EXPIRED");
    expect((await db().mandates.get(email, t2))!.mandate_state).toBe("EXPIRED");
  });
});

