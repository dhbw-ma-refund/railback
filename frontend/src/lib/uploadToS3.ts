/**
 * Upload a file to S3 using a presigned POST envelope returned by the
 * backend (POST /users/me/tickets/{id}/upload or …/belege).
 *
 * The presigned POST fields have to be attached in a very specific way:
 * every entry in `envelope.fields` becomes a FormData field, and the file
 * itself is added LAST under the field name `file`. Order matters —
 * `key`, `Content-Type`, `X-Amz-*`, and `Policy` must all precede the
 * bytes, otherwise S3 rejects the request.
 *
 * No Authorization header — S3 uses the signed policy to authenticate.
 * A 204 No Content indicates success. Anything else is treated as a
 * failure; the caller can inspect status / body for diagnostics.
 */
import type { PresignEnvelope } from './api';

export interface S3UploadResult {
  ok: boolean;
  status: number;
  body?: string;
}

export async function uploadToS3(
  envelope: PresignEnvelope,
  file: File,
  signal?: AbortSignal,
): Promise<S3UploadResult> {
  const form = new FormData();
  // Insertion order is preserved — append all presigned fields before the file.
  for (const [key, value] of Object.entries(envelope.fields)) {
    form.append(key, value);
  }
  form.append('file', file);

  const res = await fetch(envelope.uploadUrl, {
    method: 'POST',
    body: form,
    signal,
  });

  if (res.ok) return { ok: true, status: res.status };

  // S3 returns XML on failure; keep it as a string for surface-level debugging.
  const body = await res.text().catch(() => undefined);
  return { ok: false, status: res.status, body };
}
