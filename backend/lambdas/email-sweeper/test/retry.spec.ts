// retry.spec.ts — Pass A coverage.
//
// Each test runs runRetryPass against a hand-seeded in-memory db with a
// scripted SES mock, then asserts the ticket landed in the expected branch
// of the decision tree.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@railback/lib/storage";
import { _setSesClient } from "@railback/lib/email/send-email";

import { runRetryPass } from "../src/retry.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import {
  BOB_EMAIL,
  installSesMock,
  seedRetryTicket,
} from "./fixtures.js";

const NOW = new Date("2026-06-26T12:00:00.000Z");

describe("runRetryPass", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    _setSesClient(null);
    teardownTestEnv();
  });

  it("SES 2xx → email_status=SENT, attempts++, provider_id set, GSI cleared", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 1,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    installSesMock({
      responses: [{ kind: "ok", messageId: "ses-retry-ok" }],
    });

    const result = await runRetryPass({ now: NOW });
    expect(result.retried).toBe(1);

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_SENDING");
    expect(after!.email_status).toBe("SENT");
    expect(after!.email_attempts).toBe(2);
    expect(after!.email_provider_id).toBe("ses-retry-ok");
    expect(after!.email_failed_reason).toBeUndefined();

    // GSI cleared — querying the retry queue again returns 0 entries.
    const requeue = await db().tickets.queryEmailPending(50);
    expect(requeue).toHaveLength(0);
  });

  it("transient SES failure at attempts=1 → FAILED_TRANSIENT, attempts=2, stays in queue", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 1,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    installSesMock({
      responses: [{ kind: "throw", name: "TimeoutError", message: "socket hang up" }],
    });

    await runRetryPass({ now: NOW });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_SENDING");
    expect(after!.email_status).toBe("FAILED_TRANSIENT");
    expect(after!.email_attempts).toBe(2);
    // FAILED_TRANSIENT must not carry a failed_reason (reserved for terminal).
    expect(after!.email_failed_reason).toBeUndefined();

    const requeue = await db().tickets.queryEmailPending(50);
    expect(requeue.map((t) => t.ticketId)).toContain(ticketId);
  });

  it("transient SES failure at attempts=2 → terminal EMAIL_FAILED, attempts=3, reason=max_retries", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 2,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    installSesMock({
      responses: [{ kind: "throw", name: "ThrottlingException", message: "rate-limit" }],
    });

    await runRetryPass({ now: NOW });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("FAILED");
    expect(after!.email_attempts).toBe(3);
    expect(after!.email_failed_reason).toBe("max_retries");

    const requeue = await db().tickets.queryEmailPending(50);
    expect(requeue).toHaveLength(0);
  });

  it("permanent SES failure → terminal EMAIL_FAILED + reason=max_retries, no waiting for 3rd attempt", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 1,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    installSesMock({
      responses: [{ kind: "throw", name: "MailFromDomainNotVerifiedException", message: "verify-the-domain" }],
    });

    await runRetryPass({ now: NOW });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("FAILED");
    expect(after!.email_attempts).toBe(2);
    // Permanent rejection is bucketed as `max_retries` per DB_SCHEMA.md:182
    // (SES never accepted = same enum bucket). The raw SES error name lives
    // in the structured log, not on the ticket row. attempts is 2, not 3 —
    // permanent means we stop early.
    expect(after!.email_failed_reason).toBe("max_retries");
    expect(after!.email_last_attempt).toBe(NOW.toISOString());
  });

  it("oldest-first ordering: SES calls happen in ascending email_last_attempt order", async () => {
    // Seed three tickets in non-chrono order.
    const seedA = await seedRetryTicket({
      ticketId: "ticket-A",
      lastAttemptIso: "2026-06-26T10:30:00.000Z",
      attempts: 1,
    });
    const seedB = await seedRetryTicket({
      ticketId: "ticket-B",
      lastAttemptIso: "2026-06-26T10:00:00.000Z",
      attempts: 1,
    });
    const seedC = await seedRetryTicket({
      ticketId: "ticket-C",
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
      attempts: 1,
    });
    expect(seedA.email).toBe(BOB_EMAIL);
    expect(seedB.email).toBe(BOB_EMAIL);
    expect(seedC.email).toBe(BOB_EMAIL);

    const sesState = installSesMock({
      responses: [
        { kind: "ok", messageId: "msg-1" },
        { kind: "ok", messageId: "msg-2" },
        { kind: "ok", messageId: "msg-3" },
      ],
    });

    const result = await runRetryPass({ now: NOW });
    expect(result.retried).toBe(3);

    // Order: B (10:00) → A (10:30) → C (11:00)
    expect(sesState.calls.map((c) => c.ticketId)).toEqual([
      "ticket-B",
      "ticket-A",
      "ticket-C",
    ]);
  });

  it("ticket left the queue between Query and re-load → SKIPPED with no SES call", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 1,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    const sesState = installSesMock({ responses: [{ kind: "ok", messageId: "should-not-happen" }] });

    // Race: queryEmailPending returns the ticket (it's still in the queue at
    // that point), but between Query and the per-ticket re-load, the webhook
    // flipped the ticket. We simulate that with a one-shot tickets.get spy
    // that returns a mutated ticket on the next call, then restores.
    const realGet = db().tickets.get.bind(db().tickets);
    const spy = vi
      .spyOn(db().tickets, "get")
      .mockImplementationOnce(async (e: string, id: string) => {
        const t = await realGet(e, id);
        if (!t) return null;
        return { ...t, ticket_state: "PENDING_DB_PAYMENT", email_status: "DELIVERED" };
      });

    await runRetryPass({ now: NOW });
    spy.mockRestore();

    expect(sesState.callCount).toBe(0);
    // The ticket in the actual store is untouched (we mocked the read, not
    // the write). Sweeper never patched it.
    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_SENDING");
    expect(after!.email_status).toBe("FAILED_TRANSIENT");
  });

  it("missing rendered-PDF metadata row → terminal EMAIL_FAILED + reason=render_missing, no SES call", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 1,
      noRenderedPdf: true,
    });
    const sesState = installSesMock({ responses: [{ kind: "ok", messageId: "should-not-happen" }] });

    await runRetryPass({ now: NOW });

    expect(sesState.callCount).toBe(0);
    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("FAILED");
    expect(after!.email_failed_reason).toBe("render_missing");
  });

  it("missing rendered-PDF bytes (metadata exists) → terminal EMAIL_FAILED + reason=render_missing", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 1,
      noRenderedBytes: true,
    });
    const sesState = installSesMock({ responses: [{ kind: "ok", messageId: "should-not-happen" }] });

    await runRetryPass({ now: NOW });

    expect(sesState.callCount).toBe(0);
    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_failed_reason).toBe("render_missing");
  });

  it("multiple tickets in one pass; one fails internally — the rest still process", async () => {
    const seedA = await seedRetryTicket({
      ticketId: "ticket-A",
      lastAttemptIso: "2026-06-26T10:00:00.000Z",
      attempts: 1,
    });
    const seedB = await seedRetryTicket({
      ticketId: "ticket-B",
      lastAttemptIso: "2026-06-26T10:30:00.000Z",
      attempts: 1,
      noRenderedPdf: true, // forces render_missing branch
    });
    const seedC = await seedRetryTicket({
      ticketId: "ticket-C",
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
      attempts: 1,
    });
    expect(seedA.email).toBe(BOB_EMAIL);
    expect(seedB.email).toBe(BOB_EMAIL);
    expect(seedC.email).toBe(BOB_EMAIL);

    installSesMock({
      responses: [
        { kind: "ok", messageId: "msg-A" },
        { kind: "ok", messageId: "msg-C" },
      ],
    });

    const result = await runRetryPass({ now: NOW });
    expect(result.retried).toBe(3);

    const a = await db().tickets.get(BOB_EMAIL, "ticket-A");
    const b = await db().tickets.get(BOB_EMAIL, "ticket-B");
    const c = await db().tickets.get(BOB_EMAIL, "ticket-C");
    expect(a!.email_status).toBe("SENT");
    expect(b!.email_status).toBe("FAILED");
    expect(b!.email_failed_reason).toBe("render_missing");
    expect(c!.email_status).toBe("SENT");
  });

  it("respects the limit parameter", async () => {
    await seedRetryTicket({
      ticketId: "limit-A",
      lastAttemptIso: "2026-06-26T10:00:00.000Z",
      attempts: 1,
    });
    await seedRetryTicket({
      ticketId: "limit-B",
      lastAttemptIso: "2026-06-26T10:30:00.000Z",
      attempts: 1,
    });
    await seedRetryTicket({
      ticketId: "limit-C",
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
      attempts: 1,
    });

    const sesState = installSesMock({
      responses: [
        { kind: "ok", messageId: "msg-1" },
        { kind: "ok", messageId: "msg-2" },
      ],
    });

    const result = await runRetryPass({ now: NOW, limit: 2 });
    expect(result.retried).toBe(2);
    expect(sesState.callCount).toBe(2);
    expect(sesState.calls.map((c) => c.ticketId)).toEqual(["limit-A", "limit-B"]);
  });

  // ─── Coverage additions from review round ───────────────────────────────

  it("retries a SENDING ticket (refund-pdf crashed pre-SES) — same outcome as FAILED_TRANSIENT", async () => {
    // A SENDING-status ticket means refund-pdf flipped the state but crashed
    // before SES returned. The retry path treats SENDING and FAILED_TRANSIENT
    // identically — both are retry-eligible per retry.ts line 88.
    const { email, ticketId } = await seedRetryTicket({
      status: "SENDING",
      attempts: 0,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    const sesState = installSesMock({
      responses: [{ kind: "ok", messageId: "ses-recovered" }],
    });

    await runRetryPass({ now: NOW });
    expect(sesState.callCount).toBe(1);

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_status).toBe("SENT");
    expect(after!.email_attempts).toBe(1);
    expect(after!.email_provider_id).toBe("ses-recovered");
    expect(after!.email_last_attempt).toBe(NOW.toISOString());
  });

  it("orphan ticket — user row gone (anonymisation race) → terminal+render_missing, no SES call", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 1,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    // Simulate the anonymisation race by deleting the user row out from
    // under the still-queued ticket. The user repo doesn't expose a delete
    // helper for our test seam, so spy getByEmail to return null on the
    // sweeper's lookup.
    vi.spyOn(db().users, "getByEmail").mockResolvedValueOnce(null);

    const sesState = installSesMock({ responses: [{ kind: "ok", messageId: "should-not-happen" }] });

    await runRetryPass({ now: NOW });

    expect(sesState.callCount).toBe(0);
    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("FAILED");
    expect(after!.email_failed_reason).toBe("render_missing");
  });

  it("SES 2xx — email_last_attempt is overwritten to nowIso", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 1,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    installSesMock({ responses: [{ kind: "ok", messageId: "ses-stamp" }] });

    await runRetryPass({ now: NOW });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_last_attempt).toBe(NOW.toISOString());
  });

  it("transient — email_last_attempt is refreshed (keeps the ticket in the queue ordered correctly)", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 1,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    installSesMock({
      responses: [{ kind: "throw", name: "TimeoutError", message: "socket hang up" }],
    });

    await runRetryPass({ now: NOW });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_last_attempt).toBe(NOW.toISOString());
  });

  it("transient-maxed terminal — email_last_attempt is refreshed", async () => {
    const { email, ticketId } = await seedRetryTicket({
      attempts: 2,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    installSesMock({
      responses: [{ kind: "throw", name: "ThrottlingException", message: "rate-limit" }],
    });

    await runRetryPass({ now: NOW });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_last_attempt).toBe(NOW.toISOString());
  });

  it("defensive budget-exhausted branch: ticket with attempts=3 leaked into the queue → terminal+max_retries, no SES call", async () => {
    // The GSI write-side filter prevents attempts=3 from ever appearing in
    // queryEmailPending, so we force the situation by intercepting the
    // queue read and injecting a hand-crafted ticket. Mirrors the real-DDB
    // failure mode where the GSI write was stale.
    const { email, ticketId } = await seedRetryTicket({
      attempts: 1,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    // Bump attempts to 3 directly without going through the patch (which
    // would clear the GSI key via toItem).
    await db().tickets.patch(email, ticketId, { email_attempts: 3 });
    // Force-inject the now-budget-exhausted ticket as if the GSI returned it.
    const injected = await db().tickets.get(email, ticketId);
    vi.spyOn(db().tickets, "queryEmailPending").mockResolvedValueOnce([injected!]);

    const sesState = installSesMock({ responses: [{ kind: "ok", messageId: "should-not-happen" }] });

    await runRetryPass({ now: NOW });

    expect(sesState.callCount).toBe(0);
    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("FAILED");
    expect(after!.email_failed_reason).toBe("max_retries");
  });

  it("per-ticket throw is swallowed; later tickets still processed", async () => {
    const seedA = await seedRetryTicket({
      ticketId: "throw-A",
      lastAttemptIso: "2026-06-26T10:00:00.000Z",
      attempts: 1,
    });
    const seedB = await seedRetryTicket({
      ticketId: "throw-B",
      lastAttemptIso: "2026-06-26T10:30:00.000Z",
      attempts: 1,
    });

    // First user lookup blows up — affects ticket A only (oldest-first).
    let userLookupCount = 0;
    const realGetByEmail = db().users.getByEmail.bind(db().users);
    vi.spyOn(db().users, "getByEmail").mockImplementation(async (e: string) => {
      userLookupCount++;
      if (userLookupCount === 1) throw new Error("DDB-flake");
      return realGetByEmail(e);
    });

    installSesMock({
      responses: [{ kind: "ok", messageId: "ok-B" }],
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runRetryPass({ now: NOW });
    error.mockRestore();

    expect(result.retried).toBe(2);
    const a = await db().tickets.get(seedA.email, seedA.ticketId);
    const b = await db().tickets.get(seedB.email, seedB.ticketId);
    // A is unchanged — the throw aborted retryOne mid-flight before any patch.
    expect(a!.email_status).toBe("FAILED_TRANSIENT");
    expect(a!.email_attempts).toBe(1);
    // B sailed through.
    expect(b!.email_status).toBe("SENT");
  });
});
