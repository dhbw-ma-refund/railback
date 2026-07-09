// Parsers for inbound SEPA bank reports.
//
// Three message shapes:
//
//   pain.002.001.xx — Customer Payment Status Report. Carries per-tx
//     acceptance/rejection. RJCT → "REJECTED"; everything else → "ACCEPTED".
//
//   camt.054.001.xx — Bank-to-Customer Debit/Credit Notification.
//     Carries the actual booking event PLUS R-transactions (returns,
//     refunds). RtrInf present + reason-code maps to DISPUTED (MD06)
//     → "DISPUTED"; RtrInf present + other reason → "REVERSED";
//     no RtrInf → "BOOKED".
//
//   camt.053.001.xx — Bank-to-Customer Statement. Same RtrInf shape
//     as camt.054 for the purposes of this parser; informational
//     account-statement context.
//
// All three correlate to mandate via EndToEndId, which the pain.008
// builder in @railback/lib/sepa/pain008.ts pins to mandate_id. Banks
// echo it verbatim.
//
// We DO NOT XSD-validate here — that's the sepa-reports Lambda's job
// (CI snapshot). This lib only extracts the fields the state-machine
// needs.

import { XMLParser } from "fast-xml-parser";

import { AppError } from "../errors/index.js";
import { classifyReasonCode } from "./reason-codes.js";

export interface Pain002Mandate {
  mandateId: string;
  status: "ACCEPTED" | "REJECTED";
  reasonCode?: string;
}

export interface Pain002Result {
  reportId: string;
  mandates: Pain002Mandate[];
}

export interface CamtMandate {
  mandateId: string;
  outcome: "BOOKED" | "REVERSED" | "DISPUTED";
  reasonCode?: string;
}

export interface Camt05xResult {
  reportId: string;
  mandates: CamtMandate[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: () => false,
  trimValues: true,
  parseTagValue: false,
  // Strip namespace prefixes so `<ns:Document xmlns:ns="urn:iso:...">` and
  // `<Document xmlns="urn:iso:...">` both land as `tree.Document`. Banks are
  // free to bind ISO-20022 to either a default or a prefixed namespace, and
  // the path literals below (`Document`, `CstmrPmtStsRpt`, `Ntry`, …) all
  // assume the unprefixed form.
  removeNSPrefix: true,
});

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

function getStr(node: unknown, ...path: string[]): string | undefined {
  let cur: unknown = node;
  for (const p of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur === "string") return cur;
  if (typeof cur === "number") return String(cur);
  return undefined;
}

