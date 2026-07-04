// persist.spec.ts — writes XML bytes via persistPain008Xml, asserts
// the pain008/<YYYY-MM>/<batchId>.xml key shape, content-type, and
// bytes round-trip via blobs.getBytes.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";

import { persistPain008Xml } from "../src/persist.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import { db } from "@railback/lib/storage";

const TEST_BATCH = "01HXY00000PAIN008BATCH0001";
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.09"><Test/></Document>`;

function xmlBytes(): Uint8Array {
  const buf = Buffer.from(SAMPLE_XML, "utf-8");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe("persistPain008Xml", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("writes bytes at the canonical pain008/<YYYY-MM>/<batchId>.xml key", async () => {
    const bytes = xmlBytes();
    const builtAt = "2026-06-29T12:34:56.789Z";

    const result = await persistPain008Xml({
      batchId: TEST_BATCH,
      builtAt,
      bytes,
    });

    expect(result.s3_key).toBe(`pain008/2026-06/${TEST_BATCH}.xml`);
    expect(result.size_bytes).toBe(bytes.byteLength);

    // Bytes round-trip
    const blob = await db().blobs.getBytes(result.s3_key);
    expect(blob).not.toBeNull();
    expect(blob!.bytes.byteLength).toBe(bytes.byteLength);
    expect(blob!.contentType).toBe("application/xml");

    // And the bytes ARE the XML we sent in.
    const out = Buffer.from(blob!.bytes).toString("utf-8");
    expect(out).toBe(SAMPLE_XML);
  });

  it("derives YYYY-MM in UTC, not local time", async () => {
    // 2026-01-01T00:30:00Z is still January UTC even if local TZ rolls to Dec.
    const result = await persistPain008Xml({
      batchId: TEST_BATCH,
      builtAt: "2026-01-01T00:30:00.000Z",
      bytes: xmlBytes(),
    });
    expect(result.s3_key).toBe(`pain008/2026-01/${TEST_BATCH}.xml`);
  });

  it("throws on invalid builtAt", async () => {
    await expect(
      persistPain008Xml({
        batchId: TEST_BATCH,
        builtAt: "not-a-date",
        bytes: xmlBytes(),
      }),
    ).rejects.toThrow(/invalid builtAt/);
  });

  it("propagates BlobRepo.putBytes errors", async () => {
    const bytes = xmlBytes();
    // Monkey-patch putBytes on the live BlobRepo. Restore in afterEach
    // via teardownTestEnv → resetDbCache which builds a fresh repo.
    const orig = db().blobs.putBytes.bind(db().blobs);
    db().blobs.putBytes = async () => {
      throw new Error("S3 unavailable");
    };
    try {
      await expect(
        persistPain008Xml({
          batchId: TEST_BATCH,
          builtAt: "2026-06-29T00:00:00.000Z",
          bytes,
        }),
      ).rejects.toThrow(/S3 unavailable/);
    } finally {
      db().blobs.putBytes = orig;
    }
  });
});
