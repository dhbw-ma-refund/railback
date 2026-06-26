// handler.spec.ts — end-to-end handler coverage.
//
// Asserts the cron entrypoint runs both passes, returns the aggregated
// summary, and isolates failures: a Pass A throw doesn't stop Pass B, and
// a Pass B throw doesn't void Pass A's already-recorded count.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@railback/lib/storage";
import { _setSesClient } from "@railback/lib/email/send-email";

import { _setNow, handler } from "../src/handler.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import {
  installSesMock,
  seedRetryTicket,
  seedWatchdogTicket,
} from "./fixtures.js";

const NOW = new Date("2026-06-26T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

describe("handler", () => {
  beforeEach(() => {
    installTestEnv();
    _setNow(() => NOW);
  });
  afterEach(() => {
    _setNow(null);
    _setSesClient(null);
    teardownTestEnv();
  });

  it("runs both passes and returns aggregated SweepResult", async () => {
    await seedRetryTicket({
      ticketId: "retry-1",
      attempts: 1,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    await seedWatchdogTicket({
      ticketId: "watchdog-1",
      lastAttemptIso: new Date(NOW.getTime() - 25 * HOUR).toISOString(),
    });
    installSesMock({ responses: [{ kind: "ok", messageId: "ok-1" }] });

    const result = await handler();
    expect(result).toEqual({ retried: 1, watchdog_timeouts: 1 });
  });

  it("empty world → both counters zero, no SES calls", async () => {
    const sesState = installSesMock({});

    const result = await handler();
    expect(result).toEqual({ retried: 0, watchdog_timeouts: 0 });
    expect(sesState.callCount).toBe(0);
  });

  it("Pass A throws internally → Pass B still runs and contributes its count", async () => {
    await seedWatchdogTicket({
      ticketId: "watchdog-only",
      lastAttemptIso: new Date(NOW.getTime() - 25 * HOUR).toISOString(),
    });
    installSesMock({});

    // Force Pass A to blow up at the queue read.
    const spy = vi
      .spyOn(db().tickets, "queryEmailPending")
      .mockRejectedValueOnce(new Error("queue-explode"));

    const result = await handler();
    spy.mockRestore();

    expect(result.retried).toBe(0);
    expect(result.watchdog_timeouts).toBe(1);
  });

  it("Pass B throws internally → Pass A's count still in summary", async () => {
    await seedRetryTicket({
      ticketId: "retry-only",
      attempts: 1,
      lastAttemptIso: "2026-06-26T11:00:00.000Z",
    });
    installSesMock({ responses: [{ kind: "ok", messageId: "ok-1" }] });

    const spy = vi
      .spyOn(db().tickets, "scanEmailWatchdog")
      .mockRejectedValueOnce(new Error("watchdog-explode"));

    const result = await handler();
    spy.mockRestore();

    expect(result.retried).toBe(1);
    expect(result.watchdog_timeouts).toBe(0);
  });

  it("_setNow injects deterministic clock used by Pass B cutoff", async () => {
    // 25h-old at our pinned NOW. With the default clock the cutoff would be
    // 24h before the real wall-clock — the seeded ticket would NOT be stuck
    // because its timestamp is in the future from real-now's perspective.
    await seedWatchdogTicket({
      ticketId: "clock-test",
      lastAttemptIso: new Date(NOW.getTime() - 25 * HOUR).toISOString(),
    });
    installSesMock({});

    const result = await handler();
    expect(result.watchdog_timeouts).toBe(1);
  });

  it("Pass A successful retry refreshes email_last_attempt so Pass B does not flip the same ticket in the same invocation", async () => {
    // Same ticket is BOTH retry-eligible (FAILED_TRANSIENT, attempts=1) AND
    // 25h-stale by its prior email_last_attempt. The expected behaviour:
    // Pass A re-sends, ticket flips to SENT with email_last_attempt=NOW.
    // Pass B runs after and computes cutoff = NOW - 24h. The fresh ticket
    // is no longer < cutoff, so the watchdog leaves it alone.
    await seedRetryTicket({
      ticketId: "both-passes",
      attempts: 1,
      lastAttemptIso: new Date(NOW.getTime() - 25 * HOUR).toISOString(),
    });
    installSesMock({ responses: [{ kind: "ok", messageId: "ok-fresh" }] });

    const result = await handler();
    expect(result.retried).toBe(1);
    expect(result.watchdog_timeouts).toBe(0);
  });
});
