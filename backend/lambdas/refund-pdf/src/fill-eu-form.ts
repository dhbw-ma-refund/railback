// Fill the EU refund-form template (reimbursement-form_de.pdf) with ticket +
// user data, flatten the AcroForm so the result is a "flat" PDF (no editable
// fields), and return the resulting bytes.
//
// This module is intentionally narrow: it does ONLY render-and-flatten. The
// belege-merge step runs afterwards in merge-belege.ts on the already-
// flattened output (locked 2026-06-20).
//
// IBAN/BIC arrive already-decrypted from the caller — handler.ts pulls the
// snapshot off the SepaMandate (preferred) or User profile and runs
// decryptIban/decryptBic before getting here. Helvetica covers ä ö ü ß so no
// font embedding is required.
//
// Template-drift guard (added 2026-06-25 after codex review P2/P3): on
// first template load we assert that every field the eu-form-fields map
// references is present in the loaded PDF. A mismatch throws — better to
// fail loud at first render than to silently produce a half-filled form
// that the user posts to DB.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AppError } from "@railback/lib/errors";
import {
  ALL_CHECKBOX_FIELDS,
  ALL_TEXT_FIELDS,
  fillEuFormFields,
} from "@railback/lib/refund/eu-form-fields";
import { log } from "@railback/lib/http/logging";
import type { Ticket, User } from "@railback/lib/types/dto";
import { PDFDocument } from "pdf-lib";

// Resolve the bundled template relative to this module file. The compiled
// Lambda zip ships `assets/` next to `src/` at the package root, so we walk
// one level up from this file.
const TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "reimbursement-form_de.pdf",
);

let templateBytesCache: Uint8Array | undefined;
let templateValidated = false;

async function loadTemplateBytes(): Promise<Uint8Array> {
  if (templateBytesCache) return templateBytesCache;
  const buf = await readFile(TEMPLATE_PATH);
  // Buffer is a Uint8Array subclass; pdf-lib accepts either.
  templateBytesCache = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return templateBytesCache;
}

/**
 * Validate the loaded template carries every field the fill-map expects.
 * Runs once per Lambda warm-start (idempotent via the `templateValidated`
 * flag). Throws ERR_INTERNAL on drift — operator must update either the
 * template or the field map, not silently render half a form.
 */
function assertTemplateFields(doc: PDFDocument): void {
  if (templateValidated) return;
  const form = doc.getForm();
  const missing: { kind: "text" | "checkbox"; name: string }[] = [];
  for (const name of ALL_TEXT_FIELDS) {
    try {
      form.getTextField(name);
    } catch {
      missing.push({ kind: "text", name });
    }
  }
  for (const name of ALL_CHECKBOX_FIELDS) {
    try {
      form.getCheckBox(name);
    } catch {
      missing.push({ kind: "checkbox", name });
    }
  }
  if (missing.length > 0) {
    throw new AppError(
      "ERR_INTERNAL",
      `EU-form template drift: ${missing.length} field(s) missing from PDF AcroForm — update the template or the field map`,
      undefined,
      { missing },
    );
  }
  templateValidated = true;
}

/** Test-only: reset the validation cache so a fresh template can be re-checked. */
export function _resetTemplateValidationCache(): void {
  templateValidated = false;
  templateBytesCache = undefined;
}

export interface FillEuFormInput {
  ticket: Ticket;
  user: User;
  /** Already-decrypted IBAN (caller pulls from mandate snapshot). */
  iban: string;
  /** Already-decrypted BIC (caller pulls from mandate snapshot). */
  bic: string;
}

/**
 * Render the EU refund form template with the given ticket + user, flatten
 * the AcroForm, and return the saved PDF bytes.
 *
 * Field map (47 fields, Italian-named) lives in
 * `@railback/lib/refund/eu-form-fields`. This module just walks the returned
 * `{ text, checks }` payload and feeds it to pdf-lib.
 */
export async function fillEuForm(input: FillEuFormInput): Promise<Uint8Array> {
  const { ticket, user, iban, bic } = input;

  const templateBytes = await loadTemplateBytes();
  const doc = await PDFDocument.load(templateBytes);
  // Drift-guard on first render. Throws ERR_INTERNAL if any name in
  // ALL_TEXT_FIELDS / ALL_CHECKBOX_FIELDS is missing from the template.
  assertTemplateFields(doc);
  const form = doc.getForm();

  const { text, checks } = fillEuFormFields({ ticket, user, iban, bic });

  // Text fields: skip empty strings (== "leave blank") to avoid touching the
  // field at all. Defensive try/catch — if the drift-guard passed but a
  // specific field still throws (e.g. pdf-lib version mismatch on a renamed
  // field type), surface it as ERR_INTERNAL rather than rendering on.
  for (const [name, value] of Object.entries(text)) {
    if (!value) continue;
    try {
      form.getTextField(name).setText(value);
    } catch (err) {
      log.error("refund-pdf.fill-eu-form.text_field_failed", {
        ticketId: ticket.ticketId,
        field: name,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new AppError(
        "ERR_INTERNAL",
        `EU-form text field "${name}" could not be filled — template/field-map drift`,
      );
    }
  }

  for (const name of checks) {
    try {
      form.getCheckBox(name).check();
    } catch (err) {
      log.error("refund-pdf.fill-eu-form.checkbox_failed", {
        ticketId: ticket.ticketId,
        field: name,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new AppError(
        "ERR_INTERNAL",
        `EU-form checkbox "${name}" could not be filled — template/field-map drift`,
      );
    }
  }

  // Flatten before save — locked decision. Output must not carry editable
  // AcroForm fields into the DB user's hands.
  form.flatten();

  return await doc.save();
}
