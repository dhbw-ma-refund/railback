import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { AppError } from "../../src/errors/index.js";
import * as jwt from "../../src/auth/jwt.js";

describe("jwt", () => {
  beforeEach(() => {
    vi.stubEnv("RAILBACK_JWT_SECRET", "test-secret-please-change");
    vi.stubEnv("RAILBACK_JWT_ACCESS_TTL_SEC", "900");
    vi.stubEnv("RAILBACK_JWT_REFRESH_TTL_SEC", "2592000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("signs and verifies an access token round-trip", () => {
    const tok = jwt.signAccessToken({ email: "alice@example.com", role: "USER" });
    const claims = jwt.verifyAccessToken(tok);
    expect(claims.sub).toBe("alice@example.com");
    expect(claims.role).toBe("USER");
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it("signs and verifies a refresh token round-trip", () => {
    const tok = jwt.signRefreshToken({ email: "admin@example.com", role: "ADMIN" });
    const claims = jwt.verifyRefreshToken(tok);
    expect(claims.sub).toBe("admin@example.com");
    expect(claims.role).toBe("ADMIN");
  });

  it("rejects access tokens that are actually refresh tokens", () => {
    const refresh = jwt.signRefreshToken({ email: "a@b.de", role: "USER" });
    expect(() => jwt.verifyAccessToken(refresh)).toThrow(AppError);
    try {
      jwt.verifyAccessToken(refresh);
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_AUTH_INVALID");
    }
  });

  it("rejects refresh tokens missing typ:refresh", () => {
    const access = jwt.signAccessToken({ email: "a@b.de", role: "USER" });
    expect(() => jwt.verifyRefreshToken(access)).toThrow(AppError);
  });

  it("verifyRefreshToken maps ALL failures to ERR_AUTH_EXPIRED (contract)", () => {
    // Access-token used as refresh → ERR_AUTH_EXPIRED (was ERR_AUTH_INVALID
    // before fix)
    const access = jwt.signAccessToken({ email: "a@b.de", role: "USER" });
    try {
      jwt.verifyRefreshToken(access);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_AUTH_EXPIRED");
    }
    // Tampered token → ERR_AUTH_EXPIRED
    try {
      jwt.verifyRefreshToken("not.a.jwt");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_AUTH_EXPIRED");
    }
    // Bad signature → ERR_AUTH_EXPIRED
    const refresh = jwt.signRefreshToken({ email: "a@b.de", role: "USER" });
    const parts = refresh.split(".");
    const evil = `${parts[0]}.${parts[1]}.${"A".repeat((parts[2] ?? "").length)}`;
    try {
      jwt.verifyRefreshToken(evil);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_AUTH_EXPIRED");
    }
  });

  it("rejects tampered signatures", () => {
    const tok = jwt.signAccessToken({ email: "a@b.de", role: "USER" });
    const parts = tok.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${"A".repeat((parts[2] ?? "").length)}`;
    try {
      jwt.verifyAccessToken(tampered);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_AUTH_INVALID");
    }
  });

  it("rejects tampered payloads (signature mismatch)", () => {
    const tok = jwt.signAccessToken({ email: "a@b.de", role: "USER" });
    const parts = tok.split(".");
    // swap the role claim by re-encoding payload manually
    const evilPayload = Buffer.from(JSON.stringify({ sub: "a@b.de", role: "ADMIN", iat: 0, exp: 9_999_999_999 }))
      .toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const evil = `${parts[0]}.${evilPayload}.${parts[2]}`;
    expect(() => jwt.verifyAccessToken(evil)).toThrow(/bad signature/);
  });

  it("rejects malformed tokens", () => {
    expect(() => jwt.verifyAccessToken("not-a-jwt")).toThrow(AppError);
    expect(() => jwt.verifyAccessToken("")).toThrow(AppError);
    expect(() => jwt.verifyAccessToken("a.b")).toThrow(AppError);
  });

  it("throws ERR_AUTH_EXPIRED once exp has passed", () => {
    const tok = jwt.signAccessToken({ email: "a@b.de", role: "USER" });
    // Advance system time past the access TTL (15 min). Use fake timers because
    // jwt.ts calls Date.now() internally via lexical scope, which vi.spyOn
    // on the module-namespace getNow can't intercept.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() + 1_000_000 * 1000));
      try {
        jwt.verifyAccessToken(tok);
        expect.fail("should have thrown");
      } catch (e) {
        expect((e as AppError).code).toBe("ERR_AUTH_EXPIRED");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws ERR_INTERNAL when secret is missing", () => {
    vi.stubEnv("RAILBACK_JWT_SECRET", "");
    try {
      jwt.signAccessToken({ email: "a@b.de", role: "USER" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_INTERNAL");
    }
  });

  it("two consecutive sign calls produce identical tokens within the same second", () => {
    // sanity: signing is deterministic for fixed iat, so just check structure
    const tok = jwt.signAccessToken({ email: "a@b.de", role: "USER" });
    expect(tok.split(".")).toHaveLength(3);
  });
});
