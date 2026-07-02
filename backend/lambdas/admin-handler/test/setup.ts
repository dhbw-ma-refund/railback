// Test bootstrap: register the in-memory backend, set env vars
// (JWT secret, IBAN-KEK, S3 bucket + region) the routes need, reset
// the stats cache, return a fresh Db instance per test.

import { Buffer } from "node:buffer";

import { db } from "@railback/lib/storage";
import { resetDbCache } from "@railback/lib/storage";
import { registerBackend } from "@railback/lib/storage/registry";
import { resetKekCache } from "@railback/lib/crypto/kek";
import { resetS3ClientCache } from "@railback/lib/storage/s3/presigned-post";
import { resetS3ClientCacheForGet } from "@railback/lib/storage/s3/presigned-get";
import { buildMemoryDb } from "@railback/mocks-in-memory";
import { vi } from "vitest";

import { resetStatsCache } from "../src/stats-cache.js";

registerBackend("memory", buildMemoryDb);

export const TEST_JWT_SECRET = "test-secret-please-change";
export const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString("base64");

export function installTestEnv(): ReturnType<typeof db> {
  vi.stubEnv("RAILBACK_STORAGE", "memory");
  vi.stubEnv("RAILBACK_JWT_SECRET", TEST_JWT_SECRET);
  vi.stubEnv("RAILBACK_JWT_ACCESS_TTL_SEC", "900");
  vi.stubEnv("RAILBACK_JWT_REFRESH_TTL_SEC", "2592000");
  vi.stubEnv("RAILBACK_IBAN_KEK", TEST_KEK_B64);
  vi.stubEnv("RAILBACK_S3_BUCKET", "railback-storage-test");
  vi.stubEnv("RAILBACK_AWS_REGION", "eu-central-1");
  // Fake credentials so the AWS SDK signer doesn't try to hit the
  // EC2 metadata endpoint or shared-credentials file during presign.
  // The signing math is local — these don't need to be real to produce
  // a deterministic, syntactically-valid presigned URL.
  vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
  vi.stubEnv("AWS_REGION", "eu-central-1");
  resetKekCache();
  resetDbCache();
  resetStatsCache();
  resetS3ClientCache();
  resetS3ClientCacheForGet();
  return db();
}

export function teardownTestEnv(): void {
  vi.unstubAllEnvs();
  resetKekCache();
  resetDbCache();
  resetStatsCache();
  resetS3ClientCache();
  resetS3ClientCacheForGet();
}
