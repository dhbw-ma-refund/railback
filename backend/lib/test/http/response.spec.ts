import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/index.js";
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  noContentResponse,
} from "../../src/http/response.js";

describe("http response helpers", () => {
  it("corsHeaders has the three required directives", () => {
    expect(corsHeaders["access-control-allow-origin"]).toBe("*");
    expect(corsHeaders["access-control-allow-headers"]).toContain("authorization");
    expect(corsHeaders["access-control-allow-methods"]).toContain("PATCH");
  });

  it("jsonResponse stringifies + includes content-type", () => {
    const r = jsonResponse(200, { ok: true });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/json");
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    expect(JSON.parse(r.body)).toEqual({ ok: true });
  });

  it("noContentResponse is 204 with empty body", () => {
    const r = noContentResponse();
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe("");
    expect(r.headers["access-control-allow-origin"]).toBe("*");
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
