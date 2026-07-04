// Shared in-memory state. One MemState per buildMemoryDb() call so tests can
// hold multiple isolated DBs in parallel. PK -> SK -> raw item map mirrors
// how DDB itself layers the keys.

export interface MemBlob {
  bytes: Uint8Array;
  contentType: string;
  size: number;
  uploadedAt: string;
}

/**
 * Presigned-POST content-length-range policy. Registered by
 * presignRawUploadPost / presignReceiptPost at issue-time and enforced by
 * putBytes on upload. Mirrors S3's server-side enforcement of the
 * `content-length-range` policy condition (see @railback/lib/storage/s3
 * presigned-post.ts) — the production S3 rejects out-of-range uploads with
 * 400 before the bytes ever land; the mock has to do it in-process.
 * Keyed by S3 key. Absent for server-side direct writes (rendered PDFs,
 * pain.008 XML) which don't go through the presign flow.
 */
export interface PresignPolicy {
  min: number;
  max: number;
}

export interface MemState {
  rows: Map<string, Map<string, unknown>>;
  blobs: Map<string, Map<string, MemBlob>>;
  presignPolicies: Map<string, PresignPolicy>;
}

export function makeState(): MemState {
  return {
    rows: new Map(),
    blobs: new Map(),
    presignPolicies: new Map(),
  };
}

export function clearState(s: MemState): void {
  s.rows.clear();
  s.blobs.clear();
  s.presignPolicies.clear();
}

export function putRow(s: MemState, pk: string, sk: string, item: unknown): void {
  let bucket = s.rows.get(pk);
  if (!bucket) {
    bucket = new Map();
    s.rows.set(pk, bucket);
  }
  bucket.set(sk, item);
}

export function getRow<T = unknown>(s: MemState, pk: string, sk: string): T | null {
  const bucket = s.rows.get(pk);
  if (!bucket) return null;
  const v = bucket.get(sk);
  return (v ?? null) as T | null;
}

export function deleteRow(s: MemState, pk: string, sk: string): boolean {
  const bucket = s.rows.get(pk);
  if (!bucket) return false;
  const had = bucket.delete(sk);
  if (bucket.size === 0) s.rows.delete(pk);
  return had;
}

export function listSk<T = unknown>(s: MemState, pk: string, skPrefix?: string): T[] {
  const bucket = s.rows.get(pk);
  if (!bucket) return [];
  const out: T[] = [];
  for (const [sk, item] of bucket) {
    if (skPrefix !== undefined && !sk.startsWith(skPrefix)) continue;
    out.push(item as T);
  }
  return out;
}

/** Cursor-friendly pagination — base64(last_sk). Caller filters/sorts first. */
export function paginate<T>(items: T[], limit: number, getCursorKey: (item: T) => string, cursor?: string): { items: T[]; nextCursor?: string } {
  const cap = Math.max(1, Math.min(limit, 100));
  let startIdx = 0;
  if (cursor) {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const idx = items.findIndex((it) => getCursorKey(it) === decoded);
    if (idx >= 0) startIdx = idx + 1;
  }
  const slice = items.slice(startIdx, startIdx + cap);
  const consumed = startIdx + slice.length;
  const last = slice[slice.length - 1];
  const result: { items: T[]; nextCursor?: string } = { items: slice };
  if (last !== undefined && consumed < items.length) {
    result.nextCursor = Buffer.from(getCursorKey(last), "utf8").toString("base64");
  }
  return result;
}
