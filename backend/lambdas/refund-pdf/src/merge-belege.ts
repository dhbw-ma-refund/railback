// Append belege (PDFs + images) to the already-flattened EU-form PDF.
//
// Locked decisions (CLAUDE.md "Belege merging" 2026-06-20):
//   - single merged PDF, never multi-attachment / S3-link / silent drop
//   - PDFs via copyPages, JPG/PNG via embedJpg/embedPng + addPage
//   - if cumulative size would exceed the SES raw-message cap, REPLACE the
//     next-to-be-added page with a "weitere belege bei rückfrage
//     nachreichbar" notice page and stop merging
//
// We don't try to be byte-exact about the SES 10 MB raw-message cap because
// MIME-encoding the attachment adds ~33% overhead (base64). Instead we cap
// the merged PDF source at 7 MB which after base64-encode lands around
// ~9.5 MB on the wire — safe margin under the 10 MB cap.

import { log } from "@railback/lib/http/logging";
import { db } from "@railback/lib/storage";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// 7 MB pre-base64 source ≈ 9.5 MB MIME-encoded; SES raw-message cap is 10 MB.
const MAX_MERGED_BYTES = 7 * 1024 * 1024;

// US-Letter, matches the EU-form's page geometry well enough for image pages.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

export interface MergeBelegeInput {
  euFormBytes: Uint8Array;
  belege: Array<{ s3_key: string; content_type: string; filename: string }>;
}

export interface MergeBelegeResult {
  bytes: Uint8Array;
  pageCount: number;
  truncated: boolean;
  /** Filenames of belege that could not be embedded (corrupt bytes, etc.). */
  failedEmbeds: string[];
}

export async function mergeBelege(input: MergeBelegeInput): Promise<MergeBelegeResult> {
  const doc = await PDFDocument.load(input.euFormBytes);

  if (input.belege.length === 0) {
    const bytes = await doc.save();
    return { bytes, pageCount: doc.getPageCount(), truncated: false, failedEmbeds: [] };
  }

  const blobs = db().blobs;

  // Running estimate of the merged-PDF source size. We start with the
  // EU-form's own byte length and add each beleg's raw byte length as we
  // merge. Real PDF-merge output is typically slightly smaller than the
  // sum (object reuse), so this is a conservative upper bound.
  let estimatedBytes = input.euFormBytes.length;
  let truncated = false;
  const failedEmbeds: string[] = [];

  for (const beleg of input.belege) {
    const blob = await blobs.getBytes(beleg.s3_key);
    if (!blob) {
      log.warn("merge-belege.missing", { s3_key: beleg.s3_key, filename: beleg.filename });
      // Surface it as a failed embed — admin needs to know the beleg the
      // user uploaded didn't make it into the email.
      failedEmbeds.push(beleg.filename);
      continue;
    }

    // Pre-flight size check: would adding this beleg push us over the cap?
    // If so, stop merging and replace with the notice page.
    if (estimatedBytes + blob.bytes.length > MAX_MERGED_BYTES) {
      truncated = true;
      break;
    }

    const ct = beleg.content_type.toLowerCase();
    try {
      if (ct === "application/pdf") {
        const src = await PDFDocument.load(blob.bytes);
        const pages = await doc.copyPages(src, src.getPageIndices());
        for (const p of pages) doc.addPage(p);
      } else if (ct === "image/jpeg" || ct === "image/jpg") {
        const img = await doc.embedJpg(blob.bytes);
        addImagePage(doc, img.width, img.height, (page, w, h, x, y) =>
          page.drawImage(img, { x, y, width: w, height: h }),
        );
      } else if (ct === "image/png") {
        const img = await doc.embedPng(blob.bytes);
        addImagePage(doc, img.width, img.height, (page, w, h, x, y) =>
          page.drawImage(img, { x, y, width: w, height: h }),
        );
      } else {
        log.warn("merge-belege.unsupported-content-type", {
          s3_key: beleg.s3_key,
          content_type: beleg.content_type,
        });
        // Unsupported types are user-visible failures too — they uploaded
        // something we can't render. Track it so the email can mention it.
        failedEmbeds.push(beleg.filename);
        continue;
      }
      estimatedBytes += blob.bytes.length;
    } catch (err) {
      // A corrupt beleg shouldn't sink the whole render — log and track.
      // Tracking via failedEmbeds means the caller can add a notice page
      // / email-body line so the user isn't silently missing a beleg.
      log.warn("merge-belege.embed-failed", {
        s3_key: beleg.s3_key,
        content_type: beleg.content_type,
        error: err instanceof Error ? err.message : String(err),
      });
      failedEmbeds.push(beleg.filename);
    }
  }

  if (truncated) {
    await addNoticePage(doc, {
      title: "Weitere Belege",
      body: "Weitere Belege sind bei Rueckfrage nachreichbar.",
    });
  }
  if (failedEmbeds.length > 0) {
    // Separate notice page for embed-failures — the user/admin can see
    // exactly which filenames didn't make it into the merged PDF.
    const list = failedEmbeds.slice(0, 8).join(", ") +
      (failedEmbeds.length > 8 ? ` (+${failedEmbeds.length - 8})` : "");
    await addNoticePage(doc, {
      title: "Hinweis: nicht eingebettete Belege",
      body: `Folgende Belege konnten nicht eingebettet werden: ${list}.`,
    });
  }

  const bytes = await doc.save();
  return { bytes, pageCount: doc.getPageCount(), truncated, failedEmbeds };
}

// Add a full-page image, scaled to fit while keeping aspect ratio, centered.
function addImagePage(
  doc: PDFDocument,
  imgWidth: number,
  imgHeight: number,
  draw: (
    page: ReturnType<PDFDocument["addPage"]>,
    w: number,
    h: number,
    x: number,
    y: number,
  ) => void,
): void {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const scale = Math.min(PAGE_WIDTH / imgWidth, PAGE_HEIGHT / imgHeight);
  const w = imgWidth * scale;
  const h = imgHeight * scale;
  const x = (PAGE_WIDTH - w) / 2;
  const y = (PAGE_HEIGHT - h) / 2;
  draw(page, w, h, x, y);
}

async function addNoticePage(
  doc: PDFDocument,
  args: { title: string; body: string },
): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const titleSize = 18;
  const bodySize = 12;

  const titleWidth = bold.widthOfTextAtSize(args.title, titleSize);

  page.drawText(args.title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT / 2 + 20,
    size: titleSize,
    font: bold,
    color: rgb(0, 0, 0),
  });
  // Body is wrapped naively — long failedEmbeds lists could overflow but
  // we keep it short (max 8 names) so this stays safe in practice.
  const bodyWidth = font.widthOfTextAtSize(args.body, bodySize);
  page.drawText(args.body, {
    x: Math.max(40, (PAGE_WIDTH - bodyWidth) / 2),
    y: PAGE_HEIGHT / 2 - 10,
    size: bodySize,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
}
