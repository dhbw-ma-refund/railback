// Test bootstrap: register the in-memory backend, configure required
// env vars (JWT secret, IBAN-KEK) before each test file imports the
// handler. Returns a fresh Db instance per test.

import { Buffer } from "node:buffer";

import { db } from "@railback/lib/storage";
import { resetDbCache } from "@railback/lib/storage";
import { registerBackend } from "@railback/lib/storage/registry";
import { resetKekCache } from "@railback/lib/crypto/kek";
import { buildMemoryDb } from "@railback/mocks-in-memory";
import { vi } from "vitest";

// Re-register memory backend (safe to call multiple times — the registry
// is a Map keyed by backend name).
registerBackend("memory", buildMemoryDb);

export const TEST_JWT_SECRET = "test-secret-please-change";
export const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString("base64");

/**
 * Install the env vars + reset cached state. Call inside beforeEach so
 * each test gets a fresh KEK + DB. Returns the active Db so the caller
 * can seed users/admins/etc.
 */
export function installTestEnv(): ReturnType<typeof db> {
  vi.stubEnv("RAILBACK_STORAGE", "memory");
  vi.stubEnv("RAILBACK_JWT_SECRET", TEST_JWT_SECRET);
  vi.stubEnv("RAILBACK_JWT_ACCESS_TTL_SEC", "900");
  vi.stubEnv("RAILBACK_JWT_REFRESH_TTL_SEC", "2592000");
  vi.stubEnv("RAILBACK_IBAN_KEK", TEST_KEK_B64);
  resetKekCache();
  resetDbCache();
  return db();
}

export function teardownTestEnv(): void {
  vi.unstubAllEnvs();
  resetKekCache();
  resetDbCache();
}
