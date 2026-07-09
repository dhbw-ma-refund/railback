// DdbBackend adapter wired via buildDdbDb. As of Phase 3b/3c every repo
// method (users / tickets / mandates / routeTemplates / delays / sepaReports
// / ticketOwners / blobs) is FILLED — it dispatches to DynamoDB (and S3 for
// blobs) rather than throwing NotImplementedError. This spec therefore no
// longer asserts "unfilled" behaviour; it existence-checks the wired surface.
// Real behaviour is covered by @railback/db/tests/*.

import { describe, expect, it } from "vitest";
import { buildDdbDb } from "../../src/storage/ddb/stubs.js";

function expectWired(repo: Record<string, unknown>, methods: readonly string[]): void {
  for (const m of methods) {
    expect(typeof repo[m], `${m} should be a wired function`).toBe("function");
  }
}

describe("buildDdbDb (no client) — Phase 3b/3c repos are wired", () => {
  const ddb = buildDdbDb();

  it("users write-path methods are wired (Phase 3b)", () => {
    expectWired(ddb.users as unknown as Record<string, unknown>, [
      "getByEmail",
      "getByEmailForAuth",
      "getByEmailAdminView",
      "create",
      "updateProfile",
      "listAdminView",
      "scheduleDeletion",
      "scanDeletionScheduledExpired",
      "deleteByEmail",
      "scanOrphanUserPks",
    ]);
  });

  it("tickets write-path methods are wired (Phase 3b)", () => {
    expectWired(ddb.tickets as unknown as Record<string, unknown>, [
      "get",
      "listForUser",
      "create",
      "createFromRoute",
      "patch",
      "delete",
      "adminList",
      "findByBarcodeUid",
      "queryEmailPending",
      "scanEmailWatchdog",
      "anonymiseUserTickets",
      "enumerateAllTicketIdsForUser",
    ]);
  });

  it("routeTemplates fully wired in Phase 3a", () => {
    expectWired(ddb.routeTemplates as unknown as Record<string, unknown>, [
      "list",
      "get",
      "create",
      "patch",
      "delete",
      "deleteAllForUser",
    ]);
  });

  it("mandates state-machine methods are wired (Phase 3b)", () => {
    expectWired(ddb.mandates as unknown as Record<string, unknown>, [
      "get",
      "getByMandateId",
      "issue",
      "stampPain008Built",
      "markSubmitted",
      "markDebited",
      "markReversed",
      "markDisputed",
      "markExpired",
      "markCancelled",
      "listPendingBatches",
      "listByBatchId",
      "listExpiringISSUED",
      "anonymiseUserMandates",
    ]);
  });

  it("sepaReports / delays / admins / ticketOwners wired in Phase 3a", () => {
    expectWired(ddb.sepaReports as unknown as Record<string, unknown>, ["put", "getByReportId"]);
    expectWired(ddb.delays as unknown as Record<string, unknown>, [
      "segmentsForTrain",
      "departuresFromStation",
    ]);
    expectWired(ddb.admins as unknown as Record<string, unknown>, [
      "getByEmail",
      "getByEmailForAuth",
    ]);
    expectWired(ddb.ticketOwners as unknown as Record<string, unknown>, ["get", "put", "delete"]);
  });

  it("blobs are wired through the adapter's S3 path (Phase 3c)", () => {
    // As of Phase 3c the DdbBackend's BlobRepo owns the full S3 path
    // (metadata via DDB + bytes/presign/delete-cascade via S3BlobConnector),
    // replacing the backend-local S3BlobRepo(Stub). Existence-check the
    // surface; real S3 behaviour is covered by @railback/db/tests/s3.test.ts.
    expectWired(ddb.blobs as unknown as Record<string, unknown>, [
      "getRawUpload",
      "putRawUpload",
      "getRenderedPdf",
      "putRenderedPdf",
      "listReceipts",
      "putReceipt",
      "deleteReceipt",
      "getBytes",
      "putBytes",
      "presignRawUploadPost",
      "presignReceiptPost",
      "deleteBytes",
      "deleteRawUpload",
      "deleteRenderedPdf",
      "deleteAllReceipts",
    ]);
  });
});
