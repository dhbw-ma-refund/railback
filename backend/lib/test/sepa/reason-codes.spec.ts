import { describe, it, expect } from "vitest";
import { REASON_CODE_TABLE, classifyReasonCode, type ReasonCode } from "../../src/sepa/reason-codes.js";

type Expected = { mapsTo: "REVERSED" | "DISPUTED"; userNotify: boolean };

const EXPECTED: Record<ReasonCode, Expected> = {
  AC04: { mapsTo: "REVERSED", userNotify: true },
  AC06: { mapsTo: "REVERSED", userNotify: true },
  AC13: { mapsTo: "REVERSED", userNotify: true },
  AG01: { mapsTo: "REVERSED", userNotify: true },
  AG02: { mapsTo: "REVERSED", userNotify: false },
  AM04: { mapsTo: "REVERSED", userNotify: true },
  AM05: { mapsTo: "REVERSED", userNotify: false },
  BE05: { mapsTo: "REVERSED", userNotify: false },
  MD01: { mapsTo: "REVERSED", userNotify: true },
  MD02: { mapsTo: "REVERSED", userNotify: false },
  MD06: { mapsTo: "DISPUTED", userNotify: true },
  MD07: { mapsTo: "REVERSED", userNotify: true },
  MS02: { mapsTo: "REVERSED", userNotify: true },
  MS03: { mapsTo: "REVERSED", userNotify: true },
  RC01: { mapsTo: "REVERSED", userNotify: false },
  SL01: { mapsTo: "REVERSED", userNotify: true },
  TM01: { mapsTo: "REVERSED", userNotify: false },
};

describe("REASON_CODE_TABLE", () => {
  it("contains all 17 codes", () => {
    expect(Object.keys(REASON_CODE_TABLE)).toHaveLength(17);
  });

  for (const [code, exp] of Object.entries(EXPECTED) as Array<[ReasonCode, Expected]>) {
    it(`${code} maps to ${exp.mapsTo}, userNotify=${exp.userNotify}`, () => {
      const row = REASON_CODE_TABLE[code];
      expect(row.code).toBe(code);
      expect(row.mapsTo).toBe(exp.mapsTo);
      expect(row.userNotify).toBe(exp.userNotify);
      expect(row.description.length).toBeGreaterThan(0);
    });
  }

  it("only MD06 maps to DISPUTED", () => {
    const disputed = Object.values(REASON_CODE_TABLE).filter((r) => r.mapsTo === "DISPUTED");
    expect(disputed.map((r) => r.code)).toEqual(["MD06"]);
  });
});

describe("classifyReasonCode", () => {
  it("returns the table row for a known code", () => {
    expect(classifyReasonCode("AC04")).toEqual(REASON_CODE_TABLE.AC04);
  });

  it("is case-insensitive", () => {
    expect(classifyReasonCode("md06")).toEqual(REASON_CODE_TABLE.MD06);
  });

  it("returns null for unknown codes", () => {
    expect(classifyReasonCode("ZZ99")).toBeNull();
    expect(classifyReasonCode("")).toBeNull();
    expect(classifyReasonCode("AC0")).toBeNull();
  });
});
