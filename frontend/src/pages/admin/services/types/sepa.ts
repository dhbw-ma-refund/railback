/**
 * SEPA-related types mirrored from the backend's SEPA routes:
 *   - `GET /admin/sepa/pending-batches`
 *   - `POST /admin/sepa/batches/{batchId}/mark-submitted`
 *   - `POST /admin/sepa/reports/upload`
 *   - `POST /admin/tickets/{ticketId}/pain008-rebuild`
 *
 * Money fields stay as string decimals — never round-tripped through JS
 * number arithmetic.
 */

/**
 * One row in `GET /admin/sepa/pending-batches`. `downloadUrl` is a presigned
 * S3 GET valid for `downloadUrlExpiresIn` seconds; refetch the list before
 * clicking if it might have expired.
 */
export interface SepaPendingBatch {
  batchId: string;
  s3_key: string;
  downloadUrl: string;
  downloadUrlExpiresIn: number;
  mandate_count: number;
  total_eur: string;
  built_at: string;
}

export interface SepaPendingBatchesResponse {
  items: SepaPendingBatch[];
}

/**
 * Response to `POST /admin/sepa/batches/{batchId}/mark-submitted`. Idempotent:
 * a repeat call returns the original `submitted_at` and `mandates_marked: 0`.
 */
export interface SepaBatchMarkSubmittedResponse {
  batchId: string;
  submitted_at: string;
  mandates_marked: number;
}

/**
 * Request body for `POST /admin/sepa/reports/upload`. The backend validates
 * `filename`, restricts `content_type` to XML MIME, and caps `size_bytes`
 * at 5 MB (5 242 880 bytes).
 */
export interface SepaReportUploadRequest {
  filename: string;
  content_type: 'application/xml' | 'text/xml';
  size_bytes: number;
}

/**
 * Presigned-POST envelope returned by `POST /admin/sepa/reports/upload`.
 * The frontend then POSTs `multipart/form-data` to `url` with every entry
 * from `fields` plus a `file` field last; S3 rejects field ordering that
 * puts `file` before the policy fields.
 */
export interface SepaReportUploadResponse {
  url: string;
  fields: Record<string, string>;
  expires_in: number;
}

/**
 * Response to `POST /admin/tickets/{ticketId}/pain008-rebuild`. Guarded by
 * `ticket_state === 'APPROVED'` and `pain008_built_at === null` on the
 * backend; violating either yields `409 ERR_CONFLICT`.
 */
export interface Pain008RebuildResponse {
  ticketId: string;
  mandate_id: string;
  pain008_batch_id: string;
  pain008_built_at: string;
  pain008_s3_key: string;
}

/** Hard-coded to match the backend `sepaReportUploadRequestSchema`. */
export const SEPA_REPORT_MAX_BYTES = 5 * 1024 * 1024;
