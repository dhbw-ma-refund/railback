import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _activeMemState, seedSegment } from "@railback/mocks-in-memory";
import type { SegmentDelay } from "@railback/lib";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handlePostRouteLookup } from "../src/routes/post-route-lookup.js";
import { aliceAccessToken, makeEvent, seedAlice } from "./fixtures.js";

// Berlin Hauptbahnhof, München Hbf — both cat-1 in stations.ts.
const BERLIN_HBF_EVA = 8011160;
const MUNICH_HBF_EVA = 8000261;
const DATE = "2026-06-20";

function seg(overrides: Partial<SegmentDelay> & {
  segId: string;
  origin: string;
  origin_eva: number;
  destination: string;
  destination_eva: number;
  planned_departure: string;
  planned_arrival: string;
}): SegmentDelay {
  return {
    trainNr: "ICE 1001",
    date: DATE,
    delayMinutes: 0,
    reason: "",
    is_cancelled: false,
    source: "iris",
    last_seen_at: "2026-06-20T10:00:00Z",
    finalized_at: "2026-06-20T20:00:00Z",
    ...overrides,
  };
}

function seedDirectTrain(): void {
  const state = _activeMemState();
  if (!state) throw new Error("no active mem state");
  // Direct ICE Berlin Hbf → München Hbf, one segment, 30-min delay.
  seedSegment(
    state,
    seg({
      segId: "01",
      origin: "Berlin Hauptbahnhof",
      origin_eva: BERLIN_HBF_EVA,
      destination: "München Hbf",
      destination_eva: MUNICH_HBF_EVA,
      planned_departure: "08:00",
      planned_arrival: "12:00",
      actual_departure: "08:00",
      actual_arrival: "12:30",
      delayMinutes: 30,
    }),
  );
}

describe("POST /users/me/tickets/route-lookup", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns a candidate for a seeded direct train (by EVA)", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);
    seedDirectTrain();

    const res = await handlePostRouteLookup(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/route-lookup",
        token: aliceAccessToken(),
        body: {
          fromEva: BERLIN_HBF_EVA,
          toEva: MUNICH_HBF_EVA,
          date: DATE,
          timeWindow: { from: "06:00", to: "10:00" },
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { candidates: unknown[] };
    expect(body.candidates).toHaveLength(1);
    const cand = body.candidates[0] as {
      trainNr: string;
      delayMinutes: number;
      data_quality: string;
    };
    expect(cand.trainNr).toBe("ICE 1001");
    expect(cand.delayMinutes).toBe(30);
    expect(cand.data_quality).toBe("FULL");
  });

  it("resolves station names case-insensitively", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);
    seedDirectTrain();

    const res = await handlePostRouteLookup(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/route-lookup",
        token: aliceAccessToken(),
        body: {
          fromStation: "berlin hauptbahnhof",
          toStation: "münchen hbf",
          date: DATE,
          // Explicit timeWindow — the implicit default is "now ± 1h" per
          // contract, which would miss the 08:00 seeded train at most
          // wall-clock times.
          timeWindow: { from: "06:00", to: "10:00" },
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as { candidates: unknown[] }).candidates)
      .toHaveLength(1);
  });

  it("returns 404 ERR_NO_CANDIDATES when no train matches", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);
    // no segments seeded.

    const res = await handlePostRouteLookup(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/route-lookup",
        token: aliceAccessToken(),
        body: {
          fromEva: BERLIN_HBF_EVA,
          toEva: MUNICH_HBF_EVA,
          date: DATE,
        },
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NO_CANDIDATES");
  });

  it("ERR_VALIDATION on an unresolvable fromStation", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);

    const res = await handlePostRouteLookup(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/route-lookup",
        token: aliceAccessToken(),
        body: {
          fromStation: "Hogwarts Express",
          toStation: "München Hbf",
          date: DATE,
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_VALIDATION");
    expect(body.error.details.field).toBe("fromStation");
  });

  it("ERR_VALIDATION when neither fromStation nor fromEva is provided", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);

    const res = await handlePostRouteLookup(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/route-lookup",
        token: aliceAccessToken(),
        body: { toEva: MUNICH_HBF_EVA, date: DATE },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    installTestEnv();
    const res = await handlePostRouteLookup(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/route-lookup",
        body: {
          fromEva: BERLIN_HBF_EVA,
          toEva: MUNICH_HBF_EVA,
          date: DATE,
        },
      }),
    );
    expect(res.statusCode).toBe(401);
  });
});
