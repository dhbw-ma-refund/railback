// Snapshot test pins the rendered pain.008.001.09 XML byte-for-byte.
// SEPA_PAIN008.md is the prose contract; this test is the executable one.
// Any change to the XML shape (added/dropped element, attribute order,
// indentation) must be reviewed in the diff of the inline snapshot below.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPain008Xml } from "../../src/sepa/pain008.js";
import type { SepaMandate } from "../../src/types/dto.js";

const ENV_KEYS = [
  "RAILBACK_SEPA_KONTOINHABER",
  "RAILBACK_SEPA_IBAN_OWN",
  "RAILBACK_SEPA_BIC_OWN",
  "RAILBACK_SEPA_GLAEUBIGER_ID",
] as const;

function stubEnv() {
  process.env.RAILBACK_SEPA_KONTOINHABER = "RailBack GmbH";
  process.env.RAILBACK_SEPA_IBAN_OWN = "DE89370400440532013000";
  process.env.RAILBACK_SEPA_BIC_OWN = "COBADEFFXXX";
  process.env.RAILBACK_SEPA_GLAEUBIGER_ID = "DE98ZZZ09999999999";
}

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  stubEnv();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function fixedMandate(overrides: Partial<SepaMandate> = {}): SepaMandate {
  return {
    email: "user@example.com",
    ticketId: "01HTTTTTTTTTTTTTTTTTTTTTTT",
    mandate_id: "01HMMMMMMMMMMMMMMMMMMMMMMM",
    mandate_state: "ISSUED",
    sequence_type: "OOFF",
    fee_amount: "0.75",
    iban_enc: "enc-iban",
    bic_enc: "enc-bic",
    kontoinhaber_snapshot: "Max Mustermann",
    user_consent_at: "2026-06-15T10:30:00Z",
    vorabankuendigung_sent_at: "2026-06-15T10:30:00Z",
    expires_at: "2029-06-15T10:30:00Z",
    issued_at: "2026-06-15T10:30:00Z",
    ...overrides,
  };
}

