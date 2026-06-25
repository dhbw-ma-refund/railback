import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handleGetRouteTemplates } from "../src/routes/get-route-templates.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

describe("GET /users/me/route-templates", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns an empty list for a fresh user", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handleGetRouteTemplates(
      makeEvent({
        method: "GET",
        path: "/users/me/route-templates",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ templates: [] });
  });

  it("returns existing templates mapped to camelCase wire shape", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const tplId = ulid();
    await db.routeTemplates.create(ALICE_EMAIL, {
      templateId: tplId,
      label: "Pendelfahrt MA→KA",
      from_station: "Mannheim Hbf",
      from_eva: 8000244,
      to_station: "Karlsruhe Hbf",
      to_eva: 8000191,
      fahrkartennummer: "AB12345678",
      fahrkartenpreis: "29.90",
    });

    const res = await handleGetRouteTemplates(
      makeEvent({
        method: "GET",
        path: "/users/me/route-templates",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      templates: Array<Record<string, unknown>>;
    };
    expect(body.templates).toHaveLength(1);
    const t = body.templates[0]!;
    expect(t).toMatchObject({
      templateId: tplId,
      label: "Pendelfahrt MA→KA",
      fromStation: "Mannheim Hbf",
      fromEva: 8000244,
      toStation: "Karlsruhe Hbf",
      toEva: 8000191,
      fahrkartennummer: "AB12345678",
      fahrkartenpreis: "29.90",
    });
    // snake_case route fields must NOT leak through.
    expect(t).not.toHaveProperty("from_station");
    expect(t).not.toHaveProperty("to_eva");
  });

  it("is per-user: bob's templates don't show up in alice's list", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await db.routeTemplates.create("bob@example.com", {
      templateId: ulid(),
      label: "Bob's route",
      from_station: "Berlin Hauptbahnhof",
      from_eva: 8011160,
      to_station: "Hamburg Hbf",
      to_eva: 8002549,
    });

    const res = await handleGetRouteTemplates(
      makeEvent({
        method: "GET",
        path: "/users/me/route-templates",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ templates: [] });
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    installTestEnv();
    const res = await handleGetRouteTemplates(
      makeEvent({ method: "GET", path: "/users/me/route-templates" }),
    );
    expect(res.statusCode).toBe(401);
  });

  it("ERR_FORBIDDEN for an ADMIN token", async () => {
    installTestEnv();
    const res = await handleGetRouteTemplates(
      makeEvent({
        method: "GET",
        path: "/users/me/route-templates",
        token: adminAccessToken("admin@example.com"),
      }),
    );
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("ERR_FORBIDDEN");
  });
});
