import { apiClient } from './client';
import { isRecord, readArray, readNumber, readString, warnMissingField } from './parse';
import type {
  Pain008RebuildResponse,
  SepaBatchMarkSubmittedResponse,
  SepaPendingBatch,
  SepaPendingBatchesResponse,
  SepaReportUploadRequest,
  SepaReportUploadResponse,
} from '../types/sepa';

const PENDING_BATCH_REQUIRED_FIELDS: readonly string[] = [
  'batchId',
  's3_key',
  'downloadUrl',
  'downloadUrlExpiresIn',
  'mandate_count',
  'total_eur',
  'built_at',
];

function parsePendingBatch(raw: unknown): SepaPendingBatch | null {
  if (!isRecord(raw)) return null;
  for (const field of PENDING_BATCH_REQUIRED_FIELDS) {
    warnMissingField('GET /admin/sepa/pending-batches item', field, raw);
  }
  const batchId = readString(raw, 'batchId');
  if (!batchId) return null;
  return {
    batchId,
    s3_key: readString(raw, 's3_key') ?? '',
    downloadUrl: readString(raw, 'downloadUrl') ?? '',
    downloadUrlExpiresIn: readNumber(raw, 'downloadUrlExpiresIn'),
    mandate_count: readNumber(raw, 'mandate_count'),
    total_eur: readString(raw, 'total_eur') ?? '0',
    built_at: readString(raw, 'built_at') ?? '',
  };
}

function parsePendingBatchesResponse(raw: unknown): SepaPendingBatchesResponse {
  if (!isRecord(raw)) return { items: [] };
  const items = readArray(raw, 'items')
    .map(parsePendingBatch)
    .filter((b): b is SepaPendingBatch => b !== null);
  return { items };
}

const MARK_SUBMITTED_REQUIRED_FIELDS: readonly string[] = [
  'batchId',
  'submitted_at',
  'mandates_marked',
];

function parseMarkSubmitted(raw: unknown): SepaBatchMarkSubmittedResponse {
  if (!isRecord(raw)) throw new Error('Malformed mark-submitted payload');
  for (const field of MARK_SUBMITTED_REQUIRED_FIELDS) {
    warnMissingField('POST /admin/sepa/batches/{batchId}/mark-submitted', field, raw);
  }
  return {
    batchId: readString(raw, 'batchId') ?? '',
    submitted_at: readString(raw, 'submitted_at') ?? '',
    mandates_marked: readNumber(raw, 'mandates_marked'),
  };
}

const UPLOAD_REQUIRED_FIELDS: readonly string[] = ['url', 'fields', 'expires_in'];

function parseUploadResponse(raw: unknown): SepaReportUploadResponse {
  if (!isRecord(raw)) throw new Error('Malformed upload payload');
  for (const field of UPLOAD_REQUIRED_FIELDS) {
    warnMissingField('POST /admin/sepa/reports/upload', field, raw);
  }
  const fields: Record<string, string> = {};
  const rawFields = raw.fields;
  if (isRecord(rawFields)) {
    for (const [k, v] of Object.entries(rawFields)) {
      if (typeof v === 'string') fields[k] = v;
    }
  }
  return {
    url: readString(raw, 'url') ?? '',
    fields,
    expires_in: readNumber(raw, 'expires_in'),
  };
}

const PAIN008_REBUILD_REQUIRED_FIELDS: readonly string[] = [
  'ticketId',
  'mandate_id',
  'pain008_batch_id',
  'pain008_built_at',
  'pain008_s3_key',
];

function parsePain008Rebuild(raw: unknown): Pain008RebuildResponse {
  if (!isRecord(raw)) throw new Error('Malformed pain008-rebuild payload');
  for (const field of PAIN008_REBUILD_REQUIRED_FIELDS) {
    warnMissingField('POST /admin/tickets/{ticketId}/pain008-rebuild', field, raw);
  }
  return {
    ticketId: readString(raw, 'ticketId') ?? '',
    mandate_id: readString(raw, 'mandate_id') ?? '',
    pain008_batch_id: readString(raw, 'pain008_batch_id') ?? '',
    pain008_built_at: readString(raw, 'pain008_built_at') ?? '',
    pain008_s3_key: readString(raw, 'pain008_s3_key') ?? '',
  };
}

/**
 * SEPA operator surface. Every endpoint on this module is admin-only and
 * mounted under `/admin/sepa` or `/admin/tickets/{id}/pain008-rebuild`.
 *
 * Naming note: the backend mounts the mark-submitted route as
 * `/admin/sepa/batches/{batchId}/mark-submitted` — NOT under
 * `/pending-batches/`. Older contract copies say otherwise; the live route
 * is the source of truth.
 */
export const sepaApi = {
  async listPendingBatches(signal?: AbortSignal): Promise<SepaPendingBatchesResponse> {
    const raw = await apiClient.get<unknown>('/admin/sepa/pending-batches', { signal });
    return parsePendingBatchesResponse(raw);
  },

  async markBatchSubmitted(
    batchId: string,
    signal?: AbortSignal,
  ): Promise<SepaBatchMarkSubmittedResponse> {
    const raw = await apiClient.post<unknown>(
      `/admin/sepa/batches/${encodeURIComponent(batchId)}/mark-submitted`,
      {},
      { signal },
    );
    return parseMarkSubmitted(raw);
  },

  async requestReportUpload(
    body: SepaReportUploadRequest,
    signal?: AbortSignal,
  ): Promise<SepaReportUploadResponse> {
    const raw = await apiClient.post<unknown>('/admin/sepa/reports/upload', body, { signal });
    return parseUploadResponse(raw);
  },

  /**
   * Two-step: request a presigned envelope, then POST the file to S3 as
   * `multipart/form-data` with every backend-supplied field first and the
   * `file` field last. S3 rejects the wrong field order.
   *
   * Returns the S3 response so callers can distinguish 204 (success) from
   * a policy failure surfaced as 4xx.
   */
  async uploadReportToS3(
    envelope: SepaReportUploadResponse,
    file: Blob | File,
    signal?: AbortSignal,
  ): Promise<Response> {
    const form = new FormData();
    for (const [k, v] of Object.entries(envelope.fields)) form.append(k, v);
    form.append('file', file);
    return fetch(envelope.url, { method: 'POST', body: form, signal });
  },

  async rebuildPain008(ticketId: string, signal?: AbortSignal): Promise<Pain008RebuildResponse> {
    const raw = await apiClient.post<unknown>(
      `/admin/tickets/${encodeURIComponent(ticketId)}/pain008-rebuild`,
      {},
      { signal },
    );
    return parsePain008Rebuild(raw);
  },
};
