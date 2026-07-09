import { describe, expect, it } from "vitest";
import {
  deleteUserRequestSchema,
  patchBankRequestSchema,
  patchUserRequestSchema,
  refundDataResponseSchema,
} from "../../src/schemas/user.js";

describe("patchUserRequestSchema", () => {
  it("accepts a single optional field", () => {
    expect(patchUserRequestSchema.parse({ vorname: "Neu" }).vorname).toBe("Neu");
  });

  it("rejects an empty patch", () => {
    expect(patchUserRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("patchBankRequestSchema", () => {
  it("normalises iban/bic", () => {
    const out = patchBankRequestSchema.parse({
      iban: "de89 3704 0044 0532 0130 00",
      bic: "cobadeffxxx",
    });
    expect(out.iban).toBe("DE89370400440532013000");
    expect(out.bic).toBe("COBADEFFXXX");
  });

  it("rejects malformed iban", () => {
    expect(
      patchBankRequestSchema.safeParse({ iban: "99", bic: "COBADEFFXXX" })
        .success,
    ).toBe(false);
  });
});

describe("refundDataResponseSchema", () => {
  it("allows null iban/bic", () => {
    const out = refundDataResponseSchema.parse({
      vorname: "A",
      nachname: "B",
      email: "a@b.de",
      telefon: "1",
      adresse: {
        strasse: "X",
        hausnr: "1",
        plz: "1",
        ort: "Y",
        land: "DE",
      },
      iban: null,
      bic: null,
    });
    expect(out.iban).toBeNull();
  });
});

describe("deleteUserRequestSchema", () => {
  it("requires confirmPassword", () => {
    expect(
      deleteUserRequestSchema.safeParse({ confirmPassword: "" }).success,
    ).toBe(false);
    expect(deleteUserRequestSchema.parse({ confirmPassword: "x" })).toEqual({
      confirmPassword: "x",
    });
  });
});
