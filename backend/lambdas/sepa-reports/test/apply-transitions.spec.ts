// Pure decision-layer tests. No storage seeding — we hand-build the mandate
// resolver Map to exercise every source-state × trigger combination.

import { describe, expect, it } from "vitest";

import {
  decideCamt053Batch,
  decideCamt054,
  decideCamt054Batch,
  decidePain002,
  decidePain002Batch,
  decideBatch,
} from "../src/apply-transitions.js";
import type { SepaMandate } from "@railback/lib/types/dto";
import type { MandateState } from "@railback/lib/types/enums";

function makeMandate(overrides: Partial<SepaMandate> & { mandate_id: string; ticketId: string; mandate_state: MandateState }): SepaMandate {
  const base: SepaMandate = {
    email: "u@example.com",
    ticketId: overrides.ticketId,
    mandate_id: overrides.mandate_id,
    mandate_state: overrides.mandate_state,
    sequence_type: "OOFF",
    fee_amount: "0.75",
    iban_enc: "enc-iban",
    bic_enc: "enc-bic",
    kontoinhaber_snapshot: "U Ser",
    user_consent_at: "2026-06-25T08:00:00.000Z",
    expires_at: "2029-06-25T08:00:00.000Z",
    issued_at: "2026-06-25T08:00:00.000Z",
  };
  return { ...base, ...overrides };
}

describe("decidePain002", () => {
  it("ACCEPTED → SKIP informational_accepted, no notify", () => {
    const m = makeMandate({ mandate_id: "M1", ticketId: "T1", mandate_state: "SUBMITTED" });
    const d = decidePain002({ mandateId: "M1", mandate: m }, "ACCEPTED", undefined);
    expect(d.action).toBe("SKIP");
    expect(d.skipReason).toBe("informational_accepted");
    expect(d.shouldNotify).toBe(false);
  });

  it("REJECTED on SUBMITTED with known reason → REVERSED + notify (user-fault code)", () => {
    const m = makeMandate({ mandate_id: "M2", ticketId: "T2", mandate_state: "SUBMITTED" });
    const d = decidePain002({ mandateId: "M2", mandate: m }, "REJECTED", "AC04");
    expect(d.action).toBe("REVERSED");
    expect(d.reasonCode).toBe("AC04");
    expect(d.shouldNotify).toBe(true);
    expect(d.classified?.description).toBe("Closed account");
  });

  it("REJECTED on SUBMITTED with our-fault reason → REVERSED, notify=false", () => {
    const m = makeMandate({ mandate_id: "M3", ticketId: "T3", mandate_state: "SUBMITTED" });
    const d = decidePain002({ mandateId: "M3", mandate: m }, "REJECTED", "AG02");
    expect(d.action).toBe("REVERSED");
    expect(d.shouldNotify).toBe(false);
  });

  it("REJECTED on ISSUED → SKIP illegal_transition (out-of-order report)", () => {
    const m = makeMandate({ mandate_id: "M4", ticketId: "T4", mandate_state: "ISSUED" });
    const d = decidePain002({ mandateId: "M4", mandate: m }, "REJECTED", "AC04");
    expect(d.action).toBe("SKIP");
    expect(d.skipReason).toBe("illegal_transition");
  });

  it("REJECTED on DEBITED → SKIP illegal_transition", () => {
    const m = makeMandate({ mandate_id: "M5", ticketId: "T5", mandate_state: "DEBITED" });
    const d = decidePain002({ mandateId: "M5", mandate: m }, "REJECTED", "AM04");
    expect(d.action).toBe("SKIP");
    expect(d.skipReason).toBe("illegal_transition");
  });

  it("REJECTED with mandate=null → SKIP unknown_mandate", () => {
    const d = decidePain002({ mandateId: "M6", mandate: null }, "REJECTED", "AC04");
    expect(d.action).toBe("SKIP");
    expect(d.skipReason).toBe("unknown_mandate");
  });

  it("REJECTED with unknown reason code → REVERSED but shouldNotify=false", () => {
    const m = makeMandate({ mandate_id: "M7", ticketId: "T7", mandate_state: "SUBMITTED" });
    const d = decidePain002({ mandateId: "M7", mandate: m }, "REJECTED", "ZZ99");
    expect(d.action).toBe("REVERSED");
    expect(d.reasonCode).toBe("ZZ99");
    expect(d.classified).toBeUndefined();
    expect(d.shouldNotify).toBe(false);
  });
});

