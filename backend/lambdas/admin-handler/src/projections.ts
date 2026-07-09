// Admin-side projections — single source of truth for what /admin/*
// responses carry. Centralised so the visibility rules are one-import
// reviewable.
//
// Shapes match API_CONTRACT_ADMINFORMS.md verbatim. Optional fields
// per the schemas in @railback/lib/schemas/admin: a field that is
// "null in the contract" is emitted as `undefined` here so zod's
// `.optional()` strips it from the JSON output; frontend treats
// missing === null.
//
// IBAN/BIC: as of the 2026-07-07 reversal (DECISIONS.md "IBAN/BIC visible
// to admin in plaintext"), the USER views (userSummary / userDetailView)
// DO carry plaintext `iban`/`bic`, decrypted here from iban_enc/bic_enc.
// TICKET and SEPA-mandate views still must NOT leak iban/bic —
// hashed_password never appears anywhere.

import {
  DecryptionFailedError,
  decryptBic,
  decryptIban,
} from "@railback/lib/crypto/iban";
import type {
  AdminRecentTicketEntry,
  AdminStatsResponse,
  AdminTicketSummary,
  AdminUserSummary,
  GetAdminTicketResponse,
  GetAdminUserResponse,
  PendingBatchEntry,
  SepaMandateView,
} from "@railback/lib/schemas/admin";
import type {
  SepaMandate,
  Ticket,
  UserAdminView,
} from "@railback/lib/types/dto";

// Degrade a decrypt failure (corrupted blob / GCM mismatch) to null so the
// admin still sees the rest of the user; let KEK-config errors (AppError)
// propagate to a 500. Mirrors user-handler/src/projections.ts#safeDecrypt.
function safeDecrypt(
  enc: string | undefined,
  fn: (enc: string) => string,
): string | null {
  if (enc === undefined) return null;
  try {
    return fn(enc);
  } catch (err) {
    if (err instanceof DecryptionFailedError) return null;
    throw err;
  }
}

// --- Stats ---------------------------------------------------------------

export interface StatsInput {
  usersTotal: number;
  usersActive: number;
  usersSuspended: number;
  usersDeletionScheduled: number;
  ticketsTotal: number;
  ticketsByState: Record<string, number>;
  ticketsPending: number;
  totalPaidOut: string;
  thisMonthPaidOut: string;
  asOf: string;
}

export function statsView(input: StatsInput): AdminStatsResponse {
  return {
    users: {
      total: input.usersTotal,
      active: input.usersActive,
      suspended: input.usersSuspended,
      deletion_scheduled: input.usersDeletionScheduled,
    },
    tickets: {
      total: input.ticketsTotal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      by_state: input.ticketsByState as AdminStatsResponse["tickets"]["by_state"],
      pending: input.ticketsPending,
    },
    refunds: {
      total_paid_out: input.totalPaidOut,
      currency: "EUR",
      this_month_paid_out: input.thisMonthPaidOut,
    },
    as_of: input.asOf,
  };
}

// --- User summary --------------------------------------------------------

export interface UserSummaryDerived {
  ticketCount: number;
  totalRefunded: string;
}

export function userSummary(u: UserAdminView, derived: UserSummaryDerived): AdminUserSummary {
  const out: AdminUserSummary = {
    email: u.email,
    vorname: u.vorname,
    nachname: u.nachname,
    telefon: u.telefon,
    adresse: u.adresse,
    user_state: u.user_state,
    created_at: u.created_at,
    ticket_count: derived.ticketCount,
    total_refunded: derived.totalRefunded,
    // Plaintext bank data (2026-07-07 reversal). null when unset / undecryptable.
    iban: safeDecrypt(u.iban_enc, decryptIban),
    bic: safeDecrypt(u.bic_enc, decryptBic),
  };
  if (u.suspended_at !== undefined) out.suspended_at = u.suspended_at;
  if (u.suspended_reason !== undefined) out.suspended_reason = u.suspended_reason;
  return out;
}

