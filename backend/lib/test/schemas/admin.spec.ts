import { describe, expect, it } from "vitest";
import {
  listTicketsQuerySchema,
  patchAdminTicketRequestSchema,
  patchAdminUserRequestSchema,
} from "../../src/schemas/admin.js";

describe("patchAdminUserRequestSchema", () => {
  it("accepts SUSPENDED with non-empty suspended_reason", () => {
    const out = patchAdminUserRequestSchema.parse({
      user_state: "SUSPENDED",
      suspended_reason: "abuse",
    });
    expect(out.user_state).toBe("SUSPENDED");
  });

  it("accepts SUSPENDED without suspended_reason (route enforces transition-time rule)", () => {
    // The "ACTIVE→SUSPENDED requires a non-empty reason" rule lives in
    // the route because it depends on the current user_state, which the
    // schema can't see. SUSPENDED→SUSPENDED no-ops legitimately omit it.
    expect(
      patchAdminUserRequestSchema.safeParse({ user_state: "SUSPENDED" }).success,
    ).toBe(true);
  });

  it("rejects SUSPENDED with whitespace-only reason (schema-level min length)", () => {
    expect(
      patchAdminUserRequestSchema.safeParse({
        user_state: "SUSPENDED",
        suspended_reason: "",
      }).success,
    ).toBe(false);
  });

  it("rejects empty patch", () => {
    expect(patchAdminUserRequestSchema.safeParse({}).success).toBe(false);
  });

  it("allows ACTIVE without reason", () => {
    expect(
      patchAdminUserRequestSchema.parse({ user_state: "ACTIVE" }).user_state,
    ).toBe("ACTIVE");
  });
});

describe("patchAdminTicketRequestSchema", () => {
  it("accepts APPROVED + db_paid_at", () => {
    const out = patchAdminTicketRequestSchema.parse({
      ticket_state: "APPROVED",
      db_paid_at: "2026-06-20T12:00:00Z",
    });
    expect(out.ticket_state).toBe("APPROVED");
  });

  it("rejects ticket_state VALIDATING", () => {
    expect(
      patchAdminTicketRequestSchema.safeParse({ ticket_state: "VALIDATING" })
        .success,
    ).toBe(false);
  });

  it("rejects empty patch", () => {
    expect(patchAdminTicketRequestSchema.safeParse({}).success).toBe(false);
  });

  it("allows db_paid_at alone", () => {
    expect(
      patchAdminTicketRequestSchema.parse({ db_paid_at: "2026-06-20T12:00:00Z" })
        .db_paid_at,
    ).toBe("2026-06-20T12:00:00Z");
  });
});

describe("listTicketsQuerySchema", () => {
  it("coerces limit from string and applies default", () => {
    const out = listTicketsQuerySchema.parse({ limit: "50" });
    expect(out.limit).toBe(50);

    const def = listTicketsQuerySchema.parse({});
    expect(def.limit).toBe(25);
  });

  it("lowercases email when provided", () => {
    const out = listTicketsQuerySchema.parse({ email: "FOO@BAR.DE" });
    expect(out.email).toBe("foo@bar.de");
  });

  it("rejects out-of-range limit", () => {
    expect(listTicketsQuerySchema.safeParse({ limit: "500" }).success).toBe(
      false,
    );
  });
});