describe("decideCamt054", () => {
  it("BOOKED on SUBMITTED → DEBITED, no notify", () => {
    const m = makeMandate({ mandate_id: "M10", ticketId: "T10", mandate_state: "SUBMITTED" });
    const d = decideCamt054({ mandateId: "M10", mandate: m }, "BOOKED", undefined);
    expect(d.action).toBe("DEBITED");
    expect(d.shouldNotify).toBe(false);
  });

  it("BOOKED on ISSUED → SKIP illegal_transition", () => {
    const m = makeMandate({ mandate_id: "M11", ticketId: "T11", mandate_state: "ISSUED" });
    const d = decideCamt054({ mandateId: "M11", mandate: m }, "BOOKED", undefined);
    expect(d.action).toBe("SKIP");
    expect(d.skipReason).toBe("illegal_transition");
  });

  it("REVERSED on SUBMITTED with AM04 → REVERSED, notify", () => {
    const m = makeMandate({ mandate_id: "M12", ticketId: "T12", mandate_state: "SUBMITTED" });
    const d = decideCamt054({ mandateId: "M12", mandate: m }, "REVERSED", "AM04");
    expect(d.action).toBe("REVERSED");
    expect(d.shouldNotify).toBe(true);
    expect(d.classified?.code).toBe("AM04");
  });

  it("REVERSED on DEBITED (post-booking return) → REVERSED", () => {
    const m = makeMandate({ mandate_id: "M13", ticketId: "T13", mandate_state: "DEBITED" });
    const d = decideCamt054({ mandateId: "M13", mandate: m }, "REVERSED", "MD07");
    expect(d.action).toBe("REVERSED");
    expect(d.shouldNotify).toBe(true);
  });

  it("REVERSED on ISSUED → SKIP illegal_transition", () => {
    const m = makeMandate({ mandate_id: "M14", ticketId: "T14", mandate_state: "ISSUED" });
    const d = decideCamt054({ mandateId: "M14", mandate: m }, "REVERSED", "AC04");
    expect(d.action).toBe("SKIP");
    expect(d.skipReason).toBe("illegal_transition");
  });

  it("DISPUTED on DEBITED (MD06) → DISPUTED + notify", () => {
    const m = makeMandate({ mandate_id: "M15", ticketId: "T15", mandate_state: "DEBITED" });
    const d = decideCamt054({ mandateId: "M15", mandate: m }, "DISPUTED", "MD06");
    expect(d.action).toBe("DISPUTED");
    expect(d.shouldNotify).toBe(true);
    expect(d.classified?.code).toBe("MD06");
  });

  it("DISPUTED on SUBMITTED → SKIP illegal_transition (dispute needs prior debit)", () => {
    const m = makeMandate({ mandate_id: "M16", ticketId: "T16", mandate_state: "SUBMITTED" });
    const d = decideCamt054({ mandateId: "M16", mandate: m }, "DISPUTED", "MD06");
    expect(d.action).toBe("SKIP");
    expect(d.skipReason).toBe("illegal_transition");
  });

  it("Any outcome with mandate=null → SKIP unknown_mandate", () => {
    const d = decideCamt054({ mandateId: "M17", mandate: null }, "BOOKED", undefined);
    expect(d.action).toBe("SKIP");
    expect(d.skipReason).toBe("unknown_mandate");
  });
});

