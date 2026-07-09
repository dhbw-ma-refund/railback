// Importing @railback/lib/storage/ddb must register the "ddb" backend such
// that db() resolves without explicit wiring — parallel to
// mocks/in-memory/src/index.ts for the "memory" backend.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db, resetDbCache } from "../../../src/storage/index.js";
import { clearRegistry, getRegisteredFactory } from "../../../src/storage/registry.js";

const ORIGINAL_ENV = process.env.RAILBACK_STORAGE;

describe("@railback/lib/storage/ddb registration", () => {
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

  it("the package side-effect wires the ddb backend (no explicit register)", async () => {
    // simulate fresh import by clearing the registry, then dynamically importing
    clearRegistry();
    await import("../../../src/storage/ddb/index.js");
    expect(getRegisteredFactory("ddb")).not.toBeNull();
    process.env.RAILBACK_STORAGE = "ddb";
    const got = db();
    // Presence of a well-known repo method proves the factory returned a
    // real Db (a NotImplemented method still exists on the surface).
    expect(typeof got.users.create).toBe("function");
    expect(typeof got.tickets.create).toBe("function");
  });
});
