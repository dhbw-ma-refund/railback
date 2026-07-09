// Repo interface contracts. Backend handlers depend on Db; storage backends
// (memory, file, ddb) satisfy it. Signatures match CLAUDE.md verbatim.

import type {
  Admin,
  AdminAuthLookup,
  AdminTicketQuery,
  NewMandate,
  NewRouteTemplate,
  NewRouteTicket,
  NewSepaReport,
  NewTicket,
  NewUser,
  Page,
  PresignedPost,
  ProfilePatch,
  RawUpload,
  RawUploadInput,
  Receipt,
  ReceiptInput,
  RenderedPdf,
  RenderedPdfInput,
  RouteTemplate,
  RouteTemplatePatch,
  SegmentDelay,
  SepaMandate,
  SepaReport,
  Ticket,
  TicketOwner,
  TicketPatch,
  User,
  UserAdminView,
  UserAuthLookup,
  UserListQuery,
} from "../types/dto.js";

export interface UserRepo {
  getByEmail(email: string): Promise<User | null>;
  /**
   * Internal auth view: returns email + hashed_password + state metadata,
   * never used outside auth-handler. Returns null when no matching row.
   */
  getByEmailForAuth(email: string): Promise<UserAuthLookup | null>;
  /**
   * Admin-side view: same row as getByEmail but with `iban_enc`/`bic_enc`/
   * `ttl` stripped at the repo layer (defense in depth on top of the
   * admin-handler projection). MUST be used by admin-handler instead of
   * `getByEmail` — CLAUDE.md / DB_SCHEMA.md / IMPLEMENTATION_PLAN.md all
   * lock this as the boundary that keeps bank ciphertext out of the
   * admin Lambda's memory.
   */
  getByEmailAdminView(email: string): Promise<UserAdminView | null>;
  create(user: NewUser): Promise<User>;
  updateProfile(email: string, patch: ProfilePatch): Promise<User>;
  /** Admin-side list — same projection as getByEmailAdminView. */
  listAdminView(query: UserListQuery): Promise<Page<UserAdminView>>;
  scheduleDeletion(email: string): Promise<void>;
  /**
   * Anonymisation-sweeper Pass A: linear scan for profiles with
   * `user_state="DELETION_SCHEDULED" AND ttl !== undefined AND ttl < nowEpochSec`.
   * `nowEpochSec` matches the units of the persisted `ttl` field (epoch
   * seconds, the DDB TTL convention).
   */
  scanDeletionScheduledExpired(nowEpochSec: number): Promise<User[]>;
  /**
   * Hard-delete the profile row. Idempotent (no-op on missing). Used by the
   * anonymisation-sweeper at the end of Pass A per user; the TTL has already
   * fired so we drop the row eagerly to keep the next sweep idempotent.
   */
  deleteByEmail(email: string): Promise<void>;
  /**
   * Anonymisation-sweeper Pass A orphan-recovery: linear scan for `USER#`
   * partitions that have at least one child row but NO live PROFILE row,
   * AND whose PK is NOT an already-anonymised `USER#sha256:` partition.
   * Returns the decoded email strings. Covers the case where DDB's own
   * TTL sweeper evicted the profile before our cron got there — child
   * rows would otherwise stay un-anonymised under the original email PK
   * forever because the profile-driven scan can no longer find them.
   */
  scanOrphanUserPks(): Promise<string[]>;
}

