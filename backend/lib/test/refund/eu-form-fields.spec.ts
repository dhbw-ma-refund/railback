import { describe, expect, it } from "vitest";
import type { Ticket, User } from "../../src/types/dto.js";
import {
  ALL_CHECKBOX_FIELDS,
  ALL_TEXT_FIELDS,
  ANTRAGSART_FIELDS,
  ANTRAGSGRUND_FIELDS,
  AUSZAHLUNGSFORM_FIELDS,
  SECTION_3_1,
  SECTION_3_2,
  SECTION_3_3,
  SECTION_5_1,
  SECTION_5_2,
  SECTION_5_3,
  SECTION_5_5,
  SECTION_6,
  fillEuFormFields,
  getKontoinhaber,
} from "../../src/refund/eu-form-fields.js";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    email: "alice@example.com",
    vorname: "Alice",
    nachname: "Müller",
    telefon: "+49 170 1234567",
    adresse: {
      strasse: "Bahnhofstraße",
      hausnr: "12a",
      plz: "10115",
      ort: "Berlin",
      land: "DE",
    },
    user_state: "ACTIVE",
    created_at: "2026-01-01T00:00:00Z",
    datenschutz_einwilligung: true,
    agb_akzeptiert: true,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    email: "alice@example.com",
    ticketId: "01JABCDXYZ",
    ticket_state: "READY",
    state_timeline: [],
    extraction_status: "DONE",
    extraction_method: "BARCODE",
    extraction_confidence: 1.0,
    updated_at: "2026-06-20T10:00:00Z",
    ...overrides,
  };
}

describe("AcroForm name catalogue", () => {
  it("knows 13 checkbox fields total (3 grund + 6 antragsart + 2 auszahlungsform + 2 dsgvo)", () => {
    expect(ALL_CHECKBOX_FIELDS).toHaveLength(13);
    // Italian-language names; the parent+sub Antragsart structure produces 6
    expect(ALL_CHECKBOX_FIELDS).toContain("Specificare la richiesta/le richieste 1");
    expect(ALL_CHECKBOX_FIELDS).toContain("Specificare la richiesta/le richieste 2");
    expect(ALL_CHECKBOX_FIELDS).toContain("Specificare la richiesta/le richieste 3");
    expect(ALL_CHECKBOX_FIELDS).toContain("Selezionare una delle 3 opzioni 1");
    expect(ALL_CHECKBOX_FIELDS).toContain("Selezionare una delle 3 opzioni 2");
    expect(ALL_CHECKBOX_FIELDS).toContain("Selezionare una delle 3 opzioni 3");
  });

  it("knows 34 text fields total", () => {
    expect(ALL_TEXT_FIELDS).toHaveLength(34);
  });

  it("preserves the source-PDF typo 'Scheduled journey 5' verbatim", () => {
    expect(SECTION_3_2.ankunftszeit_plan).toBe("Scheduled journey 5");
  });

  it("uses the non-sequential Indirizzo numbering (6=Straße, no 1)", () => {
    expect(SECTION_5_2.strasse).toBe("Indirizzo 6");
    expect(SECTION_5_2.hausnr).toBe("Indirizzo 2");
    expect(ALL_TEXT_FIELDS).not.toContain("Indirizzo 1");
  });

  it("Section 4 parent+sub map: ENTSCHAEDIGUNG_60_119 ticks 2 boxes", () => {
    expect(ANTRAGSART_FIELDS.ENTSCHAEDIGUNG_60_119).toEqual([
      "Specificare la richiesta/le richieste 2",
      "Selezionare una delle 3 opzioni 1",
    ]);
    expect(ANTRAGSART_FIELDS.ERSTATTUNG_FAHRKARTE).toEqual([
      "Specificare la richiesta/le richieste 1",
    ]);
    expect(ANTRAGSART_FIELDS.KOSTEN_ALTERNATIVTRANSPORT).toEqual([
      "Specificare la richiesta/le richieste 3",
    ]);
  });
});

describe("getKontoinhaber", () => {
  it("joins vorname + nachname with single space and trims", () => {
    expect(getKontoinhaber({ vorname: "Alice", nachname: "Müller" })).toBe("Alice Müller");
    expect(getKontoinhaber({ vorname: "  Bob ", nachname: " Schmidt" })).toBe(
      "Bob   Schmidt".trim(),
    );
  });
});

