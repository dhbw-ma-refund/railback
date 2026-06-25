import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _activeMemState, seedSegment } from "@railback/mocks-in-memory";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAdmin,
} from "./fixtures.js";

function plantSegment() {
  const state = _activeMemState();
  if (!state) throw new Error("no mem state");
  seedSegment(state, {
    trainNr: "IC 2345",
    date: "2026-05-12",
    segId: "8000244-8000191",
    delayMinutes: 65,
    reason: "Stellwerksstörung",
    origin: "Mannheim Hbf",
    destination: "Karlsruhe Hbf",
    origin_eva: 8000244,
    destination_eva: 8000191,
    planned_departure: "14:22",
    planned_arrival: "14:56",
    actual_departure: "15:27",
    actual_arrival: "16:01",
    finalized_at: "2026-05-12T16:30:00Z",
    is_cancelled: false,
    source: "iris",
    last_seen_at: "2026-05-12T16:30:00Z",
  });
}

describe("GET /admin/trains/{trainNr}/{date}/delays", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns the segment list for a known train+date", async () => {
    installTestEnv();
    await seedAdmin();
    plantSegment();

    const res = await handler(
      makeEvent({
        method: "GET",
        // "IC 2345" URL-encoded
        path: "/admin/trains/IC%202345/2026-05-12/delays",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.trainNr).toBe("IC 2345");
    expect(body.date).toBe("2026-05-12");
    expect(body.segments).toHaveLength(1);
    expect(body.segments[0].delayMinutes).toBe(65);
    expect(body.segments[0].source).toBe("iris");
  });

  it("returns an empty array for a train with no records", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/trains/IC%209999/2026-05-12/delays",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.segments).toEqual([]);
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/trains/IC%202345/2026-05-12/delays",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/trains/IC%202345/2026-05-12/delays" }),
    );
    expect(res.statusCode).toBe(401);
  });
});
