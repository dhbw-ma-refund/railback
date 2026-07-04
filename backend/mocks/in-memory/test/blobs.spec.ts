// Coverage for InMemoryBlobRepo.getBytes — the generic bytes-read method
// used by refund-pdf (belege merge) and email-sweeper (attachment fetch).

import { describe, expect, it } from "vitest";

import { AppError } from "@railback/lib";

import { InMemoryDb, uploadRawBlob } from "../src/index.js";

describe("InMemoryBlobRepo.getBytes", () => {
  it("returns the bytes + content type for a stored blob", async () => {
    const inst = new InMemoryDb();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { s3_key } = uploadRawBlob(inst.state, "ada@example.com", "TKT_A", {
      filename: "ticket.pdf",
      bytes,
      contentType: "application/pdf",
    });

    const out = await inst.db.blobs.getBytes(s3_key);
    expect(out).not.toBeNull();
    expect(out?.contentType).toBe("application/pdf");
    expect(Array.from(out!.bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns null for a nonexistent key", async () => {
    const inst = new InMemoryDb();
    const out = await inst.db.blobs.getBytes("raw/nonexistent/key.pdf");
    expect(out).toBeNull();
  });
});

// The mock mirrors S3's server-side enforcement of the presigned-POST
// content-length-range policy: presignRawUploadPost / presignReceiptPost
// register a (min, max) policy for the issued key, and putBytes enforces
// it. Server-side direct writes (rendered PDFs, pain.008 XML) never go
// through presign and stay permissive.
describe("InMemoryBlobRepo.putBytes — presigned-POST content-length-range enforcement", () => {
  const RAW_MAX = 10 * 1024 * 1024;
  const BELEG_MAX = 5 * 1024 * 1024;

  it("accepts bytes within a registered policy range", async () => {
    const inst = new InMemoryDb();
    const post = await inst.db.blobs.presignRawUploadPost(
      "ada@example.com",
      "TKT_A",
      "application/pdf",
    );
    const bytes = new Uint8Array(1024); // 1 KB, well within [1, 10 MB]
    await expect(
      inst.db.blobs.putBytes(post.key, bytes, "application/pdf", "2026-06-25T00:00:00Z"),
    ).resolves.toBeUndefined();

    const out = await inst.db.blobs.getBytes(post.key);
    expect(out?.bytes.byteLength).toBe(1024);
  });

  it("rejects bytes below the registered min (empty upload)", async () => {
    const inst = new InMemoryDb();
    const post = await inst.db.blobs.presignRawUploadPost(
      "ada@example.com",
      "TKT_A",
      "application/pdf",
    );
    const empty = new Uint8Array(0);
    await expect(
      inst.db.blobs.putBytes(post.key, empty, "application/pdf", "2026-06-25T00:00:00Z"),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects bytes above the registered max (raw upload cap 10 MB)", async () => {
    const inst = new InMemoryDb();
    const post = await inst.db.blobs.presignRawUploadPost(
      "ada@example.com",
      "TKT_A",
      "application/pdf",
    );
    const tooBig = new Uint8Array(RAW_MAX + 1);
    await expect(
      inst.db.blobs.putBytes(post.key, tooBig, "application/pdf", "2026-06-25T00:00:00Z"),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects bytes above the belege cap (5 MB)", async () => {
    const inst = new InMemoryDb();
    const post = await inst.db.blobs.presignReceiptPost(
      "ada@example.com",
      "TKT_A",
      "image/jpeg",
    );
    const tooBig = new Uint8Array(BELEG_MAX + 1);
    await expect(
      inst.db.blobs.putBytes(post.key, tooBig, "image/jpeg", "2026-06-25T00:00:00Z"),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("keeps permissive behaviour when no policy is registered (server-side writes)", async () => {
    const inst = new InMemoryDb();
    // Server-side rendered PDFs and pain.008 XML go straight to putBytes
    // without a presign; these keys have no registered policy so any size
    // (including 0 or >10 MB) is permitted.
    const rendered = new Uint8Array(0);
    await expect(
      inst.db.blobs.putBytes(
        "rendered/some-hash/TKT_X.pdf",
        rendered,
        "application/pdf",
        "2026-06-25T00:00:00Z",
      ),
    ).resolves.toBeUndefined();

    const big = new Uint8Array(RAW_MAX + 1);
    await expect(
      inst.db.blobs.putBytes(
        "pain008/batch-1.xml",
        big,
        "application/xml",
        "2026-06-25T00:00:00Z",
      ),
    ).resolves.toBeUndefined();
  });
});