describe("fillEuFormFields — fully-filled ticket", () => {
  const user = makeUser();
  const ticket = makeTicket({
    antragsgrund: ["VERSPAETUNG"],
    antragsart: "ENTSCHAEDIGUNG_120_PLUS",
    fahrt_abreisedatum: "2026-06-15",
    fahrt_abreisebahnhof: "Berlin Hauptbahnhof",
    fahrt_zielbahnhof: "München Hbf",
    fahrt_abfahrtszeit_plan: "08:30",
    fahrt_ankunftszeit_plan: "12:45",
    fahrt_zugnummer_plan: "ICE 599",
    fahrt_zugkategorie_plan: "ICE",
    fahrt_fahrkartennummer: "1234567890",
    fahrt_fahrkartenpreis: "120.00",
    tatsaechlich_ankunftsdatum: "2026-06-15",
    tatsaechlich_abfahrtszeit: "08:35",
    tatsaechlich_ankunftszeit: "15:10",
    tatsaechlich_zugnummer: "ICE 599",
    zusaetzliche_angaben: "Bauarbeiten auf der Strecke",
    datenschutz_einwilligung: true,
    wahrheitserklaerung: true,
    antragstellung_ort: "Berlin",
    antragstellung_datum: "2026-06-20",
    erwartete_erstattung: "60.00",
    service_fee_betrag: "0.75",
  });

  const { text, checks } = fillEuFormFields({
    ticket,
    user,
    iban: "DE89370400440532013000",
    bic: "COBADEFFXXX",
  });

  it("ticks the right checkboxes (Grund + Antragsart parent+sub + Geld + DSGVO)", () => {
    expect(checks).toContain(ANTRAGSGRUND_FIELDS.VERSPAETUNG);
    expect(checks).not.toContain(ANTRAGSGRUND_FIELDS.AUSFALL);
    expect(checks).not.toContain(ANTRAGSGRUND_FIELDS.VERPASSTER_ANSCHLUSS);

    // Parent + sub for ENTSCHAEDIGUNG_120_PLUS
    expect(checks).toContain("Specificare la richiesta/le richieste 2");
    expect(checks).toContain("Selezionare una delle 3 opzioni 2");
    expect(checks).not.toContain("Specificare la richiesta/le richieste 1");
    expect(checks).not.toContain("Specificare la richiesta/le richieste 3");

    expect(checks).toContain(AUSZAHLUNGSFORM_FIELDS.GELD);
    expect(checks).not.toContain(AUSZAHLUNGSFORM_FIELDS.GUTSCHEIN);

    expect(checks).toContain(SECTION_6.dsgvo_ja);
    expect(checks).not.toContain(SECTION_6.dsgvo_nein);
  });

  it("fills Section 3.1 (always Deutsche Bahn AG in v1)", () => {
    expect(text[SECTION_3_1.eisenbahnunternehmen]).toBe("Deutsche Bahn AG");
  });

  it("fills Section 3.2 Viaggio previsto", () => {
    expect(text[SECTION_3_2.abreisedatum]).toBe("15.06.2026");
    expect(text[SECTION_3_2.abreisebahnhof]).toBe("Berlin Hauptbahnhof");
    expect(text[SECTION_3_2.zielbahnhof]).toBe("München Hbf");
    expect(text[SECTION_3_2.abfahrtszeit_plan]).toBe("08:30");
    expect(text[SECTION_3_2.ankunftszeit_plan]).toBe("12:45"); // Scheduled journey 5
    expect(text[SECTION_3_2.fahrkartennummer]).toBe("1234567890");
    expect(text[SECTION_3_2.fahrkartenpreis]).toBe("120,00 EUR");
  });

  it("joins Zugnummer + Zugkategorie correctly", () => {
    // "ICE 599" already starts with "ICE" — don't duplicate
    expect(text[SECTION_3_2.zugnummer_kategorie]).toBe("ICE 599");
  });

  it("fills Section 3.3 Viaggio effettivo", () => {
    expect(text[SECTION_3_3.ankunftsdatum_tatsaechlich]).toBe("15.06.2026");
    expect(text[SECTION_3_3.abfahrtszeit_tatsaechlich]).toBe("08:35");
    expect(text[SECTION_3_3.ankunftszeit_tatsaechlich]).toBe("15:10");
    expect(text[SECTION_3_3.zugnummer_kategorie_tatsaechlich]).toBe("ICE 599");
  });

  it("fills Section 5 (Name, Anschrift, Kontakt, Zahlung)", () => {
    expect(text[SECTION_5_1.vorname]).toBe("Alice");
    expect(text[SECTION_5_1.familienname]).toBe("Müller");
    expect(text[SECTION_5_2.strasse]).toBe("Bahnhofstraße");
    expect(text[SECTION_5_2.hausnr]).toBe("12a");
    expect(text[SECTION_5_2.plz]).toBe("10115");
    expect(text[SECTION_5_2.ort]).toBe("Berlin");
    expect(text[SECTION_5_2.land]).toBe("DE");
    expect(text[SECTION_5_3.email]).toBe("alice@example.com");
    expect(text[SECTION_5_3.telefon]).toBe("+49 170 1234567");
    expect(text[SECTION_5_5.iban]).toBe("DE89370400440532013000");
    expect(text[SECTION_5_5.bic]).toBe("COBADEFFXXX");
    expect(text[SECTION_5_5.kontoinhaber]).toBe("Alice Müller");
  });

  it("fills Section 6 (Sonstiges + Antragstellung)", () => {
    expect(text[SECTION_6.zusaetzliche_angaben]).toBe("Bauarbeiten auf der Strecke");
    expect(text[SECTION_6.datum]).toBe("20.06.2026");
    expect(text[SECTION_6.ort]).toBe("Berlin");
    expect(text[SECTION_6.antragsteller_name]).toBe("Alice Müller");
  });
});

