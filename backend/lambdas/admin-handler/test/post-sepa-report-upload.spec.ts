import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAdmin,
} from "./fixtures.js";

describe("POST /admin/sepa/reports/upload", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("issues a presigned POST for the sepa-reports prefix", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/reports/upload",
        token: adminAccessToken(),
        body: {
          filename: "pain002-2026-06-25.xml",
          content_type: "application/xml",
          size_bytes: 4831,
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toMatch(/^https?:\/\//);
    expect(typeof body.fields).toBe("object");
    expect(body.fields.key).toMatch(/^sepa-reports\/\d{4}-\d{2}-\d{2}\/[0-9A-HJKMNP-TV-Z]{26}\.xml$/);
    expect(body.expires_in).toBe(300);
  });

  it("ERR_VALIDATION when size_bytes exceeds 5 MB", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/reports/upload",
        token: adminAccessToken(),
        body: {
          filename: "huge.xml",
          content_type: "application/xml",
          size_bytes: 10 * 1024 * 1024,
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_VALIDATION with empty body", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/reports/upload",
        token: adminAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/reports/upload",
        token: aliceAccessToken(),
        body: { filename: "x.xml", content_type: "application/xml", size_bytes: 1 },
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/reports/upload",
        body: { filename: "x.xml", content_type: "application/xml", size_bytes: 1 },
      }),
    );
    expect(res.statusCode).toBe(401);
  });

  // Regression: only XML content types are accepted — anything else
  // would let an admin upload arbitrary bytes to the sepa-reports prefix
  // (HTML/JS/EXE), bypassing the parser-level guard downstream.
  it("rejects non-XML content_type with ERR_VALIDATION", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/reports/upload",
        token: adminAccessToken(),
        body: {
          filename: "evil.html",
          content_type: "text/html",
          size_bytes: 1024,
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("accepts text/xml as a second valid content type", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/reports/upload",
        token: adminAccessToken(),
        body: {
          filename: "camt054.xml",
          content_type: "text/xml",
          size_bytes: 512,
        },
      }),
    );
    expect(res.statusCode).toBe(200);
  });
});
