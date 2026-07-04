// Persist the pain.008 XML: bytes → S3 (via BlobRepo.putBytes).
//
// Key convention `pain008/<YYYY-MM>/<batchId>.xml` is locked
// (CLAUDE.md §"Open / S3 bucket layout" — pain008/ is the audit-XML
// prefix, lifecycle = 10y retention, no auto-delete). The YYYY-MM
// folder is derived from `builtAt` UTC so a month's worth of batches
// land in the same prefix — keeps `aws s3 ls pain008/2026-06/` useful
// for ops without needing a DDB GSI walk.
//
// Unlike refund-pdf's persist there is NO sibling metadata row here:
// the SepaMandate row carries `pain008_s3_key` directly (stamped by
// `handler.ts` after this returns). So a half-failure that lands bytes
// but never stamps the mandate is "harmless orphan in S3" — the lifecycle
// rule won't delete pain008 objects (10y), but the mandate-row retry will
// re-build with a fresh batchId and write a fresh object, leaving the
// orphan as audit-only noise.
//
// s3_bucket: in real Lambda the value comes from RAILBACK_S3_BUCKET; in
// the in-memory mock the BlobRepo writes into its own BUCKET constant
// ("memory-mock"). The s3_key itself doesn't carry the bucket so this
// module doesn't need the env fallback — that lives in handler.ts only
// if we ever want to log the bucket alongside the key.

import { db, log } from "@railback/lib";

const CONTENT_TYPE = "application/xml";

function yyyymm(builtAt: string): string {
  const d = new Date(builtAt);
  if (Number.isNaN(d.getTime())) {
    // Defensive: handler.ts always passes new Date().toISOString(), but
    // we don't want a bad input to silently produce "NaN-NaN/...". The
    // builtAt validation already happened inside buildPain008Xml — by
    // the time we get here the value is well-formed. Throw is loud
    // enough; caller's outer try/catch turns it into ERR_INTERNAL.
    throw new Error(`pain008-persist: invalid builtAt "${builtAt}"`);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function persistPain008Xml(input: {
  batchId: string;
  builtAt: string;
  bytes: Uint8Array;
}): Promise<{ s3_key: string; size_bytes: number }> {
  const { batchId, builtAt, bytes } = input;
  const s3_key = `pain008/${yyyymm(builtAt)}/${batchId}.xml`;
  const size_bytes = bytes.byteLength;

  await db().blobs.putBytes(s3_key, bytes, CONTENT_TYPE, builtAt);

  log.info("pain008-xml.persisted", { batchId, s3_key, size_bytes });

  return { s3_key, size_bytes };
}
