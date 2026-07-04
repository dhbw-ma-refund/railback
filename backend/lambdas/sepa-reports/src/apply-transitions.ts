// Pure decision layer: turn a parsed inbound report into a list of
// `MandateDecision` records. Kept side-effect-free so the state-machine
// logic can be unit-tested exhaustively without seeding a Db.
//
// Downstream `handler.ts` looks up each `mandateId` and applies the action:
//   - action === "SKIP" → nothing to do (informational, unknown mandate, or
//     illegal transition already logged upstream in the decision-maker)
//   - action === "DEBITED" → tickets.patch(service_fee_state=DEBITED) then
//     mandates.markDebited
//   - action === "REVERSED" → tickets.patch(service_fee_state=REVERSED) then
//     mandates.markReversed
//   - action === "DISPUTED" → tickets.patch(service_fee_state=REVERSED) then
//     mandates.markDisputed
//
// State-machine per DB_SCHEMA.md §"mandate_state transitions M3–M6":
//   pain.002 REJECTED on SUBMITTED → REVERSED
//   pain.002 ACCEPTED               → SKIP (informational; the booking event
//                                     lands via camt.054 later)
//   camt.054 BOOKED   on SUBMITTED  → DEBITED
//   camt.054 REVERSED on SUBMITTED|DEBITED → REVERSED
//   camt.054 DISPUTED on DEBITED    → DISPUTED
//   camt.053                        → SKIP (informational statement; no
//                                     state changes)
//
// Illegal source-state transitions log an error at the decision site AND
// return a SKIP decision — one bad line MUST NOT poison the batch. Same
// treatment for unknown mandates (the caller resolves mandateId → mandate
// before calling us; when the resolver returns null we pass `mandate=null`
// and get a SKIP with `reason: "unknown_mandate"`).

import { log } from "@railback/lib/http/logging";
import {
  classifyReasonCode,
  type ReasonOutcome,
} from "@railback/lib/sepa/reason-codes";
import type {
  Camt05xResult,
  Pain002Result,
} from "@railback/lib/sepa/parse-reports";
import type { SepaMandate } from "@railback/lib/types/dto";
import type { MandateState } from "@railback/lib/types/enums";

import type { ReportKind } from "./detect-kind.js";

export type MandateAction = "SKIP" | "DEBITED" | "REVERSED" | "DISPUTED";

export interface MandateDecision {
  /** ULID as echoed in EndToEndId / MndtId. */
  mandateId: string;
  action: MandateAction;
  /** Reason code from the XML (present on R-transactions + pain.002 RJCT). */
  reasonCode?: string;
  /**
   * Classified reason (present iff `reasonCode` is one of the 17 known SEPA
   * codes). Drives userNotify + human-readable description.
   */
  classified?: ReasonOutcome;
  /**
   * True iff we should send the user an R-tx notification email. Only ever
   * set on REVERSED / DISPUTED decisions with a known-to-us `classified` code
   * that has `userNotify=true`. REVERSED with unknown/missing reasonCode
   * defaults to userNotify=false — we can't render a meaningful reason.
   */
  shouldNotify: boolean;
  /**
   * Short reason for logging when action=SKIP (informational, unknown,
   * illegal-transition, etc.). Never set on non-SKIP decisions.
   */
  skipReason?:
    | "informational_accepted"
    | "informational_statement"
    | "unknown_mandate"
    | "illegal_transition";
}

/** Input for a single-mandate decision. */
export interface MandateInput {
  mandateId: string;
  /** Null when the resolver couldn't find a live row. */
  mandate: SepaMandate | null;
}

// -- pain.002 ---------------------------------------------------------------

/**
 * Decide the target action for one pain.002 TxInfAndSts entry.
 */
