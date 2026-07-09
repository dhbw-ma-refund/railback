import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/index.js";
import { deriveAntragsart } from "../../src/refund/derive-antragsart.js";
import type { Antragsart, Antragsgrund } from "../../src/types/enums.js";

interface Case {
  name: string;
  input: {
    delayMinutes: number;
    anyCancelled: boolean;
    antragsgrund: Antragsgrund[];
    hasBelege: boolean;
    isZeitkarte: boolean;
    override?: Antragsart;
  };
  expected: Antragsart;
}

const CASES: Case[] = [
  {
    name: "override wins over auto-derivation",
    input: {
      delayMinutes: 200,
      anyCancelled: true,
      antragsgrund: ["AUSFALL"],
      hasBelege: true,
      isZeitkarte: true,
      override: "ENTSCHAEDIGUNG_60_119",
    },
    expected: "ENTSCHAEDIGUNG_60_119",
  },
  {
    name: "AUSFALL via antragsgrund → ERSTATTUNG_FAHRKARTE",
    input: {
      delayMinutes: 30,
      anyCancelled: false,
      antragsgrund: ["AUSFALL"],
      hasBelege: false,
      isZeitkarte: false,
    },
    expected: "ERSTATTUNG_FAHRKARTE",
  },
  {
    name: "anyCancelled overrides zeitkarte",
    input: {
      delayMinutes: 30,
      anyCancelled: true,
      antragsgrund: ["VERSPAETUNG"],
      hasBelege: false,
      isZeitkarte: true,
    },
    expected: "ERSTATTUNG_FAHRKARTE",
  },
  {
    name: "zeitkarte (no cancel, no AUSFALL) → ZEITKARTE pauschale",
    input: {
      delayMinutes: 75,
      anyCancelled: false,
      antragsgrund: ["VERSPAETUNG"],
      hasBelege: false,
      isZeitkarte: true,
    },
    expected: "ENTSCHAEDIGUNG_ZEITKARTE",
  },
  {
    name: "belege + VERSPAETUNG → KOSTEN_ALTERNATIVTRANSPORT",
    input: {
      delayMinutes: 90,
      anyCancelled: false,
      antragsgrund: ["VERSPAETUNG"],
      hasBelege: true,
      isZeitkarte: false,
    },
    expected: "KOSTEN_ALTERNATIVTRANSPORT",
  },
  {
    name: "belege + VERPASSTER_ANSCHLUSS → KOSTEN_ALTERNATIVTRANSPORT",
    input: {
      delayMinutes: 65,
      anyCancelled: false,
      antragsgrund: ["VERPASSTER_ANSCHLUSS"],
      hasBelege: true,
      isZeitkarte: false,
    },
    expected: "KOSTEN_ALTERNATIVTRANSPORT",
  },
  {
    name: "belege without delay-grund falls through to delay tier",
    input: {
      delayMinutes: 130,
      anyCancelled: false,
      antragsgrund: [],
      hasBelege: true,
      isZeitkarte: false,
    },
    expected: "ENTSCHAEDIGUNG_120_PLUS",
  },
  {
    name: ">= 120 → ENTSCHAEDIGUNG_120_PLUS",
    input: {
      delayMinutes: 120,
      anyCancelled: false,
      antragsgrund: ["VERSPAETUNG"],
      hasBelege: false,
      isZeitkarte: false,
    },
    expected: "ENTSCHAEDIGUNG_120_PLUS",
  },
  {
    name: "60-119 → ENTSCHAEDIGUNG_60_119",
    input: {
      delayMinutes: 60,
      anyCancelled: false,
      antragsgrund: ["VERSPAETUNG"],
      hasBelege: false,
      isZeitkarte: false,
    },
    expected: "ENTSCHAEDIGUNG_60_119",
  },
  {
    name: "upper edge of 60-119 tier",
    input: {
      delayMinutes: 119,
      anyCancelled: false,
      antragsgrund: ["VERSPAETUNG"],
      hasBelege: false,
      isZeitkarte: false,
    },
    expected: "ENTSCHAEDIGUNG_60_119",
  },
];

describe("deriveAntragsart", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(deriveAntragsart(c.input)).toBe(c.expected);
    });
  }

  it("throws ERR_VALIDATION when override is not a valid antragsart", () => {
    try {
      deriveAntragsart({
        delayMinutes: 0,
        anyCancelled: false,
        antragsgrund: [],
        hasBelege: false,
        isZeitkarte: false,
        override: "BOGUS" as Antragsart,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const ae = err as AppError;
      expect(ae.code).toBe("ERR_VALIDATION");
      expect(ae.details?.field).toBe("antragsart");
    }
  });

  it("throws ERR_NO_CLAIM for sub-60 delay without any other claim path", () => {
    try {
      deriveAntragsart({
        delayMinutes: 45,
        anyCancelled: false,
        antragsgrund: ["VERSPAETUNG"],
        hasBelege: false,
        isZeitkarte: false,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("ERR_NO_CLAIM");
    }
  });

  it("throws ERR_NO_CLAIM when zero delay and no other path", () => {
    try {
      deriveAntragsart({
        delayMinutes: 0,
        anyCancelled: false,
        antragsgrund: [],
        hasBelege: false,
        isZeitkarte: false,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as AppError).code).toBe("ERR_NO_CLAIM");
    }
  });

  it("accepts a valid override even if a different antragsart would auto-derive", () => {
    const result = deriveAntragsart({
      delayMinutes: 130,
      anyCancelled: false,
      antragsgrund: ["VERSPAETUNG"],
      hasBelege: false,
      isZeitkarte: false,
      override: "KOSTEN_ALTERNATIVTRANSPORT",
    });
    expect(result).toBe("KOSTEN_ALTERNATIVTRANSPORT");
  });
});
