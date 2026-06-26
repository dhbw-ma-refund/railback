// email-sweeper entrypoint — EventBridge cron, rate(5 minutes).
//
// Two independent passes per invocation:
//   Pass A — retry SES sends for tickets in the GSI_EMAIL_PENDING queue
//            (email_status IN (SENDING, FAILED_TRANSIENT), attempts<3).
//   Pass B — 24h watchdog: tickets stuck in EMAIL_SENDING+SENT whose SNS
//            Delivery event never landed get flipped to EMAIL_FAILED.
//
// The passes are wrapped in independent try/catch so a Pass B blow-up does
// NOT mask Pass A's completed work (the metrics in the summary log line are
// still accurate) and vice-versa. A failed pass returns zero for its counter
// and an error is logged; the next cron tick re-tries.

import { log } from "@railback/lib/http/logging";

import { runRetryPass } from "./retry.js";
import { runWatchdogPass } from "./watchdog.js";

export interface SweepResult {
  retried: number;
  watchdog_timeouts: number;
}

// Test seam — handler reads "now" via this indirection so retry.spec/watchdog.spec
// can pin the clock. Mirrors the pattern used in user-handler's clockProvider
// helpers. Default `() => new Date()` so production cold-starts work without
// any wiring.
let _now: () => Date = () => new Date();

/** Test seam — inject a deterministic clock, or pass null to reset. */
export function _setNow(fn: (() => Date) | null): void {
  _now = fn ?? (() => new Date());
}

/** EventBridge cron handler. Returns a summary suitable for CloudWatch metrics. */
export async function handler(_event?: unknown): Promise<SweepResult> {
  // One clock per invocation, shared by both passes. Deliberate: Pass B's
  // 24h watchdog cutoff is computed from this `now`, and we want a stable
  // boundary independent of how long Pass A took. A ticket that Pass A
  // refreshes (`email_last_attempt = nowIso`) will have its new attempt
  // timestamp >= cutoff, so Pass B cannot mis-flip it within the same
  // invocation.
  const now = _now();
  const result: SweepResult = { retried: 0, watchdog_timeouts: 0 };

  // Pass A — retry queue.
  try {
    const { retried } = await runRetryPass({ now });
    result.retried = retried;
  } catch (err) {
    log.error("email-sweeper.retry.pass_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Pass B — 24h watchdog. Runs even if Pass A blew up; the two passes are
  // independent state machines.
  try {
    const { watchdog_timeouts } = await runWatchdogPass({ now });
    result.watchdog_timeouts = watchdog_timeouts;
  } catch (err) {
    log.error("email-sweeper.watchdog.pass_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  log.info("email-sweeper.done", { ...result });
  return result;
}
