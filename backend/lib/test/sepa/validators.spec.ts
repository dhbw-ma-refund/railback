import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/index.js";
import {
  assertValidIban,
  validateBic,
  validateGlaeubigerId,
  validateIban,
} from "../../src/sepa/validators.js";

describe("sepa validators", () => {
  it("validateIban accepts canonical DE IBAN", () => {
    expect(validateIban("DE89370400440532013000")).toEqual({ valid: true });
  });

  it("validateIban rejects bad checksum", () => {
    const r = validateIban("DE00370400440532013000");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("checksum");
  });

  it("validateIban rejects regex fail", () => {
    // Too short to match: 1-letter country code, no digits after
    const r = validateIban("X");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("format");
  });

  it("validateIban tolerates whitespace + lowercase", () => {
    expect(validateIban("de89 3704 0044 0532 0130 00")).toEqual({ valid: true });
  });

  it("validateBic accepts 11 chars", () => {
    expect(validateBic("COBADEFFXXX")).toEqual({ valid: true });
  });

  it("validateBic accepts 8 chars", () => {
    expect(validateBic("COBADEFF")).toEqual({ valid: true });
  });

  it("validateBic rejects short", () => {
    const r = validateBic("COBA");
    expect(r.valid).toBe(false);
  });

  it("validateGlaeubigerId accepts DE format", () => {
    expect(validateGlaeubigerId("DE98ZZZ09999999999")).toEqual({ valid: true });
  });

  it("validateGlaeubigerId rejects non-DE", () => {
    const r = validateGlaeubigerId("FR98ZZZ09999999999");
    expect(r.valid).toBe(false);
  });

  it("assertValidIban throws AppError ERR_VALIDATION on invalid", () => {
    try {
      assertValidIban("XY1234");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.code).toBe("ERR_VALIDATION");
      expect(err.details).toEqual({ field: "iban" });
    }
  });

  it("assertValidIban returns undefined on valid", () => {
    expect(assertValidIban("DE89370400440532013000")).toBeUndefined();
  });
});
