import { describe, expect, it } from "vitest";
import { ULID_LEN, ulid } from "../../src/util/ulid.js";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe("ulid", () => {
  it("emits 26-char Crockford base32", () => {
    const v = ulid();
    expect(v.length).toBe(26);
    expect(v.length).toBe(ULID_LEN);
    expect(ULID_RE.test(v)).toBe(true);
  });

  it("monotonic within the same millisecond", () => {
    const t = 1_700_000_000_000;
    const a = ulid(t);
    const b = ulid(t);
    const c = ulid(t);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it("timestamp prefix sorts chronologically across ms boundaries", () => {
    const a = ulid(1_000);
    const b = ulid(2_000);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
  });

  it("rejects garbage timestamps", () => {
    expect(() => ulid(NaN)).toThrow();
    expect(() => ulid(-1)).toThrow();
  });

  it("randomness — successive calls without same-ms collision differ in random tail", () => {
    const a = ulid(1);
    const b = ulid(2);
    expect(a.slice(10)).not.toBe(b.slice(10));
  });
});
