// watchdog.spec.ts — Pass B coverage.
//
// Asserts the 24h-stuck detector flips EMAIL_SENDING+SENT tickets to terminal
// EMAIL_FAILED, leaves everything else alone, and preserves email_attempts /
// email_last_attempt as SES-side audit.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@railback/lib/storage";

import { runWatchdogPass } from "../src/watchdog.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import { seedWatchdogTicket } from "./fixtures.js";

const NOW = new Date("2026-06-26T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function isoOffsetFromNow(deltaMs: number): string {
  return new Date(NOW.getTime() + deltaMs).toISOString();
}

describe("runWatchdogPass", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("25h-old EMAIL_SENDING+SENT → EMAIL_FAILED + reason=webhook_timeout", async () => {
    const { email, ticketId } = await seedWatchdogTicket({
      ticketId: "old-sent",
      lastAttemptIso: isoOffsetFromNow(-25 * HOUR),
    });

    const result = await runWatchdogPass({ now: NOW });
    expect(result.watchdog_timeouts).toBe(1);

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("FAILED");
    expect(after!.email_failed_reason).toBe("webhook_timeout");
  });

  it("5min-old SENT ticket → untouched (under cutoff)", async () => {
    const { email, ticketId } = await seedWatchdogTicket({
      ticketId: "fresh-sent",
      lastAttemptIso: isoOffsetFromNow(-5 * 60 * 1000),
    });

    const result = await runWatchdogPass({ now: NOW });
    expect(result.watchdog_timeouts).toBe(0);

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_SENDING");
    expect(after!.email_status).toBe("SENT");
    expect(after!.email_failed_reason).toBeUndefined();
  });

  it("25h-old PENDING_DB_PAYMENT+DELIVERED → untouched (already terminal)", async () => {
    const { email, ticketId } = await seedWatchdogTicket({
      ticketId: "old-delivered",
      lastAttemptIso: isoOffsetFromNow(-25 * HOUR),
      status: "DELIVERED",
      ticketState: "PENDING_DB_PAYMENT",
    });

    const result = await runWatchdogPass({ now: NOW });
    expect(result.watchdog_timeouts).toBe(0);

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("PENDING_DB_PAYMENT");
    expect(after!.email_status).toBe("DELIVERED");
  });

  it("preserves email_attempts and email_last_attempt as SES-side audit", async () => {
    const lastAttempt = isoOffsetFromNow(-25 * HOUR);
    const { email, ticketId } = await seedWatchdogTicket({
      ticketId: "preserved-fields",
      lastAttemptIso: lastAttempt,
      attempts: 1,
    });

    await runWatchdogPass({ now: NOW });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_attempts).toBe(1);
    expect(after!.email_last_attempt).toBe(lastAttempt);
  });

  it("empty result → no-op, count=0", async () => {
    const result = await runWatchdogPass({ now: NOW });
    expect(result.watchdog_timeouts).toBe(0);
  });

  it("cutoffMinutes override: 60min cutoff catches a 65min-old ticket", async () => {
    const { email, ticketId } = await seedWatchdogTicket({
      ticketId: "ninety-min",
      lastAttemptIso: isoOffsetFromNow(-65 * 60 * 1000),
    });

    const result = await runWatchdogPass({ now: NOW, cutoffMinutes: 60 });
    expect(result.watchdog_timeouts).toBe(1);

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
  });

  it("multiple stuck tickets — all get flipped in a single pass", async () => {
    await seedWatchdogTicket({
      ticketId: "stuck-A",
      lastAttemptIso: isoOffsetFromNow(-30 * HOUR),
    });
    await seedWatchdogTicket({
      ticketId: "stuck-B",
      lastAttemptIso: isoOffsetFromNow(-25 * HOUR),
    });

    const result = await runWatchdogPass({ now: NOW });
    expect(result.watchdog_timeouts).toBe(2);
  });

  it("EMAIL_SENDING+FAILED_TRANSIENT → untouched (retry queue, not watchdog territory)", async () => {
    // The watchdog only targets SENT tickets — FAILED_TRANSIENT belongs to
    // the retry queue (Pass A), and clobbering it would race with Pass A.
    const { email, ticketId } = await seedWatchdogTicket({
      ticketId: "stuck-transient",
      lastAttemptIso: isoOffsetFromNow(-25 * HOUR),
      status: "FAILED_TRANSIENT",
    });

    const result = await runWatchdogPass({ now: NOW });
    expect(result.watchdog_timeouts).toBe(0);

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_SENDING");
    expect(after!.email_status).toBe("FAILED_TRANSIENT");
  });

  it("per-ticket patch throw is swallowed; later stuck tickets still flipped", async () => {
    await seedWatchdogTicket({
      ticketId: "throw-A",
      lastAttemptIso: isoOffsetFromNow(-30 * HOUR),
    });
    const seedB = await seedWatchdogTicket({
      ticketId: "throw-B",
      lastAttemptIso: isoOffsetFromNow(-25 * HOUR),
    });

    // First patch blows up — ticket "throw-A" stays stuck, "throw-B" sails through.
    let patchCount = 0;
    const realPatch = db().tickets.patch.bind(db().tickets);
    vi.spyOn(db().tickets, "patch").mockImplementation(
      async (e: string, id: string, p: Parameters<typeof realPatch>[2]) => {
        patchCount++;
        if (patchCount === 1) throw new Error("DDB-flake");
        return realPatch(e, id, p);
      },
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runWatchdogPass({ now: NOW });
    error.mockRestore();

    // Count reflects all stuck tickets (the pass returns stuck.length, even if
    // one patch throw was swallowed — by design, that's the watchdog count).
    expect(result.watchdog_timeouts).toBe(2);

    // ticket-A is still stuck (patch threw before any state change).
    const a = await db().tickets.get(seedB.email, "throw-A");
    expect(a!.ticket_state).toBe("EMAIL_SENDING");
    // ticket-B sailed through.
    const b = await db().tickets.get(seedB.email, seedB.ticketId);
    expect(b!.ticket_state).toBe("EMAIL_FAILED");
    expect(b!.email_failed_reason).toBe("webhook_timeout");
  });
});
