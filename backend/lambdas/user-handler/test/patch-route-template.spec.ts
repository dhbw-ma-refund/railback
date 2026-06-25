import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handlePatchRouteTemplate } from "../src/routes/patch-route-template.js";
import {
  ALICE_EMAIL,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";
import type { ApiGwEvent } from "../src/event.js";

function makePatchEvent(opts: {
  templateId: string;
  token?: string;
  body?: unknown;
}): ApiGwEvent {
  const ev = makeEvent({
    method: "PATCH",
    path: `/users/me/route-templates/${opts.templateId}`,
    ...(opts.token !== undefined ? { token: opts.token } : {}),
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  });
  ev.pathParameters = { templateId: opts.templateId };
  return ev;
}

describe("PATCH /users/me/route-templates/{templateId}", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("updates label only and bumps updated_at", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const tplId = ulid();
    const before = await db.routeTemplates.create(ALICE_EMAIL, {
      templateId: tplId,
      label: "old label",
      from_station: "Mannheim Hbf",
      from_eva: 8000244,
      to_station: "Karlsruhe Hbf",
      to_eva: 8000191,
    });

    // ensure a different ISO instant so updated_at strictly changes
    await new Promise((r) => setTimeout(r, 5));

    const res = await handlePatchRouteTemplate(
      makePatchEvent({
        templateId: tplId,
        token: aliceAccessToken(),
        body: { label: "new label" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body["label"]).toBe("new label");
    expect(body["fromEva"]).toBe(8000244);
    expect(body["toEva"]).toBe(8000191);
    expect(typeof body["updated_at"]).toBe("string");
    expect(body["updated_at"]).not.toBe(before.updated_at);
    // created_at preserved.
    expect(body["created_at"]).toBe(before.created_at);
  });

  it("re-resolves EVA when fromStation changes", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const tplId = ulid();
    await db.routeTemplates.create(ALICE_EMAIL, {
      templateId: tplId,
      label: "x",
      from_station: "Mannheim Hbf",
      from_eva: 8000244,
      to_station: "Karlsruhe Hbf",
      to_eva: 8000191,
    });

    const res = await handlePatchRouteTemplate(
      makePatchEvent({
        templateId: tplId,
        token: aliceAccessToken(),
        body: { fromStation: "Frankfurt (Main) Hbf" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body["fromStation"]).toBe("Frankfurt (Main) Hbf");
    expect(body["fromEva"]).toBe(8000105);
    // to-side unchanged.
    expect(body["toEva"]).toBe(8000191);
  });

  it("ERR_NOT_FOUND for an unknown templateId", async () => {
    installTestEnv();
    const res = await handlePatchRouteTemplate(
      makePatchEvent({
        templateId: ulid(),
        token: aliceAccessToken(),
        body: { label: "x" },
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("ERR_VALIDATION on empty body (refine: at least one field)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const tplId = ulid();
    await db.routeTemplates.create(ALICE_EMAIL, {
      templateId: tplId,
      label: "x",
      from_station: "Mannheim Hbf",
      from_eva: 8000244,
      to_station: "Karlsruhe Hbf",
      to_eva: 8000191,
    });
    const res = await handlePatchRouteTemplate(
      makePatchEvent({
        templateId: tplId,
        token: aliceAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_VALIDATION when fromStation is unknown", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const tplId = ulid();
    await db.routeTemplates.create(ALICE_EMAIL, {
      templateId: tplId,
      label: "x",
      from_station: "Mannheim Hbf",
      from_eva: 8000244,
      to_station: "Karlsruhe Hbf",
      to_eva: 8000191,
    });
    const res = await handlePatchRouteTemplate(
      makePatchEvent({
        templateId: tplId,
        token: aliceAccessToken(),
        body: { fromStation: "Atlantis Hbf" },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.details).toMatchObject({
      field: "fromStation",
    });
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    installTestEnv();
    const res = await handlePatchRouteTemplate(
      makePatchEvent({
        templateId: ulid(),
        body: { label: "x" },
      }),
    );
    expect(res.statusCode).toBe(401);
  });
});
