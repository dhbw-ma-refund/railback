import { describe, expect, it } from "vitest";

import {
  isUserTransitionAllowed,
  assertUserTransition,
  isTicketTransitionAllowed,
  assertTicketTransition,
} from "../src/state-machines.js";
import { AppError } from "@railback/lib/errors";

describe("user state machine", () => {
  it("allows the documented transitions", () => {
    expect(isUserTransitionAllowed("ACTIVE", "SUSPENDED")).toBe(true);
    expect(isUserTransitionAllowed("SUSPENDED", "ACTIVE")).toBe(true);
    expect(isUserTransitionAllowed("SUSPENDED", "DELETION_SCHEDULED")).toBe(true);
    expect(isUserTransitionAllowed("ACTIVE", "DELETION_SCHEDULED")).toBe(true);
    expect(isUserTransitionAllowed("DELETION_SCHEDULED", "ACTIVE")).toBe(true);
  });

  it("forbids DELETION_SCHEDULED → SUSPENDED explicitly", () => {
    expect(isUserTransitionAllowed("DELETION_SCHEDULED", "SUSPENDED")).toBe(false);
    expect(() => assertUserTransition("DELETION_SCHEDULED", "SUSPENDED")).toThrow(AppError);
  });

  it("assertUserTransition throws ERR_CONFLICT with details", () => {
    try {
      assertUserTransition("DELETION_SCHEDULED", "SUSPENDED");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.code).toBe("ERR_CONFLICT");
      expect(e.details?.["from"]).toBe("DELETION_SCHEDULED");
      expect(e.details?.["to"]).toBe("SUSPENDED");
    }
  });

  it("permits same-state (no-op) — but the patch handler still rejects pure no-ops", () => {
    expect(isUserTransitionAllowed("ACTIVE", "ACTIVE")).toBe(true);
    expect(isUserTransitionAllowed("SUSPENDED", "SUSPENDED")).toBe(true);
  });
});

describe("ticket state machine", () => {
  it("allows the documented transitions", () => {
    expect(isTicketTransitionAllowed("PENDING_DB_PAYMENT", "APPROVED")).toBe(true);
    expect(isTicketTransitionAllowed("PENDING_DB_PAYMENT", "REJECTED")).toBe(true);
    expect(isTicketTransitionAllowed("APPROVED", "COMPLETED")).toBe(true);
    expect(isTicketTransitionAllowed("APPROVED", "REJECTED")).toBe(true);
  });

  it("allows any non-terminal → INVALID", () => {
    expect(isTicketTransitionAllowed("VALIDATING", "INVALID")).toBe(true);
    expect(isTicketTransitionAllowed("READY", "INVALID")).toBe(true);
    expect(isTicketTransitionAllowed("EMAIL_SENDING", "INVALID")).toBe(true);
    expect(isTicketTransitionAllowed("PENDING_DB_PAYMENT", "INVALID")).toBe(true);
    expect(isTicketTransitionAllowed("APPROVED", "INVALID")).toBe(true);
  });

  it("forbids transitions out of EMAIL_FAILED entirely (system-owned)", () => {
    expect(isTicketTransitionAllowed("EMAIL_FAILED", "APPROVED")).toBe(false);
    expect(() => assertTicketTransition("EMAIL_FAILED", "APPROVED")).toThrow(AppError);
  });

  it("forbids transitions out of COMPLETED / REJECTED (terminal)", () => {
    expect(isTicketTransitionAllowed("COMPLETED", "APPROVED")).toBe(false);
    expect(isTicketTransitionAllowed("REJECTED", "APPROVED")).toBe(false);
  });

  it("forbids re-approving a PENDING ticket as anything else weird", () => {
    expect(isTicketTransitionAllowed("PENDING_DB_PAYMENT", "READY")).toBe(false);
  });

  it("assertTicketTransition throws ERR_CONFLICT with details", () => {
    try {
      assertTicketTransition("COMPLETED", "APPROVED");
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as AppError;
      expect(e.code).toBe("ERR_CONFLICT");
      expect(e.details?.["from"]).toBe("COMPLETED");
      expect(e.details?.["to"]).toBe("APPROVED");
    }
  });
});