export function decidePain002(
  input: MandateInput,
  status: "ACCEPTED" | "REJECTED",
  reasonCode: string | undefined,
): MandateDecision {
  const { mandateId, mandate } = input;

  // Unknown mandate first — same handling regardless of status. Preserves
  // the "unknown mandateIds surface as skipReason=unknown_mandate" invariant
  // that handler.ts + BUILD.md advertise.
  if (mandate === null) {
    return {
      mandateId,
      action: "SKIP",
      shouldNotify: false,
      skipReason: "unknown_mandate",
    };
  }

  if (status === "ACCEPTED") {
    // pain.002 ACCSP / ACSP is a positive-acknowledgement that the bank has
    // ingested the DD instruction. The actual booking arrives later in a
    // camt.054, and THAT is what transitions the mandate to DEBITED. We do
    // not touch state on ACSP.
    return {
      mandateId,
      action: "SKIP",
      shouldNotify: false,
      skipReason: "informational_accepted",
    };
  }

  // REJECTED. Legal source state = SUBMITTED. Anything else means the report
  // arrived out-of-order (or the bank re-sent an old status after we'd
  // already booked/reversed) — skip and log; the operator can reconcile.
  if (!isLegalSource(mandate.mandate_state, "REVERSED_FROM_PAIN002")) {
    log.error("sepa-reports.transition.illegal", {
      mandateId,
      from: mandate.mandate_state,
      to: "REVERSED",
      trigger: "pain002.REJECTED",
      reasonCode,
    });
    return {
      mandateId,
      action: "SKIP",
      shouldNotify: false,
      skipReason: "illegal_transition",
    };
  }

  return buildRTxDecision(mandateId, "REVERSED", reasonCode);
}

// -- camt.054 (state-changing) ---------------------------------------------

/**
 * Decide the target action for one camt.054 TxDtls entry.
 */
export function decideCamt054(
  input: MandateInput,
  outcome: "BOOKED" | "REVERSED" | "DISPUTED",
  reasonCode: string | undefined,
): MandateDecision {
  const { mandateId, mandate } = input;

  if (mandate === null) {
    return {
      mandateId,
      action: "SKIP",
      shouldNotify: false,
      skipReason: "unknown_mandate",
    };
  }

  if (outcome === "BOOKED") {
    if (!isLegalSource(mandate.mandate_state, "DEBITED_FROM_CAMT054")) {
      log.error("sepa-reports.transition.illegal", {
        mandateId,
        from: mandate.mandate_state,
        to: "DEBITED",
        trigger: "camt054.BOOKED",
      });
      return {
        mandateId,
        action: "SKIP",
        shouldNotify: false,
        skipReason: "illegal_transition",
      };
    }
    return {
      mandateId,
      action: "DEBITED",
      shouldNotify: false,
    };
  }

  if (outcome === "REVERSED") {
    if (!isLegalSource(mandate.mandate_state, "REVERSED_FROM_CAMT054")) {
      log.error("sepa-reports.transition.illegal", {
        mandateId,
        from: mandate.mandate_state,
        to: "REVERSED",
        trigger: "camt054.REVERSED",
        reasonCode,
      });
      return {
        mandateId,
        action: "SKIP",
        shouldNotify: false,
        skipReason: "illegal_transition",
      };
    }
    return buildRTxDecision(mandateId, "REVERSED", reasonCode);
  }

  // DISPUTED. Legal source state = DEBITED (MD06 is a debtor-initiated
  // 8-week refund AFTER booking).
  if (!isLegalSource(mandate.mandate_state, "DISPUTED_FROM_CAMT054")) {
    log.error("sepa-reports.transition.illegal", {
      mandateId,
      from: mandate.mandate_state,
      to: "DISPUTED",
      trigger: "camt054.DISPUTED",
      reasonCode,
    });
    return {
      mandateId,
      action: "SKIP",
      shouldNotify: false,
      skipReason: "illegal_transition",
    };
  }
  return buildRTxDecision(mandateId, "DISPUTED", reasonCode);
}

// -- Batch producers -------------------------------------------------------

/**
 * Turn a full parsed pain.002 into decisions. Caller supplies the mandate
 * resolver as a Map (mandateId → mandate|null); we do NOT call storage from
 * this pure module.
 */
