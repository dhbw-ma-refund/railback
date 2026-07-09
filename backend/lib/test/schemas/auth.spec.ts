import { describe, expect, it } from "vitest";
import {
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
} from "../../src/schemas/auth.js";

const baseAddress = {
  strasse: "Hauptstr.",
  hausnr: "1",
  plz: "70173",
  ort: "Stuttgart",
  land: "DE",
};

describe("registerRequestSchema", () => {
  it("lowercases email and normalises iban/bic", () => {
    const out = registerRequestSchema.parse({
      email: "  Foo.Bar@Example.COM ",
      password: "hunter22",
      vorname: "Foo",
      nachname: "Bar",
      telefon: "+49 711 123",
      adresse: baseAddress,
      iban: "de89 3704 0044 0532 0130 00",
      bic: "cobadeffxxx",
      datenschutz_einwilligung: true,
      agb_akzeptiert: true,
    });
    expect(out.email).toBe("foo.bar@example.com");
    expect(out.iban).toBe("DE89370400440532013000");
    expect(out.bic).toBe("COBADEFFXXX");
  });

  it("rejects when consent literals are not true", () => {
    const r = registerRequestSchema.safeParse({
      email: "a@b.de",
      password: "hunter22",
      vorname: "A",
      nachname: "B",
      telefon: "1",
      adresse: baseAddress,
      datenschutz_einwilligung: false,
      agb_akzeptiert: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects when iban is missing (now mandatory at register)", () => {
    const r = registerRequestSchema.safeParse({
      email: "a@b.de",
      password: "hunter22",
      vorname: "A",
      nachname: "B",
      telefon: "1",
      adresse: baseAddress,
      bic: "COBADEFFXXX",
      datenschutz_einwilligung: true,
      agb_akzeptiert: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects when bic is missing (now mandatory at register)", () => {
    const r = registerRequestSchema.safeParse({
      email: "a@b.de",
      password: "hunter22",
      vorname: "A",
      nachname: "B",
      telefon: "1",
      adresse: baseAddress,
      iban: "DE89370400440532013000",
      datenschutz_einwilligung: true,
      agb_akzeptiert: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects when IBAN fails the mod-97 checksum", () => {
    // Regex-valid but checksum-invalid IBAN (flipped last two digits)
    const r = registerRequestSchema.safeParse({
      email: "a@b.de",
      password: "hunter22",
      vorname: "A",
      nachname: "B",
      telefon: "1",
      adresse: baseAddress,
      iban: "DE00370400440532013000",
      bic: "COBADEFFXXX",
      datenschutz_einwilligung: true,
      agb_akzeptiert: true,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("iban"))).toBe(true);
    }
  });

  it("rejects too-short password", () => {
    const r = registerRequestSchema.safeParse({
      email: "a@b.de",
      password: "short",
      vorname: "A",
      nachname: "B",
      telefon: "1",
      adresse: baseAddress,
      datenschutz_einwilligung: true,
      agb_akzeptiert: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("loginRequestSchema", () => {
  it("lowercases email", () => {
    const out = loginRequestSchema.parse({
      email: "FOO@BAR.DE",
      password: "x",
    });
    expect(out.email).toBe("foo@bar.de");
  });

  it("rejects empty password", () => {
    const r = loginRequestSchema.safeParse({ email: "a@b.de", password: "" });
    expect(r.success).toBe(false);
  });
});

describe("refreshRequestSchema", () => {
  it("requires non-empty refreshToken", () => {
    expect(refreshRequestSchema.safeParse({ refreshToken: "" }).success).toBe(
      false,
    );
    expect(refreshRequestSchema.parse({ refreshToken: "abc" }).refreshToken).toBe(
      "abc",
    );
  });
});
