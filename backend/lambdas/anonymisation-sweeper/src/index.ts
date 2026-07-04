// Public entry-point. EventBridge cron triggers handler() on a rate(1 day)
// schedule (Phase 5 deploy). Two independent passes per invocation:
// - Pass A (cascade): GDPR-erasure for users whose DELETION_SCHEDULED TTL has
//   fired — anonymise their tickets/mandates, hard-delete templates/blobs/
//   profile, leave pain008 audit XML untouched.
// - Pass B (mandate expiry): flip ISSUED mandates past their 36-month expiry
//   to EXPIRED and mirror service_fee_state=WAIVED on the linked ticket.

export { handler, _setNow } from "./handler.js";
export type { SweepResult } from "./handler.js";
