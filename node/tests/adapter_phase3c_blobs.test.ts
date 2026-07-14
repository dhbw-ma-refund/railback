import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { makeBackend } from "./helpers.js";

/**
 * Phase 3c — BlobRepoImpl S3 path, end-to-end against LocalStack + DDB Local.
 *
 * Covers the methods filled in Phase 3c:
 *   getBytes / putBytes            — generic S3 byte read/write
 *   presignRawUploadPost / …Receipt — presigned POST policy shape + key convention
 *   deleteBytes                    — idempotent S3 delete
 *   deleteRawUpload / …RenderedPdf / deleteAllReceipts — metadata+S3 cascade
 *
 * Gated behind RAILBACK_RUN_INTEGRATION=1 (needs the podman stack up). Skips
 * cleanly otherwise. Bring the stack up per tests/integration.test.ts.
 */

const DDB_URL = process.env["DYNAMODB_ENDPOINT_URL"] ?? "http://localhost:8000";
const S3_URL = process.env["S3_ENDPOINT_URL"] ?? "http://localhost:4566";
const BUCKET = process.env["RAILBACK_S3_BUCKET"] ?? "railback-test";
const REGION = process.env["RAILBACK_S3_REGION"] ?? "eu-north-1";

async function probe(url: string, timeoutMs = 500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(url, { signal: controller.signal }).catch(() => null);
    clearTimeout(t);
    return r !== null;
  } catch { return false; }
}

let reachable = false;

beforeAll(async () => {
  reachable = (await probe(DDB_URL)) && (await probe(S3_URL));
  if (!reachable) return;
  const s3 = new S3Client({
    region: REGION, endpoint: S3_URL, forcePathStyle: true,
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    try { await s3.send(new CreateBucketCommand({ Bucket: BUCKET })); }
    catch { /* race */ }
  }
});

const runIntegration = process.env["RAILBACK_RUN_INTEGRATION"] === "1";
const d = runIntegration ? describe : describe.skip;

d("Phase 3c: adapter BlobRepo S3 path", () => {
  test("putBytes / getBytes round-trips arbitrary keys", async () => {
    if (!reachable) { console.warn("stack unreachable, skipping"); return; }
    const b = makeBackend().blobs;
    const key = "rendered/hashx/t-3c-bytes.pdf";
    const bytes = new TextEncoder().encode("phase-3c-pdf-bytes");
    await b.putBytes(key, bytes, "application/pdf", "2026-07-09T00:00:00Z");
    const got = await b.getBytes(key);
    expect(got).not.toBeNull();
    expect(got!.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(got!.bytes)).toBe("phase-3c-pdf-bytes");
  });

  test("getBytes returns null for a missing key", async () => {
    if (!reachable) return;
    const b = makeBackend().blobs;
    expect(await b.getBytes("rendered/nope/does-not-exist.pdf")).toBeNull();
  });

  test("deleteBytes is idempotent (missing key = no throw)", async () => {
    if (!reachable) return;
    const b = makeBackend().blobs;
    await expect(b.deleteBytes("rendered/nope/also-missing.pdf")).resolves.toBeUndefined();
  });

  test("presignRawUploadPost yields raw/<hash>/<id>.<ext> + policy caps", async () => {
    if (!reachable) return;
    const b = makeBackend().blobs;
    const r = await b.presignRawUploadPost("Alice@Example.COM", "t-3c-raw", "application/pdf");
    expect(r.key).toMatch(/^raw\/[0-9a-f]{16}\/t-3c-raw\.pdf$/);
    expect(r.expiresIn).toBe(300);
    expect(r.fields["Content-Type"]).toBe("application/pdf");
    const policy = JSON.parse(Buffer.from(r.fields["Policy"]!, "base64").toString());
    const flat = JSON.stringify(policy.conditions);
    expect(flat).toContain("content-length-range");
    // 10 MB raw cap present in the policy
    expect(flat).toContain(String(10 * 1024 * 1024));
  });

  test("presignReceiptPost yields belege/<hash>/<id>/<belegId>.<ext> + 5 MB cap", async () => {
    if (!reachable) return;
    const b = makeBackend().blobs;
    const r = await b.presignReceiptPost("alice@example.com", "t-3c-beleg", "image/jpeg");
    expect(r.key).toMatch(/^belege\/[0-9a-f]{16}\/t-3c-beleg\/[0-9a-f-]{36}\.jpg$/);
    const policy = JSON.parse(Buffer.from(r.fields["Policy"]!, "base64").toString());
    expect(JSON.stringify(policy.conditions)).toContain(String(5 * 1024 * 1024));
  });

  test("deleteRawUpload cascade: metadata row + S3 object gone; idempotent", async () => {
    if (!reachable) return;
    const b = makeBackend().blobs;
    const email = "cascade-raw@example.com";
    const id = "t-3c-cascade-raw";
    const key = "raw/deadbeefdeadbeef/t-3c-cascade-raw.pdf";
    await b.putBytes(key, new TextEncoder().encode("x"), "application/pdf", "2026-07-09T00:00:00Z");
    await b.putRawUpload(email, id, {
      filename: "ticket.pdf", s3_bucket: BUCKET, s3_key: key,
      content_type: "application/pdf", size_bytes: 1, uploaded_at: "2026-07-09T00:00:00Z",
    });
    // sanity: metadata + bytes present
    expect(await b.getRawUpload(email, id)).not.toBeNull();
    expect(await b.getBytes(key)).not.toBeNull();

    const res = await b.deleteRawUpload(email, id);
    expect(res.s3_key).toBe(key);
    expect(await b.getRawUpload(email, id)).toBeNull();
    expect(await b.getBytes(key)).toBeNull();

    // idempotent second call → null, no throw
    const res2 = await b.deleteRawUpload(email, id);
    expect(res2.s3_key).toBeNull();
  });

  test("deleteAllReceipts cascade removes every beleg row + object", async () => {
    if (!reachable) return;
    const b = makeBackend().blobs;
    const email = "cascade-belege@example.com";
    const id = "t-3c-cascade-belege";
    const mk = async (belegId: string) => {
      const key = `belege/cafebabecafebabe/${id}/${belegId}.jpg`;
      await b.putBytes(key, new TextEncoder().encode("img"), "image/jpeg", "2026-07-09T00:00:00Z");
      await b.putReceipt(email, id, {
        belegId, filename: `${belegId}.jpg`, s3_bucket: BUCKET, s3_key: key,
        content_type: "image/jpeg", size_bytes: 3, typ: "TAXI", amount: "12.50",
        uploaded_at: "2026-07-09T00:00:00Z",
      });
      return key;
    };
    const k1 = await mk("beleg-1");
    const k2 = await mk("beleg-2");
    expect((await b.listReceipts(email, id)).length).toBe(2);

    const res = await b.deleteAllReceipts(email, id);
    expect(res.s3_keys.sort()).toEqual([k1, k2].sort());
    expect(await b.listReceipts(email, id)).toEqual([]);
    expect(await b.getBytes(k1)).toBeNull();
    expect(await b.getBytes(k2)).toBeNull();
  });
});
