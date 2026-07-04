// Cross-Lambda integration test bootstrap. Registers the in-memory backend
// (side-effect import of @railback/mocks-in-memory), stubs every env var
// any lambda under test reads (JWT + IBAN-KEK from user-handler/setup.ts,
// SES from refund-pdf, the four SEPA vars from pain008-generator), and
// installs a default SES mock so /refund flow specs don't crash on the
// real SDK. Mirrors lambdas/user-handler/test/setup.ts and
// lambdas/pain008-generator/test/setup.ts combined.

import "@railback/mocks-in-memory";

import { Buffer } from "node:buffer";

import { db, resetDbCache } from "@railback/lib/storage";
import { resetKekCache } from "@railback/lib/crypto/kek";
import { _setSesClient } from "@railback/refund-pdf/send-email";
import { vi } from "vitest";

export const TEST_JWT_SECRET = "test-secret-please-change";
export const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString("base64");

// SEPA env values — same as lambdas/pain008-generator/test/setup.ts so
// pain008 build paths validate without extra plumbing.
export const TEST_KONTOINHABER = "RailBack UG (haftungsbeschränkt)";
export const TEST_IBAN_OWN = "DE89370400440532013000";
export const TEST_BIC_OWN = "COBADEFFXXX";
export const TEST_GLAEUBIGER_ID = "DE98ZZZ09999999999";

function installDefaultSesMock(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _setSesClient({
    async send() {
      return { MessageId: "test-integration" };
    },
  } as any);
}

export function installTestEnv(): ReturnType<typeof db> {
  vi.stubEnv("RAILBACK_STORAGE", "memory");
  vi.stubEnv("RAILBACK_JWT_SECRET", TEST_JWT_SECRET);
  vi.stubEnv("RAILBACK_JWT_ACCESS_TTL_SEC", "900");
  vi.stubEnv("RAILBACK_JWT_REFRESH_TTL_SEC", "2592000");
  vi.stubEnv("RAILBACK_IBAN_KEK", TEST_KEK_B64);
  vi.stubEnv("RAILBACK_SES_FROM_ADDRESS", "noreply@railback.test");
  vi.stubEnv("RAILBACK_AWS_REGION", "eu-central-1");
  vi.stubEnv("RAILBACK_S3_BUCKET", "railback-test");
  vi.stubEnv("RAILBACK_SEPA_KONTOINHABER", TEST_KONTOINHABER);
  vi.stubEnv("RAILBACK_SEPA_IBAN_OWN", TEST_IBAN_OWN);
  vi.stubEnv("RAILBACK_SEPA_BIC_OWN", TEST_BIC_OWN);
  vi.stubEnv("RAILBACK_SEPA_GLAEUBIGER_ID", TEST_GLAEUBIGER_ID);
  resetKekCache();
  resetDbCache();
  installDefaultSesMock();
  return db();
}

export function teardownTestEnv(): void {
  vi.unstubAllEnvs();
  resetKekCache();
  resetDbCache();
  _setSesClient(null);
}
