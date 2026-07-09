import { describe, expect, it } from "vitest";
import type { SegmentDelay } from "../../src/types/dto.js";
import type { DelayRepo } from "../../src/storage/types.js";
import { lookupDirectRoutes } from "../../src/refund/route-lookup.js";

class StubDelays implements DelayRepo {
  constructor(
    private byTrain: Map<string, SegmentDelay[]>,
    private byStation: Map<string, SegmentDelay[]>,
  ) {}
  async segmentsForTrain(trainNr: string, date: string): Promise<SegmentDelay[]> {
    return this.byTrain.get(`${trainNr}#${date}`) ?? [];
  }
  async departuresFromStation(
    eva: number,
    date: string,
    fromTime: string,
    toTime: string,
  ): Promise<SegmentDelay[]> {
    const all = this.byStation.get(`${eva}#${date}`) ?? [];
    return all.filter(
      (s) => s.planned_departure >= fromTime && s.planned_departure <= toTime,
    );
  }
}

// seg accepts partial overrides on top of the required positional fields.
// We build the SegmentDelay with conditional spreads so optional fields
// that aren't explicitly set never appear as `undefined` on the result
// (exactOptionalPropertyTypes). The Partial<...> is widened with
// `| undefined` for the fields where the test intentionally passes
// `undefined` to mean "absent".
type SegPartial = {
  [K in keyof SegmentDelay]?: SegmentDelay[K] | undefined;
} & {
  trainNr: string;
  origin_eva: number;
  destination_eva: number;
  planned_departure: string;
  planned_arrival: string;
};

function seg(p: SegPartial): SegmentDelay {
  const base: SegmentDelay = {
    trainNr: p.trainNr,
    date: p.date ?? "2026-06-20",
    segId: p.segId ?? `${p.origin_eva}-${p.destination_eva}`,
    delayMinutes: p.delayMinutes ?? 0,
    reason: p.reason ?? "",
    origin: p.origin ?? `S${p.origin_eva}`,
    destination: p.destination ?? `S${p.destination_eva}`,
    origin_eva: p.origin_eva,
    destination_eva: p.destination_eva,
    planned_departure: p.planned_departure,
    planned_arrival: p.planned_arrival,
    is_cancelled: p.is_cancelled ?? false,
    source: p.source ?? "iris",
    last_seen_at: p.last_seen_at ?? "2026-06-20T12:00:00+02:00",
  };
  // Optional fields: assign only when explicitly present-and-defined.
  if (p.actual_departure !== undefined) base.actual_departure = p.actual_departure;
  if (p.actual_arrival !== undefined) base.actual_arrival = p.actual_arrival;
  // finalized_at: caller wants "absent" if they passed it as undefined.
  if ("finalized_at" in p) {
    if (p.finalized_at !== undefined) base.finalized_at = p.finalized_at;
    // else: omit, leaves data_quality=PLAN_ONLY path active
  } else {
    base.finalized_at = "2026-06-20T23:59:00+02:00";
  }
  return base;
}

const DATE = "2026-06-20";
const A = 8000001;
const B = 8000002;
const C = 8000003;
const Z = 8000099;

function first<T>(arr: T[]): T {
  const v = arr[0];
  if (v === undefined) throw new Error("array is empty");
  return v;
}

