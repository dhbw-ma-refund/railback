import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";
import type { Db } from "@railback/lib/storage/types";
import type { SegmentDelay } from "@railback/lib";
import { seedSegment, _activeMemState } from "@railback/mocks-in-memory";
import type { MemState } from "@railback/mocks-in-memory";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_EMAIL,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

// EVA numbers picked from @railback/lib/refund/stations:
const BERLIN_HBF = { eva: 8011160, name: "Berlin Hauptbahnhof" };
const HANNOVER = { eva: 8000152, name: "Hannover Hbf" };
const MUNICH = { eva: 8000261, name: "München Hbf" };
const FRANKFURT = { eva: 8000105, name: "Frankfurt (Main) Hbf" };

const TRAIN_NR = "ICE 123";
const DATE = "2026-06-23";

function seg(input: {
  trainNr?: string;
  date?: string;
  segId: string;
  origin: { eva: number; name: string };
  destination: { eva: number; name: string };
  planned_departure: string;
  planned_arrival: string;
  actual_departure?: string;
  actual_arrival?: string;
  delayMinutes: number;
  is_cancelled?: boolean;
  finalized_at?: string;
}): SegmentDelay {
  const s: SegmentDelay = {
    trainNr: input.trainNr ?? TRAIN_NR,
    date: input.date ?? DATE,
    segId: input.segId,
    delayMinutes: input.delayMinutes,
    reason: "",
    origin: input.origin.name,
    destination: input.destination.name,
    origin_eva: input.origin.eva,
    destination_eva: input.destination.eva,
    planned_departure: input.planned_departure,
    planned_arrival: input.planned_arrival,
    is_cancelled: input.is_cancelled ?? false,
    source: "iris",
    last_seen_at: "2026-06-23T20:00:00Z",
  };
  if (input.actual_departure !== undefined) s.actual_departure = input.actual_departure;
  if (input.actual_arrival !== undefined) s.actual_arrival = input.actual_arrival;
  if (input.finalized_at !== undefined) s.finalized_at = input.finalized_at;
  return s;
}

async function seedTrip(db: Db, opts: {
  finalized?: boolean;
  gap?: boolean;
  cancelled?: boolean;
  delays?: number[];
} = {}): Promise<void> {
  const finalized = opts.finalized ?? true;
  const fin = finalized ? "2026-06-23T22:00:00Z" : undefined;
  const d = opts.delays ?? [0, 30, 90];

  // Berlin → Hannover → Frankfurt → München
  const segments: SegmentDelay[] = [
    seg({
      segId: "s1",
      origin: BERLIN_HBF,
      destination: HANNOVER,
      planned_departure: "08:00",
      planned_arrival: "09:30",
      actual_departure: "08:00",
      actual_arrival: "09:30",
      delayMinutes: d[0] ?? 0,
      ...(fin ? { finalized_at: fin } : {}),
    }),
    seg({
      segId: "s2",
      // gap toggle: pretend the segment starts from Frankfurt instead of Hannover
      origin: opts.gap ? FRANKFURT : HANNOVER,
      destination: FRANKFURT,
      planned_departure: "09:40",
      planned_arrival: "11:30",
      actual_departure: "09:50",
      actual_arrival: "12:00",
      delayMinutes: d[1] ?? 30,
      ...(fin ? { finalized_at: fin } : {}),
    }),
    seg({
      segId: "s3",
      origin: FRANKFURT,
      destination: MUNICH,
      planned_departure: "11:45",
      planned_arrival: "14:00",
      actual_departure: "12:10",
      actual_arrival: "15:30",
      delayMinutes: d[2] ?? 90,
      is_cancelled: opts.cancelled ?? false,
      ...(fin ? { finalized_at: fin } : {}),
    }),
  ];

  // The mocks-in-memory backend exposes the shared MemState via the
  // _activeMemState() helper (set by buildMemoryDb's factory at the most
  // recent db() resolve). seedSegment writes directly into it.
  const state: MemState | null = _activeMemState();
  if (!state) throw new Error("no active mem state — call installTestEnv() first");
  for (const s of segments) seedSegment(state, s);
  void db; // unused but keeps the signature symmetric
}

async function seedTicket(db: Db, opts: { ticketId?: string } = {}): Promise<string> {
  const ticketId = opts.ticketId ?? ulid();
  await db.tickets.createFromRoute({
    email: ALICE_EMAIL,
    ticketId,
    trainNr: TRAIN_NR,
    date: DATE,
    fromStation: BERLIN_HBF.name,
    fromEva: BERLIN_HBF.eva,
    toStation: MUNICH.name,
    toEva: MUNICH.eva,
    abfahrtszeit_plan: "08:00",
    ankunftszeit_plan: "14:00",
    fahrkartennummer: "DB-12345",
    fahrkartenpreis: "99.90",
    is_zeitkarte: false,
  });
  return ticketId;
}

