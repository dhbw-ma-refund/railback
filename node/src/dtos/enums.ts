// String literal unions and readonly tuples for every enum used across @railback/lib.
// Tuples are the source of truth — types are derived from them so additions stay in sync.

export const TICKET_STATES = [
  "VALIDATING",
  "READY",
  "EMAIL_SENDING",
  "PENDING_DB_PAYMENT",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
  "EMAIL_FAILED",
  "INVALID",
] as const;
export type TicketState = (typeof TICKET_STATES)[number];

export const TERMINAL_TICKET_STATES = [
  "INVALID",
  "REJECTED",
  "COMPLETED",
  "EMAIL_FAILED",
] as const;
export type TerminalTicketState = (typeof TERMINAL_TICKET_STATES)[number];

export const USER_STATES = ["ACTIVE", "SUSPENDED", "DELETION_SCHEDULED"] as const;
export type UserState = (typeof USER_STATES)[number];

export const EMAIL_STATUSES = [
  "SENDING",
  "SENT",
  "FAILED_TRANSIENT",
  "DELIVERED",
  "BOUNCED",
  "FAILED",
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EXTRACTION_METHODS = ["BARCODE", "PDF_TEXT", "MANUAL", "MANUAL_ROUTE"] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const EXTRACTION_STATUSES = ["PROCESSING", "DONE", "FAILED"] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const ANTRAGSARTEN = [
  "ERSTATTUNG_FAHRKARTE",
  "ENTSCHAEDIGUNG_60_119",
  "ENTSCHAEDIGUNG_120_PLUS",
  "ENTSCHAEDIGUNG_ZEITKARTE",
  "KOSTEN_ALTERNATIVTRANSPORT",
] as const;
export type Antragsart = (typeof ANTRAGSARTEN)[number];

export const ANTRAGSGRUENDE = ["VERSPAETUNG", "AUSFALL", "VERPASSTER_ANSCHLUSS"] as const;
export type Antragsgrund = (typeof ANTRAGSGRUENDE)[number];

export const MANDATE_STATES = [
  "ISSUED",
  "SUBMITTED",
  "DEBITED",
  "REVERSED",
  "DISPUTED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type MandateState = (typeof MANDATE_STATES)[number];

export const SERVICE_FEE_STATES = ["PENDING", "DEBITED", "REVERSED", "WAIVED"] as const;
export type ServiceFeeState = (typeof SERVICE_FEE_STATES)[number];

export const BELEG_TYPEN = ["TAXI", "BUS", "HOTEL", "SONSTIGES"] as const;
export type BelegTyp = (typeof BELEG_TYPEN)[number];

export const ROLES = ["USER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const ERROR_CODES = [
  "ERR_VALIDATION",
  "ERR_AUTH_INVALID",
  "ERR_AUTH_EXPIRED",
  "ERR_FORBIDDEN",
  "ERR_NOT_FOUND",
  "ERR_CONFLICT",
  "ERR_NO_CLAIM",
  "ERR_NO_CANDIDATES",
  "ERR_INTERNAL",
  "ERR_EMAIL_FAILED",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
