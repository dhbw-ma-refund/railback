// Smoke tests for the admin-handler route dispatcher.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import { adminAccessToken, makeEvent, seedAdmin } from "./fixtures.js";

describe("admin-handler dispatch", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns 404 for an unknown path", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/unknown", token: adminAccessToken() }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("returns 404 for POST /admin/stats (wrong method)", async () => {
    const res = await handler(
      makeEvent({ method: "POST", path: "/admin/stats", token: adminAccessToken() }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("dispatches GET /admin/stats to the right handler", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/stats", token: adminAccessToken() }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.users).toBeDefined();
    expect(body.tickets).toBeDefined();
    expect(body.refunds).toBeDefined();
  });

  it("dispatches template route GET /admin/users/{email} with path-param extraction", async () => {
    // No seeded user — should 404 from the route, not from the dispatcher.
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/users/missing@example.com",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });
});
