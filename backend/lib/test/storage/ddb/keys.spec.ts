import { describe, expect, it } from "vitest";
import {
  ADMIN_PROFILE_SK,
  BARCODE_GSI2_PK,
  EMAIL_PENDING_GSI_PK,
  TICKET_OWNER_SK,
  USER_PROFILE_SK,
  adminPk,
  barcodeGsi2Sk,
  belegSk,
  emailPendingGsiSk,
  mandateSk,
  normaliseEmail,
  parseTemplateSk,
  parseTicketSk,
  parseUserPk,
  rawSk,
  renderedSk,
  segPk,
  segSk,
  sepaReportPk,
  sepaReportSk,
  stationGsi3Pk,
  stationGsi3Sk,
  templateSk,
  ticketGsi1Sk,
  ticketOwnerPk,
  ticketSk,
  trainGsi1Pk,
  userPk,
} from "../../../src/storage/ddb/keys.js";

describe("key derivation", () => {
  it("normaliseEmail trims + lowercases", () => {
    expect(normaliseEmail("  ANNA@Beispiel.DE ")).toBe("anna@beispiel.de");
  });

  it("userPk auto-normalises", () => {
    expect(userPk("Anna@Beispiel.DE")).toBe("USER#anna@beispiel.de");
  });

  it("USER_PROFILE_SK constant", () => {
    expect(USER_PROFILE_SK).toBe("PROFILE");
  });

  it("adminPk", () => {
    expect(adminPk("X@Y.DE")).toBe("ADMIN#x@y.de");
    expect(ADMIN_PROFILE_SK).toBe("PROFILE");
  });

  it("ticket SK + GSI1", () => {
    expect(ticketSk("01H")).toBe("TICKET#01H");
    expect(trainGsi1Pk("ICE100", "2026-01-01")).toBe("TRAIN#ICE100#2026-01-01");
    expect(ticketGsi1Sk("01H")).toBe("TICKET#01H");
  });

  it("barcode GSI2", () => {
    expect(BARCODE_GSI2_PK).toBe("BARCODE");
    expect(barcodeGsi2Sk("UID-1")).toBe("UID-1");
  });

  it("email-pending GSI", () => {
    expect(EMAIL_PENDING_GSI_PK).toBe("EMAIL_PENDING");
    expect(emailPendingGsiSk("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
  });

  it("blob SKs", () => {
    expect(rawSk("01H")).toBe("RAW#01H");
    expect(renderedSk("01H")).toBe("RENDERED#01H");
    expect(belegSk("01H", "B-1")).toBe("TICKET#01H#BELEG#B-1");
  });

  it("mandate SK", () => {
    expect(mandateSk("01H")).toBe("TICKET#01H#MANDATE");
  });

  it("sepa report keys", () => {
    expect(sepaReportPk("2026-01-01")).toBe("SEPA#REPORT#2026-01-01");
    expect(sepaReportSk("R-1")).toBe("REPORT#R-1");
  });

  it("template SK", () => {
    expect(templateSk("T-1")).toBe("TEMPLATE#T-1");
  });

  it("seg + station GSI3", () => {
    expect(segPk("ICE100", "2026-01-01")).toBe("TRAIN#ICE100#2026-01-01");
    expect(segSk("S-1")).toBe("SEG#S-1");
    expect(stationGsi3Pk(8011160, "2026-01-01")).toBe("STATION#8011160#2026-01-01");
    expect(stationGsi3Sk("08:00", "ICE100")).toBe("08:00#ICE100");
  });

  it("ticket owner", () => {
    expect(ticketOwnerPk("01H")).toBe("TICKET#01H");
    expect(TICKET_OWNER_SK).toBe("OWNER");
  });

  it("parseUserPk happy + sad", () => {
    expect(parseUserPk("USER#a@b.de")).toBe("a@b.de");
    expect(parseUserPk("ADMIN#a@b.de")).toBeNull();
    expect(parseUserPk("USER#")).toBeNull();
  });

  it("parseTicketSk rejects RAW#/RENDERED#/MANDATE/BELEG SKs", () => {
    expect(parseTicketSk("TICKET#01H")).toBe("01H");
    expect(parseTicketSk("RAW#01H")).toBeNull();
    expect(parseTicketSk("RENDERED#01H")).toBeNull();
    expect(parseTicketSk("TICKET#01H#MANDATE")).toBeNull();
    expect(parseTicketSk("TICKET#01H#BELEG#1")).toBeNull();
  });

  it("parseTemplateSk", () => {
    expect(parseTemplateSk("TEMPLATE#T-1")).toBe("T-1");
    expect(parseTemplateSk("TICKET#01H")).toBeNull();
    expect(parseTemplateSk("TEMPLATE#")).toBeNull();
  });
});
