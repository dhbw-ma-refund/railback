// Public entry-point. EventBridge cron triggers handler() on a rate(5 minutes)
// schedule (Phase 5 deploy). Two independent passes per invocation:
// - Pass A (retry): query GSI_EMAIL_PENDING oldest-first, re-send tickets that
//   SES rejected on a prior attempt.
// - Pass B (watchdog): scan for tickets stuck in EMAIL_SENDING+SENT for >24h
//   (the SNS Delivery webhook never landed) and flip them to EMAIL_FAILED.

export { handler, _setNow } from "./handler.js";
export type { SweepResult } from "./handler.js";
