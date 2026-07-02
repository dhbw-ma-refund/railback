import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handleDeleteRouteTemplate } from "../src/routes/delete-route-template.js";
import {
  ALICE_EMAIL,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";
import type { ApiGwEvent } from "../src/event.js";

function makeDeleteEvent(opts: {
  templateId: string;
  token?: string;
}): ApiGwEvent {
  const ev = makeEvent({
    method: "DELETE",
    path: `/users/me/route-templates/${opts.templateId}`,
    ...(opts.token !== undefined ? { token: opts.token } : {}),
  });
  ev.pathParameters = { templateId: opts.templateId };
  return ev;
}

describe("DELETE /users/me/route-templates/{templateId}", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("deletes an existing template and returns 204", async () => {
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

    const res = await handleDeleteRouteTemplate(
      makeDeleteEvent({ templateId: tplId, token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");

    // Row really gone.
    const after = await db.routeTemplates.get(ALICE_EMAIL, tplId);
    expect(after).toBeNull();
  });

  it("ERR_NOT_FOUND when the template doesn't exist", async () => {
    installTestEnv();
    const res = await handleDeleteRouteTemplate(
      makeDeleteEvent({ templateId: ulid(), token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("is per-user: bob can't delete alice's template", async () => {
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
    // No row in bob's namespace → 404 from bob's perspective.
    const { signAccessToken } = await import("@railback/lib/auth/jwt");
    const bobToken = signAccessToken({ email: "bob@example.com", role: "USER" });
    const res = await handleDeleteRouteTemplate(
      makeDeleteEvent({ templateId: tplId, token: bobToken }),
    );
    expect(res.statusCode).toBe(404);
    // Alice's row still there.
    const stillThere = await db.routeTemplates.get(ALICE_EMAIL, tplId);
    expect(stillThere).not.toBeNull();
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    installTestEnv();
    const res = await handleDeleteRouteTemplate(
      makeDeleteEvent({ templateId: ulid() }),
    );
    expect(res.statusCode).toBe(401);
  });
});
