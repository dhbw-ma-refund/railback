import { describe, it, expect } from "vitest";

import { hashPassword, verifyPassword } from "../../src/auth/password.js";

describe("password", () => {
  it("hashes and verifies a password (round-trip)", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("produces different hashes for the same plaintext (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("rejects tampered hashes gracefully (no throw)", async () => {
    const hash = await hashPassword("abc");
    // Flip the FIRST char of the encoded hash component so the bytes really
    // change. Appending garbage at the end gets eaten by base64 padding.
    const parts = hash.split("$");
    const flipFirstHashChar = (s: string): string => {
      const ch = s[0];
      const flipped = ch === "A" ? "B" : "A";
      return flipped + s.slice(1);
    };
    const tampered = `${parts[0]}$${parts[1]}$${parts[2]}$${parts[3]}$${parts[4]}$${flipFirstHashChar(parts[5] ?? "")}`;
    expect(await verifyPassword("abc", tampered)).toBe(false);
    expect(await verifyPassword("abc", "not-a-hash")).toBe(false);
    expect(await verifyPassword("abc", "scrypt$bad$bad$bad$bad$bad")).toBe(false);
    expect(await verifyPassword("abc", "")).toBe(false);
  });

  it("refuses to hash empty plaintext", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });

  it("encodes N/r/p and salt in the hash string", async () => {
    const hash = await hashPassword("x");
    const parts = hash.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(Number.parseInt(parts[1] ?? "", 10)).toBe(16384);
    expect(Number.parseInt(parts[2] ?? "", 10)).toBe(8);
    expect(Number.parseInt(parts[3] ?? "", 10)).toBe(1);
  });
});
