import { describe, expect, it } from "vitest";
import type {
  Address,
  AdminTicketQuery,
  NewMandate,
  NewRouteTicket,
  NewTicket,
  NewUser,
  Page,
  PresignedPost,
  ProfilePatch,
  RouteTemplate,
  Ticket,
  TicketOwner,
  User,
} from "../../src/types/dto.js";

describe("dto shapes compile", () => {
  it("User + Address", () => {
    const adr: Address = { strasse: "Hauptstr.", hausnr: "1", plz: "10115", ort: "Berlin", land: "DE" };
    const u: User = {
      email: "a@b.de",
      vorname: "A",
      nachname: "B",
      telefon: "+49",
      adresse: adr,
      user_state: "ACTIVE",
      created_at: "2026-01-01T00:00:00Z",
      datenschutz_einwilligung: true,
      agb_akzeptiert: true,
    };
    expect(u.adresse.land).toBe("DE");
  });

  it("NewUser carries hashed_password but no PK/SK", () => {
    const n: NewUser = {
      email: "a@b.de",
      vorname: "A",
      nachname: "B",
      telefon: "+49",
      adresse: { strasse: "x", hausnr: "1", plz: "00000", ort: "B", land: "DE" },
      hashed_password: "hashed",
      iban_enc: "enc-iban",
      bic_enc: "enc-bic",
      datenschutz_einwilligung: true,
      agb_akzeptiert: true,
    };
    expect(n.hashed_password).toBe("hashed");
  });

  it("ProfilePatch is partial", () => {
    const p: ProfilePatch = { vorname: "X" };
    expect(p.vorname).toBe("X");
  });

  it("Page<T> generic", () => {
    const page: Page<string> = { items: ["a", "b"], nextCursor: "n" };
    expect(page.items.length).toBe(2);
  });

  it("Ticket allows optional belege_count", () => {
    const t: Ticket = {
      email: "a@b.de",
      ticketId: "01H",
      ticket_state: "READY",
      state_timeline: [],
      extraction_status: "DONE",
      extraction_method: "BARCODE",
      extraction_confidence: 1,
      updated_at: "2026-01-01T00:00:00Z",
      belege_count: 2,
    };
    expect(t.belege_count).toBe(2);
  });

  it("NewTicket / NewRouteTicket", () => {
    const a: NewTicket = {
      email: "a@b.de",
      ticketId: "01H",
      filename: "t.pdf",
      s3_key: "raw/x",
      mimeType: "application/pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      uploadedAt: "2026-01-01T00:00:00Z",
    };
    const r: NewRouteTicket = {
      email: "a@b.de",
      ticketId: "02H",
      trainNr: "ICE100",
      date: "2026-01-01",
      fromStation: "Berlin Hbf",
      fromEva: 8011160,
      toStation: "Hamburg Hbf",
      toEva: 8002549,
      abfahrtszeit_plan: "08:00",
      ankunftszeit_plan: "09:30",
      fahrkartennummer: "F-1",
      fahrkartenpreis: "59.90",
      is_zeitkarte: false,
    };
    expect(a.contentType).toBe("application/pdf");
    expect(r.is_zeitkarte).toBe(false);
  });

  it("AdminTicketQuery", () => {
    const q: AdminTicketQuery = { state: "PENDING_DB_PAYMENT", limit: 50 };
    expect(q.limit).toBe(50);
  });

  it("RouteTemplate", () => {
    const r: RouteTemplate = {
      email: "a@b.de",
      templateId: "T-1",
      label: "Heimweg",
      from_station: "Berlin Hbf",
      from_eva: 8011160,
      to_station: "Hamburg Hbf",
      to_eva: 8002549,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(r.label).toBe("Heimweg");
  });

  it("NewMandate", () => {
    const m: NewMandate = {
      ticketId: "01H",
      fee_amount: "0.99",
      iban_enc: "x",
      bic_enc: "y",
      kontoinhaber_snapshot: "A B",
      user_consent_at: "2026-01-01T00:00:00Z",
    };
    expect(m.fee_amount).toBe("0.99");
  });

  it("PresignedPost", () => {
    const p: PresignedPost = {
      url: "https://s3.example",
      fields: { key: "raw/x" },
      key: "raw/x",
      expiresIn: 300,
    };
    expect(p.expiresIn).toBe(300);
  });

  it("TicketOwner", () => {
    const o: TicketOwner = {
      ticketId: "01H",
      email: "a@b.de",
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(o.email).toBe("a@b.de");
  });
});
