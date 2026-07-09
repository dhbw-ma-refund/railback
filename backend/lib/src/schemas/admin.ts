// /admin/* endpoints. Admin user views carry plaintext `iban`/`bic` (reversed
// 2026-07-07 — see DECISIONS.md "IBAN/BIC visible to admin in plaintext").
// The admin-handler decrypts iban_enc/bic_enc on read; encryption at rest is
// unchanged. Ticket views still never carry iban/bic.
//
// Rewritten Phase 2.4 to match API_CONTRACT_ADMINFORMS.md verbatim:
//   - adminStatsResponseSchema: flat user counters + currency + as_of
//   - adminUserSummarySchema: includes ticket_count + total_refunded
//   - adminTicketSummarySchema: unprefixed wire field names (abreisedatum,
//     abreisebahnhof, …) — the DDB row keeps fahrt_*, the projection
//     strips the prefix on read.
//   - getAdminTicketResponseSchema: flat fahrt_*/tatsaechlich_* plus
//     vorname/nachname/has_belege/sepa_mandate.
//   - pendingBatchEntrySchema: batchId-grouped (matches the contract).
//   - markSubmitted: empty request, response = {batchId, submitted_at, mandates_marked}
//   - sepaReportUpload: {filename, content_type, size_bytes} → presigned POST envelope

import { z } from "zod";
import {
  ANTRAGSARTEN,
  ANTRAGSGRUENDE,
  EMAIL_STATUSES,
  EXTRACTION_METHODS,
  MANDATE_STATES,
  TICKET_STATES,
  USER_STATES,
} from "../types/enums.js";
import {
  addressSchema,
  decimalEurSchema,
  emailSchema,
  hhmmSchema,
  iso8601DateSchema,
  iso8601DateTimeSchema,
  pageQuerySchema,
  ulidSchema,
} from "./common.js";

// --- Stats --------------------------------------------------------------

export const adminStatsResponseSchema = z
  .object({
    users: z.object({
      total: z.number().int().nonnegative(),
      active: z.number().int().nonnegative(),
      suspended: z.number().int().nonnegative(),
      deletion_scheduled: z.number().int().nonnegative(),
    }),
    tickets: z.object({
      total: z.number().int().nonnegative(),
      by_state: z.record(z.enum(TICKET_STATES), z.number().int().nonnegative()),
      pending: z.number().int().nonnegative(),
    }),
    refunds: z.object({
      total_paid_out: decimalEurSchema,
      currency: z.literal("EUR"),
      this_month_paid_out: decimalEurSchema,
    }),
    as_of: iso8601DateTimeSchema,
  })
  .openapi("AdminStatsResponse", {
    description: "GET /admin/stats — KPI snapshot; frontend polls ≥ 30 s.",
  });
export type AdminStatsResponse = z.infer<typeof adminStatsResponseSchema>;

// --- Users list / detail ------------------------------------------------

