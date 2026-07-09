// EU refund form (reimbursement-form_de.pdf) AcroForm field map.
//
// The shipped PDF template is shared across all EU language versions, so
// the AcroForm field names are ITALIAN. This module is the single source
// of truth for translating our backend domain model into the form's
// AcroForm field names. The refund-pdf Lambda (Phase 2.5) calls
// `fillEuFormFields()`, hands the returned `{ text, checks }` object to
// pdf-lib's `setText()` / `check()`, then `form.flatten()`s the result.
//
// 47 fields total in the shipped PDF:
//   - 13 checkboxes (Btn): 3 Antragsgrund, 6 Antragsart (3 top-level + 3
//     sub), 2 Auszahlungsform, 2 DSGVO
//   - 34 text fields (Tx)
//
// Section 4 has a 2-level structure: ticking "Entschädigung durch EVU"
// (Specificare 2) requires ticking exactly one of "Selezionare 1/2/3".
// We tick BOTH the parent and the matching sub when the antragsart is an
// ENTSCHAEDIGUNG_* variant.
//
// Verified against the live PDF on 2026-06-12 (see refund-pdf/field-map.js
// for the original verification notes, including the source-PDF typo
// "Scheduled journey 5" and the non-sequential Indirizzo numbering).

import type { Antragsart, Antragsgrund } from "../types/enums.js";
import type { Ticket, User } from "../types/dto.js";
import { formatEur } from "../util/decimal.js";

// ---------------------------------------------------------------------------
// Italian AcroForm field names — the canonical names pdf-lib looks up by.
// ---------------------------------------------------------------------------

export const ANTRAGSGRUND_FIELDS: Record<Antragsgrund, string> = {
  VERSPAETUNG: "Motivi della richiesta 1",
  AUSFALL: "Motivi della richiesta 2",
  VERPASSTER_ANSCHLUSS: "Motivi della richiesta 3",
};

// Section 2 — Richiesta precedente (vorheriger Antrag). We always leave
// this empty by design; exposed only so callers know the names exist.
export const RICHIESTA_PRECEDENTE_FIELDS = {
  datum: "Data 1",
  empfaenger: "Destinatario della richiesta 1",
  referenz: "Richiesta precedente 1",
} as const;

export const SECTION_3_1 = {
  eisenbahnunternehmen: "Nome dell'impresa ferroviaria 1",
} as const;

// 3.2 Viaggio previsto (Fahrt laut Fahrplan). Field 5 is the only English
// name in the PDF ("Scheduled journey 5") — verbatim, do not "fix".
// Field 6 combines Zugnummer + Zugkategorie into one input.
export const SECTION_3_2 = {
  abreisedatum: "Viaggio previsto 1",
  abreisebahnhof: "Viaggio previsto 2",
  zielbahnhof: "Viaggio previsto 3",
  abfahrtszeit_plan: "Viaggio previsto 4",
  ankunftszeit_plan: "Scheduled journey 5",
  zugnummer_kategorie: "Viaggio previsto 6",
  fahrkartennummer: "Viaggio previsto 7",
  fahrkartenpreis: "Viaggio previsto 8",
} as const;

// 3.3 Viaggio effettivo (tatsächliche Fahrt). Field 4 combines Zugnummer
// + Zugkategorie (same as 3.2.6).
export const SECTION_3_3 = {
  ankunftsdatum_tatsaechlich: "Viaggio effettivo 1",
  abfahrtszeit_tatsaechlich: "Viaggio effettivo 2",
  ankunftszeit_tatsaechlich: "Viaggio effettivo 3",
  zugnummer_kategorie_tatsaechlich: "Viaggio effettivo 4",
  verpasster_anschluss_bahnhof: "Viaggio effettivo 5",
} as const;

