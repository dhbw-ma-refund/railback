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

describe("POST /admin/sepa/batches/{batchId}/mark-submitted", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("flips every ISSUED mandate in the batch to SUBMITTED", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, "01HZBATCHSUB000000000001");
    await seedMandate(db, ALICE_EMAIL, "01HZBATCHSUB000000000001", {
      pain008_batch_id: "BATCH-SUB-001",
      pain008_s3_key: "pain008/2026-06/BATCH-SUB-001.xml",
      pain008_built_at: "2026-06-25T09:15:00Z",
    });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/batches/BATCH-SUB-001/mark-submitted",
        token: adminAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.batchId).toBe("BATCH-SUB-001");
    expect(body.mandates_marked).toBe(1);
    expect(typeof body.submitted_at).toBe("string");

    const m = await db.mandates.get(ALICE_EMAIL, "01HZBATCHSUB000000000001");
    expect(m?.mandate_state).toBe("SUBMITTED");
  });

  it("is idempotent — second call marks 0 mandates", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, "01HZBATCHSUB000000000002");
    await seedMandate(db, ALICE_EMAIL, "01HZBATCHSUB000000000002", {
      pain008_batch_id: "BATCH-SUB-002",
      pain008_s3_key: "pain008/2026-06/BATCH-SUB-002.xml",
      pain008_built_at: "2026-06-25T09:15:00Z",
    });

    const a = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/batches/BATCH-SUB-002/mark-submitted",
        token: adminAccessToken(),
        body: {},
      }),
    );
    expect(JSON.parse(a.body).mandates_marked).toBe(1);
    const firstSubmittedAt = JSON.parse(a.body).submitted_at;

    const b = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/batches/BATCH-SUB-002/mark-submitted",
        token: adminAccessToken(),
        body: {},
      }),
    );
    expect(b.statusCode).toBe(200);
    expect(JSON.parse(b.body).mandates_marked).toBe(0);
    // Regression: idempotent repeat must return the original submitted_at,
    // not a fresh `now`.
    expect(JSON.parse(b.body).submitted_at).toBe(firstSubmittedAt);
  });

  it("ERR_NOT_FOUND for unknown batchId", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/batches/NONE-EXISTING/mark-submitted",
        token: adminAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/batches/X/mark-submitted",
        token: aliceAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: "/admin/sepa/batches/X/mark-submitted",
        body: {},
      }),
    );
    expect(res.statusCode).toBe(401);
  });
});