export const listUsersQuerySchema = pageQuerySchema.extend({
  email: z.string().optional(),
  user_state: z.enum(USER_STATES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const adminUserSummarySchema = z
  .object({
    email: z.string(),
    vorname: z.string(),
    nachname: z.string(),
    telefon: z.string(),
    adresse: addressSchema,
    user_state: z.enum(USER_STATES),
    suspended_at: iso8601DateTimeSchema.optional(),
    suspended_reason: z.string().optional(),
    created_at: iso8601DateTimeSchema,
    ticket_count: z.number().int().nonnegative(),
    total_refunded: decimalEurSchema,
    // Plaintext bank data (reversed 2026-07-07). Nullable: null when the
    // user has no bank data yet, or when a stored blob fails to decrypt
    // (safeDecrypt degrades to null). Optional so pre-reversal callers that
    // never set them still validate.
    iban: z.string().nullable().optional(),
    bic: z.string().nullable().optional(),
  })
  .openapi("AdminUserSummary", {
    description: "Admin user-list projection. Carries plaintext iban/bic (or null).",
  });
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;

export const listUsersResponseSchema = z
  .object({
    items: z.array(adminUserSummarySchema),
    nextCursor: z.string().optional(),
  })
  .openapi("ListUsersResponse", {
    description: "GET /admin/users.",
  });
export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;

// User-detail's recent_tickets entry is a slimmer shape than the main
// ticket summary — see contract.
export const adminRecentTicketEntrySchema = z.object({
  ticketId: ulidSchema,
  ticket_state: z.enum(TICKET_STATES),
  abreisedatum: iso8601DateSchema.optional(),
  erwartete_erstattung: decimalEurSchema.optional(),
});
export type AdminRecentTicketEntry = z.infer<
  typeof adminRecentTicketEntrySchema
>;

export const getAdminUserResponseSchema = adminUserSummarySchema
  .extend({
    recent_tickets: z.array(adminRecentTicketEntrySchema),
  })
  .openapi("GetAdminUserResponse", {
    description: "GET /admin/users/{email} — user detail with recent tickets.",
  });
export type GetAdminUserResponse = z.infer<typeof getAdminUserResponseSchema>;

// Strict: reject iban/bic/email/created_at/ticket_count/total_refunded.
// `.strict()` rejects any unknown key (which covers all of those).
//
// The "ACTIVE→SUSPENDED requires a non-empty suspended_reason" rule is
// enforced in the route, not here — the schema doesn't know the current
// user state, so a SUSPENDED→SUSPENDED no-op (audit-trail-preserving
// re-patch) wouldn't otherwise be allowed to omit the reason. When
// suspended_reason IS provided, it must be non-empty.
export const patchAdminUserRequestSchema = z
  .object({
    vorname: z.string().min(1).optional(),
    nachname: z.string().min(1).optional(),
    telefon: z.string().min(1).optional(),
    adresse: addressSchema.optional(),
    user_state: z.enum(USER_STATES).optional(),
    suspended_reason: z.string().min(1).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "at least one field must be provided",
  });
export type PatchAdminUserRequest = z.infer<typeof patchAdminUserRequestSchema>;

// --- Tickets list / detail ----------------------------------------------

export const listTicketsQuerySchema = pageQuerySchema.extend({
  state: z.enum(TICKET_STATES).optional(),
  email: emailSchema.optional(),
  trainNr: z.string().optional(),
  date: iso8601DateSchema.optional(),
  from: iso8601DateSchema.optional(),
  to: iso8601DateSchema.optional(),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

// Unprefixed names per contract; the DDB row keeps fahrt_*, the projection
// strips the prefix on read.
export const adminTicketSummarySchema = z
  .object({
    ticketId: ulidSchema,
    email: z.string(),
    vorname: z.string(),
    nachname: z.string(),
    ticket_state: z.enum(TICKET_STATES),
    antragsart: z.enum(ANTRAGSARTEN).optional(),
    antragsgrund: z.array(z.enum(ANTRAGSGRUENDE)).optional(),
    abreisedatum: iso8601DateSchema.optional(),
    abreisebahnhof: z.string().optional(),
    zielbahnhof: z.string().optional(),
    zugnummer_plan: z.string().optional(),
    fahrkartenpreis: decimalEurSchema.optional(),
    erwartete_erstattung: decimalEurSchema.optional(),
    delayMinutes: z.number().int().nonnegative().optional(),
    submitted_at: iso8601DateTimeSchema.optional(),
    updated_at: iso8601DateTimeSchema,
  })
  .openapi("AdminTicketSummary", {
    description: "Admin ticket-list projection (unprefixed wire names).",
  });
export type AdminTicketSummary = z.infer<typeof adminTicketSummarySchema>;

export const listAdminTicketsResponseSchema = z
  .object({
    items: z.array(adminTicketSummarySchema),
    nextCursor: z.string().optional(),
  })
  .openapi("AdminListTicketsResponse", {
    description: "GET /admin/tickets — admin ticket list.",
  });
export type ListAdminTicketsResponse = z.infer<
  typeof listAdminTicketsResponseSchema
>;

export const sepaMandateViewSchema = z.object({
  state: z.enum(MANDATE_STATES),
  debited_at: iso8601DateTimeSchema.optional(),
  reversed_at: iso8601DateTimeSchema.optional(),
  reversed_reason: z.string().optional(),
  dispute_opened_at: iso8601DateTimeSchema.optional(),
  expires_at: iso8601DateTimeSchema,
});
export type SepaMandateView = z.infer<typeof sepaMandateViewSchema>;

export const getAdminTicketResponseSchema = z.object({
  ticketId: ulidSchema,
  email: z.string(),
  vorname: z.string().optional(),
  nachname: z.string().optional(),
  ticket_state: z.enum(TICKET_STATES),
  state_timeline: z.array(
    z.object({ state: z.enum(TICKET_STATES), at: iso8601DateTimeSchema }),
  ),
  extraction_method: z.enum(EXTRACTION_METHODS),
  extraction_confidence: z.number(),
  barcode_uid: z.string().optional(),

  fahrt_abreisedatum: iso8601DateSchema.optional(),
  fahrt_abreisebahnhof: z.string().optional(),
  fahrt_zielbahnhof: z.string().optional(),
  fahrt_abfahrtszeit_plan: hhmmSchema.optional(),
  fahrt_ankunftszeit_plan: hhmmSchema.optional(),
  fahrt_zugnummer_plan: z.string().optional(),
  fahrt_zugkategorie_plan: z.string().optional(),
  fahrt_fahrkartennummer: z.string().optional(),
  fahrt_fahrkartenpreis: decimalEurSchema.optional(),

  tatsaechlich_ankunftsdatum: iso8601DateSchema.optional(),
  tatsaechlich_abfahrtszeit: hhmmSchema.optional(),
  tatsaechlich_ankunftszeit: hhmmSchema.optional(),
  tatsaechlich_zugnummer: z.string().optional(),
  tatsaechlich_verpasster_anschluss_bahnhof: z.string().optional(),

  antragsgrund: z.array(z.enum(ANTRAGSGRUENDE)).optional(),
  antragsart: z.enum(ANTRAGSARTEN).optional(),
  antragstellung_ort: z.string().optional(),
  zusaetzliche_angaben: z.string().optional(),

  delayMinutes: z.number().int().nonnegative().optional(),
  erwartete_erstattung: decimalEurSchema.optional(),
  service_fee_betrag: decimalEurSchema.optional(),

  has_belege: z.boolean(),

  db_paid_at: iso8601DateTimeSchema.optional(),
  admin_note: z.string().optional(),

  email_status: z.enum(EMAIL_STATUSES).optional(),
  email_provider_id: z.string().optional(),
  email_failed_reason: z.string().optional(),

  submitted_at: iso8601DateTimeSchema.optional(),
  updated_at: iso8601DateTimeSchema.optional(),

  sepa_mandate: sepaMandateViewSchema.optional(),
}).openapi("GetAdminTicketResponse", {
  description:
    "GET /admin/tickets/{ticketId} — full admin view; iban/bic never present.",
});
export type GetAdminTicketResponse = z.infer<
  typeof getAdminTicketResponseSchema
>;

// Admin can only push tickets to APPROVED / REJECTED / COMPLETED / INVALID.
// Money fields (erwartete_erstattung, service_fee_betrag) are immutable
// post-submit. .strict() rejects every other key.
export const patchAdminTicketRequestSchema = z
  .object({
    ticket_state: z
      .enum(["APPROVED", "REJECTED", "COMPLETED", "INVALID"] as const)
      .optional(),
    db_paid_at: iso8601DateTimeSchema.optional(),
    admin_note: z.string().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "at least one field must be provided",
  });
export type PatchAdminTicketRequest = z.infer<
  typeof patchAdminTicketRequestSchema
>;

// --- SEPA: pending-batches / mark-submitted / report-upload -------------

export const pendingBatchEntrySchema = z.object({
  batchId: z.string(),
  s3_key: z.string(),
  downloadUrl: z.string().url(),
  downloadUrlExpiresIn: z.number().int().positive(),
  mandate_count: z.number().int().nonnegative(),
  total_eur: decimalEurSchema,
  built_at: iso8601DateTimeSchema,
});
export type PendingBatchEntry = z.infer<typeof pendingBatchEntrySchema>;

export const getPendingBatchesResponseSchema = z
  .object({
    items: z.array(pendingBatchEntrySchema),
  })
  .openapi("GetPendingBatchesResponse", {
    description: "GET /admin/sepa/pending-batches — SEPA batches awaiting bank upload.",
  });
export type GetPendingBatchesResponse = z.infer<
  typeof getPendingBatchesResponseSchema
>;

// Empty body request — admin identity comes from the JWT.
export const markSubmittedRequestSchema = z.object({}).strict();
export type MarkSubmittedRequest = z.infer<typeof markSubmittedRequestSchema>;

// Operator retry for pain008-generator. Empty body — admin identity from
// JWT, ticketId from path. Symmetric with markSubmittedRequestSchema.
// Locked 2026-07-01 per audit finding `pain008-rebuild-body-unvalidated`.
export const pain008RebuildRequestSchema = z.object({}).strict();
export type Pain008RebuildRequest = z.infer<typeof pain008RebuildRequestSchema>;

export const markSubmittedResponseSchema = z
  .object({
    batchId: z.string(),
    submitted_at: iso8601DateTimeSchema,
    mandates_marked: z.number().int().nonnegative(),
  })
  .openapi("MarkSubmittedResponse", {
    description: "POST /admin/sepa/batches/{batchId}/mark-submitted response.",
  });
export type MarkSubmittedResponse = z.infer<typeof markSubmittedResponseSchema>;

export const SEPA_REPORT_CONTENT_TYPES = ["application/xml", "text/xml"] as const;

export const sepaReportUploadRequestSchema = z.object({
  filename: z.string().min(1),
  content_type: z.enum(SEPA_REPORT_CONTENT_TYPES),
  size_bytes: z.number().int().positive(),
});
export type SepaReportUploadRequest = z.infer<
  typeof sepaReportUploadRequestSchema
>;

export const sepaReportUploadResponseSchema = z
  .object({
    url: z.string().url(),
    fields: z.record(z.string()),
    expires_in: z.number().int().positive(),
  })
  .openapi("SepaReportUploadResponse", {
    description: "POST /admin/sepa/reports/upload — presigned POST envelope.",
  });
export type SepaReportUploadResponse = z.infer<
  typeof sepaReportUploadResponseSchema
>;
