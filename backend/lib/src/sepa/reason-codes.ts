// R-transaction reason codes per SEPA_PAIN008.md.
// Mapping: MD06 (debtor refund request) -> DISPUTED, all others -> REVERSED.
// userNotify=false on codes that are our fault or out-of-scope retries.

export type ReasonCode =
  | "AC04"
  | "AC06"
  | "AC13"
  | "AG01"
  | "AG02"
  | "AM04"
  | "AM05"
  | "BE05"
  | "MD01"
  | "MD02"
  | "MD06"
  | "MD07"
  | "MS02"
  | "MS03"
  | "RC01"
  | "SL01"
  | "TM01";

export type ReasonOutcome = {
  code: ReasonCode;
  mapsTo: "REVERSED" | "DISPUTED";
  userNotify: boolean;
  description: string;
};

export const REASON_CODE_TABLE: Record<ReasonCode, ReasonOutcome> = {
  AC04: { code: "AC04", mapsTo: "REVERSED", userNotify: true, description: "Closed account" },
  AC06: { code: "AC06", mapsTo: "REVERSED", userNotify: true, description: "Blocked account" },
  AC13: { code: "AC13", mapsTo: "REVERSED", userNotify: true, description: "Invalid debtor account type" },
  AG01: { code: "AG01", mapsTo: "REVERSED", userNotify: true, description: "Transaction forbidden" },
  AG02: { code: "AG02", mapsTo: "REVERSED", userNotify: false, description: "Invalid bank operation code" },
  AM04: { code: "AM04", mapsTo: "REVERSED", userNotify: true, description: "Insufficient funds" },
  AM05: { code: "AM05", mapsTo: "REVERSED", userNotify: false, description: "Duplicate collection" },
  BE05: { code: "BE05", mapsTo: "REVERSED", userNotify: false, description: "Identifier of the creditor unknown" },
  MD01: { code: "MD01", mapsTo: "REVERSED", userNotify: true, description: "No mandate / mandate cancelled" },
  MD02: { code: "MD02", mapsTo: "REVERSED", userNotify: false, description: "Missing mandatory information in mandate" },
  MD06: { code: "MD06", mapsTo: "DISPUTED", userNotify: true, description: "Refund request by debtor" },
  MD07: { code: "MD07", mapsTo: "REVERSED", userNotify: true, description: "Debtor deceased" },
  MS02: { code: "MS02", mapsTo: "REVERSED", userNotify: true, description: "Refusal by debtor" },
  MS03: { code: "MS03", mapsTo: "REVERSED", userNotify: true, description: "Reason not specified" },
  RC01: { code: "RC01", mapsTo: "REVERSED", userNotify: false, description: "Bank identifier incorrect" },
  SL01: { code: "SL01", mapsTo: "REVERSED", userNotify: true, description: "Specific service offered by debtor agent" },
  TM01: { code: "TM01", mapsTo: "REVERSED", userNotify: false, description: "Cut-off time" },
};

export function classifyReasonCode(code: string): ReasonOutcome | null {
  const key = code.toUpperCase() as ReasonCode;
  return REASON_CODE_TABLE[key] ?? null;
}