export function decidePain002Batch(
  parsed: Pain002Result,
  resolver: Map<string, SepaMandate | null>,
): MandateDecision[] {
  return parsed.mandates.map((entry) => {
    const mandate = resolver.get(entry.mandateId) ?? null;
    return decidePain002(
      { mandateId: entry.mandateId, mandate },
      entry.status,
      entry.reasonCode,
    );
  });
}

/**
 * Turn a full parsed camt.054 into decisions.
 */
export function decideCamt054Batch(
  parsed: Camt05xResult,
  resolver: Map<string, SepaMandate | null>,
): MandateDecision[] {
  return parsed.mandates.map((entry) => {
    const mandate = resolver.get(entry.mandateId) ?? null;
    return decideCamt054(
      { mandateId: entry.mandateId, mandate },
      entry.outcome,
      entry.reasonCode,
    );
  });
}

/**
 * camt.053 is informational — a bank-side statement summary. Every entry
 * turns into a SKIP; the SepaReport row still gets written for audit.
 */
export function decideCamt053Batch(parsed: Camt05xResult): MandateDecision[] {
  return parsed.mandates.map((entry) => {
    const d: MandateDecision = {
      mandateId: entry.mandateId,
      action: "SKIP",
      shouldNotify: false,
      skipReason: "informational_statement",
    };
    if (entry.reasonCode !== undefined) {
      d.reasonCode = entry.reasonCode;
      // Populate classified when we can, so the audit log line prints a
      // human-readable description alongside the raw bank code (matches
      // buildRTxDecision's shape on the notify path).
      const classified = classifyReasonCode(entry.reasonCode);
      if (classified !== null) d.classified = classified;
    }
    return d;
  });
}

/**
 * Top-level dispatch by report kind. Handler wires it up with the resolver
 * it built after doing the mandateId lookups.
 */
export function decideBatch(
  kind: ReportKind,
  parsed: Pain002Result | Camt05xResult,
  resolver: Map<string, SepaMandate | null>,
): MandateDecision[] {
  switch (kind) {
    case "PAIN002":
      return decidePain002Batch(parsed as Pain002Result, resolver);
    case "CAMT054":
      return decideCamt054Batch(parsed as Camt05xResult, resolver);
    case "CAMT053":
      return decideCamt053Batch(parsed as Camt05xResult);
  }
}

// -- Internal helpers ------------------------------------------------------

type LegalityRule =
  | "REVERSED_FROM_PAIN002"
  | "DEBITED_FROM_CAMT054"
  | "REVERSED_FROM_CAMT054"
  | "DISPUTED_FROM_CAMT054";

function isLegalSource(from: MandateState, rule: LegalityRule): boolean {
  switch (rule) {
    // pain.002 RJCT means the bank never booked — must come from SUBMITTED.
    case "REVERSED_FROM_PAIN002":
      return from === "SUBMITTED";
    // camt.054 booking notification must come from SUBMITTED.
    case "DEBITED_FROM_CAMT054":
      return from === "SUBMITTED";
    // R-transaction after booking (rejection notice or return) can hit either
    // the pre-booking SUBMITTED state (bank rejected inline) or the post-
    // booking DEBITED state (bank pulled it back).
    case "REVERSED_FROM_CAMT054":
      return from === "SUBMITTED" || from === "DEBITED";
    // MD06 is a debtor-initiated refund, only meaningful AFTER debit.
    case "DISPUTED_FROM_CAMT054":
      return from === "DEBITED";
  }
}

function buildRTxDecision(
  mandateId: string,
  action: "REVERSED" | "DISPUTED",
  reasonCode: string | undefined,
): MandateDecision {
  const classified = reasonCode ? classifyReasonCode(reasonCode) : null;
  const shouldNotify = classified?.userNotify === true;
  const d: MandateDecision = { mandateId, action, shouldNotify };
  if (reasonCode !== undefined) d.reasonCode = reasonCode;
  if (classified !== null) d.classified = classified;
  return d;
}