function getNode(node: unknown, ...path: string[]): unknown {
  let cur: unknown = node;
  for (const p of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function parseXml(xml: string): unknown {
  if (typeof xml !== "string" || xml.length === 0) {
    throw new AppError("ERR_VALIDATION", "empty XML", undefined, {
      field: "xml",
    });
  }
  try {
    return parser.parse(xml);
  } catch (err) {
    throw new AppError(
      "ERR_VALIDATION",
      `XML parse error: ${(err as Error).message ?? "unknown"}`,
      undefined,
      { field: "xml" },
    );
  }
}

/**
 * Parse a pain.002 Customer Payment Status Report.
 *
 * reportId = GrpHdr.MsgId; mandateId = TxInfAndSts.OrgnlEndToEndId;
 * status from TxSts (RJCT → REJECTED, else ACCEPTED).
 */
export function parsePain002(xml: string): Pain002Result {
  const tree = parseXml(xml);
  const root = getNode(tree, "Document", "CstmrPmtStsRpt");
  if (!root) {
    throw new AppError(
      "ERR_VALIDATION",
      "pain.002: missing Document/CstmrPmtStsRpt",
      undefined,
      { field: "xml" },
    );
  }

  const reportId = getStr(root, "GrpHdr", "MsgId") ?? "";
  if (!reportId) {
    throw new AppError(
      "ERR_VALIDATION",
      "pain.002: missing GrpHdr/MsgId",
      undefined,
      { field: "MsgId" },
    );
  }

  const mandates: Pain002Mandate[] = [];
  const pmts = toArray(getNode(root, "OrgnlPmtInfAndSts") as unknown);
  for (const pmt of pmts) {
    const txs = toArray(getNode(pmt, "TxInfAndSts") as unknown);
    for (const tx of txs) {
      // EndToEndId is our canonical mandate correlator — the pain.008 builder
      // pins it to mandate_id. We DO NOT fall back to OrgnlInstrId: that's
      // the pain.008 InstructionId (a message-scoped identifier, not the
      // mandate), and letting it match against MandateRepo.getByMandateId
      // would risk misrouting a state transition to a coincidentally-shaped
      // ULID. If a bank omits OrgnlEndToEndId entirely, we log unknown-mandate
      // downstream — safer than silent mis-correlation.
      const endToEnd = getStr(tx, "OrgnlEndToEndId");
      if (!endToEnd) continue;
      const stsRaw = getStr(tx, "TxSts") ?? "";
      const status: "ACCEPTED" | "REJECTED" =
        stsRaw === "RJCT" ? "REJECTED" : "ACCEPTED";
      const reasonCode =
        getStr(tx, "StsRsnInf", "Rsn", "Cd") ??
        getStr(tx, "StsRsnInf", "Rsn", "Prtry");
      const entry: Pain002Mandate = { mandateId: endToEnd, status };
      if (reasonCode) entry.reasonCode = reasonCode;
      mandates.push(entry);
    }
  }

  return { reportId, mandates };
}

function parseCamt(xml: string, kind: "camt.054" | "camt.053"): Camt05xResult {
  const tree = parseXml(xml);
  const rootKey =
    kind === "camt.054" ? "BkToCstmrDbtCdtNtfctn" : "BkToCstmrStmt";
  const root = getNode(tree, "Document", rootKey);
  if (!root) {
    throw new AppError(
      "ERR_VALIDATION",
      `${kind}: missing Document/${rootKey}`,
      undefined,
      { field: "xml" },
    );
  }

  const reportId = getStr(root, "GrpHdr", "MsgId") ?? "";
  if (!reportId) {
    throw new AppError(
      "ERR_VALIDATION",
      `${kind}: missing GrpHdr/MsgId`,
      undefined,
      { field: "MsgId" },
    );
  }

  const containerKey = kind === "camt.054" ? "Ntfctn" : "Stmt";
  const containers = toArray(getNode(root, containerKey) as unknown);

  const mandates: CamtMandate[] = [];
  for (const c of containers) {
    const entries = toArray(getNode(c, "Ntry") as unknown);
    for (const ntry of entries) {
      // NtryDtls can repeat under a single Ntry — each block is a settlement
      // batch with its own TxDtls[]. Walking `NtryDtls -> TxDtls` in one hop
      // via getNode() silently reads only the first NtryDtls when the parser
      // has collapsed the siblings into an array; iterate explicitly.
      const dtlsList = toArray(getNode(ntry, "NtryDtls") as unknown);
      for (const dtls of dtlsList) {
        const txDetailsList = toArray(getNode(dtls, "TxDtls") as unknown);
        for (const tx of txDetailsList) {
          // EndToEndId is our canonical mandate correlator — the pain.008
          // builder pins it to mandate_id (see @railback/lib/sepa/pain008.ts).
          // We deliberately do NOT fall back to MndtId here — pain.002's
          // parser refuses the analogous fallback for OrgnlInstrId
          // (parseP002 above, line 147-153), and camt.054 must match:
          //
          //   1. `MndtId` in a camt Refs block is the ORIGINAL mandate
          //      identifier the bank echoes back, but banks are not
          //      obliged to populate it. When it IS populated, it's often
          //      a bank-side normalisation of the debitor's mandate id
          //      (not necessarily our ULID). If a coincidentally-shaped
          //      MndtId matches an unrelated MandateRepo.getByMandateId()
          //      row, we'd flip the wrong mandate to REVERSED / DISPUTED.
          //   2. Silent misrouting is worse than logged skip: the
          //      per-record continuation in sepa-reports.handler emits an
          //      unknown-mandate warn-log and moves on.
          //
          // Locked 2026-07-01 per audit finding
          // `camt-mndtid-fallback-mis-correlation`.
          const endToEnd = getStr(tx, "Refs", "EndToEndId");
          if (!endToEnd) continue;
          const rtrInf = getNode(tx, "RtrInf");
          const reasonCode =
            getStr(tx, "RtrInf", "Rsn", "Cd") ??
            getStr(tx, "RtrInf", "Rsn", "Prtry");
          let outcome: "BOOKED" | "REVERSED" | "DISPUTED" = "BOOKED";
          if (rtrInf !== undefined) {
            const classified = reasonCode
              ? classifyReasonCode(reasonCode)
              : null;
            outcome =
              classified?.mapsTo === "DISPUTED" ? "DISPUTED" : "REVERSED";
          }
          const entry: CamtMandate = { mandateId: endToEnd, outcome };
          if (reasonCode) entry.reasonCode = reasonCode;
          mandates.push(entry);
        }
      }
    }
  }

  return { reportId, mandates };
}

export function parseCamt054(xml: string): Camt05xResult {
  return parseCamt(xml, "camt.054");
}

export function parseCamt053(xml: string): Camt05xResult {
  return parseCamt(xml, "camt.053");
}
