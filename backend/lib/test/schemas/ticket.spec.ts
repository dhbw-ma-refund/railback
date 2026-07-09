import { describe, expect, it } from "vitest";
import {
  fromRouteRequestSchema,
  refundRequestSchema,
  routeLookupRequestSchema,
  uploadRequestSchema,
} from "../../src/schemas/ticket.js";

const validFahrt = {
  abreisedatum: "2026-06-01",
  abreisebahnhof: "Stuttgart Hbf",
  zielbahnhof: "Berlin Hbf",
  abfahrtszeit_plan: "08:30",
  ankunftszeit_plan: "14:30",
  zugnummer_plan: "ICE 123",
  fahrkartennummer: "AB123",
  fahrkartenpreis: "99.90",
};

describe("refundRequestSchema", () => {
  it("accepts a minimal happy-path payload", () => {
    const out = refundRequestSchema.parse({
      antragsgrund: ["VERSPAETUNG"],
      antragsart: "ENTSCHAEDIGUNG_60_119",
      fahrt: validFahrt,
      fahrt_tatsaechlich: { ankunftszeit_tatsaechlich: "15:30" },
      antragstellung_ort: "Stuttgart",
      datenschutz_einwilligung: true,
      wahrheitserklaerung: true,
    });
    expect(out.antragsart).toBe("ENTSCHAEDIGUNG_60_119");
  });

  it("rejects when wahrheitserklaerung is false", () => {
    expect(
      refundRequestSchema.safeParse({
        antragsgrund: ["VERSPAETUNG"],
        antragsart: "ENTSCHAEDIGUNG_60_119",
        fahrt: validFahrt,
        fahrt_tatsaechlich: {},
        antragstellung_ort: "X",
        datenschutz_einwilligung: true,
        wahrheitserklaerung: false,
      }).success,
    ).toBe(false);
  });

  it("rejects malformed decimal price", () => {
    expect(
      refundRequestSchema.safeParse({
        antragsgrund: ["VERSPAETUNG"],
        antragsart: "ENTSCHAEDIGUNG_60_119",
        fahrt: { ...validFahrt, fahrkartenpreis: "99" },
        fahrt_tatsaechlich: {},
        antragstellung_ort: "X",
        datenschutz_einwilligung: true,
        wahrheitserklaerung: true,
      }).success,
    ).toBe(false);
  });

  it("rejects when antragsgrund is empty array", () => {
    expect(
      refundRequestSchema.safeParse({
        antragsgrund: [],
        antragsart: "ENTSCHAEDIGUNG_60_119",
        fahrt: validFahrt,
        fahrt_tatsaechlich: {},
        antragstellung_ort: "X",
        datenschutz_einwilligung: true,
        wahrheitserklaerung: true,
      }).success,
    ).toBe(false);
  });

  it("accepts multiple antragsgrund values", () => {
    const out = refundRequestSchema.parse({
      antragsgrund: ["VERSPAETUNG", "VERPASSTER_ANSCHLUSS"],
      antragsart: "ENTSCHAEDIGUNG_60_119",
      fahrt: validFahrt,
      fahrt_tatsaechlich: { verpasster_anschluss_bahnhof: "Mannheim" },
      antragstellung_ort: "X",
      datenschutz_einwilligung: true,
      wahrheitserklaerung: true,
    });
    expect(out.antragsgrund).toEqual(["VERSPAETUNG", "VERPASSTER_ANSCHLUSS"]);
  });
});

describe("routeLookupRequestSchema", () => {
  it("accepts fromStation + toEva", () => {
    const out = routeLookupRequestSchema.parse({
      fromStation: "Stuttgart Hbf",
      toEva: 8011160,
      date: "2026-06-01",
    });
    expect(out.fromStation).toBe("Stuttgart Hbf");
  });

  it("rejects when fromStation and fromEva are both missing", () => {
    expect(
      routeLookupRequestSchema.safeParse({
        toStation: "Berlin",
        date: "2026-06-01",
      }).success,
    ).toBe(false);
  });

  it("rejects when toStation and toEva are both missing", () => {
    expect(
      routeLookupRequestSchema.safeParse({
        fromStation: "Stuttgart",
        date: "2026-06-01",
      }).success,
    ).toBe(false);
  });
});

describe("fromRouteRequestSchema", () => {
  it("defaults is_zeitkarte to false", () => {
    const out = fromRouteRequestSchema.parse({
      trainNr: "ICE 123",
      date: "2026-06-01",
      fromStation: "Stuttgart Hbf",
      toStation: "Berlin Hbf",
      abfahrtszeit_plan: "08:30",
      ankunftszeit_plan: "14:30",
      fahrkartennummer: "X",
      fahrkartenpreis: "99.90",
    });
    expect(out.is_zeitkarte).toBe(false);
  });
});

describe("uploadRequestSchema", () => {
  it("accepts pdf/jpeg/png", () => {
    expect(
      uploadRequestSchema.parse({ filename: "a.pdf", mimeType: "application/pdf" })
        .mimeType,
    ).toBe("application/pdf");
  });

  it("rejects other mime types", () => {
    expect(
      uploadRequestSchema.safeParse({
        filename: "a.tiff",
        mimeType: "image/tiff",
      }).success,
    ).toBe(false);
  });
});
