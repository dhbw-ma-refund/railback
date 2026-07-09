import { AppError } from "../errors/index.js";
import type { Antragsart } from "../types/enums.js";
import { mulDecimal, parseDecimal } from "../util/decimal.js";

export interface ComputeFeeInput {
  antragsart: Antragsart;
  fahrkartenpreis: string;
  delayMinutes: number;
  belegeSumme?: string;
  isZeitkarte?: boolean;
}

export interface ComputeFeeResult {
  erwartete_erstattung: string;
  service_fee_betrag: string;
}

export function computeFee(input: ComputeFeeInput): ComputeFeeResult {
  const { antragsart, fahrkartenpreis, delayMinutes, belegeSumme } = input;

  try {
    parseDecimal(fahrkartenpreis);
  } catch {
    throw new AppError(
      "ERR_VALIDATION",
      `fahrkartenpreis ist kein gültiger Dezimalwert: "${fahrkartenpreis}"`,
      undefined,
      { field: "fahrkartenpreis" }
    );
  }

  let erwartete_erstattung: string;

  switch (antragsart) {
    case "ERSTATTUNG_FAHRKARTE":
      erwartete_erstattung = fahrkartenpreis;
      break;
    case "ENTSCHAEDIGUNG_60_119":
      erwartete_erstattung = mulDecimal(fahrkartenpreis, 0.25);
      break;
    case "ENTSCHAEDIGUNG_120_PLUS":
      erwartete_erstattung = mulDecimal(fahrkartenpreis, 0.5);
      break;
    case "KOSTEN_ALTERNATIVTRANSPORT":
      if (belegeSumme === undefined || belegeSumme === null || belegeSumme === "") {
        throw new AppError(
          "ERR_VALIDATION",
          "KOSTEN_ALTERNATIVTRANSPORT erfordert belegeSumme",
          undefined,
          { field: "belegeSumme" }
        );
      }
      try {
        parseDecimal(belegeSumme);
      } catch {
        throw new AppError(
          "ERR_VALIDATION",
          `belegeSumme ist kein gültiger Dezimalwert: "${belegeSumme}"`,
          undefined,
          { field: "belegeSumme" }
        );
      }
      erwartete_erstattung = belegeSumme;
      break;
    case "ENTSCHAEDIGUNG_ZEITKARTE":
      // TODO Open Question #10 — DB-AGB-Pauschal-Tabelle ersetzt diese Stub-Werte.
      // Stub: 60–119 min → 5.00 EUR, ≥120 min → 10.00 EUR pro Trip. Reale Tabelle
      // hängt am DB-AGB-Recherche-output; redeploy von refund-pdf reicht.
      if (delayMinutes >= 120) {
        erwartete_erstattung = "10.00";
      } else if (delayMinutes >= 60) {
        erwartete_erstattung = "5.00";
      } else {
        throw new AppError(
          "ERR_NO_CLAIM",
          "Zeitkarte: keine Pauschale unter 60 min"
        );
      }
      break;
    default: {
      // exhaustive — unreachable while Antragsart enum matches
      const _exhaustive: never = antragsart;
      throw new AppError(
        "ERR_VALIDATION",
        `unbekannte Antragsart: ${_exhaustive as string}`,
        undefined,
        { field: "antragsart" }
      );
    }
  }

  // Service-fee locked 2026-06-24: 0.75 EUR pauschal pro Antrag,
  // unabhängig von antragsart / fahrkartenpreis / delayMinutes / belege.
  // Zero-fee-guard im refund-pdf-Lambda bleibt als defensiver check
  // (skip SEPA-pfad bei "0.00") — auf happy-path dead code, fängt
  // aber zukünftige admin-side waiver edge-cases ab.
  const service_fee_betrag = "0.75";

  return { erwartete_erstattung, service_fee_betrag };
}
