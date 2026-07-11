import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/index.js";
import {
  errorResponse,
  jsonResponse,
  noContentResponse,
} from "../../src/http/response.js";

describe("http response helpers", () => {
  it("response helpers do NOT set CORS headers (Function URL native CORS owns them)", () => {
    // Setting access-control-allow-origin here would duplicate the platform's
    // header on the Function URL and get rejected by browsers. See response.ts.
    expect(jsonResponse(200, {}).headers["access-control-allow-origin"]).toBeUndefined();
    expect(noContentResponse().headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("jsonResponse stringifies + includes content-type", () => {
    const r = jsonResponse(200, { ok: true });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(r.body)).toEqual({ ok: true });
  });

  it("noContentResponse is 204 with empty body", () => {
    const r = noContentResponse();
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe("");
  });

  it("errorResponse round-trips an AppError", () => {
    const r = errorResponse(new AppError("ERR_NOT_FOUND", "missing"));
    expect(r.statusCode).toBe(404);
    const parsed = JSON.parse(r.body);
    expect(parsed.error.code).toBe("ERR_NOT_FOUND");
    expect(parsed.error.message).toBe("missing");
  });

  it("errorResponse on unknown value", () => {
    const r = errorResponse(42);
    expect(r.statusCode).toBe(500);
    const parsed = JSON.parse(r.body);
    expect(parsed.error.code).toBe("ERR_INTERNAL");
  });
});
