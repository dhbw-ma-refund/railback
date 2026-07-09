import { describe, expect, it } from "vitest";
import { AppError, ERROR_STATUS_CODES, toApiResponse } from "../../src/errors/index.js";
import { ERROR_CODES } from "../../src/types/enums.js";

describe("errors", () => {
  it("ERROR_STATUS_CODES covers every code", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS_CODES[code]).toBeDefined();
    }
  });

  it("ERROR_STATUS_CODES specific mappings", () => {
    expect(ERROR_STATUS_CODES.ERR_VALIDATION).toBe(400);
    expect(ERROR_STATUS_CODES.ERR_AUTH_INVALID).toBe(401);
    expect(ERROR_STATUS_CODES.ERR_AUTH_EXPIRED).toBe(401);
    expect(ERROR_STATUS_CODES.ERR_FORBIDDEN).toBe(403);
    expect(ERROR_STATUS_CODES.ERR_NOT_FOUND).toBe(404);
    expect(ERROR_STATUS_CODES.ERR_CONFLICT).toBe(409);
    expect(ERROR_STATUS_CODES.ERR_NO_CLAIM).toBe(422);
    expect(ERROR_STATUS_CODES.ERR_NO_CANDIDATES).toBe(404);
    expect(ERROR_STATUS_CODES.ERR_INTERNAL).toBe(500);
    expect(ERROR_STATUS_CODES.ERR_EMAIL_FAILED).toBe(500);
  });

  it("AppError defaults statusCode from table", () => {
    const e = new AppError("ERR_CONFLICT", "duplicate barcode");
    expect(e.statusCode).toBe(409);
    expect(e.code).toBe("ERR_CONFLICT");
    expect(e.message).toBe("duplicate barcode");
  });

  it("AppError honours explicit statusCode override", () => {
    const e = new AppError("ERR_INTERNAL", "x", 503);
    expect(e.statusCode).toBe(503);
  });

  it("AppError carries details", () => {
    const e = new AppError("ERR_CONFLICT", "x", undefined, { existing_ticket_id: "01H" });
    expect(e.details?.existing_ticket_id).toBe("01H");
  });

  it("toApiResponse on AppError", () => {
    const r = toApiResponse(new AppError("ERR_VALIDATION", "bad", undefined, { field: "iban" }));
    expect(r.statusCode).toBe(400);
    expect(r.body.error.code).toBe("ERR_VALIDATION");
    expect(r.body.error.message).toBe("bad");
    expect(r.body.error.details?.field).toBe("iban");
  });

  it("toApiResponse on plain Error → 500 ERR_INTERNAL", () => {
    const r = toApiResponse(new Error("boom"));
    expect(r.statusCode).toBe(500);
    expect(r.body.error.code).toBe("ERR_INTERNAL");
    expect(r.body.error.message).toBe("boom");
    expect(r.body.error.details).toBeUndefined();
  });

  it("toApiResponse on non-Error value", () => {
    const r = toApiResponse("not an error");
    expect(r.statusCode).toBe(500);
    expect(r.body.error.code).toBe("ERR_INTERNAL");
    expect(r.body.error.message).toBe("Unknown error");
  });

  it("toApiResponse on undefined", () => {
    const r = toApiResponse(undefined);
    expect(r.statusCode).toBe(500);
    expect(r.body.error.code).toBe("ERR_INTERNAL");
  });
});
