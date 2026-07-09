import { Buffer } from "node:buffer";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/index.js";
import { getKek, resetKekCache } from "../../src/crypto/kek.js";
import {
  DecryptionFailedError,
  decryptBic,
  decryptIban,
  decryptValue,
  encryptBic,
  encryptIban,
  encryptValue,
} from "../../src/crypto/iban.js";

// fixed 32-byte test KEK so behaviour is deterministic across runs
const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString("base64");

function setKek(value: string | undefined): void {
  if (value === undefined) delete process.env.RAILBACK_IBAN_KEK;
  else process.env.RAILBACK_IBAN_KEK = value;
  resetKekCache();
}

beforeEach(() => {
  setKek(TEST_KEK_B64);
});

describe("getKek", () => {
  it("throws ERR_INTERNAL when env var missing", () => {
    setKek(undefined);
    try {
      getKek();
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("ERR_INTERNAL");
      expect((e as AppError).message).toBe(
        "RAILBACK_IBAN_KEK missing or wrong length"
      );
    }
  });

  it("throws ERR_INTERNAL on wrong-length key", () => {
    setKek(Buffer.alloc(16, 0x01).toString("base64"));
    expect(() => getKek()).toThrowError(AppError);
  });

  it("caches across calls", () => {
    const a = getKek();
    const b = getKek();
    expect(a).toBe(b);
  });
});

describe("encryptValue / decryptValue", () => {
  it("round-trips arbitrary string", () => {
    const plain = "hello world";
    expect(decryptValue(encryptValue(plain))).toBe(plain);
  });

  it("produces different ciphertext for same plaintext (random iv)", () => {
    const a = encryptValue("same");
    const b = encryptValue("same");
    expect(a).not.toBe(b);
    expect(decryptValue(a)).toBe("same");
    expect(decryptValue(b)).toBe("same");
  });

  it("throws DecryptionFailedError on tampered ciphertext", () => {
    const enc = encryptValue("DE89370400440532013000");
    // flip a base64 char somewhere past the iv+tag region
    const idx = enc.length - 4;
    const ch = enc[idx];
    const flipped = ch === "A" ? "B" : "A";
    const tampered = enc.slice(0, idx) + flipped + enc.slice(idx + 1);
    expect(() => decryptValue(tampered)).toThrowError(DecryptionFailedError);
  });

  it("throws DecryptionFailedError on garbage input", () => {
    expect(() => decryptValue("!!!notbase64!!!")).toThrowError(DecryptionFailedError);
    expect(() => decryptValue("")).toThrowError(DecryptionFailedError);
  });

  it("KEK-missing still throws AppError (server-config, not data corruption)", () => {
    // Even if the ciphertext looks valid, a missing KEK must surface as
    // an AppError(ERR_INTERNAL) — NOT a DecryptionFailedError. Callers
    // who degrade-to-null on cipher failures (e.g. user-handler's
    // refundDataView) MUST still 500 on a broken deploy.
    const enc = encryptValue("DE89370400440532013000");
    setKek(undefined);
    let caught: unknown;
    try {
      decryptValue(enc);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).not.toBeInstanceOf(DecryptionFailedError);
    expect((caught as AppError).code).toBe("ERR_INTERNAL");
  });
});

describe("encryptIban / decryptIban", () => {
  it("round-trips a clean IBAN", () => {
    const iban = "DE89370400440532013000";
    expect(decryptIban(encryptIban(iban))).toBe(iban);
  });

  it("normalises whitespace + casing on encrypt", () => {
    const messy = "de89 3704 0044 0532 0130 00";
    const expected = "DE89370400440532013000";
    expect(decryptIban(encryptIban(messy))).toBe(expected);
  });
});

describe("encryptBic / decryptBic", () => {
  it("round-trips and uppercases", () => {
    expect(decryptBic(encryptBic("cobadeffxxx"))).toBe("COBADEFFXXX");
  });
});