describe("decideCamt053Batch", () => {
  it("every entry → SKIP informational_statement regardless of outcome/reason", () => {
    const decisions = decideCamt053Batch({
      reportId: "S1",
      mandates: [
        { mandateId: "M20", outcome: "BOOKED" },
        { mandateId: "M21", outcome: "REVERSED", reasonCode: "AC04" },
        { mandateId: "M22", outcome: "DISPUTED", reasonCode: "MD06" },
      ],
    });
    expect(decisions).toHaveLength(3);
    for (const d of decisions) {
      expect(d.action).toBe("SKIP");
      expect(d.skipReason).toBe("informational_statement");
      expect(d.shouldNotify).toBe(false);
    }
    expect(decisions[1]?.reasonCode).toBe("AC04");
  });
});

describe("decideBatch dispatch", () => {
  it("PAIN002 → decidePain002Batch", () => {
    const m = makeMandate({ mandate_id: "M30", ticketId: "T30", mandate_state: "SUBMITTED" });
    const resolver = new Map<string, SepaMandate | null>([["M30", m]]);
    const decisions = decideBatch(
      "PAIN002",
      {
        reportId: "R1",
        mandates: [{ mandateId: "M30", status: "REJECTED", reasonCode: "AC04" }],
      },
      resolver,
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("REVERSED");
  });

  it("CAMT054 → decideCamt054Batch", () => {
    const m = makeMandate({ mandate_id: "M31", ticketId: "T31", mandate_state: "SUBMITTED" });
    const resolver = new Map<string, SepaMandate | null>([["M31", m]]);
    const decisions = decideBatch(
      "CAMT054",
      { reportId: "R2", mandates: [{ mandateId: "M31", outcome: "BOOKED" }] },
      resolver,
    );
    expect(decisions[0]?.action).toBe("DEBITED");
  });

  it("CAMT053 → decideCamt053Batch (informational)", () => {
    const resolver = new Map<string, SepaMandate | null>();
    const decisions = decideBatch(
      "CAMT053",
      { reportId: "R3", mandates: [{ mandateId: "M32", outcome: "REVERSED", reasonCode: "AC04" }] },
      resolver,
    );
    expect(decisions[0]?.action).toBe("SKIP");
  });
});

describe("decidePain002Batch / decideCamt054Batch — multi-entry", () => {
  it("handles mixed known + unknown mandates in one report", () => {
    const known = makeMandate({ mandate_id: "K1", ticketId: "TK1", mandate_state: "SUBMITTED" });
    const resolver = new Map<string, SepaMandate | null>([
      ["K1", known],
      ["U1", null],
    ]);
    const decisions = decidePain002Batch(
      {
        reportId: "R4",
        mandates: [
          { mandateId: "K1", status: "REJECTED", reasonCode: "AC04" },
          { mandateId: "U1", status: "REJECTED", reasonCode: "AC04" },
        ],
      },
      resolver,
    );
    expect(decisions).toHaveLength(2);
    expect(decisions[0]?.action).toBe("REVERSED");
    expect(decisions[1]?.action).toBe("SKIP");
    expect(decisions[1]?.skipReason).toBe("unknown_mandate");
  });

  it("camt054 mixed outcomes over one batch", () => {
    const s1 = makeMandate({ mandate_id: "S1", ticketId: "TS1", mandate_state: "SUBMITTED" });
    const s2 = makeMandate({ mandate_id: "S2", ticketId: "TS2", mandate_state: "DEBITED" });
    const s3 = makeMandate({ mandate_id: "S3", ticketId: "TS3", mandate_state: "DEBITED" });
    const resolver = new Map<string, SepaMandate | null>([
      ["S1", s1],
      ["S2", s2],
      ["S3", s3],
    ]);
    const decisions = decideCamt054Batch(
      {
        reportId: "R5",
        mandates: [
          { mandateId: "S1", outcome: "BOOKED" },
          { mandateId: "S2", outcome: "REVERSED", reasonCode: "MD07" },
          { mandateId: "S3", outcome: "DISPUTED", reasonCode: "MD06" },
        ],
      },
      resolver,
    );
    expect(decisions.map((d) => d.action)).toEqual([
      "DEBITED",
      "REVERSED",
      "DISPUTED",
    ]);
  });
});