export function recentTicketEntry(t: Ticket): AdminRecentTicketEntry {
  const out: AdminRecentTicketEntry = {
    ticketId: t.ticketId,
    ticket_state: t.ticket_state,
  };
  if (t.fahrt_abreisedatum !== undefined) out.abreisedatum = t.fahrt_abreisedatum;
  if (t.erwartete_erstattung !== undefined) out.erwartete_erstattung = t.erwartete_erstattung;
  return out;
}

export function userDetailView(
  u: UserAdminView,
  derived: UserSummaryDerived,
  recentTickets: Ticket[],
): GetAdminUserResponse {
  return {
    ...userSummary(u, derived),
    recent_tickets: recentTickets.map(recentTicketEntry),
  };
}

// --- Ticket summary ------------------------------------------------------

export interface UserSlice {
  vorname: string;
  nachname: string;
}

export function ticketSummaryView(t: Ticket, user: UserSlice): AdminTicketSummary {
  const out: AdminTicketSummary = {
    ticketId: t.ticketId,
    email: t.email,
    vorname: user.vorname,
    nachname: user.nachname,
    ticket_state: t.ticket_state,
    updated_at: t.updated_at,
  };
  if (t.antragsart !== undefined) out.antragsart = t.antragsart;
  if (t.antragsgrund !== undefined) out.antragsgrund = t.antragsgrund;
  if (t.fahrt_abreisedatum !== undefined) out.abreisedatum = t.fahrt_abreisedatum;
  if (t.fahrt_abreisebahnhof !== undefined) out.abreisebahnhof = t.fahrt_abreisebahnhof;
  if (t.fahrt_zielbahnhof !== undefined) out.zielbahnhof = t.fahrt_zielbahnhof;
  if (t.fahrt_zugnummer_plan !== undefined) out.zugnummer_plan = t.fahrt_zugnummer_plan;
  if (t.fahrt_fahrkartenpreis !== undefined) out.fahrkartenpreis = t.fahrt_fahrkartenpreis;
  if (t.erwartete_erstattung !== undefined) out.erwartete_erstattung = t.erwartete_erstattung;
  if (t.delayMinutes !== undefined) out.delayMinutes = t.delayMinutes;
  if (t.submitted_at !== undefined) out.submitted_at = t.submitted_at;
  return out;
}

// --- Ticket detail -------------------------------------------------------

export function sepaMandateView(m: SepaMandate): SepaMandateView {
  const out: SepaMandateView = {
    state: m.mandate_state,
    expires_at: m.expires_at,
  };
  if (m.debited_at !== undefined) out.debited_at = m.debited_at;
  if (m.reversed_at !== undefined) out.reversed_at = m.reversed_at;
  if (m.reversed_reason !== undefined) out.reversed_reason = m.reversed_reason;
  if (m.dispute_opened_at !== undefined) out.dispute_opened_at = m.dispute_opened_at;
  return out;
}

export interface TicketDetailExtras {
  user: { vorname?: string; nachname?: string };
  hasBelege: boolean;
  mandate?: SepaMandate;
}

