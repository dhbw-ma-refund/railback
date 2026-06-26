// Test bootstrap for email-sweeper. Mirrors refund-pdf/test/setup.ts:
// registers the in-memory backend, stubs the env vars sweeper + lib need,
// resets caches between tests.

import { Buffer } from "node:buffer";

import { db, resetDbCache } from "@railback/lib/storage";
import { registerBackend } from "@railback/lib/storage/registry";
import { resetKekCache } from "@railback/lib/crypto/kek";
import { buildMemoryDb } from "@railback/mocks-in-memory";
import { vi } from "vitest";

registerBackend("memory", buildMemoryDb);

export const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString("base64");
export const TEST_SES_FROM = "noreply@railback.test";

export function installTestEnv(): ReturnType<typeof db> {
  vi.stubEnv("RAILBACK_STORAGE", "memory");
  vi.stubEnv("RAILBACK_IBAN_KEK", TEST_KEK_B64);
  vi.stubEnv("RAILBACK_SES_FROM_ADDRESS", TEST_SES_FROM);
  vi.stubEnv("RAILBACK_AWS_REGION", "eu-central-1");
  resetKekCache();
  resetDbCache();
  return db();
}

export function teardownTestEnv(): void {
  vi.unstubAllEnvs();
  resetKekCache();
  resetDbCache();
}
