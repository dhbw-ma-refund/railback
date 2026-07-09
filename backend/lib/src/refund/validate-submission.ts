// Submit-time guard for POST /users/me/tickets/{id}/refund. Zod already
// covers shape; this enforces business rules that depend on cross-field
// state or on the linked User row (IBAN/BIC must be on file).

import { AppError } from "../errors/index.js";
import type { RefundRequest } from "../schemas/ticket.js";
import type { User } from "../types/dto.js";

export interface RefundSubmissionInput {
  body: RefundRequest;
  user: User;
  belegeCount: number;
}

export function validateRefundSubmission(input: RefundSubmissionInput): void {
  const { body, user, belegeCount } = input;

  if (body.datenschutz_einwilligung !== true) {
    throw new AppError(
      "ERR_VALIDATION",
      "Datenschutz-Einwilligung erforderlich",
      undefined,
      { field: "datenschutz_einwilligung" },
    );
  }

  if (body.wahrheitserklaerung !== true) {
    throw new AppError(
      "ERR_VALIDATION",
      "Wahrheitserklaerung erforderlich",
      undefined,
      { field: "wahrheitserklaerung" },
    );
  }

  // Defensive: zod schema already enforces .min(1), but keep an explicit
  // guard so the field name is surfaced consistently if the schema loosens.
  if (!body.antragsgrund || body.antragsgrund.length === 0) {
    throw new AppError(
      "ERR_VALIDATION",
      "antragsgrund erforderlich",
      undefined,
      { field: "antragsgrund" },
    );
  }

  if (body.antragsgrund.includes("VERPASSTER_ANSCHLUSS")) {
    const bahnhof = body.fahrt_tatsaechlich.verpasster_anschluss_bahnhof;
    if (typeof bahnhof !== "string" || bahnhof.length === 0) {
      throw new AppError(
        "ERR_VALIDATION",
        "verpasster_anschluss_bahnhof erforderlich bei VERPASSTER_ANSCHLUSS",
        undefined,
        { field: "fahrt_tatsaechlich.verpasster_anschluss_bahnhof" },
      );
    }
  }

  if (body.antragsart === "KOSTEN_ALTERNATIVTRANSPORT" && belegeCount < 1) {
    throw new AppError(
      "ERR_VALIDATION",
      "KOSTEN_ALTERNATIVTRANSPORT benoetigt mindestens einen Beleg",
      undefined,
      { field: "belege" },
    );
  }

  // ENTSCHAEDIGUNG_ZEITKARTE requires is_zeitkarte=true. Otherwise the
  // computeFee ZEITKARTE-pauschale (DB-AGB tiered formula) would apply
  // to a non-zeitkarte ticket, silently over/under-paying the user.
  // The frontend wizard drives the pairing (antragsart choice tied to
  // is_zeitkarte flag), but the backend is the last-line-of-defence
  // against a hand-crafted POST body. Locked 2026-07-01 per audit
  // finding `zeitkarte-flag-not-enforced`.
  if (
    body.antragsart === "ENTSCHAEDIGUNG_ZEITKARTE" &&
    body.is_zeitkarte !== true
  ) {
    throw new AppError(
      "ERR_VALIDATION",
      "ENTSCHAEDIGUNG_ZEITKARTE erfordert is_zeitkarte=true",
      undefined,
      { field: "is_zeitkarte" },
    );
  }

  if (!user.iban_enc) {
    throw new AppError(
      "ERR_VALIDATION",
      "IBAN nicht hinterlegt",
      undefined,
      { field: "iban" },
    );
  }

  if (!user.bic_enc) {
    throw new AppError(
      "ERR_VALIDATION",
      "BIC nicht hinterlegt",
      undefined,
      { field: "bic" },
    );
  }

  if (
    typeof body.antragstellung_ort !== "string" ||
    body.antragstellung_ort.length === 0
  ) {
    throw new AppError(
      "ERR_VALIDATION",
      "antragstellung_ort erforderlich",
      undefined,
      { field: "antragstellung_ort" },
    );
  }

  if (
    body.zusaetzliche_angaben !== undefined &&
    body.zusaetzliche_angaben.length > 2500
  ) {
    throw new AppError(
      "ERR_VALIDATION",
      "zusaetzliche_angaben max 2500 Zeichen",
      undefined,
      { field: "zusaetzliche_angaben" },
    );
  }
}
