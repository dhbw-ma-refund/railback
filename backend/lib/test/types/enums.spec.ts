import { describe, expect, it } from "vitest";
import {
  ANTRAGSARTEN,
  ANTRAGSGRUENDE,
  BELEG_TYPEN,
  EMAIL_STATUSES,
  ERROR_CODES,
  EXTRACTION_METHODS,
  EXTRACTION_STATUSES,
  MANDATE_STATES,
  ROLES,
  SERVICE_FEE_STATES,
  TERMINAL_TICKET_STATES,
  TICKET_STATES,
  USER_STATES,
} from "../../src/types/enums.js";

describe("enums", () => {
  it("ticket states cover lifecycle", () => {
    expect(TICKET_STATES).toContain("VALIDATING");
    expect(TICKET_STATES).toContain("PENDING_DB_PAYMENT");
    expect(TICKET_STATES).toContain("EMAIL_FAILED");
    expect(TICKET_STATES.length).toBe(9);
  });

  it("terminal ticket states subset", () => {
    for (const t of TERMINAL_TICKET_STATES) {
      expect(TICKET_STATES).toContain(t);
    }
    expect(TERMINAL_TICKET_STATES.length).toBe(4);
  });

  it("user states", () => {
    expect(USER_STATES).toEqual(["ACTIVE", "SUSPENDED", "DELETION_SCHEDULED"]);
  });

  it("email statuses include retry-queue values", () => {
    expect(EMAIL_STATUSES).toContain("FAILED_TRANSIENT");
    expect(EMAIL_STATUSES).toContain("DELIVERED");
    expect(EMAIL_STATUSES).toContain("BOUNCED");
  });

  it("extraction method has MANUAL_ROUTE", () => {
    expect(EXTRACTION_METHODS).toContain("MANUAL_ROUTE");
  });

  it("extraction status", () => {
    expect(EXTRACTION_STATUSES).toEqual(["PROCESSING", "DONE", "FAILED"]);
  });

  it("antragsart includes ZEITKARTE + KOSTEN_ALTERNATIVTRANSPORT", () => {
    expect(ANTRAGSARTEN).toContain("ENTSCHAEDIGUNG_ZEITKARTE");
    expect(ANTRAGSARTEN).toContain("KOSTEN_ALTERNATIVTRANSPORT");
  });

  it("antragsgrund", () => {
    expect(ANTRAGSGRUENDE).toEqual(["VERSPAETUNG", "AUSFALL", "VERPASSTER_ANSCHLUSS"]);
  });

  it("mandate states", () => {
    expect(MANDATE_STATES).toContain("ISSUED");
    expect(MANDATE_STATES).toContain("DEBITED");
    expect(MANDATE_STATES).toContain("EXPIRED");
  });

  it("service fee states include WAIVED", () => {
    expect(SERVICE_FEE_STATES).toContain("WAIVED");
  });

  it("beleg typen", () => {
    expect(BELEG_TYPEN).toEqual(["TAXI", "BUS", "HOTEL", "SONSTIGES"]);
  });

  it("roles", () => {
    expect(ROLES).toEqual(["USER", "ADMIN"]);
  });

  it("error codes 10 entries", () => {
    expect(ERROR_CODES.length).toBe(10);
    expect(ERROR_CODES).toContain("ERR_NO_CLAIM");
    expect(ERROR_CODES).toContain("ERR_EMAIL_FAILED");
  });
});