function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of range`);
  return v;
}

describe("lookupDirectRoutes", () => {
  it("exact-match FULL: A to B to C, query A to C", async () => {
    const trainNr = "ICE100";
    const s1 = seg({
      trainNr, origin_eva: A, destination_eva: B,
      planned_departure: "08:00", planned_arrival: "09:00",
      delayMinutes: 5,
    });
    const s2 = seg({
      trainNr, origin_eva: B, destination_eva: C,
      planned_departure: "09:05", planned_arrival: "10:00",
      delayMinutes: 12,
    });
    const delays = new StubDelays(
      new Map([[`${trainNr}#${DATE}`, [s1, s2]]]),
      new Map([[`${A}#${DATE}`, [s1]]]),
    );

    const out = await lookupDirectRoutes(
      { fromEva: A, toEva: C, date: DATE },
      { delays },
    );

    expect(out).toHaveLength(1);
    const c0 = first(out);
    expect(c0.trainNr).toBe(trainNr);
    expect(c0.data_quality).toBe("FULL");
    expect(c0.delayMinutes).toBe(12);
    expect(c0.abfahrt_plan).toBe("08:00");
    expect(c0.ankunft_plan).toBe("10:00");
    expect(c0.any_cancelled).toBe(false);
  });

  it("train doesn't reach toEva returns empty", async () => {
    const trainNr = "ICE200";
    const s1 = seg({ trainNr, origin_eva: A, destination_eva: B, planned_departure: "08:00", planned_arrival: "09:00" });
    const s2 = seg({ trainNr, origin_eva: B, destination_eva: C, planned_departure: "09:05", planned_arrival: "10:00" });
    const delays = new StubDelays(
      new Map([[`${trainNr}#${DATE}`, [s1, s2]]]),
      new Map([[`${A}#${DATE}`, [s1]]]),
    );

    const out = await lookupDirectRoutes({ fromEva: A, toEva: Z, date: DATE }, { delays });
    expect(out).toEqual([]);
  });

  it("time-window filter: 08:30 train filtered out when fromTime=09:00", async () => {
    const trainNr = "ICE300";
    const s1 = seg({ trainNr, origin_eva: A, destination_eva: B, planned_departure: "08:30", planned_arrival: "09:30" });
    const delays = new StubDelays(
      new Map([[`${trainNr}#${DATE}`, [s1]]]),
      new Map([[`${A}#${DATE}`, [s1]]]),
    );

    const out = await lookupDirectRoutes(
      { fromEva: A, toEva: B, date: DATE, fromTime: "09:00", toTime: "23:59" },
      { delays },
    );
    expect(out).toEqual([]);
  });

  it("multi-train sorted ascending by abfahrt_plan", async () => {
    const t1 = "ICE400";
    const t2 = "ICE401";
    const s1 = seg({ trainNr: t1, origin_eva: A, destination_eva: B, planned_departure: "10:00", planned_arrival: "11:00" });
    const s2 = seg({ trainNr: t2, origin_eva: A, destination_eva: B, planned_departure: "08:00", planned_arrival: "09:00" });
    const delays = new StubDelays(
      new Map([
        [`${t1}#${DATE}`, [s1]],
        [`${t2}#${DATE}`, [s2]],
      ]),
      new Map([[`${A}#${DATE}`, [s1, s2]]]),
    );

    const out = await lookupDirectRoutes({ fromEva: A, toEva: B, date: DATE }, { delays });
    expect(out).toHaveLength(2);
    expect(at(out, 0).trainNr).toBe(t2);
    expect(at(out, 0).abfahrt_plan).toBe("08:00");
    expect(at(out, 1).trainNr).toBe(t1);
    expect(at(out, 1).abfahrt_plan).toBe("10:00");
  });

  it("PLAN_ONLY when any segment finalized_at is undefined; delay still computed", async () => {
    const trainNr = "ICE500";
    const s1 = seg({
      trainNr, origin_eva: A, destination_eva: B,
      planned_departure: "08:00", planned_arrival: "09:00",
      delayMinutes: 7, finalized_at: undefined,
    });
    const delays = new StubDelays(
      new Map([[`${trainNr}#${DATE}`, [s1]]]),
      new Map([[`${A}#${DATE}`, [s1]]]),
    );

    const out = await lookupDirectRoutes({ fromEva: A, toEva: B, date: DATE }, { delays });
    expect(out).toHaveLength(1);
    expect(first(out).data_quality).toBe("PLAN_ONLY");
    expect(first(out).delayMinutes).toBe(7);
  });

  it("cancelled segment sets any_cancelled=true", async () => {
    const trainNr = "ICE600";
    const s1 = seg({
      trainNr, origin_eva: A, destination_eva: B,
      planned_departure: "08:00", planned_arrival: "09:00",
      is_cancelled: true,
    });
    const delays = new StubDelays(
      new Map([[`${trainNr}#${DATE}`, [s1]]]),
      new Map([[`${A}#${DATE}`, [s1]]]),
    );

    const out = await lookupDirectRoutes({ fromEva: A, toEva: B, date: DATE }, { delays });
    expect(out).toHaveLength(1);
    expect(first(out).any_cancelled).toBe(true);
  });

  it("PARTIAL when consecutive segments don't chain", async () => {
    const trainNr = "ICE700";
    const sAB = seg({
      trainNr, origin_eva: A, destination_eva: B,
      planned_departure: "08:00", planned_arrival: "09:00",
    });
    const sCZ = seg({
      trainNr, origin_eva: C, destination_eva: Z,
      planned_departure: "10:00", planned_arrival: "11:00",
    });
    const delays = new StubDelays(
      new Map([[`${trainNr}#${DATE}`, [sAB, sCZ]]]),
      new Map([[`${A}#${DATE}`, [sAB]]]),
    );

    const out = await lookupDirectRoutes({ fromEva: A, toEva: Z, date: DATE }, { delays });
    expect(out).toHaveLength(1);
    expect(first(out).data_quality).toBe("PARTIAL");
  });
});