describe("POST /users/me/tickets/{ticketId}/delays", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("happy path — FULL data_quality, computed delay = max segment delay", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedTicket(db);
    await seedTrip(db);

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/delays`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: {
          trainNr: TRAIN_NR,
          date: DATE,
          abreisebahnhof: "Berlin Hauptbahnhof",
          zielbahnhof: "München Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.trainNr).toBe(TRAIN_NR);
    // Per API_CONTRACT_USERFORMS.md Step 3: response carries maxDelayMinutes
    // + suggested_antragsart, NOT top-level abreise/zielbahnhof (those echo
    // back via segments[0].origin / segments[last].destination).
    expect(body.maxDelayMinutes).toBe(90);
    expect(body.any_cancelled).toBe(false);
    expect(body.data_quality).toBe("FULL");
    expect(body.suggested_antragsart).toBe("ENTSCHAEDIGUNG_60_119");
    expect(body.segments).toHaveLength(3);
    expect(body.segments[0].origin).toBe("Berlin Hauptbahnhof");
    expect(body.segments[2].destination).toBe("München Hbf");
    // segId + new flat time field names per contract
    expect(typeof body.segments[0].segId).toBe("string");
    expect(typeof body.segments[0].abfahrtszeit_plan).toBe("string");
    expect(typeof body.segments[0].ankunftszeit_plan).toBe("string");
  });

  it("PLAN_ONLY when no segment is finalized", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedTicket(db);
    await seedTrip(db, { finalized: false });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/delays`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: {
          trainNr: TRAIN_NR,
          date: DATE,
          abreisebahnhof: "Berlin Hauptbahnhof",
          zielbahnhof: "München Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data_quality).toBe("PLAN_ONLY");
  });

  it("PARTIAL when chain has a gap (consecutive segs don't chain on eva)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedTicket(db);
    await seedTrip(db, { gap: true });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/delays`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: {
          trainNr: TRAIN_NR,
          date: DATE,
          abreisebahnhof: "Berlin Hauptbahnhof",
          zielbahnhof: "München Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data_quality).toBe("PARTIAL");
  });

  it("any_cancelled propagates from the span", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedTicket(db);
    await seedTrip(db, { cancelled: true });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/delays`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: {
          trainNr: TRAIN_NR,
          date: DATE,
          abreisebahnhof: "Berlin Hauptbahnhof",
          zielbahnhof: "München Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).any_cancelled).toBe(true);
  });

  it("404 when ticketId doesn't belong to caller", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedTrip(db);
    const stranger = ulid();

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${stranger}/delays`,
        token: aliceAccessToken(),
        pathParameters: { ticketId: stranger },
        body: {
          trainNr: TRAIN_NR,
          date: DATE,
          abreisebahnhof: "Berlin Hauptbahnhof",
          zielbahnhof: "München Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("200 with empty segments when train+date has no delay data (coverage gap per contract)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedTicket(db);
    // no seedTrip — repo returns []

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/delays`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: {
          trainNr: TRAIN_NR,
          date: DATE,
          abreisebahnhof: "Berlin Hauptbahnhof",
          zielbahnhof: "München Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      segments: unknown[];
      maxDelayMinutes: number;
      any_cancelled: boolean;
      data_quality: string;
    };
    expect(body.segments).toEqual([]);
    expect(body.maxDelayMinutes).toBe(0);
    expect(body.any_cancelled).toBe(false);
    expect(body.data_quality).toBe("PLAN_ONLY");
  });

  it("404 when station name is not in the top-200 list", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedTicket(db);
    await seedTrip(db);

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/delays`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: {
          trainNr: TRAIN_NR,
          date: DATE,
          abreisebahnhof: "Atlantis Hbf",
          zielbahnhof: "München Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.details?.field).toBe("abreisebahnhof");
  });

  it("404 when the train doesn't stop at the requested origin station", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedTicket(db);
    await seedTrip(db);

    // Frankfurt is on the line but not the FIRST departure — toIdx must be
    // at-or-after fromIdx so requesting Frankfurt → Berlin will 404.
    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/delays`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: {
          trainNr: TRAIN_NR,
          date: DATE,
          abreisebahnhof: "Frankfurt (Main) Hbf",
          zielbahnhof: "Berlin Hauptbahnhof",
        },
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.details?.field).toBe("zielbahnhof");
  });

  it("400 on invalid body (missing trainNr)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedTicket(db);

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/delays`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: {
          date: DATE,
          abreisebahnhof: "Berlin Hauptbahnhof",
          zielbahnhof: "München Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("401 without a token", async () => {
    const ticketId = ulid();
    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/delays`,
        pathParameters: { ticketId },
        body: {
          trainNr: TRAIN_NR,
          date: DATE,
          abreisebahnhof: "Berlin Hauptbahnhof",
          zielbahnhof: "München Hbf",
        },
      }),
    );
    expect(res.statusCode).toBe(401);
  });
});
