import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { AppError } from "../../src/errors/index.js";
import { extractAuthFromHeaders, requireRole } from "../../src/auth/middleware.js";
import { signAccessToken } from "../../src/auth/jwt.js";

describe("middleware.extractAuthFromHeaders", () => {
  beforeEach(() => {
    vi.stubEnv("RAILBACK_JWT_SECRET", "test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("extracts email + role from a Bearer token (lowercase header)", () => {
    const tok = signAccessToken({ email: "alice@example.com", role: "USER" });
    const out = extractAuthFromHeaders({ authorization: `Bearer ${tok}` });
    expect(out).toEqual({ email: "alice@example.com", role: "USER" });
  });

  it("accepts capitalized Authorization header", () => {
    const tok = signAccessToken({ email: "a@b.de", role: "ADMIN" });
    const out = extractAuthFromHeaders({ Authorization: `Bearer ${tok}` });
    expect(out.role).toBe("ADMIN");
  });

  it("rejects missing header", () => {
    try {
      extractAuthFromHeaders({});
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_AUTH_INVALID");
    }
  });

  it("rejects non-Bearer scheme", () => {
    expect(() => extractAuthFromHeaders({ authorization: "Basic abc" })).toThrow(AppError);
  });

  it("rejects empty bearer", () => {
    expect(() => extractAuthFromHeaders({ authorization: "Bearer " })).toThrow(AppError);
  });

  it("propagates ERR_AUTH_INVALID for tampered token", () => {
    try {
      extractAuthFromHeaders({ authorization: "Bearer not.a.jwt" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_AUTH_INVALID");
    }
  });
});

describe("middleware.requireRole", () => {
  it("passes when roles match", () => {
    expect(() => requireRole({ role: "ADMIN" }, "ADMIN")).not.toThrow();
    expect(() => requireRole({ role: "USER" }, "USER")).not.toThrow();
  });

  it("throws ERR_FORBIDDEN on mismatch", () => {
    try {
      requireRole({ role: "USER" }, "ADMIN");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_FORBIDDEN");
    }
  });
});
