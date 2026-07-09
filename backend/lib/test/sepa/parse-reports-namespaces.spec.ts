// Regression tests for the P1 parse-reports bugs:
//
//   1. Namespace-aware traversal — banks are free to bind ISO-20022 either
//      to the default namespace (`<Document xmlns="urn:iso:...">`) or to a
//      prefix (`<ns:Document xmlns:ns="urn:iso:...">…</ns:Document>`).
//      Without `removeNSPrefix: true` on the XMLParser, the prefixed form
//      lands as `tree["ns:Document"]` and every `getNode(tree, "Document", …)`
//      path lookup below the root returns undefined, tripping the missing-
//      root ERR_VALIDATION throw.
//
//   2. Multi-NtryDtls — a single `<Ntry>` may carry multiple `<NtryDtls>`
//      siblings (each with its own `<TxDtls>[]`). The old parser hopped
//      `Ntry -> NtryDtls -> TxDtls` in one getNode() call, which silently
//      returns undefined when NtryDtls is a collapsed array, dropping every
//      entry past the first NtryDtls block.
//
// These tests would have failed against the pre-fix parser.
import { describe, expect, it } from "vitest";
import {
  parseCamt054,
  parsePain002,
} from "../../src/sepa/parse-reports.js";

describe("parsePain002 — namespaces", () => {
  it("parses pain.002 with a default xmlns on Document", () => {
    // Default-ns case did work pre-fix (fast-xml-parser leaves default-ns
    // element names unprefixed), but pin the behaviour so removeNSPrefix
    // doesn't regress it.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.11">
  <CstmrPmtStsRpt>
    <GrpHdr><MsgId>REP-NS-1</MsgId></GrpHdr>
    <OrgnlPmtInfAndSts>
      <TxInfAndSts>
        <OrgnlEndToEndId>M-NS-1</OrgnlEndToEndId>
        <TxSts>ACSP</TxSts>
      </TxInfAndSts>
    </OrgnlPmtInfAndSts>
  </CstmrPmtStsRpt>
</Document>`;
    const out = parsePain002(xml);
    expect(out.reportId).toBe("REP-NS-1");
    expect(out.mandates).toHaveLength(1);
    expect(out.mandates[0]).toEqual({
      mandateId: "M-NS-1",
      status: "ACCEPTED",
    });
  });

  it("parses pain.002 with a prefixed namespace on every element", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Doc:Document xmlns:Doc="urn:iso:std:iso:20022:tech:xsd:pain.002.001.11">
  <Doc:CstmrPmtStsRpt>
    <Doc:GrpHdr><Doc:MsgId>REP-NS-2</Doc:MsgId></Doc:GrpHdr>
    <Doc:OrgnlPmtInfAndSts>
      <Doc:TxInfAndSts>
        <Doc:OrgnlEndToEndId>M-NS-2</Doc:OrgnlEndToEndId>
        <Doc:TxSts>RJCT</Doc:TxSts>
        <Doc:StsRsnInf><Doc:Rsn><Doc:Cd>AC04</Doc:Cd></Doc:Rsn></Doc:StsRsnInf>
      </Doc:TxInfAndSts>
    </Doc:OrgnlPmtInfAndSts>
  </Doc:CstmrPmtStsRpt>
</Doc:Document>`;
    const out = parsePain002(xml);
    expect(out.reportId).toBe("REP-NS-2");
    expect(out.mandates).toHaveLength(1);
    expect(out.mandates[0]).toEqual({
      mandateId: "M-NS-2",
      status: "REJECTED",
      reasonCode: "AC04",
    });
  });
});

describe("parseCamt054 — namespaces and multi-NtryDtls", () => {
  it("parses camt.054 with a prefixed namespace on every element", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ns:Document xmlns:ns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
  <ns:BkToCstmrDbtCdtNtfctn>
    <ns:GrpHdr><ns:MsgId>CAMT-NS-1</ns:MsgId></ns:GrpHdr>
    <ns:Ntfctn>
      <ns:Ntry>
        <ns:NtryDtls>
          <ns:TxDtls>
            <ns:Refs><ns:EndToEndId>M-NS-CAMT-1</ns:EndToEndId></ns:Refs>
          </ns:TxDtls>
        </ns:NtryDtls>
      </ns:Ntry>
    </ns:Ntfctn>
  </ns:BkToCstmrDbtCdtNtfctn>
</ns:Document>`;
    const out = parseCamt054(xml);
    expect(out.reportId).toBe("CAMT-NS-1");
    expect(out.mandates).toEqual([
      { mandateId: "M-NS-CAMT-1", outcome: "BOOKED" },
    ]);
  });

  it("returns ALL mandates when a single Ntry carries multiple NtryDtls siblings", () => {
    // Pre-fix: parser walked Ntry -> NtryDtls -> TxDtls via one getNode()
    // call; only M-A (from the first NtryDtls) would be returned. The second
    // (M-B, DISPUTED) and third (M-C, REVERSED via AC04) would be silently
    // dropped.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>CAMT-MULTI-1</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>M-A</EndToEndId></Refs>
          </TxDtls>
        </NtryDtls>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>M-B</EndToEndId></Refs>
            <RtrInf><Rsn><Cd>MD06</Cd></Rsn></RtrInf>
          </TxDtls>
        </NtryDtls>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>M-C</EndToEndId></Refs>
            <RtrInf><Rsn><Cd>AC04</Cd></Rsn></RtrInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
    const out = parseCamt054(xml);
    expect(out.mandates).toHaveLength(3);
    expect(out.mandates.map((m) => m.mandateId)).toEqual([
      "M-A",
      "M-B",
      "M-C",
    ]);
    expect(out.mandates.map((m) => m.outcome)).toEqual([
      "BOOKED",
      "DISPUTED",
      "REVERSED",
    ]);
    expect(out.mandates[1]?.reasonCode).toBe("MD06");
    expect(out.mandates[2]?.reasonCode).toBe("AC04");
  });

  it("combines default-ns + multi-NtryDtls + multi-TxDtls in one document", () => {
    // Real-world shape: bank uses default namespace, one Ntry with two
    // NtryDtls blocks, and the second block itself carries two TxDtls
    // siblings (a legitimate ISO-20022 shape). All four mandates must land.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>CAMT-MULTI-2</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <NtryDtls>
          <TxDtls><Refs><EndToEndId>M-1</EndToEndId></Refs></TxDtls>
        </NtryDtls>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>M-2</EndToEndId></Refs>
            <RtrInf><Rsn><Cd>AM04</Cd></Rsn></RtrInf>
          </TxDtls>
          <TxDtls>
            <Refs><EndToEndId>M-3</EndToEndId></Refs>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>M-4</EndToEndId></Refs>
            <RtrInf><Rsn><Cd>MD06</Cd></Rsn></RtrInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
    const out = parseCamt054(xml);
    expect(out.mandates).toHaveLength(4);
    expect(out.mandates.map((m) => m.mandateId)).toEqual([
      "M-1",
      "M-2",
      "M-3",
      "M-4",
    ]);
    expect(out.mandates.map((m) => m.outcome)).toEqual([
      "BOOKED",
      "REVERSED",
      "BOOKED",
      "DISPUTED",
    ]);
  });
});
