import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/storage/types.js";
import { db, registerBackend, resetDbForTests } from "../../src/storage/types.js";

const ORIGINAL_ENV = process.env.RAILBACK_STORAGE;

function stubDb(): Db {
  const todo = (): never => {
    throw new Error("not impl");
  };
  return {
    users: { getByEmail: todo, create: todo, updateProfile: todo, list: todo, scheduleDeletion: todo } as never,
    tickets: {
      get: todo, listForUser: todo, create: todo, createFromRoute: todo,
      patch: todo, delete: todo, adminList: todo, findByBarcodeUid: todo,
    } as never,
    routeTemplates: { list: todo, get: todo, create: todo, patch: todo, delete: todo } as never,
    blobs: {
      getRawUpload: todo, putRawUpload: todo, getRenderedPdf: todo, putRenderedPdf: todo,
      listReceipts: todo, putReceipt: todo, presignRawUploadPost: todo, presignReceiptPost: todo,
    } as never,
    mandates: {
      get: todo, issue: todo, stampPain008Built: todo, markSubmitted: todo,
      markDebited: todo, markReversed: todo, markDisputed: todo, markExpired: todo,
      markCancelled: todo, listPendingBatches: todo, listByBatchId: todo, listExpiringISSUED: todo,
    } as never,
    sepaReports: { put: todo, getByReportId: todo } as never,
    delays: { segmentsForTrain: todo, departuresFromStation: todo } as never,
    admins: { getByEmail: todo } as never,
    ticketOwners: { get: todo, put: todo, delete: todo } as never,
  };
}

describe("storage backend registry", () => {
  beforeEach(() => resetDbForTests());
  afterEach(() => {
    resetDbForTests();
    if (ORIGINAL_ENV === undefined) delete process.env.RAILBACK_STORAGE;
    else process.env.RAILBACK_STORAGE = ORIGINAL_ENV;
  });

  it("dispatches on RAILBACK_STORAGE env var", () => {
    const sentinel = stubDb();
    registerBackend("test-memory", () => sentinel);
    process.env.RAILBACK_STORAGE = "test-memory";
    expect(db()).toBe(sentinel);
  });

  it("caches the resolved backend per name", () => {
    let count = 0;
    registerBackend("test-cached", () => {
      count++;
      return stubDb();
    });
    process.env.RAILBACK_STORAGE = "test-cached";
    db();
    db();
    expect(count).toBe(1);
  });

  it("unknown backend throws", () => {
    process.env.RAILBACK_STORAGE = "no-such-backend-name";
    expect(() => db()).toThrow(/no registered backend/);
  });
});