export function ticketDetailView(
  t: Ticket,
  extras: TicketDetailExtras,
): GetAdminTicketResponse {
  const out: GetAdminTicketResponse = {
    ticketId: t.ticketId,
    email: t.email,
    ticket_state: t.ticket_state,
    state_timeline: t.state_timeline,
    extraction_method: t.extraction_method,
    extraction_confidence: t.extraction_confidence,
    has_belege: extras.hasBelege,
  };
  if (extras.user.vorname !== undefined) out.vorname = extras.user.vorname;
  if (extras.user.nachname !== undefined) out.nachname = extras.user.nachname;
  if (t.barcode_uid !== undefined) out.barcode_uid = t.barcode_uid;
  if (t.fahrt_abreisedatum !== undefined) out.fahrt_abreisedatum = t.fahrt_abreisedatum;
  if (t.fahrt_abreisebahnhof !== undefined) out.fahrt_abreisebahnhof = t.fahrt_abreisebahnhof;
  if (t.fahrt_zielbahnhof !== undefined) out.fahrt_zielbahnhof = t.fahrt_zielbahnhof;
  if (t.fahrt_abfahrtszeit_plan !== undefined) out.fahrt_abfahrtszeit_plan = t.fahrt_abfahrtszeit_plan;
  if (t.fahrt_ankunftszeit_plan !== undefined) out.fahrt_ankunftszeit_plan = t.fahrt_ankunftszeit_plan;
  if (t.fahrt_zugnummer_plan !== undefined) out.fahrt_zugnummer_plan = t.fahrt_zugnummer_plan;
  if (t.fahrt_zugkategorie_plan !== undefined) out.fahrt_zugkategorie_plan = t.fahrt_zugkategorie_plan;
  if (t.fahrt_fahrkartennummer !== undefined) out.fahrt_fahrkartennummer = t.fahrt_fahrkartennummer;
  if (t.fahrt_fahrkartenpreis !== undefined) out.fahrt_fahrkartenpreis = t.fahrt_fahrkartenpreis;
  if (t.tatsaechlich_ankunftsdatum !== undefined) out.tatsaechlich_ankunftsdatum = t.tatsaechlich_ankunftsdatum;
  if (t.tatsaechlich_abfahrtszeit !== undefined) out.tatsaechlich_abfahrtszeit = t.tatsaechlich_abfahrtszeit;
  if (t.tatsaechlich_ankunftszeit !== undefined) out.tatsaechlich_ankunftszeit = t.tatsaechlich_ankunftszeit;
  if (t.tatsaechlich_zugnummer !== undefined) out.tatsaechlich_zugnummer = t.tatsaechlich_zugnummer;
  if (t.tatsaechlich_verpasster_anschluss_bahnhof !== undefined) {
    out.tatsaechlich_verpasster_anschluss_bahnhof = t.tatsaechlich_verpasster_anschluss_bahnhof;
  }
  if (t.antragsgrund !== undefined) out.antragsgrund = t.antragsgrund;
  if (t.antragsart !== undefined) out.antragsart = t.antragsart;
  if (t.antragstellung_ort !== undefined) out.antragstellung_ort = t.antragstellung_ort;
  if (t.zusaetzliche_angaben !== undefined) out.zusaetzliche_angaben = t.zusaetzliche_angaben;
  if (t.delayMinutes !== undefined) out.delayMinutes = t.delayMinutes;
  if (t.erwartete_erstattung !== undefined) out.erwartete_erstattung = t.erwartete_erstattung;
  if (t.service_fee_betrag !== undefined) out.service_fee_betrag = t.service_fee_betrag;
  if (t.db_paid_at !== undefined) out.db_paid_at = t.db_paid_at;
  if (t.admin_note !== undefined) out.admin_note = t.admin_note;
  if (t.email_status !== undefined) out.email_status = t.email_status;
  if (t.email_provider_id !== undefined) out.email_provider_id = t.email_provider_id;
  if (t.email_failed_reason !== undefined) out.email_failed_reason = t.email_failed_reason;
  if (t.submitted_at !== undefined) out.submitted_at = t.submitted_at;
  if (t.updated_at !== undefined) out.updated_at = t.updated_at;
  if (extras.mandate) out.sepa_mandate = sepaMandateView(extras.mandate);
  return out;
}

// --- SEPA pending batch entry --------------------------------------------

export interface PendingBatchInput {
  batchId: string;
  s3_key: string;
  downloadUrl: string;
  downloadUrlExpiresIn: number;
  mandate_count: number;
  total_eur: string;
  built_at: string;
}

export function pendingBatchView(input: PendingBatchInput): PendingBatchEntry {
  return {
    batchId: input.batchId,
    s3_key: input.s3_key,
    downloadUrl: input.downloadUrl,
    downloadUrlExpiresIn: input.downloadUrlExpiresIn,
    mandate_count: input.mandate_count,
    total_eur: input.total_eur,
    built_at: input.built_at,
  };
}