export interface TicketRepo {
  get(email: string, id: string): Promise<Ticket | null>;
  listForUser(email: string): Promise<Ticket[]>;
  create(ticket: NewTicket): Promise<Ticket>;
  createFromRoute(ticket: NewRouteTicket): Promise<Ticket>;
  patch(email: string, id: string, patch: TicketPatch): Promise<Ticket>;
  delete(email: string, id: string): Promise<void>;
  adminList(query: AdminTicketQuery): Promise<Page<Ticket>>;
  findByBarcodeUid(uid: string): Promise<Ticket | null>;
  /**
   * Query `GSI_EMAIL_PENDING` ascending by SK (oldest `email_last_attempt`
   * first). Returns at most `limit` tickets currently in the retry queue —
   * i.e. `email_status IN ("SENDING","FAILED_TRANSIENT")` with
   * `email_attempts < 3` (the GSI is sparse on the write side; callers MUST
   * NOT re-filter). Used by `email-sweeper` Pass A.
   */
  queryEmailPending(limit: number): Promise<Ticket[]>;
  /**
   * Scan for tickets in `ticket_state="EMAIL_SENDING"` AND
   * `email_status="SENT"` whose last attempt is older than `cutoffIso`.
   * Used by `email-sweeper` Pass B (24h-stuck watchdog). Real DDB impl:
   * `Scan` with a `FilterExpression` on those three attributes — admin-scale
   * traffic, one Scan per cron tick is fine.
   */
  scanEmailWatchdog(cutoffIso: string): Promise<Ticket[]>;
  /**
   * Anonymisation-sweeper Pass A: for every ticket row under `USER#<email>`
   * (strict — rejects MANDATE/BELEG sub-rows), rewrite PK to `anonPk`
   * (`USER#sha256:<full sha256Hex(email)>`), strip the PII fields listed in
   * DB_SCHEMA.md §"Cascade on user delete" item 3 (vorname_aus_ticket,
   * nachname_aus_ticket, fahrt_fahrkartennummer, antragstellung_ort,
   * antragstellung_datum, zusaetzliche_angaben), and refresh `updated_at`
   * to `nowIso`. Returns the list of `ticketId` values touched so the
   * caller can cascade S3 + TicketOwner cleanups.
   */
  anonymiseUserTickets(
    email: string,
    anonPk: string,
    nowIso: string
  ): Promise<{ ticketIds: string[] }>;
  /**
   * Anonymisation-sweeper Pass A: enumerate every ticketId that has *any*
   * trace under `USER#<email>` — TICKET#/RAW#/RENDERED#/BELEG#/MANDATE#
   * rows all yield the same ticketId. Returns the de-duplicated set.
   * Used by the cascade to discover stranded blob debris from earlier
   * hard-deleted tickets so a single pass cleans the partition fully.
   */
  enumerateAllTicketIdsForUser(email: string): Promise<string[]>;
}

export interface RouteTemplateRepo {
  list(email: string): Promise<RouteTemplate[]>;
  get(email: string, id: string): Promise<RouteTemplate | null>;
  create(email: string, tpl: NewRouteTemplate): Promise<RouteTemplate>;
  patch(email: string, id: string, patch: RouteTemplatePatch): Promise<RouteTemplate>;
  delete(email: string, id: string): Promise<void>;
  /**
   * Anonymisation-sweeper Pass A: hard-delete every TEMPLATE#-row under
   * USER#<email>. Returns the count for the summary log. Templates have no
   * S3 blobs so DDB-row delete is the whole cascade.
   */
  deleteAllForUser(email: string): Promise<number>;
}

