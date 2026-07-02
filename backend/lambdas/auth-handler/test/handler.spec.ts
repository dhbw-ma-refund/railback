// Smoke tests for the route dispatcher itself: unknown routes → 404,
// wrong method → 404. The route handlers have their own *.spec.ts files.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";

describe("auth-handler dispatch", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns 404 for an unknown path", async () => {
    const res = await handler({
      version: "2.0",
      headers: {},
      requestContext: { http: { method: "POST", path: "/auth/unknown" } },
      body: "",
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("returns 404 for GET (wrong method)", async () => {
    const res = await handler({
      version: "2.0",
      headers: {},
      requestContext: { http: { method: "GET", path: "/auth/login" } },
    });
    expect(res.statusCode).toBe(404);
  });
});
