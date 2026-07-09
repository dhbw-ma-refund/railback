import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/index.js";
import { validateRefundSubmission } from "../../src/refund/validate-submission.js";
import type { RefundRequest } from "../../src/schemas/ticket.js";
import type { User } from "../../src/types/dto.js";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    email: "a@b.de",
    vorname: "Anna",
    nachname: "Beispiel",
    telefon: "+49 30 1234567",
    adresse: {
      strasse: "Hauptstr.",
      hausnr: "1",
      plz: "10115",
      ort: "Berlin",
      land: "DE",
    },
    user_state: "ACTIVE",
    created_at: "2026-01-01T00:00:00Z",
    iban_enc: "enc-iban",
    bic_enc: "enc-bic",
    datenschutz_einwilligung: true,
    agb_akzeptiert: true,
    ...overrides,
  };
}

function makeBody(overrides: Partial<RefundRequest> = {}): RefundRequest {
  return {
    antragsgrund: ["VERSPAETUNG"],
    antragsart: "ENTSCHAEDIGUNG_60_119",
    fahrt: {
      abreisedatum: "2026-06-01",
      abreisebahnhof: "Berlin Hbf",
      zielbahnhof: "Muenchen Hbf",
      abfahrtszeit_plan: "08:00",
      ankunftszeit_plan: "12:00",
      zugnummer_plan: "ICE 123",
      fahrkartennummer: "FK-1",
      fahrkartenpreis: "100.00",
    },
    fahrt_tatsaechlich: {
      ankunftszeit_tatsaechlich: "13:30",
    },
    antragstellung_ort: "Berlin",
    datenschutz_einwilligung: true,
    wahrheitserklaerung: true,
    ...overrides,
  } as RefundRequest;
}

function expectFieldError(fn: () => void, field: string): void {
  try {
    fn();
    throw new Error("expected throw");
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    const e = err as AppError;
    expect(e.code).toBe("ERR_VALIDATION");
    expect(e.details).toBeDefined();
    expect((e.details as { field: string }).field).toBe(field);
  }
}

describe("validateRefundSubmission", () => {
  it("passes on a fully valid submission", () => {
    expect(() =>
      validateRefundSubmission({
        body: makeBody(),
        user: makeUser(),
        belegeCount: 0,
      }),
    ).not.toThrow();
  });

  it("rejects when datenschutz_einwilligung is false", () => {
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody({
            datenschutz_einwilligung: false as unknown as true,
          }),
          user: makeUser(),
          belegeCount: 0,
        }),
      "datenschutz_einwilligung",
    );
  });

  it("rejects when wahrheitserklaerung is false", () => {
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody({
            wahrheitserklaerung: false as unknown as true,
          }),
          user: makeUser(),
          belegeCount: 0,
        }),
      "wahrheitserklaerung",
    );
  });

  it("rejects when antragsgrund is missing", () => {
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody({
            antragsgrund: [] as unknown as RefundRequest["antragsgrund"],
          }),
          user: makeUser(),
          belegeCount: 0,
        }),
      "antragsgrund",
    );
  });

  it("rejects VERPASSTER_ANSCHLUSS without bahnhof", () => {
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody({
            antragsgrund: ["VERPASSTER_ANSCHLUSS"],
            fahrt_tatsaechlich: {},
          }),
          user: makeUser(),
          belegeCount: 0,
        }),
      "fahrt_tatsaechlich.verpasster_anschluss_bahnhof",
    );
  });

  it("rejects VERPASSTER_ANSCHLUSS with empty bahnhof", () => {
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody({
            antragsgrund: ["VERPASSTER_ANSCHLUSS"],
            fahrt_tatsaechlich: { verpasster_anschluss_bahnhof: "" },
          }),
          user: makeUser(),
          belegeCount: 0,
        }),
      "fahrt_tatsaechlich.verpasster_anschluss_bahnhof",
    );
  });

  it("accepts VERPASSTER_ANSCHLUSS with valid bahnhof", () => {
    expect(() =>
      validateRefundSubmission({
        body: makeBody({
          antragsgrund: ["VERPASSTER_ANSCHLUSS"],
          fahrt_tatsaechlich: {
            verpasster_anschluss_bahnhof: "Hannover Hbf",
          },
        }),
        user: makeUser(),
        belegeCount: 0,
      }),
    ).not.toThrow();
  });

  it("rejects KOSTEN_ALTERNATIVTRANSPORT without belege", () => {
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody({ antragsart: "KOSTEN_ALTERNATIVTRANSPORT" }),
          user: makeUser(),
          belegeCount: 0,
        }),
      "belege",
    );
  });

  it("accepts KOSTEN_ALTERNATIVTRANSPORT with at least one beleg", () => {
    expect(() =>
      validateRefundSubmission({
        body: makeBody({ antragsart: "KOSTEN_ALTERNATIVTRANSPORT" }),
        user: makeUser(),
        belegeCount: 1,
      }),
    ).not.toThrow();
  });

  it("rejects when user has no iban_enc", () => {
    const u = makeUser();
    delete u.iban_enc;
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody(),
          user: u,
          belegeCount: 0,
        }),
      "iban",
    );
  });

  it("rejects when user has no bic_enc", () => {
    const u = makeUser();
    delete u.bic_enc;
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody(),
          user: u,
          belegeCount: 0,
        }),
      "bic",
    );
  });

  it("rejects empty antragstellung_ort", () => {
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody({ antragstellung_ort: "" }),
          user: makeUser(),
          belegeCount: 0,
        }),
      "antragstellung_ort",
    );
  });

  it("rejects zusaetzliche_angaben longer than 2500 chars", () => {
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody({ zusaetzliche_angaben: "x".repeat(2501) }),
          user: makeUser(),
          belegeCount: 0,
        }),
      "zusaetzliche_angaben",
    );
  });

  it("accepts zusaetzliche_angaben exactly 2500 chars", () => {
    expect(() =>
      validateRefundSubmission({
        body: makeBody({ zusaetzliche_angaben: "x".repeat(2500) }),
        user: makeUser(),
        belegeCount: 0,
      }),
    ).not.toThrow();
  });

  // Locked 2026-07-01 per audit finding `zeitkarte-flag-not-enforced`.
  // ENTSCHAEDIGUNG_ZEITKARTE must be paired with is_zeitkarte=true or
  // the computeFee ZEITKARTE-pauschale silently applies to a non-
  // zeitkarte ticket.
  it("rejects ENTSCHAEDIGUNG_ZEITKARTE without is_zeitkarte=true", () => {
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody({
            antragsart: "ENTSCHAEDIGUNG_ZEITKARTE",
            is_zeitkarte: false,
          }),
          user: makeUser(),
          belegeCount: 0,
        }),
      "is_zeitkarte",
    );
  });

  it("rejects ENTSCHAEDIGUNG_ZEITKARTE when is_zeitkarte is omitted", () => {
    expectFieldError(
      () =>
        validateRefundSubmission({
          body: makeBody({ antragsart: "ENTSCHAEDIGUNG_ZEITKARTE" }),
          user: makeUser(),
          belegeCount: 0,
        }),
      "is_zeitkarte",
    );
  });

  it("accepts ENTSCHAEDIGUNG_ZEITKARTE with is_zeitkarte=true", () => {
    expect(() =>
      validateRefundSubmission({
        body: makeBody({
          antragsart: "ENTSCHAEDIGUNG_ZEITKARTE",
          is_zeitkarte: true,
        }),
        user: makeUser(),
        belegeCount: 0,
      }),
    ).not.toThrow();
  });
});
