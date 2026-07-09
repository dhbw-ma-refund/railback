import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/index.js";
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

function validMandate(overrides: Partial<SepaMandate> = {}): SepaMandate {
  return {
    email: "user@example.com",
    ticketId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    mandate_id: "01HMMMMMMMMMMMMMMMMMMMMMMM",
    mandate_state: "ISSUED",
    sequence_type: "OOFF",
    fee_amount: "5.00",
    iban_enc: "enc-iban",
    bic_enc: "enc-bic",
    kontoinhaber_snapshot: "Max Mustermann",
    user_consent_at: "2026-06-15T10:30:00Z",
    // Vorabankündigung is sent at mandate-issue time per CLAUDE.md; pain008
    // builder requires the field to be set before render. Same instant as
    // user_consent_at is fine — the ≥1-calendar-day window is enforced
    // against builtAt by computeReqdColltnDt.
    vorabankuendigung_sent_at: "2026-06-15T10:30:00Z",
    expires_at: "2029-06-15T10:30:00Z",
    issued_at: "2026-06-15T10:30:00Z",
    ...overrides,
  };
}

const DEBTOR_IBAN = "DE89370400440532013000";
const DEBTOR_BIC = "COBADEFFXXX";

function validInput(overrides: Partial<Parameters<typeof buildPain008Xml>[0]> = {}) {
  return {
    batchId: "01HBBBBBBBBBBBBBBBBBBBBBBB",
    builtAt: "2026-06-15T12:00:00Z", // Monday
    mandate: validMandate(),
    ticket: { ticketId: "TCK-001" },
    debtorIbanPlain: DEBTOR_IBAN,
    debtorBicPlain: DEBTOR_BIC,
    ...overrides,
  };
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

describe("buildPain008Xml — happy path", () => {
  it("emits well-formed pain.008.001.09 XML with required positions", () => {
    const xml = buildPain008Xml(validInput());
    expect(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")).toBe(true);
    expect(xml).toContain("xmlns=\"urn:iso:std:iso:20022:tech:xsd:pain.008.001.09\"");
    expect(xml).toContain("<MsgId>01HBBBBBBBBBBBBBBBBBBBBBBB</MsgId>");
    expect(xml).toContain("<CtrlSum>5.00</CtrlSum>");
    expect(xml).toContain("<EndToEndId>01HMMMMMMMMMMMMMMMMMMMMMMM</EndToEndId>");
    expect(xml).toContain(`<IBAN>${DEBTOR_IBAN}</IBAN>`);
    expect(xml).toContain("<Dbtr>\n          <Nm>Max Mustermann</Nm>\n        </Dbtr>");
    expect(xml).toContain("<SeqTp>OOFF</SeqTp>");
    expect(xml).toContain("<ChrgBr>SLEV</ChrgBr>");
    expect(xml).toContain("<Id>DE98ZZZ09999999999</Id>");
    expect(xml).toContain(
      "<Ustrd>RailBack Service-Fee Antrag #TCK-001 Mandat 01HMMMMMMMMMMMMMMMMMMMMMMM</Ustrd>"
    );
    expect(xml).toContain("<InstdAmt Ccy=\"EUR\">5.00</InstdAmt>");
    expect(xml).toContain("<DtOfSgntr>2026-06-15</DtOfSgntr>");
  });
});

describe("buildPain008Xml — validation", () => {
  it("throws ERR_VALIDATION on fee_amount = 0.00", () => {
    expect(() => buildPain008Xml(validInput({ mandate: validMandate({ fee_amount: "0.00" }) })))
      .toThrowError(AppError);
    try {
      buildPain008Xml(validInput({ mandate: validMandate({ fee_amount: "0.00" }) }));
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_VALIDATION");
    }
  });

  it("throws ERR_VALIDATION when mandate_state !== ISSUED", () => {
    expect(() => buildPain008Xml(validInput({
      mandate: validMandate({ mandate_state: "SUBMITTED" }),
    }))).toThrow(AppError);
  });

  it("throws ERR_VALIDATION when pain008_built_at already set (idempotency)", () => {
    expect(() => buildPain008Xml(validInput({
      mandate: validMandate({ pain008_built_at: "2026-06-15T11:00:00Z" }),
    }))).toThrow(AppError);
  });

  it("throws ERR_VALIDATION when expires_at <= builtAt", () => {
    expect(() => buildPain008Xml(validInput({
      builtAt: "2026-06-15T12:00:00Z",
      mandate: validMandate({ expires_at: "2026-06-15T11:00:00Z" }),
    }))).toThrow(AppError);
  });

  it("throws ERR_VALIDATION on invalid debtor IBAN", () => {
    expect(() => buildPain008Xml(validInput({
      debtorIbanPlain: "NOTANIBAN",
    }))).toThrow(AppError);
  });

  it("throws ERR_INTERNAL when env var missing", () => {
    delete process.env.RAILBACK_SEPA_GLAEUBIGER_ID;
    try {
      buildPain008Xml(validInput());
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("ERR_INTERNAL");
    }
  });
});

describe("buildPain008Xml — ReqdColltnDt roll-forward", () => {
  function extractReqdColltnDt(xml: string): string {
    const m = /<ReqdColltnDt>(.+?)<\/ReqdColltnDt>/.exec(xml);
    if (!m || m[1] === undefined) throw new Error("no ReqdColltnDt in xml");
    return m[1];
  }

  it("Mon-Thu builtAt → +1 day", () => {
    // Monday 2026-06-15 → Tuesday 2026-06-16
    const xml = buildPain008Xml(validInput({ builtAt: "2026-06-15T12:00:00Z" }));
    expect(extractReqdColltnDt(xml)).toBe("2026-06-16");
    // Thursday 2026-06-18 → Friday 2026-06-19
    const xml2 = buildPain008Xml(validInput({ builtAt: "2026-06-18T12:00:00Z" }));
    expect(extractReqdColltnDt(xml2)).toBe("2026-06-19");
  });

  it("Friday builtAt → Monday", () => {
    // Friday 2026-06-19 → +1 = Sat 06-20 → roll → Mon 2026-06-22
    const xml = buildPain008Xml(validInput({ builtAt: "2026-06-19T12:00:00Z" }));
    expect(extractReqdColltnDt(xml)).toBe("2026-06-22");
  });

  it("Saturday builtAt → Monday", () => {
    // Saturday 2026-06-20 → +1 = Sun 06-21 → roll → Mon 2026-06-22
    const xml = buildPain008Xml(validInput({ builtAt: "2026-06-20T12:00:00Z" }));
    expect(extractReqdColltnDt(xml)).toBe("2026-06-22");
  });

  it("Sunday builtAt → Monday", () => {
    // Sunday 2026-06-21 → +1 = Mon 06-22 (business day)
    const xml = buildPain008Xml(validInput({ builtAt: "2026-06-21T12:00:00Z" }));
    expect(extractReqdColltnDt(xml)).toBe("2026-06-22");
  });

  it("skips fixed holidays (Dec 25/26)", () => {
    // Wed 2026-12-23 → +1 = Thu 12-24 (business day, not a fixed holiday in our minimal calendar)
    const xml = buildPain008Xml(validInput({
      builtAt: "2026-12-23T12:00:00Z",
      mandate: validMandate({ expires_at: "2027-12-23T12:00:00Z" }),
    }));
    expect(extractReqdColltnDt(xml)).toBe("2026-12-24");
    // Thu 2026-12-24 → +1 = Fri 12-25 (holiday) → Sat 12-26 (holiday) → Sun 12-27 → Mon 12-28
    const xml2 = buildPain008Xml(validInput({
      builtAt: "2026-12-24T12:00:00Z",
      mandate: validMandate({ expires_at: "2027-12-24T12:00:00Z" }),
    }));
    expect(extractReqdColltnDt(xml2)).toBe("2026-12-28");
  });

  // Malformed vorabankuendigung_sent_at must throw ERR_VALIDATION, not
  // silently degrade to builtAt-only. Silent degradation weakens the
  // ≥1-day pre-notification guarantee whenever the stored value is
  // corrupt / tooling-bypassed. Locked 2026-07-01 per audit finding
  // `vorab-silent-degrade`.
  it("throws ERR_VALIDATION when mandate.vorabankuendigung_sent_at is malformed", () => {
    try {
      buildPain008Xml(
        validInput({
          mandate: validMandate({
            vorabankuendigung_sent_at: "not-a-real-timestamp",
          }),
        }),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const app = err as AppError;
      expect(app.code).toBe("ERR_VALIDATION");
      expect(app.message).toContain("vorabankuendigung_sent_at");
      expect(app.details?.["field"]).toBe("mandate.vorabankuendigung_sent_at");
    }
  });
});

describe("buildPain008Xml — XML escaping and umlauts", () => {
  it("escapes & in kontoinhaber_snapshot", () => {
    const xml = buildPain008Xml(validInput({
      mandate: validMandate({ kontoinhaber_snapshot: "Müller & Söhne" }),
    }));
    expect(xml).toContain("<Nm>Müller &amp; Söhne</Nm>");
    expect(xml).not.toContain("Müller & Söhne</Nm>");
  });

  it("preserves umlauts verbatim (no escaping for non-ASCII)", () => {
    const xml = buildPain008Xml(validInput({
      mandate: validMandate({ kontoinhaber_snapshot: "Müller" }),
    }));
    expect(xml).toContain("<Nm>Müller</Nm>");
  });
});