// Section 4 — Antragsart. 2-level structure. Top-level Specificare 1..3:
//   1 = Erstattung der Fahrkarte (standalone)
//   2 = Entschädigung durch das EVU (parent — tick together with one of
//       Selezionare 1..3 sub-options)
//   3 = Erstattung der Kosten Bus/Taxi/Hotel = KOSTEN_ALTERNATIVTRANSPORT
// Sub-options Selezionare 1..3:
//   1 = Verspätung 60-119 min
//   2 = Verspätung mindestens 120 min
//   3 = Wiederholte Verspätungen / Ausfälle (Zeitkarte)
export const ANTRAGSART_FIELDS: Record<Antragsart, readonly string[]> = {
  ERSTATTUNG_FAHRKARTE: ["Specificare la richiesta/le richieste 1"],
  ENTSCHAEDIGUNG_60_119: [
    "Specificare la richiesta/le richieste 2",
    "Selezionare una delle 3 opzioni 1",
  ],
  ENTSCHAEDIGUNG_120_PLUS: [
    "Specificare la richiesta/le richieste 2",
    "Selezionare una delle 3 opzioni 2",
  ],
  ENTSCHAEDIGUNG_ZEITKARTE: [
    "Specificare la richiesta/le richieste 2",
    "Selezionare una delle 3 opzioni 3",
  ],
  KOSTEN_ALTERNATIVTRANSPORT: ["Specificare la richiesta/le richieste 3"],
};

export const SECTION_5_1 = {
  vorname: "Nome 1",
  familienname: "Nome 2",
} as const;

// 5.2 Anschrift. Indirizzo numbering is non-sequential: "Indirizzo 1"
// doesn't exist; the lines go 6 (Straße) / 2 (Hausnr) / 3 (Land) / 4 (PLZ)
// / 5 (Ort).
export const SECTION_5_2 = {
  strasse: "Indirizzo 6",
  hausnr: "Indirizzo 2",
  land: "Indirizzo 3",
  plz: "Indirizzo 4",
  ort: "Indirizzo 5",
} as const;

export const SECTION_5_3 = {
  email: "Dati di contatto 1",
  telefon: "Dati di contatto 2",
} as const;

// 5.4 Auszahlungsform — radio. We always pick GELD; expose both names so
// callers can tick GUTSCHEIN later if needed.
export const AUSZAHLUNGSFORM_FIELDS = {
  GELD: "Forma di pagamento preferita 1",
  GUTSCHEIN: "Forma di pagamento preferita 2",
} as const;

export const SECTION_5_5 = {
  iban: "Estremi del pagamento 1",
  bic: "Estremi del pagamento 2",
  // Estremi del pagamento 3 = "andere Zahlungsmethoden", always empty.
  kontoinhaber: "Estremi del pagamento 4",
} as const;

export const SECTION_6 = {
  zusaetzliche_angaben: "Informazioni supplementari 1",
  dsgvo_ja: "Regolamento generale sulla protezione dei dati 1",
  dsgvo_nein: "Regolamento generale sulla protezione dei dati 2",
  datum: "Informazioni 1",
  ort: "Informazioni 2",
  antragsteller_name: "Informazioni 3",
} as const;

// ---------------------------------------------------------------------------
// Output shape — what refund-pdf Lambda feeds pdf-lib.
// ---------------------------------------------------------------------------

export interface EuFormFieldValues {
  /** Text fields keyed by their Italian AcroForm name. Empty strings are skipped by the caller. */
  text: Record<string, string>;
  /** Checkbox AcroForm names that should be ticked. Everything not in this list stays unticked. */
  checks: string[];
}

export function getKontoinhaber(user: { vorname: string; nachname: string }): string {
  return `${user.vorname} ${user.nachname}`.trim();
}

