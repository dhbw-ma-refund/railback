import { describe, expect, it } from "vitest";
import { AppError } from "@railback/lib/errors";

import { detectReportKind } from "../src/detect-kind.js";

describe("detectReportKind", () => {
  it("recognises pain.002 by root element (no namespace)", () => {
    const xml = `<?xml version="1.0"?><Document><CstmrPmtStsRpt><GrpHdr><MsgId>X</MsgId></GrpHdr></CstmrPmtStsRpt></Document>`;
    expect(detectReportKind(xml)).toBe("PAIN002");
  });

  it("recognises pain.002 with default namespace on Document", () => {
    const xml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10"><CstmrPmtStsRpt/></Document>`;
    expect(detectReportKind(xml)).toBe("PAIN002");
  });

  it("recognises camt.054", () => {
    const xml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn/></Document>`;
    expect(detectReportKind(xml)).toBe("CAMT054");
  });

  it("recognises camt.053", () => {
    const xml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt/></Document>`;
    expect(detectReportKind(xml)).toBe("CAMT053");
  });

  it("throws ERR_VALIDATION on empty XML", () => {
    expect(() => detectReportKind("")).toThrowError(AppError);
    try {
      detectReportKind("");
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_VALIDATION");
    }
  });

  it("throws ERR_VALIDATION on unknown root", () => {
    const xml = `<Document><SomeOtherThing/></Document>`;
    try {
      detectReportKind(xml);
      throw new Error("expected throw");
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_VALIDATION");
    }
  });

  it("routes pain.002 before camt.054 even if both tokens appear (stable order)", () => {
    // Extremely pathological — the regex checks pain.002 first. Guards against
    // silent routing drift if someone re-orders the checks.
    const xml = `<Document><CstmrPmtStsRpt/><BkToCstmrDbtCdtNtfctn/></Document>`;
    expect(detectReportKind(xml)).toBe("PAIN002");
  });
});
