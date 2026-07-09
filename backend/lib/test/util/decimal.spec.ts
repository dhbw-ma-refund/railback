import { describe, expect, it } from "vitest";
import {
  addDecimal,
  cmpDecimal,
  formatEur,
  isZero,
  mulDecimal,
  parseDecimal,
  subDecimal,
  sumDecimals,
} from "../../src/util/decimal.js";

describe("decimal", () => {
  it("parseDecimal sign + scale", () => {
    expect(parseDecimal("10.50")).toEqual({ sign: 1, whole: 10n, fraction: 50n, scale: 2 });
    expect(parseDecimal("-3.25")).toEqual({ sign: -1, whole: 3n, fraction: 25n, scale: 2 });
    expect(parseDecimal("+0")).toEqual({ sign: 1, whole: 0n, fraction: 0n, scale: 0 });
  });

  it("parseDecimal rejects garbage", () => {
    expect(() => parseDecimal("abc")).toThrow();
    expect(() => parseDecimal("1.2.3")).toThrow();
    expect(() => parseDecimal("")).toThrow();
  });

  it("addDecimal", () => {
    expect(addDecimal("10.50", "0.25")).toBe("10.75");
    expect(addDecimal("-1.00", "1.00")).toBe("0.00");
    expect(addDecimal("0.10", "0.20")).toBe("0.30");
  });

  it("subDecimal", () => {
    expect(subDecimal("10.50", "0.50")).toBe("10.00");
    expect(subDecimal("0.00", "1.00")).toBe("-1.00");
  });

  it("mulDecimal half-even rounding", () => {
    // 0.255 * 1 → 0.26 (round half to even, last kept digit 5→6 because 5 is odd, half-even goes to 6 only if next is non-zero; here exactly half so to-even = 26 since 5 is odd → 6)
    expect(mulDecimal("0.255", 1)).toBe("0.26");
    // 0.245 * 1 → 0.24 (half-even: 4 is even, stays)
    expect(mulDecimal("0.245", 1)).toBe("0.24");
    // 0.50 * 0.5 = 0.25
    expect(mulDecimal("0.50", 0.5)).toBe("0.25");
    // 100.00 * 0.25 = 25.00
    expect(mulDecimal("100.00", 0.25)).toBe("25.00");
    // 100.00 * 0.5 = 50.00
    expect(mulDecimal("100.00", 0.5)).toBe("50.00");
    // negative
    expect(mulDecimal("-10.00", 0.25)).toBe("-2.50");
  });

  it("sumDecimals", () => {
    expect(sumDecimals([])).toBe("0.00");
    expect(sumDecimals(["1.00", "2.50", "0.25"])).toBe("3.75");
    expect(sumDecimals(["100.00", "-50.00", "-50.00"])).toBe("0.00");
  });

  it("cmpDecimal", () => {
    expect(cmpDecimal("1.00", "1.00")).toBe(0);
    expect(cmpDecimal("1.00", "2.00")).toBe(-1);
    expect(cmpDecimal("3.00", "2.99")).toBe(1);
    expect(cmpDecimal("1.0", "1.00")).toBe(0);
    expect(cmpDecimal("-1.00", "1.00")).toBe(-1);
  });

  it("isZero accepts variants", () => {
    expect(isZero("0.00")).toBe(true);
    expect(isZero("0")).toBe(true);
    expect(isZero("0.0")).toBe(true);
    expect(isZero("+0.00")).toBe(true);
    expect(isZero("-0.00")).toBe(true);
    expect(isZero("0.01")).toBe(false);
  });

  it("formatEur", () => {
    expect(formatEur("10.50")).toBe("10,50 EUR");
    expect(formatEur("0.00")).toBe("0,00 EUR");
    expect(formatEur("1234.56")).toBe("1234,56 EUR");
    expect(formatEur("-3.25")).toBe("-3,25 EUR");
  });

  it("large bigint values stay exact", () => {
    expect(addDecimal("999999999999999.99", "0.01")).toBe("1000000000000000.00");
  });
});
