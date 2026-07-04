// Sniff the report kind BEFORE full XML parsing. We only need to decide
// which parser to dispatch — regex on the raw string is enough and avoids
// double-parsing (parse-reports.ts parses again to actually extract).
//
// Three shapes, discriminated by the immediate child of <Document>:
//   pain.002 → CstmrPmtStsRpt
//   camt.054 → BkToCstmrDbtCdtNtfctn
//   camt.053 → BkToCstmrStmt
//
// The XML may or may not carry the ISO-20022 namespace on <Document>; parser
// tolerates both, so we do too. Anything else → throw ERR_VALIDATION.

import { AppError } from "@railback/lib/errors";

export type ReportKind = "PAIN002" | "CAMT054" | "CAMT053";

const PAIN002_ROOT = /<(?:[A-Za-z_][\w.-]*:)?CstmrPmtStsRpt\b/;
const CAMT054_ROOT = /<(?:[A-Za-z_][\w.-]*:)?BkToCstmrDbtCdtNtfctn\b/;
const CAMT053_ROOT = /<(?:[A-Za-z_][\w.-]*:)?BkToCstmrStmt\b/;

/**
 * Return the report kind (`PAIN002` | `CAMT054` | `CAMT053`) for a raw XML
 * string. Order of checks is stable — pain.002 first, then the two camt.
 * variants — so a pathological payload that happens to contain multiple
 * root tokens still routes deterministically. Throws `ERR_VALIDATION` when
 * none of the three root elements appear.
 */
export function detectReportKind(xml: string): ReportKind {
  if (typeof xml !== "string" || xml.length === 0) {
    throw new AppError("ERR_VALIDATION", "sepa-reports: empty XML", undefined, {
      field: "xml",
    });
  }
  if (PAIN002_ROOT.test(xml)) return "PAIN002";
  if (CAMT054_ROOT.test(xml)) return "CAMT054";
  if (CAMT053_ROOT.test(xml)) return "CAMT053";
  throw new AppError(
    "ERR_VALIDATION",
    "sepa-reports: unrecognised XML root — expected CstmrPmtStsRpt, BkToCstmrDbtCdtNtfctn, or BkToCstmrStmt",
    undefined,
    { field: "xml" },
  );
}
