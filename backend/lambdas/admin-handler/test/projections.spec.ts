// Projection tests — assert iban/bic never leak.
//
// The schemas in @railback/lib/schemas/admin don't even have iban/bic
// fields, but a sloppy refactor could spread the full User DTO into a
// response. These tests guard against that.

import { describe, expect, it } from "vitest";

import {
  recentTicketEntry,
  sepaMandateView,
  statsView,
  ticketDetailView,
  ticketSummaryView,
  userDetailView,
  userSummary,
} from "../src/projections.js";
import type { SepaMandate, Ticket, User } from "@railback/lib/types/dto";

const baseUser: User = {
  email: "alice@example.com",
  vorname: "Alice",
  nachname: "Müller",
  telefon: "+49",
  adresse: {
    strasse: "Bahnhofstr.",
    hausnr: "12",
    plz: "10115",
    ort: "Berlin",
    land: "DE",
  },
  user_state: "ACTIVE",
  created_at: "2026-01-01T00:00:00Z",
  iban_enc: "SECRET_IBAN_ENC",
  bic_enc: "SECRET_BIC_ENC",
  datenschutz_einwilligung: true,
  agb_akzeptiert: true,
};

const baseTicket: Ticket = {
  email: "alice@example.com",
  ticketId: "01HZ00000000000000000000AA",
  ticket_state: "COMPLETED",
  state_timeline: [{ state: "COMPLETED", at: "2026-01-01T00:00:00Z" }],
  extraction_status: "DONE",
  extraction_method: "BARCODE",
  extraction_confidence: 1,
  fahrt_abreisedatum: "2026-05-12",
  fahrt_abreisebahnhof: "Mannheim Hbf",
  fahrt_zielbahnhof: "Karlsruhe Hbf",
  fahrt_zugnummer_plan: "IC 2345",
  fahrt_fahrkartenpreis: "29.90",
  antragsart: "ENTSCHAEDIGUNG_60_119",
  antragsgrund: ["VERSPAETUNG"],
  erwartete_erstattung: "29.90",
  service_fee_betrag: "0.75",
  delayMinutes: 65,
  submitted_at: "2026-06-11T19:00:00Z",
  updated_at: "2026-06-11T19:00:00Z",
};

const baseMandate: SepaMandate = {
  email: "alice@example.com",
  ticketId: "01HZ00000000000000000000AA",
  mandate_id: "01HZMANDATE",
  mandate_state: "ISSUED",
  sequence_type: "OOFF",
  fee_amount: "0.75",
  iban_enc: "SECRET_M_IBAN_ENC",
  bic_enc: "SECRET_M_BIC_ENC",
  kontoinhaber_snapshot: "Alice Müller",
  user_consent_at: "2026-06-11T19:00:00Z",
  expires_at: "2029-06-11T19:00:00Z",
  issued_at: "2026-06-11T19:00:00Z",
};

function leaksBankSecrets(obj: unknown): boolean {
  const json = JSON.stringify(obj);
  return /SECRET_IBAN_ENC|SECRET_BIC_ENC|SECRET_M_IBAN_ENC|SECRET_M_BIC_ENC|iban|bic/i.test(
    json,
  );
}

