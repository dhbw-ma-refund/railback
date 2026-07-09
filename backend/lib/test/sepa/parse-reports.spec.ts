// Real parser tests for pain.002 / camt.054 / camt.053 inbound SEPA reports.
// Fixtures are minimal hand-built XML in the shapes our pain008 builder's
// counterparties send back.

import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/index.js";
import {
  parseCamt053,
  parseCamt054,
  parsePain002,
} from "../../src/sepa/parse-reports.js";

describe("parsePain002", () => {
  it("parses a single-mandate ACCEPTED status report", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10">
  <CstmrPmtStsRpt>
    <GrpHdr><MsgId>REP-001</MsgId><CreDtTm>2026-06-25T10:00:00Z</CreDtTm></GrpHdr>
    <OrgnlPmtInfAndSts>
      <TxInfAndSts>
        <OrgnlEndToEndId>01HXMANDATEAAAAAAAAAAAAAAA</OrgnlEndToEndId>
        <TxSts>ACSP</TxSts>
      </TxInfAndSts>
    </OrgnlPmtInfAndSts>
  </CstmrPmtStsRpt>
</Document>`;
    const out = parsePain002(xml);
    expect(out.reportId).toBe("REP-001");
    expect(out.mandates).toHaveLength(1);
    expect(out.mandates[0]).toEqual({
      mandateId: "01HXMANDATEAAAAAAAAAAAAAAA",
      status: "ACCEPTED",
    });
  });

  it("parses a REJECTED status with reason code", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10">
  <CstmrPmtStsRpt>
    <GrpHdr><MsgId>REP-002</MsgId></GrpHdr>
    <OrgnlPmtInfAndSts>
      <TxInfAndSts>
        <OrgnlEndToEndId>01HXMANDATEBBBBBBBBBBBBBBB</OrgnlEndToEndId>
        <TxSts>RJCT</TxSts>
        <StsRsnInf><Rsn><Cd>AC04</Cd></Rsn></StsRsnInf>
      </TxInfAndSts>
    </OrgnlPmtInfAndSts>
  </CstmrPmtStsRpt>
</Document>`;
    const out = parsePain002(xml);
    expect(out.mandates[0]).toEqual({
      mandateId: "01HXMANDATEBBBBBBBBBBBBBBB",
      status: "REJECTED",
      reasonCode: "AC04",
    });
  });

  it("parses multiple TxInfAndSts entries in one OrgnlPmtInfAndSts", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <CstmrPmtStsRpt>
    <GrpHdr><MsgId>REP-003</MsgId></GrpHdr>
    <OrgnlPmtInfAndSts>
      <TxInfAndSts>
        <OrgnlEndToEndId>M1</OrgnlEndToEndId>
        <TxSts>ACSP</TxSts>
      </TxInfAndSts>
      <TxInfAndSts>
        <OrgnlEndToEndId>M2</OrgnlEndToEndId>
        <TxSts>RJCT</TxSts>
        <StsRsnInf><Rsn><Cd>MD01</Cd></Rsn></StsRsnInf>
      </TxInfAndSts>
    </OrgnlPmtInfAndSts>
  </CstmrPmtStsRpt>
</Document>`;
    const out = parsePain002(xml);
    expect(out.mandates).toHaveLength(2);
    expect(out.mandates[0]?.status).toBe("ACCEPTED");
    expect(out.mandates[1]?.status).toBe("REJECTED");
    expect(out.mandates[1]?.reasonCode).toBe("MD01");
  });

  it("throws ERR_VALIDATION on empty input", () => {
    try {
      parsePain002("");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("ERR_VALIDATION");
    }
  });

  it("throws ERR_VALIDATION when Document/CstmrPmtStsRpt is missing", () => {
    try {
      parsePain002("<?xml version=\"1.0\"?><Other/>");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as AppError).code).toBe("ERR_VALIDATION");
    }
  });

  it("throws ERR_VALIDATION when GrpHdr.MsgId is missing", () => {
    const xml = `<Document><CstmrPmtStsRpt><GrpHdr/></CstmrPmtStsRpt></Document>`;
    try {
      parsePain002(xml);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as AppError).code).toBe("ERR_VALIDATION");
    }
  });
});

describe("parseCamt054", () => {
  it("parses a BOOKED entry (no RtrInf)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>CAMT-001</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>01HXMANDATECCCCCCCCCCCCCCC</EndToEndId></Refs>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
    const out = parseCamt054(xml);
    expect(out.reportId).toBe("CAMT-001");
    expect(out.mandates).toEqual([
      { mandateId: "01HXMANDATECCCCCCCCCCCCCCC", outcome: "BOOKED" },
    ]);
  });

  it("maps RtrInf with non-MD06 reason to REVERSED", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>CAMT-002</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>M-AC04</EndToEndId></Refs>
            <RtrInf>
              <Rsn><Cd>AC04</Cd></Rsn>
            </RtrInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
    const out = parseCamt054(xml);
    expect(out.mandates[0]).toEqual({
      mandateId: "M-AC04",
      outcome: "REVERSED",
      reasonCode: "AC04",
    });
  });

  it("maps RtrInf with MD06 to DISPUTED", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>CAMT-003</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>M-MD06</EndToEndId></Refs>
            <RtrInf>
              <Rsn><Cd>MD06</Cd></Rsn>
            </RtrInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
    const out = parseCamt054(xml);
    expect(out.mandates[0]).toEqual({
      mandateId: "M-MD06",
      outcome: "DISPUTED",
      reasonCode: "MD06",
    });
  });

  it("handles multiple entries and multiple TxDtls per entry", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>CAMT-004</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <NtryDtls>
          <TxDtls><Refs><EndToEndId>M1</EndToEndId></Refs></TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>M2</EndToEndId></Refs>
            <RtrInf><Rsn><Cd>AM04</Cd></Rsn></RtrInf>
          </TxDtls>
          <TxDtls>
            <Refs><EndToEndId>M3</EndToEndId></Refs>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
    const out = parseCamt054(xml);
    expect(out.mandates).toHaveLength(3);
    expect(out.mandates.map((m) => m.outcome)).toEqual([
      "BOOKED",
      "REVERSED",
      "BOOKED",
    ]);
  });

  it("throws ERR_VALIDATION for missing root", () => {
    try {
      parseCamt054("<Document/>");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as AppError).code).toBe("ERR_VALIDATION");
    }
  });

  // Symmetric with pain.002's OrgnlInstrId refusal (parse-reports.ts:147-153):
  // camt.054 must NOT fall back to Refs/MndtId when EndToEndId is missing.
  // MndtId can carry a bank-side normalisation that isn't our ULID; if it
  // coincidentally matches an unrelated mandate row, we'd misroute state
  // transitions. Skipping the record is safer — the sepa-reports handler
  // per-record continuation logs the unknown-mandate case and moves on.
  // Locked 2026-07-01 per audit finding `camt-mndtid-fallback-mis-correlation`.
  it("does NOT fall back to MndtId when EndToEndId is missing", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>CAMT-MNDT-ONLY</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><MndtId>01HXMANDATEDDDDDDDDDDDDDDD</MndtId></Refs>
            <RtrInf><Rsn><Cd>AC04</Cd></Rsn></RtrInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
    const out = parseCamt054(xml);
    expect(out.reportId).toBe("CAMT-MNDT-ONLY");
    expect(out.mandates).toHaveLength(0);
  });
});

describe("parseCamt053", () => {
  it("parses a Stmt-rooted document with the same RtrInf semantics", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>STMT-001</MsgId></GrpHdr>
    <Stmt>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>M-STMT</EndToEndId></Refs>
            <RtrInf><Rsn><Cd>MD06</Cd></Rsn></RtrInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
    const out = parseCamt053(xml);
    expect(out.reportId).toBe("STMT-001");
    expect(out.mandates[0]?.outcome).toBe("DISPUTED");
  });

  it("rejects camt.054 XML when called as camt.053", () => {
    const xml = `<Document><BkToCstmrDbtCdtNtfctn><GrpHdr><MsgId>X</MsgId></GrpHdr></BkToCstmrDbtCdtNtfctn></Document>`;
    try {
      parseCamt053(xml);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as AppError).code).toBe("ERR_VALIDATION");
    }
  });
});
