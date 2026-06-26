// Persist the rendered EU-form PDF: bytes → S3 (via BlobRepo.putBytes), then
// metadata row → DDB (via BlobRepo.putRenderedPdf). Keep these two writes in
// this order so a half-failure leaves the system with orphaned S3 bytes
// rather than a metadata row pointing at nothing — the orphaned bytes get
// cleaned up by the bucket lifecycle rule on `rendered/`.
//
// The s3_key convention `rendered/<emailHash>/<ticketId>.pdf` is locked
// (CLAUDE.md §"Locked product decisions" / §"Tech stack"). emailHash gives
// us a stable, non-reversible per-user prefix so a single bucket policy can
// pin object access; ticketId disambiguates within the user's namespace.
//
// s3_bucket: in real Lambda the value comes from RAILBACK_S3_BUCKET; in the
// in-memory mock the BlobRepo writes into its own BUCKET constant
// ("memory-mock") and we mirror that here so the metadata row matches what
// getBytes(s3_key) will look up. Keeping the env-fallback inline (rather
// than as a BlobRepo getter) keeps the repo interface free of deployment
// shape concerns.

import { db, emailHash, log } from "@railback/lib";

const MEMORY_BUCKET = "memory-mock";
const CONTENT_TYPE = "application/pdf";

function resolveBucket(): string {
  // RAILBACK_S3_BUCKET is required in production (real S3BlobRepo throws
  // otherwise). In dev/test with RAILBACK_STORAGE=memory the env is unset
  // and the in-memory BlobRepo writes into its own BUCKET — mirror it.
  return process.env.RAILBACK_S3_BUCKET ?? MEMORY_BUCKET;
}

export async function persistRenderedPdf(input: {
  email: string;
  ticketId: string;
  bytes: Uint8Array;
}): Promise<{
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  rendered_at: string;
}> {
  const { email, ticketId, bytes } = input;
  const s3_key = `rendered/${emailHash(email)}/${ticketId}.pdf`;
  const s3_bucket = resolveBucket();
  const rendered_at = new Date().toISOString();
  const size_bytes = bytes.byteLength;

  const repo = db().blobs;

  // 1) Bytes first — if this fails we never leave a metadata row pointing
  //    at a missing object. The caller (renderAndSend) re-throws and the
  //    ticket stays in its pre-submit state.
  await repo.putBytes(s3_key, bytes, CONTENT_TYPE, rendered_at);

  // 2) Metadata row. If this fails the S3 object is orphaned and gets
  //    swept by the `rendered/` lifecycle rule (6 months, see CLAUDE.md
  //    §"Open / S3 bucket layout").
  await repo.putRenderedPdf(email, ticketId, {
    s3_bucket,
    s3_key,
    size_bytes,
    rendered_at,
  });

  log.info("rendered-pdf.persisted", { ticketId, s3_key, size_bytes });

  return { s3_bucket, s3_key, size_bytes, rendered_at };
}
