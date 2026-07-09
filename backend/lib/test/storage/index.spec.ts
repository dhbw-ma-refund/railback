// Tests for the storage entry-point (db() / resetDbCache + the strict registry).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/index.js";
import { db, resetDbCache } from "../../src/storage/index.js";
import {
  clearRegistry,
  getRegisteredFactory,
  registerBackend,
} from "../../src/storage/registry.js";
import type { Db } from "../../src/storage/types.js";

const ORIGINAL_ENV = process.env.RAILBACK_STORAGE;

function stubDb(): Db {
  const todo = (): never => {
    throw new Error("not impl");
  };
  return {
    users: { getByEmail: todo, create: todo, updateProfile: todo, listAdminView: todo, scheduleDeletion: todo } as never,
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
      markCancelled: todo, listPendingBatches: todo, listExpiringISSUED: todo,
    } as never,
    sepaReports: { put: todo, getByReportId: todo } as never,
    delays: { segmentsForTrain: todo, departuresFromStation: todo } as never,
    admins: { getByEmail: todo } as never,
    ticketOwners: { get: todo, put: todo, delete: todo } as never,
  };
}

describe("storage/index db()", () => {
  beforeEach(() => {
    clearRegistry();
    resetDbCache();
  });
  afterEach(() => {
    clearRegistry();
    resetDbCache();
    if (ORIGINAL_ENV === undefined) delete process.env.RAILBACK_STORAGE;
    else process.env.RAILBACK_STORAGE = ORIGINAL_ENV;
  });

  it("returns the registered factory output for memory", () => {
    const sentinel = stubDb();
    registerBackend("memory", () => sentinel);
    process.env.RAILBACK_STORAGE = "memory";
    expect(db()).toBe(sentinel);
  });

  it("getRegisteredFactory returns null when nothing is registered", () => {
    expect(getRegisteredFactory("ddb")).toBeNull();
  });

  it("getRegisteredFactory returns the factory after registration", () => {
    const sentinel = stubDb();
    const factory = (): Db => sentinel;
    registerBackend("ddb", factory);
    expect(getRegisteredFactory("ddb")).toBe(factory);
  });

  it("missing factory throws ERR_INTERNAL with Phase 5 hint", () => {
    process.env.RAILBACK_STORAGE = "ddb";
    let caught: unknown;
    try {
      db();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("ERR_INTERNAL");
    expect((caught as AppError).message).toMatch(/Phase 5/);
  });

  it("file backend without factory also throws Phase-5 error", () => {
    process.env.RAILBACK_STORAGE = "file";
    expect(() => db()).toThrow(/Phase 5/);
  });

  it("resetDbCache lets you swap factories under the same name", () => {
    const first = stubDb();
    const second = stubDb();
    registerBackend("memory", () => first);
    process.env.RAILBACK_STORAGE = "memory";
    expect(db()).toBe(first);

    // Re-register and reset cache — db() should pick the new factory up.
    registerBackend("memory", () => second);
    resetDbCache();
    expect(db()).toBe(second);
  });

  it("caches the resolved backend per name (factory called once)", () => {
    let count = 0;
    registerBackend("memory", () => {
      count++;
      return stubDb();
    });
    process.env.RAILBACK_STORAGE = "memory";
    db();
    db();
    db();
    expect(count).toBe(1);
  });

  it("clearRegistry wipes all registrations", () => {
    registerBackend("memory", () => stubDb());
    expect(getRegisteredFactory("memory")).not.toBeNull();
    clearRegistry();
    expect(getRegisteredFactory("memory")).toBeNull();
  });
});