export interface BlobRepo {
  getRawUpload(email: string, id: string): Promise<RawUpload | null>;
  putRawUpload(email: string, id: string, input: RawUploadInput): Promise<void>;
  getRenderedPdf(email: string, id: string): Promise<RenderedPdf | null>;
  putRenderedPdf(email: string, id: string, input: RenderedPdfInput): Promise<void>;
  listReceipts(email: string, id: string): Promise<Receipt[]>;
  putReceipt(email: string, id: string, input: ReceiptInput): Promise<Receipt>;
  deleteReceipt(email: string, id: string, belegId: string): Promise<void>;
  /**
   * Read raw bytes by s3_key. Returns null if the object does not exist.
   * Used by refund-pdf (belege merge) and email-sweeper (attachment fetch
   * on retry). The s3_key is the value previously persisted on Receipt /
   * RenderedPdf / RawUpload rows; callers do NOT construct it themselves.
   */
  getBytes(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /**
   * Write raw bytes at an arbitrary s3_key. Used by refund-pdf to persist the
   * rendered EU-form PDF: the lambda computes the canonical key
   * `rendered/<emailHash>/<ticketId>.pdf`, hands the flattened bytes here, and
   * then writes the matching `RenderedPdf` metadata row via putRenderedPdf.
   *
   * Distinct from the presigned-POST flow (presignRawUploadPost /
   * presignReceiptPost) which is for frontend → S3 user uploads — those never
   * touch the lambda's memory. putBytes is the backend-side counterpart for
   * artefacts we render ourselves.
   */
  putBytes(
    key: string,
    bytes: Uint8Array,
    contentType: string,
    uploadedAt: string
  ): Promise<void>;
  presignRawUploadPost(email: string, id: string, contentType: string): Promise<PresignedPost>;
  presignReceiptPost(email: string, id: string, contentType: string): Promise<PresignedPost>;
  /**
   * Hard-delete an S3 object by key. Idempotent — no-op when the key is
   * absent. Used by the anonymisation-sweeper's Pass-A cascade to drop
   * raw uploads, rendered PDFs, and belege from S3.
   */
  deleteBytes(key: string): Promise<void>;
  /**
   * Anonymisation-sweeper Pass A: delete the RawUpload metadata row and
   * (if the row carried an `s3_key`) the matching S3 object. Returns the
   * key that was deleted, or `null` when there was no row to begin with.
   */
  deleteRawUpload(email: string, id: string): Promise<{ s3_key: string | null }>;
  /**
   * Anonymisation-sweeper Pass A: delete the RenderedPdf metadata row and
   * its S3 object. Same shape / semantics as `deleteRawUpload`.
   */
  deleteRenderedPdf(email: string, id: string): Promise<{ s3_key: string | null }>;
  /**
   * Anonymisation-sweeper Pass A: delete every Receipt row for the ticket
   * and the matching S3 objects. Returns the keys it deleted (possibly an
   * empty array). One call per ticket — the sweeper does not iterate.
   */
  deleteAllReceipts(email: string, id: string): Promise<{ s3_keys: string[] }>;
}

export interface MandateRepo {
  get(email: string, id: string): Promise<SepaMandate | null>;
  /**
   * Reverse lookup by `mandate_id` (the ULID we stamp on `EndToEndId` of every
   * pain.008 payment info). Returns null if no live mandate row carries that
   * id. Used by `sepa-reports` Lambda: inbound pain.002 / camt.054 XML echoes
   * `EndToEndId` back at us and that's the only cross-reference the bank
   * emits — no `(email, ticketId)` context. Linear scan in v1 (admin-scale
   * mandate volume, one call per parsed report entry); real DDB impl (Phase 5)
   * either adds a GSI on `mandate_id` or leans on the `TicketOwner` pointer
   * pattern documented in CLAUDE.md. Anonymised rows (`USER#sha256:` prefix)
   * are intentionally skipped — those are the 10y archive and are not part of
   * the live SEPA pipeline.
   */
  getByMandateId(mandateId: string): Promise<SepaMandate | null>;
  issue(email: string, id: string, mandate: NewMandate): Promise<SepaMandate>;
  /**
   * Conditional-write contract (SEPA_PAIN008.md §7): if `pain008_built_at`
   * is already set, MUST throw `ERR_CONFLICT` instead of overwriting.
   * Real DDB impl: `UpdateItem` with
   *   `ConditionExpression: attribute_not_exists(pain008_built_at)` and
   * translate `ConditionalCheckFailedException` → `ERR_CONFLICT`.
   * Defends against the double-build race acknowledged in CLAUDE.md and
   * in `pain008-generator/src/handler.ts`.
   */
  stampPain008Built(
    email: string,
    id: string,
    info: { batchId: string; s3Key: string; builtAt: string }
  ): Promise<void>;
  markSubmitted(email: string, id: string, submittedAt: string): Promise<void>;
  markDebited(email: string, id: string, debitedAt: string): Promise<void>;
  markReversed(
    email: string,
    id: string,
    info: { reversedAt: string; reason: string }
  ): Promise<void>;
  markDisputed(email: string, id: string, disputeOpenedAt: string): Promise<void>;
  markExpired(email: string, id: string): Promise<void>;
  markCancelled(email: string, id: string): Promise<void>;
  listPendingBatches(): Promise<SepaMandate[]>;
  /**
   * All mandates carrying the given pain008_batch_id. Used by admin-handler's
   * POST /admin/sepa/batches/{batchId}/mark-submitted to flip every mandate
   * in a batch from ISSUED → SUBMITTED in one go. In v1 a batch holds one
   * mandate, but the schema is batch-id-grouped so future multi-mandate
   * batches drop in without API changes.
   */
  listByBatchId(batchId: string): Promise<SepaMandate[]>;
  listExpiringISSUED(now: string): Promise<SepaMandate[]>;
  /**
   * Anonymisation-sweeper Pass A: for every #MANDATE row under
   * USER#<email>, rewrite PK to `anonPk` and null the PII fields
   * (iban_enc, bic_enc, kontoinhaber_snapshot, user_consent_ip,
   * user_consent_user_agent). All non-PII fields — mandate_id /
   * mandate_state / sequence_type / fee_amount / user_consent_at /
   * vorabankuendigung_sent_at / pain008_* / debited_at / reversed_* /
   * dispute_opened_at / expires_at / issued_at / ttl — are preserved
   * verbatim. Returns the count of mandates rewritten so the cascade
   * caller can report it without a second walk.
   */
  anonymiseUserMandates(email: string, anonPk: string): Promise<{ count: number }>;
}

// 10-year retention for the SepaReport audit row (buchungsrelevant per
// HGB §257 / AO §147). Matches DB_SCHEMA.md TTL table for `SEPA Report`.
// 365.2425 = Gregorian mean year length; flat 365d would drift ~2.5d short
// over 10y, cutting the retention window early. Mirrors the same constant
// convention used by admin-handler/routes/patch-ticket.ts.
const SECONDS_PER_DAY = 24 * 60 * 60;
export const SEPA_REPORT_TTL_SECONDS = Math.round(10 * 365.2425 * SECONDS_PER_DAY);

export interface SepaReportRepo {
  put(report: NewSepaReport): Promise<SepaReport>;
  getByReportId(date: string, reportId: string): Promise<SepaReport | null>;
}

export interface DelayRepo {
  segmentsForTrain(trainNr: string, date: string): Promise<SegmentDelay[]>;
  departuresFromStation(
    eva: number,
    date: string,
    fromTime: string,
    toTime: string
  ): Promise<SegmentDelay[]>;
}

export interface AdminRepo {
  getByEmail(email: string): Promise<Admin | null>;
  /**
   * Internal auth view: returns email + hashed_password, never used
   * outside auth-handler. Returns null when no matching row.
   */
  getByEmailForAuth(email: string): Promise<AdminAuthLookup | null>;
}

export interface TicketOwnerRepo {
  get(ticketId: string): Promise<TicketOwner | null>;
  put(ticketId: string, email: string, ttl?: number): Promise<void>;
  delete(ticketId: string): Promise<void>;
}

export interface Db {
  users: UserRepo;
  tickets: TicketRepo;
  routeTemplates: RouteTemplateRepo;
  blobs: BlobRepo;
  mandates: MandateRepo;
  sepaReports: SepaReportRepo;
  delays: DelayRepo;
  admins: AdminRepo;
  ticketOwners: TicketOwnerRepo;
}

// Backend registration runtime lives in ./registry.ts and ./index.ts. Re-exported
// here for ergonomics + backwards compatibility with the foundation-layer tests.

export type DbFactory = () => Db;

import { _registerBackendByString } from "./registry.js";

/** Loose-typed shim for the foundation tests; new code uses the strict variant
 *  from ./registry.js. */
export function registerBackend(name: string, factory: DbFactory): void {
  _registerBackendByString(name, factory);
}

export { db, resetDbCache as resetDbForTests } from "./index.js";