describe("fillEuFormFields — empty / minimal ticket", () => {
  it("returns empty strings for unset text fields and no checks for missing flags", () => {
    const ticket = makeTicket();
    const user = makeUser();
    const { text, checks } = fillEuFormFields({ ticket, user });

    // No grund/antragsart → only the always-on checkboxes remain
    expect(checks).not.toContain(ANTRAGSGRUND_FIELDS.VERSPAETUNG);
    expect(checks).not.toContain("Specificare la richiesta/le richieste 1");
    expect(checks).not.toContain("Specificare la richiesta/le richieste 2");
    expect(checks).not.toContain("Specificare la richiesta/le richieste 3");
    expect(checks).not.toContain(SECTION_6.dsgvo_ja);
    // Auszahlungsform = Geld is always ticked
    expect(checks).toContain(AUSZAHLUNGSFORM_FIELDS.GELD);

    expect(text[SECTION_3_2.abreisedatum]).toBe("");
    expect(text[SECTION_3_2.abreisebahnhof]).toBe("");
    expect(text[SECTION_3_2.fahrkartenpreis]).toBe("");
    expect(text[SECTION_5_5.iban]).toBe("");
    expect(text[SECTION_5_5.bic]).toBe("");
    expect(text[SECTION_6.zusaetzliche_angaben]).toBe("");

    // User PII still fills (it comes from the User record, not the ticket)
    expect(text[SECTION_5_1.vorname]).toBe("Alice");
    expect(text[SECTION_5_5.kontoinhaber]).toBe("Alice Müller");
  });
});

describe("fillEuFormFields — multi-grund + AUSFALL", () => {
  it("ticks every grund and uses ERSTATTUNG_FAHRKARTE (single-box) variant", () => {
    const ticket = makeTicket({
      antragsgrund: ["VERSPAETUNG", "AUSFALL"],
      antragsart: "ERSTATTUNG_FAHRKARTE",
    });
    const user = makeUser();
    const { checks } = fillEuFormFields({ ticket, user });

    expect(checks).toContain(ANTRAGSGRUND_FIELDS.VERSPAETUNG);
    expect(checks).toContain(ANTRAGSGRUND_FIELDS.AUSFALL);
    expect(checks).toContain("Specificare la richiesta/le richieste 1");
    // Single-box variant: no Selezionare sub-box
    expect(checks).not.toContain("Selezionare una delle 3 opzioni 1");
    expect(checks).not.toContain("Selezionare una delle 3 opzioni 2");
    expect(checks).not.toContain("Selezionare una delle 3 opzioni 3");
  });
});
