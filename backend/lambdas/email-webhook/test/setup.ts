// Test bootstrap for email-webhook. Mirrors refund-pdf's setup, minus the
// SES + KEK env vars — the webhook never sends mail and never decrypts.

import { resetDbCache } from "@railback/lib/storage";
import { registerBackend } from "@railback/lib/storage/registry";
import { buildMemoryDb } from "@railback/mocks-in-memory";
import { vi } from "vitest";

registerBackend("memory", buildMemoryDb);

export function installTestEnv(): void {
  vi.stubEnv("RAILBACK_STORAGE", "memory");
  vi.stubEnv("RAILBACK_AWS_REGION", "eu-central-1");
  resetDbCache();
}

export function teardownTestEnv(): void {
  vi.unstubAllEnvs();
  resetDbCache();
}
