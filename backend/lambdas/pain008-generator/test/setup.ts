// Test bootstrap for pain008-generator. Same shape as refund-pdf/test/setup.ts:
// registers the in-memory backend, stubs the env vars the lambda + lib need
// (IBAN-KEK + the four SEPA env vars read by @railback/lib/sepa/pain008),
// resets caches between tests, returns a fresh Db.

import { Buffer } from "node:buffer";

import { db, resetDbCache } from "@railback/lib/storage";
import { registerBackend } from "@railback/lib/storage/registry";
import { resetKekCache } from "@railback/lib/crypto/kek";
import { buildMemoryDb } from "@railback/mocks-in-memory";
import { vi } from "vitest";

registerBackend("memory", buildMemoryDb);

export const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString("base64");
export const TEST_KONTOINHABER = "RailBack UG (haftungsbeschränkt)";
// Valid mod97 IBAN (Deutsche Bank Frankfurt test number).
export const TEST_IBAN_OWN = "DE89370400440532013000";
export const TEST_BIC_OWN = "COBADEFFXXX";
// Format: DE + 2 check + ZZZ + 11 chars per Bundesbank spec.
export const TEST_GLAEUBIGER_ID = "DE98ZZZ09999999999";

export function installTestEnv(): ReturnType<typeof db> {
  vi.stubEnv("RAILBACK_STORAGE", "memory");
  vi.stubEnv("RAILBACK_IBAN_KEK", TEST_KEK_B64);
  vi.stubEnv("RAILBACK_AWS_REGION", "eu-central-1");
  vi.stubEnv("RAILBACK_SEPA_KONTOINHABER", TEST_KONTOINHABER);
  vi.stubEnv("RAILBACK_SEPA_IBAN_OWN", TEST_IBAN_OWN);
  vi.stubEnv("RAILBACK_SEPA_BIC_OWN", TEST_BIC_OWN);
  vi.stubEnv("RAILBACK_SEPA_GLAEUBIGER_ID", TEST_GLAEUBIGER_ID);
  resetKekCache();
  resetDbCache();
  return db();
}

export function teardownTestEnv(): void {
  vi.unstubAllEnvs();
  resetKekCache();
  resetDbCache();
}
