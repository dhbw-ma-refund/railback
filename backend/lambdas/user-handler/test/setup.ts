// Test bootstrap: register the in-memory backend, set the env vars
// (JWT secret, IBAN-KEK) all routes need, return a fresh Db instance
// per test. Mirrors lambdas/auth-handler/test/setup.ts.

import { Buffer } from "node:buffer";

import { db } from "@railback/lib/storage";
import { resetDbCache } from "@railback/lib/storage";
import { registerBackend } from "@railback/lib/storage/registry";
import { resetKekCache } from "@railback/lib/crypto/kek";
import { buildMemoryDb } from "@railback/mocks-in-memory";
import { _setSesClient } from "@railback/refund-pdf/send-email";
import { vi } from "vitest";

registerBackend("memory", buildMemoryDb);

export const TEST_JWT_SECRET = "test-secret-please-change";
export const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString("base64");

// Default SES stub for user-handler tests: refund-pdf now ships in the
// workspace and is sync-invoked by post-refund. Without a default mock,
// every /refund test would either hit the real SES SDK (env unset →
// crash) or report email_status=FAILED_TRANSIENT. Tests that care about
// the email state path explicitly install their own mock; the default
// here just returns a stable MessageId so the happy-path assertions
// (email_status=SENT, attempts=1) hold.
function installDefaultSesMock(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _setSesClient({
    async send() {
      return { MessageId: "test-ses-default-message-id" };
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
