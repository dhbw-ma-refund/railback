import { describe, expect, it } from "vitest";
import { emailHash, sha256Hex } from "../../src/util/hash.js";

describe("hash", () => {
  it("sha256Hex produces 64-char hex", () => {
    const h = sha256Hex("hello");
    expect(h.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
  });

  it("sha256Hex deterministic", () => {
    expect(sha256Hex("x")).toBe(sha256Hex("x"));
  });

  it("emailHash returns 16 chars", () => {
    expect(emailHash("a@b.de").length).toBe(16);
  });

  it("emailHash normalises case + whitespace", () => {
    const a = emailHash("Anna@Beispiel.DE");
    const b = emailHash("  anna@beispiel.de ");
    expect(a).toBe(b);
  });

  it("different emails → different hashes", () => {
    expect(emailHash("a@b.de")).not.toBe(emailHash("c@d.de"));
  });
});
