// Ticket-flow endpoints. Refund submit holds the EU-form payload minus the
// user's own contact info (that comes from the User record at submit time).

import { z } from "zod";
import {
  ANTRAGSARTEN,
  ANTRAGSGRUENDE,
  BELEG_TYPEN,
  EMAIL_STATUSES,
  EXTRACTION_METHODS,
  EXTRACTION_STATUSES,
  TICKET_STATES,
} from "../types/enums.js";
import {
  decimalEurSchema,
  hhmmSchema,
  iso8601DateSchema,
  iso8601DateTimeSchema,
  ulidSchema,
} from "./common.js";

export const mimeTypeSchema = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
export type SupportedMimeType = z.infer<typeof mimeTypeSchema>;

export const uploadRequestSchema = z.object({
  filename: z.string().min(1),
  mimeType: mimeTypeSchema,
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const presignedFieldsSchema = z.record(z.string());

export const uploadResponseSchema = z
  .object({
    ticketId: ulidSchema,
    uploadUrl: z.string().url(),
    s3_key: z.string().min(1),
    expiresIn: z.number().int().positive(),
    fields: presignedFieldsSchema,
  })
  .openapi("UploadResponse", {
    description: "Presigned S3 POST envelope for a raw ticket upload.",
  });
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const uploadConfirmRequestSchema = z.object({
  s3_key: z.string().min(1),
  filename: z.string().min(1),
  mimeType: mimeTypeSchema,
});
export type UploadConfirmRequest = z.infer<typeof uploadConfirmRequestSchema>;

export const uploadConfirmResponseSchema = z
  .object({
    ticketId: ulidSchema,
    extraction_status: z.enum(EXTRACTION_STATUSES),
  })
  .openapi("UploadConfirmResponse", {
    description: "Response after landing the RAW#<ticketId> DDB row.",
  });
export type UploadConfirmResponse = z.infer<typeof uploadConfirmResponseSchema>;

// Full ticket view returned by GET /users/me/tickets/{id}. Mirrors the Ticket
// DTO; kept loose where DTO is loose. No iban/bic ever.
export const ticketResponseSchema = z.object({
  email: z.string(),
  ticketId: ulidSchema,
  ticket_state: z.enum(TICKET_STATES),
  state_timeline: z.array(
    z.object({ state: z.enum(TICKET_STATES), at: iso8601DateTimeSchema }),
  ),

  extraction_status: z.enum(EXTRACTION_STATUSES),
  extraction_method: z.enum(EXTRACTION_METHODS),
  extraction_confidence: z.number(),
  barcode_uid: z.string().optional(),

  vorname_aus_ticket: z.string().optional(),
  nachname_aus_ticket: z.string().optional(),
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
  is_zeitkarte: z.boolean().optional(),
  antragstellung_ort: z.string().optional(),
  antragstellung_datum: iso8601DateSchema.optional(),
  zusaetzliche_angaben: z.string().optional(),
  datenschutz_einwilligung: z.boolean().optional(),
  wahrheitserklaerung: z.boolean().optional(),

  delayMinutes: z.number().int().nonnegative().optional(),
  erwartete_erstattung: decimalEurSchema.optional(),
  service_fee_betrag: decimalEurSchema.optional(),

  db_paid_at: iso8601DateTimeSchema.optional(),
  admin_note: z.string().optional(),

  email_status: z.enum(EMAIL_STATUSES).optional(),
  email_attempts: z.number().int().nonnegative().optional(),
  email_last_attempt: iso8601DateTimeSchema.optional(),
  email_failed_reason: z.string().optional(),

  uploaded_at: iso8601DateTimeSchema.optional(),
  submitted_at: iso8601DateTimeSchema.optional(),
  updated_at: iso8601DateTimeSchema,
  belege_count: z.number().int().nonnegative().optional(),
}).openapi("TicketResponse", {
  description:
    "Full ticket view. Never includes iban/bic. Optional fields fill in as the ticket progresses through the state machine.",
});
export type TicketResponse = z.infer<typeof ticketResponseSchema>;

export const ticketSummarySchema = z
  .object({
    ticketId: ulidSchema,
    ticket_state: z.enum(TICKET_STATES),
    // Per API_CONTRACT_USERFORMS.md D03 the dashboard list item must carry
    // enough info to distinguish in-flight from delivered tickets without
    // a per-row /tickets/{id} fetch — that's why email_status, submitted_at,
    // antragsart, fahrkartenpreis are on the summary. Field names are the
    // flat "trip" variants (no fahrt_ prefix) to match the contract verbatim.
    abreisedatum: iso8601DateSchema.optional(),
    abreisebahnhof: z.string().optional(),
    zielbahnhof: z.string().optional(),
    fahrkartenpreis: decimalEurSchema.optional(),
    antragsart: z.enum(ANTRAGSARTEN).optional(),
    erwartete_erstattung: decimalEurSchema.optional(),
    email_status: z.enum(EMAIL_STATUSES).optional(),
    submitted_at: iso8601DateTimeSchema.optional(),
    updated_at: iso8601DateTimeSchema,
  })
  .openapi("TicketSummary", {
    description: "Dashboard list-item projection of a ticket.",
  });
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

export const listTicketsResponseSchema = z
  .object({
    items: z.array(ticketSummarySchema),
  })
  .openapi("ListTicketsResponse", {
    description: "GET /users/me/tickets — user-scoped ticket list.",
  });
export type ListTicketsResponse = z.infer<typeof listTicketsResponseSchema>;

// /refund — request shape per CONTRACTS. Section 5 (contact info) is NOT in
// the body; backend reads it from the User record at submit time. Both
// consent literals must be true.
export const refundFahrtSchema = z.object({
  abreisedatum: iso8601DateSchema,
  abreisebahnhof: z.string().min(1),
  zielbahnhof: z.string().min(1),
  abfahrtszeit_plan: hhmmSchema,
  ankunftszeit_plan: hhmmSchema,
  zugnummer_plan: z.string().min(1),
  zugkategorie_plan: z.string().optional(),
  fahrkartennummer: z.string().min(1),
  fahrkartenpreis: decimalEurSchema,
});
export type RefundFahrt = z.infer<typeof refundFahrtSchema>;

export const refundFahrtTatsaechlichSchema = z.object({
  // Field names mirror API_CONTRACT_USERFORMS.md Step 5 verbatim. The
  // `_tatsaechlich` suffix on every field is redundant given the parent
  // object name, but the contract is the source of truth and the frontend
  // already speaks it. nullable() accepts the contract's literal `null`
  // for "not applicable" (e.g. verpasster_anschluss_bahnhof when
  // antragsgrund doesn't include VERPASSTER_ANSCHLUSS).
  ankunftsdatum_tatsaechlich: iso8601DateSchema.nullable().optional(),
  abfahrtszeit_tatsaechlich: hhmmSchema.nullable().optional(),
  ankunftszeit_tatsaechlich: hhmmSchema.nullable().optional(),
  zugnummer_tatsaechlich: z.string().nullable().optional(),
  verpasster_anschluss_bahnhof: z.string().nullable().optional(),
});
export type RefundFahrtTatsaechlich = z.infer<
  typeof refundFahrtTatsaechlichSchema
>;

export const refundRequestSchema = z
  .object({
    antragsgrund: z.array(z.enum(ANTRAGSGRUENDE)).min(1),
    antragsart: z.enum(ANTRAGSARTEN),
    is_zeitkarte: z.boolean().optional(),
    fahrt: refundFahrtSchema,
    fahrt_tatsaechlich: refundFahrtTatsaechlichSchema,
    antragstellung_ort: z.string().min(1),
    zusaetzliche_angaben: z.string().optional(),
    datenschutz_einwilligung: z.literal(true),
    wahrheitserklaerung: z.literal(true),
  })
  .openapi("RefundRequest", {
    description:
      "POST /users/me/tickets/{ticketId}/refund body. Section-5 contact info is NOT in this body.",
  });
export type RefundRequest = z.infer<typeof refundRequestSchema>;

export const refundResponseSchema = z
  .object({
    ticketId: ulidSchema,
    // The renderer (refund-pdf) runs sync inside POST /refund and may have
    // already transitioned the ticket to a terminal EMAIL_FAILED on a
    // permanent SES rejection. Widen the response to reflect what actually
    // happened — the contract example shows the happy-path EMAIL_SENDING /
    // SENT case, but the schema must permit the failure path too.
    ticket_state: z.enum(["EMAIL_SENDING", "EMAIL_FAILED"]),
    submitted_at: iso8601DateTimeSchema,
    email_status: z.enum(EMAIL_STATUSES),
    erwartete_erstattung: decimalEurSchema,
    service_fee_betrag: decimalEurSchema,
  })
  .openapi("RefundResponse", {
    description:
      "POST /refund response. Amounts are locked at submit; edits require reject + resubmit.",
  });
export type RefundResponse = z.infer<typeof refundResponseSchema>;

// /tickets/route-lookup — at least one of fromStation/fromEva and
// toStation/toEva is required.
export const routeLookupRequestSchema = z
  .object({
    fromStation: z.string().optional(),
    fromEva: z.number().int().positive().optional(),
    toStation: z.string().optional(),
    toEva: z.number().int().positive().optional(),
    date: iso8601DateSchema,
    timeWindow: z
      .object({ from: hhmmSchema, to: hhmmSchema })
      .optional(),
  })
  .refine((d) => d.fromStation !== undefined || d.fromEva !== undefined, {
    message: "fromStation or fromEva is required",
    path: ["fromStation"],
  })
  .refine((d) => d.toStation !== undefined || d.toEva !== undefined, {
    message: "toStation or toEva is required",
    path: ["toStation"],
  });
export type RouteLookupRequest = z.infer<typeof routeLookupRequestSchema>;

export const routeLookupCandidateSchema = z.object({
  trainNr: z.string(),
  zugkategorie: z.string().optional(),
  abfahrt_plan: hhmmSchema,
  ankunft_plan: hhmmSchema,
  abfahrt_tatsaechlich: hhmmSchema.optional(),
  ankunft_tatsaechlich: hhmmSchema.optional(),
  delayMinutes: z.number().int().nonnegative(),
  any_cancelled: z.boolean(),
  data_quality: z.enum(["FULL", "PARTIAL", "PLAN_ONLY"]),
});
export type RouteLookupCandidate = z.infer<typeof routeLookupCandidateSchema>;

export const routeLookupResponseSchema = z
  .object({
    candidates: z.array(routeLookupCandidateSchema),
  })
  .openapi("RouteLookupResponse", {
    description: "Candidate direct connections for the MANUAL_ROUTE flow.",
  });
export type RouteLookupResponse = z.infer<typeof routeLookupResponseSchema>;

export const fromRouteRequestSchema = z.object({
  ticketId: ulidSchema.optional(),
  trainNr: z.string().min(1),
  date: iso8601DateSchema,
  fromStation: z.string().min(1),
  toStation: z.string().min(1),
  abfahrtszeit_plan: hhmmSchema,
  ankunftszeit_plan: hhmmSchema,
  fahrkartennummer: z.string().min(1),
  fahrkartenpreis: decimalEurSchema,
  is_zeitkarte: z.boolean().default(false),
  templateId: ulidSchema.optional(),
});
export type FromRouteRequest = z.infer<typeof fromRouteRequestSchema>;

export const fromRouteResponseSchema = z.object({
  ticketId: ulidSchema,
  ticket_state: z.literal("READY"),
  extraction_method: z.literal("MANUAL_ROUTE"),
  extraction_confidence: z.literal(0),
});
export type FromRouteResponse = z.infer<typeof fromRouteResponseSchema>;

export const delaysRequestSchema = z.object({
  trainNr: z.string().min(1),
  date: iso8601DateSchema,
  abreisebahnhof: z.string().min(1),
  zielbahnhof: z.string().min(1),
});
export type DelaysRequest = z.infer<typeof delaysRequestSchema>;

export const delaysResponseSchema = z.object({
  trainNr: z.string(),
  date: iso8601DateSchema,
  // Per API_CONTRACT_USERFORMS.md "Step 3" — the response wraps every
  // segment in the span between abreise/ziel and surfaces the *summary*
  // fields (maxDelayMinutes / any_cancelled / suggested_antragsart) at
  // the top level. The frontend caches this for the rest of the wizard.
  segments: z.array(
    z.object({
      segId: z.string(),
      origin: z.string(),
      destination: z.string(),
      delayMinutes: z.number().int().nonnegative(),
      reason: z.string(),
      is_cancelled: z.boolean(),
      abfahrtszeit_plan: hhmmSchema,
      abfahrtszeit_tatsaechlich: hhmmSchema.optional(),
      ankunftszeit_plan: hhmmSchema,
      ankunftszeit_tatsaechlich: hhmmSchema.optional(),
    }),
  ),
  maxDelayMinutes: z.number().int().nonnegative(),
  any_cancelled: z.boolean(),
  suggested_antragsart: z.enum(ANTRAGSARTEN),
  // data_quality stays as a backend signal — Phase-1 lib returns it; the
  // frontend can show a banner. It's not in the original contract sketch
  // but it doesn't conflict (additive only), so we keep it.
  data_quality: z.enum(["FULL", "PARTIAL", "PLAN_ONLY"]),
});
export type DelaysResponse = z.infer<typeof delaysResponseSchema>;

export const belegPresignRequestSchema = z.object({
  filename: z.string().min(1),
  mimeType: mimeTypeSchema,
  typ: z.enum(BELEG_TYPEN),
});
export type BelegPresignRequest = z.infer<typeof belegPresignRequestSchema>;

export const belegPresignResponseSchema = z.object({
  belegId: ulidSchema,
  uploadUrl: z.string().url(),
  s3_key: z.string().min(1),
  expiresIn: z.number().int().positive(),
  fields: presignedFieldsSchema,
});
export type BelegPresignResponse = z.infer<typeof belegPresignResponseSchema>;

export const belegConfirmResponseSchema = z.object({
  belegId: ulidSchema,
});
export type BelegConfirmResponse = z.infer<typeof belegConfirmResponseSchema>;

// POST /users/me/tickets/{ticketId}/belege/{belegId}/confirm — frontend
// reports back what it actually uploaded so we can land the metadata row.
// size_bytes is required so the 5 MB cap can be enforced at confirm time
// even though S3 already enforced it via the presigned-POST policy.
// `amount` is the EUR value of the receipt; required so the backend can
// derive `belegeSumme` for `KOSTEN_ALTERNATIVTRANSPORT` refunds without
// re-prompting at submit time (locked 2026-06-24, see CLAUDE.md
// "Belege amount field").
export const belegConfirmRequestSchema = z.object({
  s3_key: z.string().min(1),
  filename: z.string().min(1),
  mimeType: mimeTypeSchema,
  typ: z.enum(BELEG_TYPEN),
  size_bytes: z.number().int().positive(),
  amount: decimalEurSchema,
});
export type BelegConfirmRequest = z.infer<typeof belegConfirmRequestSchema>;
