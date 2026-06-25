import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAdmin,
  seedAlice,
  seedMandate,
  seedTicket,
} from "./fixtures.js";

describe("GET /admin/sepa/pending-batches", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("groups pending mandates by batchId and presigned-GETs the XML", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, "01HZBATCH00000000000000A1");
    await seedMandate(db, ALICE_EMAIL, "01HZBATCH00000000000000A1", {
      pain008_batch_id: "BATCH-001",
      pain008_s3_key: "pain008/2026-06/BATCH-001.xml",
      pain008_built_at: "2026-06-25T09:15:00Z",
    });

    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/sepa/pending-batches",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    const batch = body.items[0];
    expect(batch.batchId).toBe("BATCH-001");
    expect(batch.s3_key).toBe("pain008/2026-06/BATCH-001.xml");
    expect(batch.mandate_count).toBe(1);
    expect(batch.total_eur).toBe("0.75");
    expect(batch.built_at).toBe("2026-06-25T09:15:00Z");
    expect(batch.downloadUrl).toMatch(/^https?:\/\//);
    expect(batch.downloadUrlExpiresIn).toBe(300);
  });

  it("returns empty list when no batches pending", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/sepa/pending-batches",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toEqual([]);
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/sepa/pending-batches",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/sepa/pending-batches" }),
    );
    expect(res.statusCode).toBe(401);
  });
});
