// persist.spec.ts — writes bytes via persistRenderedPdf, asserts the
// RENDERED# metadata row, the bytes at the canonical s3_key, and the key
// shape.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";

import { persistRenderedPdf } from "../src/persist.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import { db } from "@railback/lib/storage";
import { emailHash } from "@railback/lib/util/hash";

const TEST_EMAIL = "carol@example.com";
const TEST_TICKET = "01HXY00000PERSIST00000000";

describe("persistRenderedPdf", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("writes bytes + metadata row at the canonical s3_key", async () => {
    const bytes = new Uint8Array(Buffer.from("%PDF-1.7\n%PERSIST-TEST\n%%EOF\n", "utf8"));

    const result = await persistRenderedPdf({
      email: TEST_EMAIL,
      ticketId: TEST_TICKET,
      bytes,
    });

    const expectedKey = `rendered/${emailHash(TEST_EMAIL)}/${TEST_TICKET}.pdf`;
    expect(result.s3_key).toBe(expectedKey);
    expect(result.size_bytes).toBe(bytes.byteLength);

    // (a) metadata row landed
    const row = await db().blobs.getRenderedPdf(TEST_EMAIL, TEST_TICKET);
    expect(row).not.toBeNull();
    expect(row!.s3_key).toBe(expectedKey);
    expect(row!.size_bytes).toBe(bytes.byteLength);

    // (b) bytes are retrievable via getBytes
    const blob = await db().blobs.getBytes(expectedKey);
    expect(blob).not.toBeNull();
    expect(blob!.bytes.byteLength).toBe(bytes.byteLength);
    expect(blob!.contentType).toBe("application/pdf");
  });
});
