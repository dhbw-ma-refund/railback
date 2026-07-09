// Test bootstrap for anonymisation-sweeper. Mirrors email-sweeper/test/setup.ts
// minus the SES envs (sweeper does no email).

import { Buffer } from "node:buffer";

import { db, resetDbCache } from "@railback/lib/storage";
import { registerBackend } from "@railback/lib/storage/registry";
import { resetKekCache } from "@railback/lib/crypto/kek";
import { buildMemoryDb } from "@railback/mocks-in-memory";
import { vi } from "vitest";

registerBackend("memory", buildMemoryDb);

export const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString("base64");

export function installTestEnv(): ReturnType<typeof db> {
  vi.stubEnv("RAILBACK_STORAGE", "memory");
  vi.stubEnv("RAILBACK_IBAN_KEK", TEST_KEK_B64);
  vi.stubEnv("RAILBACK_AWS_REGION", "eu-central-1");
  // The existing cascade/handler tests assert the destructive path (rows
  // anonymised + deleted), so arm the sweeper by default. Dry-run behaviour
  // is covered explicitly in cascade.spec.ts by overriding this.
  vi.stubEnv("RAILBACK_ANONYMISATION_DRY_RUN", "false");
  resetKekCache();
  resetDbCache();
  return db();
}

export function teardownTestEnv(): void {
  vi.unstubAllEnvs();
  resetKekCache();
  resetDbCache();
}
