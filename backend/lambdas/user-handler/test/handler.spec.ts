// Smoke tests for the route dispatcher: unknown path → 404, wrong method → 404.
// Per-route behaviour lives in the *.spec.ts beside this file.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import { aliceAccessToken, makeEvent, seedAlice } from "./fixtures.js";

describe("user-handler dispatch", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns 404 for an unknown path", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: "/users/me/unknown", token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("returns 404 for POST /users/me (wrong method)", async () => {
    const res = await handler(
      makeEvent({ method: "POST", path: "/users/me", token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for GET /users/me/bank (wrong method on bank route)", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: "/users/me/bank", token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("dispatches GET /users/me to the right handler", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await handler(
      makeEvent({ method: "GET", path: "/users/me", token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).email).toBe("alice@example.com");
  });
});
