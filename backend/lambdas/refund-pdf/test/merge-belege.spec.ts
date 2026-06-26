// merge-belege.spec.ts — exercise the four real branches: no belege, PDF
// beleg via copyPages, image beleg via embedPng + addPage, oversize -> notice.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";
import { PDFDocument } from "pdf-lib";

import { mergeBelege } from "../src/merge-belege.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import { db } from "@railback/lib/storage";

// 1x1 transparent PNG. Smallest valid PNG bytes (the PNG signature + IHDR
// for a 1x1 RGBA image + a single IDAT chunk + IEND).
const PNG_1x1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

async function makeTinyPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage([100, 100]);
  }
  return await doc.save();
}

async function makeEuFormStub(): Promise<Uint8Array> {
  // Stand-in for the rendered EU-form bytes. Real fill-eu-form output is a
  // 16-page document; for merge-belege isolation we use a 1-page stub.
  return await makeTinyPdf(1);
}

describe("merge-belege", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("no belege → returns input unchanged (same page count, valid PDF)", async () => {
    const euForm = await makeEuFormStub();
    const before = await PDFDocument.load(euForm);
    const beforeCount = before.getPageCount();

    const out = await mergeBelege({ euFormBytes: euForm, belege: [] });

    expect(out.truncated).toBe(false);
    expect(out.pageCount).toBe(beforeCount);
    // valid PDF
    const reload = await PDFDocument.load(out.bytes);
    expect(reload.getPageCount()).toBe(beforeCount);
  });

  it("one PNG beleg → pageCount += 1", async () => {
    const euForm = await makeEuFormStub();
    const pngBytes = new Uint8Array(Buffer.from(PNG_1x1_B64, "base64"));
    await db().blobs.putBytes("belege/x/png.png", pngBytes, "image/png", "2026-06-25T00:00:00Z");

    const out = await mergeBelege({
      euFormBytes: euForm,
      belege: [{ s3_key: "belege/x/png.png", content_type: "image/png", filename: "x.png" }],
    });

    expect(out.truncated).toBe(false);
    expect(out.pageCount).toBe(2);
    const reload = await PDFDocument.load(out.bytes);
    expect(reload.getPageCount()).toBe(2);
  });

  it("one multi-page PDF beleg → pageCount += N", async () => {
    const euForm = await makeEuFormStub();
    const belegPdf = await makeTinyPdf(3);
    await db().blobs.putBytes("belege/x/multi.pdf", belegPdf, "application/pdf", "2026-06-25T00:00:00Z");

    const out = await mergeBelege({
      euFormBytes: euForm,
      belege: [{ s3_key: "belege/x/multi.pdf", content_type: "application/pdf", filename: "x.pdf" }],
    });

    expect(out.truncated).toBe(false);
    expect(out.pageCount).toBe(1 + 3);
    const reload = await PDFDocument.load(out.bytes);
    expect(reload.getPageCount()).toBe(1 + 3);
  });

  it("oversize beleg → truncated=true and notice page is added", async () => {
    const euForm = await makeEuFormStub();
    // Fake-belege whose RAW byte count alone busts the 7 MB pre-base64 cap.
    const big = new Uint8Array(8 * 1024 * 1024);
    big.set(Buffer.from(PNG_1x1_B64, "base64"), 0);
    await db().blobs.putBytes("belege/x/big.png", big, "image/png", "2026-06-25T00:00:00Z");

    const out = await mergeBelege({
      euFormBytes: euForm,
      belege: [
        { s3_key: "belege/x/big.png", content_type: "image/png", filename: "big.png" },
      ],
    });

    expect(out.truncated).toBe(true);
    // 1 (eu-form) + 1 (notice) — the oversize beleg itself was skipped.
    expect(out.pageCount).toBe(2);
  });

  it("missing beleg row → logged + surfaced as failedEmbed (notice page added)", async () => {
    const euForm = await makeEuFormStub();
    const out = await mergeBelege({
      euFormBytes: euForm,
      belege: [{ s3_key: "belege/x/nonexistent.pdf", content_type: "application/pdf", filename: "x.pdf" }],
    });
    expect(out.truncated).toBe(false);
    expect(out.failedEmbeds).toEqual(["x.pdf"]);
    // eu-form + failed-embeds notice page
    expect(out.pageCount).toBe(2);
  });

  it("corrupt PNG beleg → marked as failedEmbed instead of silently dropped", async () => {
    const euForm = await makeEuFormStub();
    // Bytes claiming to be PNG but not actually PNG → embedPng throws.
    const garbage = new Uint8Array(Buffer.from("not-a-png-at-all", "utf8"));
    await db().blobs.putBytes("belege/x/corrupt.png", garbage, "image/png", "2026-06-25T00:00:00Z");

    const out = await mergeBelege({
      euFormBytes: euForm,
      belege: [{ s3_key: "belege/x/corrupt.png", content_type: "image/png", filename: "corrupt.png" }],
    });

    expect(out.failedEmbeds).toEqual(["corrupt.png"]);
    // 1 eu-form + 1 failed-embeds notice page; no image page.
    expect(out.pageCount).toBe(2);
  });

  it("unsupported content-type → marked as failedEmbed", async () => {
    const euForm = await makeEuFormStub();
    const bytes = new Uint8Array(Buffer.from("any-bytes", "utf8"));
    await db().blobs.putBytes("belege/x/weird.tiff", bytes, "image/tiff", "2026-06-25T00:00:00Z");

    const out = await mergeBelege({
      euFormBytes: euForm,
      belege: [{ s3_key: "belege/x/weird.tiff", content_type: "image/tiff", filename: "weird.tiff" }],
    });

    expect(out.failedEmbeds).toEqual(["weird.tiff"]);
    expect(out.pageCount).toBe(2);
  });
});
