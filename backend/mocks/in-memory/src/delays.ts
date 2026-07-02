import { keys } from "@railback/lib";
import type { DelayRepo, SegmentDelay } from "@railback/lib";
import type { TrainSegmentDelayItem } from "@railback/lib";

import { listSk, type MemState } from "./state.js";

function fromItem(it: TrainSegmentDelayItem): SegmentDelay {
  // PK = TRAIN#<nr>#<date>; SK = SEG#<segId>
  const pkBody = it.PK.slice("TRAIN#".length);
  const hash = pkBody.indexOf("#");
  const trainNr = pkBody.slice(0, hash);
  const date = pkBody.slice(hash + 1);
  const segId = it.SK.slice("SEG#".length);
  const s: SegmentDelay = {
    trainNr,
    date,
    segId,
    delayMinutes: it.delayMinutes,
    reason: it.reason,
    origin: it.origin,
    destination: it.destination,
    origin_eva: it.origin_eva,
    destination_eva: it.destination_eva,
    planned_departure: it.planned_departure,
    planned_arrival: it.planned_arrival,
    is_cancelled: it.is_cancelled,
    source: it.source,
    last_seen_at: it.last_seen_at,
  };
  if (it.actual_departure !== undefined) s.actual_departure = it.actual_departure;
  if (it.actual_arrival !== undefined) s.actual_arrival = it.actual_arrival;
  if (it.finalized_at !== undefined) s.finalized_at = it.finalized_at;
  return s;
}

export class InMemoryDelayRepo implements DelayRepo {
  constructor(private readonly state: MemState) {}

  async segmentsForTrain(trainNr: string, date: string): Promise<SegmentDelay[]> {
    const items = listSk<TrainSegmentDelayItem>(this.state, keys.segPk(trainNr, date), "SEG#");
    return items.map(fromItem).sort((a, b) => a.planned_departure.localeCompare(b.planned_departure));
  }

  async departuresFromStation(eva: number, date: string, fromTime: string, toTime: string): Promise<SegmentDelay[]> {
    const out: SegmentDelay[] = [];
    for (const [pk, bucket] of this.state.rows) {
      if (!pk.startsWith("TRAIN#")) continue;
      for (const [sk, item] of bucket) {
        if (!sk.startsWith("SEG#")) continue;
        const it = item as TrainSegmentDelayItem;
        if (it.origin_eva !== eva) continue;
        if (it.GSI3_PK !== keys.stationGsi3Pk(eva, date)) continue;
        if (it.planned_departure < fromTime || it.planned_departure > toTime) continue;
        out.push(fromItem(it));
      }
    }
    out.sort((a, b) => a.planned_departure.localeCompare(b.planned_departure));
    return out;
  }
}

// Helper for tests + seeders. Not part of the repo interface.
export function seedSegment(state: MemState, seg: SegmentDelay): void {
  const item: TrainSegmentDelayItem = {
    PK: keys.segPk(seg.trainNr, seg.date),
    SK: keys.segSk(seg.segId),
    GSI3_PK: keys.stationGsi3Pk(seg.origin_eva, seg.date),
    GSI3_SK: keys.stationGsi3Sk(seg.planned_departure, seg.trainNr),
    delayMinutes: seg.delayMinutes,
    reason: seg.reason,
    origin: seg.origin,
    destination: seg.destination,
    origin_eva: seg.origin_eva,
    destination_eva: seg.destination_eva,
    planned_departure: seg.planned_departure,
    planned_arrival: seg.planned_arrival,
    is_cancelled: seg.is_cancelled,
    source: seg.source,
    last_seen_at: seg.last_seen_at,
  };
  if (seg.actual_departure !== undefined) item.actual_departure = seg.actual_departure;
  if (seg.actual_arrival !== undefined) item.actual_arrival = seg.actual_arrival;
  if (seg.finalized_at !== undefined) item.finalized_at = seg.finalized_at;
  let bucket = state.rows.get(item.PK);
  if (!bucket) {
    bucket = new Map();
    state.rows.set(item.PK, bucket);
  }
  bucket.set(item.SK, item);
}
