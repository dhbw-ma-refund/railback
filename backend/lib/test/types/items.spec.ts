import { describe, expect, it } from "vitest";
import type {
  AdminProfileItem,
  OriginalReceiptItem,
  RawUploadItem,
  RenderedPdfItem,
  RouteTemplateItem,
  SepaMandateItem,
  SepaReportItem,
  TicketOwnerItem,
  TrainSegmentDelayItem,
  UserProfileItem,
  UserTicketItem,
} from "../../src/types/items.js";

// Compile-time only: the assignments confirm shape; runtime expectation is trivial.
describe("item shapes compile", () => {
  it("UserProfileItem accepts required fields", () => {
    const u: UserProfileItem = {
      PK: "USER#a@b.de",
      SK: "PROFILE",
      GSI1_PK: "USER",
      GSI1_SK: "EMAIL#a@b.de",
      email: "a@b.de",
      vorname: "Anna",
      nachname: "Beispiel",
      telefon: "+491701234567",
      adresse_strasse: "Hauptstr.",
      adresse_hausnr: "1",
      adresse_plz: "10115",
      adresse_ort: "Berlin",
      adresse_land: "DE",
      hashed_password: "x",
      user_state: "ACTIVE",
      created_at: "2026-01-01T00:00:00Z",
      datenschutz_einwilligung: true,
      agb_akzeptiert: true,
    };
    expect(u.email).toBe("a@b.de");
  });

  it("AdminProfileItem", () => {
    const a: AdminProfileItem = {
      PK: "ADMIN#x@b.de",
      SK: "PROFILE",
      GSI1_PK: "ADMIN",
      GSI1_SK: "EMAIL#x@b.de",
      email: "x@b.de",
      hashed_password: "y",
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(a.SK).toBe("PROFILE");
  });

  it("UserTicketItem", () => {
    const t: UserTicketItem = {
      PK: "USER#a@b.de",
      SK: "TICKET#01H",
      ticketId: "01H",
      ticket_state: "VALIDATING",
      state_timeline: [{ state: "VALIDATING", at: "2026-01-01T00:00:00Z" }],
      extraction_status: "PROCESSING",
      extraction_method: "BARCODE",
      extraction_confidence: 1,
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(t.ticket_state).toBe("VALIDATING");
  });

  it("RawUploadItem", () => {
    const r: RawUploadItem = {
      PK: "USER#a@b.de",
      SK: "RAW#01H",
      filename: "ticket.pdf",
      s3_bucket: "rb",
      s3_key: "raw/x",
      content_type: "application/pdf",
      size_bytes: 1234,
      uploaded_at: "2026-01-01T00:00:00Z",
    };
    expect(r.size_bytes).toBe(1234);
  });

  it("RenderedPdfItem", () => {
    const r: RenderedPdfItem = {
      PK: "USER#a@b.de",
      SK: "RENDERED#01H",
      s3_bucket: "rb",
      s3_key: "rendered/x",
      size_bytes: 1,
      rendered_at: "2026-01-01T00:00:00Z",
    };
    expect(r.SK.startsWith("RENDERED#")).toBe(true);
  });

  it("OriginalReceiptItem", () => {
    const o: OriginalReceiptItem = {
      PK: "USER#a@b.de",
      SK: "TICKET#01H#BELEG#001",
      filename: "taxi.pdf",
      s3_bucket: "rb",
      s3_key: "belege/x",
      content_type: "application/pdf",
      size_bytes: 100,
      typ: "TAXI",
      amount: "9.50",
      uploaded_at: "2026-01-01T00:00:00Z",
    };
    expect(o.typ).toBe("TAXI");
  });

  it("SepaMandateItem", () => {
    const m: SepaMandateItem = {
      PK: "USER#a@b.de",
      SK: "TICKET#01H#MANDATE",
      mandate_id: "M-1",
      mandate_state: "ISSUED",
      sequence_type: "OOFF",
      fee_amount: "0.99",
      iban_enc: "...",
      bic_enc: "...",
      kontoinhaber_snapshot: "Anna Beispiel",
      user_consent_at: "2026-01-01T00:00:00Z",
      expires_at: "2029-01-01T00:00:00Z",
      issued_at: "2026-01-01T00:00:00Z",
    };
    expect(m.sequence_type).toBe("OOFF");
  });

  it("SepaReportItem", () => {
    const r: SepaReportItem = {
      PK: "SEPA#REPORT#2026-01-01",
      SK: "REPORT#R-1",
      report_type: "PAIN002",
      s3_bucket: "rb",
      s3_key: "sepa-reports/x",
      sender: "bank",
      ingest_source: "MANUAL_UPLOAD",
      mandates_correlated: ["M-1"],
      parsed_at: "2026-01-01T00:00:00Z",
      received_at: "2026-01-01T00:00:00Z",
    };
    expect(r.ingest_source).toBe("MANUAL_UPLOAD");
  });

  it("RouteTemplateItem", () => {
    const t: RouteTemplateItem = {
      PK: "USER#a@b.de",
      SK: "TEMPLATE#T-1",
      templateId: "T-1",
      label: "Heimweg",
      from_station: "Berlin Hbf",
      from_eva: 8011160,
      to_station: "Hamburg Hbf",
      to_eva: 8002549,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(t.from_eva).toBeGreaterThan(0);
  });

  it("TrainSegmentDelayItem", () => {
    const s: TrainSegmentDelayItem = {
      PK: "TRAIN#ICE100#2026-01-01",
      SK: "SEG#1",
      GSI3_PK: "STATION#8011160#2026-01-01",
      GSI3_SK: "08:00#ICE100",
      delayMinutes: 15,
      reason: "weichenstoerung",
      origin: "Berlin Hbf",
      destination: "Hamburg Hbf",
      origin_eva: 8011160,
      destination_eva: 8002549,
      planned_departure: "08:00",
      planned_arrival: "09:30",
      is_cancelled: false,
      source: "iris",
      last_seen_at: "2026-01-01T00:00:00Z",
    };
    expect(s.delayMinutes).toBe(15);
  });

  it("TicketOwnerItem", () => {
    const o: TicketOwnerItem = {
      PK: "TICKET#01H",
      SK: "OWNER",
      email: "a@b.de",
      ticketId: "01H",
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(o.SK).toBe("OWNER");
  });
});
