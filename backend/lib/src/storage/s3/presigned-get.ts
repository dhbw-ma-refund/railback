// S3 presigned-GET URL helper. Companion to presigned-post.ts.
//
// Used by admin-handler's GET /admin/sepa/pending-batches: each entry needs
// a short-lived download URL so the admin can fetch the pain.008 XML out
// of S3 without going through Lambda. 5-minute TTL is the convention
// (matches the policy TTL on presigned POSTs).
//
// Like presigned-post.ts this module is allowed to import @aws-sdk/*
// directly. The lint exclusion in .eslintrc.cjs covers lib/src/storage/s3/**.

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { AppError } from "../../errors/index.js";

let _client: S3Client | null = null;

/** Lazy-init the S3 client. RAILBACK_AWS_REGION must be set. */
function getClient(): S3Client {
  if (_client) return _client;
  const region = process.env.RAILBACK_AWS_REGION;
  if (!region) {
    throw new AppError(
      "ERR_INTERNAL",
      "RAILBACK_AWS_REGION not set; cannot presign S3 GETs",
    );
  }
  _client = new S3Client({ region });
  return _client;
}

/** Reset cached client. Test-only. */
export function resetS3ClientCacheForGet(): void {
  _client = null;
}

export interface PresignGetInput {
  bucket: string;
  key: string;
  /** seconds, default 300 (5 min) */
  expiresInSec?: number;
}

export interface PresignGetResult {
  url: string;
  expiresIn: number;
}

/**
 * Issue a presigned GET URL for an existing S3 object. Returns the URL +
 * the TTL the caller can echo back to the frontend.
 */
export async function presignGet(
  input: PresignGetInput,
): Promise<PresignGetResult> {
  if (!input.bucket || !input.key) {
    throw new AppError(
      "ERR_VALIDATION",
      "bucket and key are required",
      undefined,
      { field: input.bucket ? "key" : "bucket" },
    );
  }
  const expiresIn = input.expiresInSec ?? 300;
  const url = await getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
    { expiresIn },
  );
  return { url, expiresIn };
}