describe("buildPain008Xml — snapshot", () => {
  it("renders byte-stable XML for a deterministic input", () => {
    const xml = buildPain008Xml({
      batchId: "01HBBBBBBBBBBBBBBBBBBBBBBB",
      builtAt: "2026-06-15T12:00:00Z",
      mandate: fixedMandate(),
      ticket: { ticketId: "01HTTTTTTTTTTTTTTTTTTTTTTT" },
      debtorIbanPlain: "DE89370400440532013000",
      debtorBicPlain: "COBADEFFXXX",
    });
    expect(xml).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.09">
        <CstmrDrctDbtInitn>
          <GrpHdr>
            <MsgId>01HBBBBBBBBBBBBBBBBBBBBBBB</MsgId>
            <CreDtTm>2026-06-15T12:00:00Z</CreDtTm>
            <NbOfTxs>1</NbOfTxs>
            <CtrlSum>0.75</CtrlSum>
            <InitgPty>
              <Nm>RailBack GmbH</Nm>
            </InitgPty>
          </GrpHdr>
          <PmtInf>
            <PmtInfId>01HBBBBBBBBBBBBBBBBBBBBBBB</PmtInfId>
            <PmtMtd>DD</PmtMtd>
            <NbOfTxs>1</NbOfTxs>
            <CtrlSum>0.75</CtrlSum>
            <PmtTpInf>
              <SvcLvl>
                <Cd>SEPA</Cd>
              </SvcLvl>
              <LclInstrm>
                <Cd>CORE</Cd>
              </LclInstrm>
              <SeqTp>OOFF</SeqTp>
            </PmtTpInf>
            <ReqdColltnDt>2026-06-16</ReqdColltnDt>
            <Cdtr>
              <Nm>RailBack GmbH</Nm>
            </Cdtr>
            <CdtrAcct>
              <Id>
                <IBAN>DE89370400440532013000</IBAN>
              </Id>
            </CdtrAcct>
            <CdtrAgt>
              <FinInstnId>
                <BICFI>COBADEFFXXX</BICFI>
              </FinInstnId>
            </CdtrAgt>
            <ChrgBr>SLEV</ChrgBr>
            <CdtrSchmeId>
              <Id>
                <PrvtId>
                  <Othr>
                    <Id>DE98ZZZ09999999999</Id>
                    <SchmeNm>
                      <Prtry>SEPA</Prtry>
                    </SchmeNm>
                  </Othr>
                </PrvtId>
              </Id>
            </CdtrSchmeId>
            <DrctDbtTxInf>
              <PmtId>
                <EndToEndId>01HMMMMMMMMMMMMMMMMMMMMMMM</EndToEndId>
              </PmtId>
              <InstdAmt Ccy="EUR">0.75</InstdAmt>
              <DrctDbtTx>
                <MndtRltdInf>
                  <MndtId>01HMMMMMMMMMMMMMMMMMMMMMMM</MndtId>
                  <DtOfSgntr>2026-06-15</DtOfSgntr>
                </MndtRltdInf>
              </DrctDbtTx>
              <DbtrAgt>
                <FinInstnId>
                  <BICFI>COBADEFFXXX</BICFI>
                </FinInstnId>
              </DbtrAgt>
              <Dbtr>
                <Nm>Max Mustermann</Nm>
              </Dbtr>
              <DbtrAcct>
                <Id>
                  <IBAN>DE89370400440532013000</IBAN>
                </Id>
              </DbtrAcct>
              <RmtInf>
                <Ustrd>RailBack Service-Fee Antrag #01HTTTTTTTTTTTTTTTTTTTTTTT Mandat 01HMMMMMMMMMMMMMMMMMMMMMMM</Ustrd>
              </RmtInf>
            </DrctDbtTxInf>
          </PmtInf>
        </CstmrDrctDbtInitn>
      </Document>
      "
    `);
  });

  it("truncates kontoinhaber_snapshot to 70 chars in <Dbtr><Nm>", () => {
    // 100 chars (max per nachname schema), but vorname+nachname concat could
    // be ~201 chars total — we still cap at SEPA Max70Text.
    const longName = "X".repeat(100);
    const xml = buildPain008Xml({
      batchId: "01HBBBBBBBBBBBBBBBBBBBBBBB",
      builtAt: "2026-06-15T12:00:00Z",
      mandate: fixedMandate({ kontoinhaber_snapshot: longName }),
      ticket: { ticketId: "01HTTTTTTTTTTTTTTTTTTTTTTT" },
      debtorIbanPlain: "DE89370400440532013000",
      debtorBicPlain: "COBADEFFXXX",
    });
    const m = /<Dbtr>\s*<Nm>([^<]*)<\/Nm>\s*<\/Dbtr>/.exec(xml);
    expect(m).not.toBeNull();
    const rendered = m![1]!;
    expect(rendered.length).toBe(70);
    expect(rendered).toBe("X".repeat(70));
  });

  it("does not emit the dropped InitgPty.Id (Gläubiger-ID belongs only in CdtrSchmeId)", () => {
    const xml = buildPain008Xml({
      batchId: "01HBBBBBBBBBBBBBBBBBBBBBBB",
      builtAt: "2026-06-15T12:00:00Z",
      mandate: fixedMandate(),
      ticket: { ticketId: "01HTTTTTTTTTTTTTTTTTTTTTTT" },
      debtorIbanPlain: "DE89370400440532013000",
      debtorBicPlain: "COBADEFFXXX",
    });
    // The dropped block was an `<Id><PrvtId>` directly inside `<InitgPty>`.
    // CdtrSchmeId still has a PrvtId — pin on the InitgPty/Id adjacency.
    expect(xml).not.toMatch(/<InitgPty>[\s\S]*?<Id>[\s\S]*?<\/InitgPty>/);
    // And exactly one PrvtId in the whole document (the CdtrSchmeId one).
    expect(xml.match(/<PrvtId>/g)?.length).toBe(1);
  });
});
