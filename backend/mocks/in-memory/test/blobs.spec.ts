// Coverage for InMemoryBlobRepo.getBytes — the generic bytes-read method
// used by refund-pdf (belege merge) and email-sweeper (attachment fetch).

import { describe, expect, it } from "vitest";

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
