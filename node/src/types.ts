// Public type surface for @railback/db. DTOs are vendored under ./dtos/;
// this file re-exports the strict shapes and declares the full 9-repo
// Db interface the adapter implements.
//
// Phase 1 constraint: signature parity with backend/lib/src/storage/types.ts.
// Errors are thrown, NOT Result-wrapped. Promise<T | null> for gets,
// Promise<T> for creates, Promise<void> for state transitions.
// Physical DynamoDB attribute names (pk, sk, gsi*) never appear here.

export * from "./dtos/index.js";

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
} from "./dtos/index.js";

export interface UserRepo {
  getByEmail(email: string): Promise<User | null>;
  getByEmailForAuth(email: string): Promise<UserAuthLookup | null>;
  getByEmailAdminView(email: string): Promise<UserAdminView | null>;
  create(user: NewUser): Promise<User>;
  updateProfile(email: string, patch: ProfilePatch): Promise<User>;
  /** Admin-side list — same projection as getByEmailAdminView. */
  listAdminView(query: UserListQuery): Promise<Page<UserAdminView>>;
  scheduleDeletion(email: string): Promise<void>;
  scanDeletionScheduledExpired(nowEpochSec: number): Promise<User[]>;
  deleteByEmail(email: string): Promise<void>;
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
  queryEmailPending(limit: number): Promise<Ticket[]>;
  scanEmailWatchdog(cutoffIso: string): Promise<Ticket[]>;
  anonymiseUserTickets(
    email: string,
    anonPk: string,
    nowIso: string,
  ): Promise<{ ticketIds: string[] }>;
  enumerateAllTicketIdsForUser(email: string): Promise<string[]>;
}

export interface RouteTemplateRepo {
  list(email: string): Promise<RouteTemplate[]>;
  get(email: string, id: string): Promise<RouteTemplate | null>;
  create(email: string, tpl: NewRouteTemplate): Promise<RouteTemplate>;
  patch(email: string, id: string, patch: RouteTemplatePatch): Promise<RouteTemplate>;
  delete(email: string, id: string): Promise<void>;
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
  getBytes(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  putBytes(
    key: string,
    bytes: Uint8Array,
    contentType: string,
    uploadedAt: string,
  ): Promise<void>;
  presignRawUploadPost(email: string, id: string, contentType: string): Promise<PresignedPost>;
  presignReceiptPost(email: string, id: string, contentType: string): Promise<PresignedPost>;
  deleteBytes(key: string): Promise<void>;
  deleteRawUpload(email: string, id: string): Promise<{ s3_key: string | null }>;
  deleteRenderedPdf(email: string, id: string): Promise<{ s3_key: string | null }>;
  deleteAllReceipts(email: string, id: string): Promise<{ s3_keys: string[] }>;
}

export interface MandateRepo {
  get(email: string, id: string): Promise<SepaMandate | null>;
  getByMandateId(mandateId: string): Promise<SepaMandate | null>;
  issue(email: string, id: string, mandate: NewMandate): Promise<SepaMandate>;
  stampPain008Built(
    email: string,
    id: string,
    info: { batchId: string; s3Key: string; builtAt: string },
  ): Promise<void>;
  markSubmitted(email: string, id: string, submittedAt: string): Promise<void>;
  markDebited(email: string, id: string, debitedAt: string): Promise<void>;
  markReversed(
    email: string,
    id: string,
    info: { reversedAt: string; reason: string },
  ): Promise<void>;
  markDisputed(email: string, id: string, disputeOpenedAt: string): Promise<void>;
  markExpired(email: string, id: string): Promise<void>;
  markCancelled(email: string, id: string): Promise<void>;
  listPendingBatches(): Promise<SepaMandate[]>;
  listByBatchId(batchId: string): Promise<SepaMandate[]>;
  listExpiringISSUED(now: string): Promise<SepaMandate[]>;
  anonymiseUserMandates(email: string, anonPk: string): Promise<{ count: number }>;
}

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
    toTime: string,
  ): Promise<SegmentDelay[]>;
}

export interface AdminRepo {
  getByEmail(email: string): Promise<Admin | null>;
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
