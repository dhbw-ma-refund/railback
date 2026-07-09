// S3 presigned-POST URL helper. Pattern: presigned POST (not PUT) because the
// upload policy can pin Content-Type AND content-length-range via policy
// conditions; PUT signatures cannot. Locked 2026-06-18. See CLAUDE.md
// "Tech stack > Cross-cutting > File uploads" and DECISIONS.md.
//
// Caller picks the prefix (raw / belege / sepa-reports / pain008), the
// max-bytes cap, and the allowed content-type. We never make policy choices
// here — those are domain decisions and belong in the lambda code that
// owns each upload site.
//
// This module IS allowed to import @aws-sdk/* directly. The
// `no-restricted-imports` rule in .eslintrc.cjs excludes
// `lib/src/storage/s3/**` for exactly this case.

import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { S3Client } from "@aws-sdk/client-s3";

import { AppError } from "../../errors/index.js";
import type { PresignedPost } from "../../types/dto.js";

let _client: S3Client | null = null;

/** Lazy-init the S3 client. RAILBACK_AWS_REGION must be set. */
function getClient(): S3Client {
  if (_client) return _client;
  const region = process.env.RAILBACK_AWS_REGION;
  if (!region) {
    throw new AppError(
      "ERR_INTERNAL",
      "RAILBACK_AWS_REGION not set; cannot presign S3 uploads"
    );
  }
  _client = new S3Client({ region });
  return _client;
}

/** Reset cached client. Test-only. */
export function resetS3ClientCache(): void {
  _client = null;
}

export interface PresignedPostInput {
  bucket: string;
  key: string;
  contentType: string;
  maxBytes: number;
  /** seconds, default 300 (5 min) */
  expiresInSec?: number;
}

/**
 * Issue a presigned-POST URL with a policy pinning Content-Type and
 * content-length-range. Returns the URL + form fields the browser must
 * include in its multipart POST.
 */
export async function presignPost(
  input: PresignedPostInput
): Promise<PresignedPost> {
  if (input.maxBytes <= 0) {
    throw new AppError(
      "ERR_VALIDATION",
      "maxBytes must be positive",
      undefined,
      { field: "maxBytes" }
    );
  }
  if (!input.bucket || !input.key) {
    throw new AppError(
      "ERR_VALIDATION",
      "bucket and key are required",
      undefined,
      { field: input.bucket ? "key" : "bucket" }
    );
  }
  if (!input.contentType) {
    throw new AppError(
      "ERR_VALIDATION",
      "contentType is required",
      undefined,
      { field: "contentType" }
    );
  }

  const expiresIn = input.expiresInSec ?? 300;
  const { url, fields } = await createPresignedPost(getClient(), {
    Bucket: input.bucket,
    Key: input.key,
    Conditions: [
      ["eq", "$Content-Type", input.contentType],
      ["content-length-range", 1, input.maxBytes],
    ],
    Fields: { "Content-Type": input.contentType },
    Expires: expiresIn,
  });

  return { url, fields, key: input.key, expiresIn };
}

// Convenience: standard caps per upload site (per CLAUDE.md locked 2026-06-18).
export const RAW_UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const BELEG_UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