describe("admin projections — iban/bic never leak", () => {
  it("userSummary strips encrypted fields", () => {
    const v = userSummary(baseUser, { ticketCount: 3, totalRefunded: "29.90" });
    expect(leaksBankSecrets(v)).toBe(false);
    // sanity: shape carries the right keys
    expect(v.email).toBe("alice@example.com");
    expect(v.user_state).toBe("ACTIVE");
    expect(v.ticket_count).toBe(3);
  });

  it("userDetailView strips encrypted fields, surfaces recent_tickets", () => {
    const v = userDetailView(
      baseUser,
      { ticketCount: 1, totalRefunded: "29.90" },
      [baseTicket],
    );
    expect(leaksBankSecrets(v)).toBe(false);
    expect(v.recent_tickets).toHaveLength(1);
  });

  it("ticketSummaryView strips encrypted fields, unprefixed wire names", () => {
    const v = ticketSummaryView(baseTicket, { vorname: "Alice", nachname: "Müller" });
    expect(leaksBankSecrets(v)).toBe(false);
    expect(v.abreisedatum).toBe("2026-05-12");
    expect(v.zugnummer_plan).toBe("IC 2345");
    expect(v.fahrkartenpreis).toBe("29.90");
  });

  it("ticketDetailView keeps fahrt_*/tatsaechlich_* flat and strips encrypted fields", () => {
    const v = ticketDetailView(baseTicket, {
      user: { vorname: "Alice", nachname: "Müller" },
      hasBelege: false,
      mandate: baseMandate,
    });
    expect(leaksBankSecrets(v)).toBe(false);
    expect(v.fahrt_abreisedatum).toBe("2026-05-12");
    expect(v.sepa_mandate?.state).toBe("ISSUED");
    expect(v.has_belege).toBe(false);
    expect(v.service_fee_betrag).toBe("0.75");
  });

  it("sepaMandateView emits state + expires_at, never iban/bic", () => {
    const v = sepaMandateView(baseMandate);
    expect(leaksBankSecrets(v)).toBe(false);
    expect(v.state).toBe("ISSUED");
    expect(v.expires_at).toBe("2029-06-11T19:00:00Z");
  });

  it("statsView mirrors input verbatim with EUR currency", () => {
    const v = statsView({
      usersTotal: 2,
      usersActive: 1,
      usersSuspended: 1,
      usersDeletionScheduled: 0,
      ticketsTotal: 5,
      ticketsByState: {
        VALIDATING: 0, READY: 0, EMAIL_SENDING: 0,
        PENDING_DB_PAYMENT: 1, APPROVED: 0, REJECTED: 0,
        COMPLETED: 4, EMAIL_FAILED: 0, INVALID: 0,
      },
      ticketsPending: 1,
      totalPaidOut: "119.60",
      thisMonthPaidOut: "0.00",
      asOf: "2026-06-25T12:00:00Z",
    });
    expect(v.refunds.currency).toBe("EUR");
    expect(v.users.suspended).toBe(1);
    expect(v.tickets.pending).toBe(1);
  });

  it("recentTicketEntry only carries the slim shape", () => {
    const v = recentTicketEntry(baseTicket);
    expect(Object.keys(v).sort()).toEqual(
      ["abreisedatum", "erwartete_erstattung", "ticketId", "ticket_state"].sort(),
    );
  });

  // Regression: contract drop — admin ticket-detail must NOT include
  // extraction_status, vorname_aus_ticket, nachname_aus_ticket,
  // email_attempts, email_last_attempt, uploaded_at, is_zeitkarte.
  it("ticketDetailView drops internal-only fields per contract", () => {
    const tWithInternals: Ticket = {
      ...baseTicket,
      vorname_aus_ticket: "TicketName",
      nachname_aus_ticket: "TicketSurname",
      is_zeitkarte: true,
      uploaded_at: "2026-06-11T18:00:00Z",
      email_attempts: 2,
      email_last_attempt: "2026-06-11T18:05:00Z",
    };
    const v = ticketDetailView(tWithInternals, {
      user: { vorname: "Alice", nachname: "Müller" },
      hasBelege: false,
    });
    const keys = Object.keys(v);
    expect(keys).not.toContain("extraction_status");
    expect(keys).not.toContain("vorname_aus_ticket");
    expect(keys).not.toContain("nachname_aus_ticket");
    expect(keys).not.toContain("is_zeitkarte");
    expect(keys).not.toContain("uploaded_at");
    expect(keys).not.toContain("email_attempts");
    expect(keys).not.toContain("email_last_attempt");
  });
});
