import { makeDb } from "./helpers.js";

const db = makeDb();
const NS = "td001ts";
const DATE = "2026-06-01";
const TRAIN = "ICE8";

function seg(trainNr: string, date: string, segId: string, extra: Record<string, unknown> = {}) {
  return {
    pk: `TRAIN#${trainNr}#${date}`, sk: `SEG#${segId}`,
    // Route-lookup rides GSI3 (STATION#<eva>#<date> / <plannedDeparture>#<trainNr>).
    // The ingest-delays poller writes gsi3_sk as `<date>T<HH:MM>#<trainNr>`
    // (full ISO planned_departure) — these fixtures mirror that exactly.
    gsi3_pk: `STATION#8000105#${date}`, gsi3_sk: `${date}T08:00#${trainNr}`,
    dep_station: 8000105, arr_station: 8000261,
    dep_time_plan: "08:00", delay_min: 5,
    ...extra,
  };
}

describe("TrainSegmentDelayConnector", () => {
  test("put and get", async () => {
    await db.trainDelay.put(seg(TRAIN, DATE, "S_GET"));
    const r = await db.trainDelay.get(TRAIN, DATE, "S_GET");
    expect(r.isOk()).toBe(true);
    expect((r.unwrap() as any)["delay_min"]).toBe(5);
    await db.trainDelay._delete(`TRAIN#${TRAIN}#${DATE}`, "SEG#S_GET");
  });

  test("get not found returns null", async () => {
    expect((await db.trainDelay.get("GHOST", "2099-01-01", "S_GHOST")).unwrap()).toBeNull();
  });

  test("listForTrain returns segments", async () => {
    const segs = ["S_LFT0", "S_LFT1", "S_LFT2"];
    for (const id of segs) await db.trainDelay.put(seg(TRAIN, DATE, id));
    const r = await db.trainDelay.listForTrain(TRAIN, DATE);
    expect(r.isOk()).toBe(true);
    const sks = (r.unwrap() as any[]).map((i) => i["sk"]);
    for (const id of segs) expect(sks).toContain(`SEG#${id}`);
    for (const id of segs) await db.trainDelay._delete(`TRAIN#${TRAIN}#${DATE}`, `SEG#${id}`);
  });

  test("routeLookup finds segments in time window", async () => {
    const segs = [
      seg(TRAIN, DATE, "S_RL0", { gsi3_sk: `${DATE}T08:00#${TRAIN}` }),
      seg(TRAIN, DATE, "S_RL1", { gsi3_sk: `${DATE}T09:00#${TRAIN}` }),
      seg(TRAIN, DATE, "S_RL2", { gsi3_sk: `${DATE}T14:00#${TRAIN}` }),
    ];
    for (const s of segs) await db.trainDelay.put(s);
    const r = await db.trainDelay.routeLookup(8000105, DATE, "07:00", "10:00");
    expect(r.isOk()).toBe(true);
    const sks = (r.unwrap() as any[]).map((i) => i["gsi3_sk"]);
    expect(sks).toContain(`${DATE}T08:00#${TRAIN}`);
    expect(sks).toContain(`${DATE}T09:00#${TRAIN}`);
    expect(sks).not.toContain(`${DATE}T14:00#${TRAIN}`);
    for (const s of segs) await db.trainDelay._delete(s["pk"] as string, s["sk"] as string);
  });
});