// ISO-8601 ("2026-06-21" or full timestamp) → "DD.MM.YYYY". Empty/invalid → "".
function formatDateDe(iso: string | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function joinZugnummerKategorie(
  zugnr: string | undefined,
  kategorie: string | undefined,
): string {
  if (!zugnr && !kategorie) return "";
  if (!kategorie) return zugnr ?? "";
  if (!zugnr) return kategorie;
  const zUp = zugnr.trim().toUpperCase();
  const kUp = kategorie.trim().toUpperCase();
  if (zUp.startsWith(kUp)) return zugnr;
  return `${zugnr} (${kategorie})`;
}

function moneyEur(v: string | undefined): string {
  if (!v) return "";
  return formatEur(v);
}

/**
 * Build the EU-form field-values payload for refund-pdf Lambda.
 *
 * @param input.ticket   Ticket DTO (post-submit, money fields locked).
 * @param input.user     User DTO (vorname, nachname, adresse, contact).
 * @param input.iban     Plaintext IBAN (caller decrypts from mandate).
 * @param input.bic      Plaintext BIC (caller decrypts from mandate).
 *
 * Empty string in `text` means "leave the field blank". `checks` contains
 * the AcroForm names of every checkbox that should be ticked. Both shapes
 * map 1:1 to pdf-lib's `getTextField(name).setText(value)` and
 * `getCheckBox(name).check()`.
 */
export function fillEuFormFields(input: {
  ticket: Ticket;
  user: User;
  iban?: string;
  bic?: string;
}): EuFormFieldValues {
  const { ticket, user, iban, bic } = input;
  const kontoinhaber = getKontoinhaber(user);
  const grund = ticket.antragsgrund ?? [];
  const art = ticket.antragsart;

  const text: Record<string, string> = {};
  const checks: string[] = [];

  // Section 1 — Antragsgrund (multi-select)
  for (const g of grund) checks.push(ANTRAGSGRUND_FIELDS[g]);

  // Section 3.1 — Eisenbahnunternehmen (always hardcoded for v1 — we only
  // accept DB tickets right now)
  text[SECTION_3_1.eisenbahnunternehmen] = "Deutsche Bahn AG";

  // Section 3.2 — Fahrt laut Fahrplan
  text[SECTION_3_2.abreisedatum] = formatDateDe(ticket.fahrt_abreisedatum);
  text[SECTION_3_2.abreisebahnhof] = ticket.fahrt_abreisebahnhof ?? "";
  text[SECTION_3_2.zielbahnhof] = ticket.fahrt_zielbahnhof ?? "";
  text[SECTION_3_2.abfahrtszeit_plan] = ticket.fahrt_abfahrtszeit_plan ?? "";
  text[SECTION_3_2.ankunftszeit_plan] = ticket.fahrt_ankunftszeit_plan ?? "";
  text[SECTION_3_2.zugnummer_kategorie] = joinZugnummerKategorie(
    ticket.fahrt_zugnummer_plan,
    ticket.fahrt_zugkategorie_plan,
  );
  text[SECTION_3_2.fahrkartennummer] = ticket.fahrt_fahrkartennummer ?? "";
  text[SECTION_3_2.fahrkartenpreis] = moneyEur(ticket.fahrt_fahrkartenpreis);

  // Section 3.3 — tatsächliche Fahrt
  text[SECTION_3_3.ankunftsdatum_tatsaechlich] = formatDateDe(
    ticket.tatsaechlich_ankunftsdatum,
  );
  text[SECTION_3_3.abfahrtszeit_tatsaechlich] =
    ticket.tatsaechlich_abfahrtszeit ?? "";
  text[SECTION_3_3.ankunftszeit_tatsaechlich] =
    ticket.tatsaechlich_ankunftszeit ?? "";
  text[SECTION_3_3.zugnummer_kategorie_tatsaechlich] = joinZugnummerKategorie(
    ticket.tatsaechlich_zugnummer,
    // The tatsächliche-fahrt block doesn't carry a separate zugkategorie
    // (per DB_SCHEMA.md). Pass undefined → join falls back to zugnummer.
    undefined,
  );
  text[SECTION_3_3.verpasster_anschluss_bahnhof] =
    ticket.tatsaechlich_verpasster_anschluss_bahnhof ?? "";

  // Section 4 — Antragsart (one or two checkboxes per the parent+sub map)
  if (art) {
    for (const fieldName of ANTRAGSART_FIELDS[art]) checks.push(fieldName);
  }

  // Section 5.1 — Name
  text[SECTION_5_1.vorname] = user.vorname;
  text[SECTION_5_1.familienname] = user.nachname;

  // Section 5.2 — Anschrift (5 fields, non-sequential numbering)
  text[SECTION_5_2.strasse] = user.adresse.strasse;
  text[SECTION_5_2.hausnr] = user.adresse.hausnr;
  text[SECTION_5_2.land] = user.adresse.land;
  text[SECTION_5_2.plz] = user.adresse.plz;
  text[SECTION_5_2.ort] = user.adresse.ort;

  // Section 5.3 — Kontaktdaten
  text[SECTION_5_3.email] = user.email;
  text[SECTION_5_3.telefon] = user.telefon;

  // Section 5.4 — Auszahlungsform: we always pay out as Geld.
  checks.push(AUSZAHLUNGSFORM_FIELDS.GELD);

  // Section 5.5 — IBAN / BIC / Kontoinhaber. IBAN / BIC come decrypted
  // from the caller (mandate.iban_enc / mandate.bic_enc).
  text[SECTION_5_5.iban] = iban ?? "";
  text[SECTION_5_5.bic] = bic ?? "";
  text[SECTION_5_5.kontoinhaber] = kontoinhaber;

  // Section 6 — Sonstiges + DSGVO + Erklärung
  text[SECTION_6.zusaetzliche_angaben] = ticket.zusaetzliche_angaben ?? "";
  if (ticket.datenschutz_einwilligung) checks.push(SECTION_6.dsgvo_ja);
  // dsgvo_nein never ticked; refund flow blocks submit when consent is false.
  text[SECTION_6.datum] = formatDateDe(ticket.antragstellung_datum);
  text[SECTION_6.ort] = ticket.antragstellung_ort ?? "";
  text[SECTION_6.antragsteller_name] = kontoinhaber;

  return { text, checks };
}

// ---------------------------------------------------------------------------
// Field-name catalogue — handy for tests + the refund-pdf Lambda's own
// "every PDF field is either set or deliberately blank" assertion.
// ---------------------------------------------------------------------------

/** All 13 checkbox AcroForm names in the form. */
export const ALL_CHECKBOX_FIELDS: readonly string[] = [
  ANTRAGSGRUND_FIELDS.VERSPAETUNG,
  ANTRAGSGRUND_FIELDS.AUSFALL,
  ANTRAGSGRUND_FIELDS.VERPASSTER_ANSCHLUSS,
  "Specificare la richiesta/le richieste 1",
  "Specificare la richiesta/le richieste 2",
  "Specificare la richiesta/le richieste 3",
  "Selezionare una delle 3 opzioni 1",
  "Selezionare una delle 3 opzioni 2",
  "Selezionare una delle 3 opzioni 3",
  AUSZAHLUNGSFORM_FIELDS.GELD,
  AUSZAHLUNGSFORM_FIELDS.GUTSCHEIN,
  SECTION_6.dsgvo_ja,
  SECTION_6.dsgvo_nein,
];

/** All 34 text AcroForm names in the form. */
export const ALL_TEXT_FIELDS: readonly string[] = [
  RICHIESTA_PRECEDENTE_FIELDS.datum,
  RICHIESTA_PRECEDENTE_FIELDS.empfaenger,
  RICHIESTA_PRECEDENTE_FIELDS.referenz,
  SECTION_3_1.eisenbahnunternehmen,
  SECTION_3_2.abreisedatum,
  SECTION_3_2.abreisebahnhof,
  SECTION_3_2.zielbahnhof,
  SECTION_3_2.abfahrtszeit_plan,
  SECTION_3_2.ankunftszeit_plan,
  SECTION_3_2.zugnummer_kategorie,
  SECTION_3_2.fahrkartennummer,
  SECTION_3_2.fahrkartenpreis,
  SECTION_3_3.ankunftsdatum_tatsaechlich,
  SECTION_3_3.abfahrtszeit_tatsaechlich,
  SECTION_3_3.ankunftszeit_tatsaechlich,
  SECTION_3_3.zugnummer_kategorie_tatsaechlich,
  SECTION_3_3.verpasster_anschluss_bahnhof,
  SECTION_5_1.vorname,
  SECTION_5_1.familienname,
  SECTION_5_2.strasse,
  SECTION_5_2.hausnr,
  SECTION_5_2.land,
  SECTION_5_2.plz,
  SECTION_5_2.ort,
  SECTION_5_3.email,
  SECTION_5_3.telefon,
  SECTION_5_5.iban,
  SECTION_5_5.bic,
  "Estremi del pagamento 3",
  SECTION_5_5.kontoinhaber,
  SECTION_6.zusaetzliche_angaben,
  SECTION_6.datum,
  SECTION_6.ort,
  SECTION_6.antragsteller_name,
];
