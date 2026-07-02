import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handlePostRouteTemplate } from "../src/routes/post-route-template.js";
import {
  ALICE_EMAIL,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

describe("POST /users/me/route-templates", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("creates a template, resolves EVA numbers, echoes camelCase shape", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const tplId = ulid();
    const res = await handlePostRouteTemplate(
      makeEvent({
        method: "POST",
        path: "/users/me/route-templates",
        token: aliceAccessToken(),
        body: {
          templateId: tplId,
          label: "Pendelfahrt MA→KA",
          fromStation: "Mannheim Hbf",
          toStation: "Karlsruhe Hbf",
          fahrkartennummer: "AB12345678",
          fahrkartenpreis: "29.90",
          zugkategorie_pref: "IC",
        },
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      templateId: tplId,
      label: "Pendelfahrt MA→KA",
      fromStation: "Mannheim Hbf",
      fromEva: 8000244,
      toStation: "Karlsruhe Hbf",
      toEva: 8000191,
      fahrkartennummer: "AB12345678",
      fahrkartenpreis: "29.90",
      zugkategorie_pref: "IC",
    });
    expect(typeof body["created_at"]).toBe("string");
    expect(typeof body["updated_at"]).toBe("string");

    // Persisted via repo round-trip.
    const persisted = await db.routeTemplates.get(ALICE_EMAIL, tplId);
    expect(persisted).not.toBeNull();
    expect(persisted!.from_eva).toBe(8000244);
    expect(persisted!.to_eva).toBe(8000191);
  });

  it("resolver picks the canonical name even on partial input", async () => {
    installTestEnv();
    const res = await handlePostRouteTemplate(
      makeEvent({
        method: "POST",
        path: "/users/me/route-templates",
        token: aliceAccessToken(),
        body: {
          templateId: ulid(),
          label: "Hbf-shortcut",
          fromStation: "mannheim",
          toStation: "karlsruhe",
        },
      }),
    );
    // seedAlice isn't required here — auth middleware only needs the
    // token, not the row (the row is needed for /me reads, not for
    // route-template CRUD which keys on the email alone).
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body["fromStation"]).toBe("Mannheim Hbf");
    expect(body["toStation"]).toBe("Karlsruhe Hbf");
  });

  it("ERR_CONFLICT on duplicate templateId for the same user", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const tplId = ulid();
    await db.routeTemplates.create(ALICE_EMAIL, {
      templateId: tplId,
      label: "existing",
      from_station: "Mannheim Hbf",
      from_eva: 8000244,
      to_station: "Karlsruhe Hbf",
      to_eva: 8000191,
    });

    const res = await handlePostRouteTemplate(
      makeEvent({
        method: "POST",
        path: "/users/me/route-templates",
        token: aliceAccessToken(),
        body: {
          templateId: tplId,
          label: "duplicate",
          fromStation: "Mannheim Hbf",
          toStation: "Karlsruhe Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("ERR_CONFLICT");
  });

  it("ERR_VALIDATION when fromStation is unknown", async () => {
    installTestEnv();
    const res = await handlePostRouteTemplate(
      makeEvent({
        method: "POST",
        path: "/users/me/route-templates",
        token: aliceAccessToken(),
        body: {
          templateId: ulid(),
          label: "x",
          fromStation: "Atlantis Hbf",
          toStation: "Karlsruhe Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_VALIDATION");
    expect(body.error.details).toMatchObject({ field: "fromStation" });
  });

  it("ERR_VALIDATION on body shape (missing label)", async () => {
    installTestEnv();
    const res = await handlePostRouteTemplate(
      makeEvent({
        method: "POST",
        path: "/users/me/route-templates",
        token: aliceAccessToken(),
        body: {
          templateId: ulid(),
          fromStation: "Mannheim Hbf",
          toStation: "Karlsruhe Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    installTestEnv();
    const res = await handlePostRouteTemplate(
      makeEvent({
        method: "POST",
        path: "/users/me/route-templates",
        body: {
          templateId: ulid(),
          label: "x",
          fromStation: "Mannheim Hbf",
          toStation: "Karlsruhe Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(401);
  });
});
