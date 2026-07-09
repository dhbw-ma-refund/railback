import type { SegmentDelay } from "../types/dto.js";
import type { DelayRepo } from "../storage/types.js";

export interface RouteCandidate {
  trainNr: string;
  zugkategorie?: string;
  abfahrt_plan: string;
  ankunft_plan: string;
  abfahrt_tatsaechlich?: string;
  ankunft_tatsaechlich?: string;
  delayMinutes: number;
  any_cancelled: boolean;
  data_quality: "FULL" | "PARTIAL" | "PLAN_ONLY";
}

export interface RouteLookupInput {
  fromEva: number;
  toEva: number;
  date: string;
  fromTime?: string;
  toTime?: string;
}

export async function lookupDirectRoutes(
  input: RouteLookupInput,
  deps: { delays: DelayRepo },
): Promise<RouteCandidate[]> {
  const fromTime = input.fromTime ?? "00:00";
  const toTime = input.toTime ?? "23:59";

  const departures = await deps.delays.departuresFromStation(
    input.fromEva,
    input.date,
    fromTime,
    toTime,
  );

  // dedup by trainNr -- each train shows up as one departure-segment from this station
  const trainNrs = Array.from(new Set(departures.map((s) => s.trainNr)));

  const candidates: RouteCandidate[] = [];

  for (const trainNr of trainNrs) {
    const segments = await deps.delays.segmentsForTrain(trainNr, input.date);
    if (segments.length === 0) continue;

    // sort by planned_departure HH:MM lex order
    const sorted = [...segments].sort((a, b) =>
      a.planned_departure < b.planned_departure
        ? -1
        : a.planned_departure > b.planned_departure
          ? 1
          : 0,
    );

    const fromIdx = sorted.findIndex((s) => s.origin_eva === input.fromEva);
    if (fromIdx < 0) continue;
    const fromSeg = sorted[fromIdx];
    if (!fromSeg) continue; // type-narrow noUncheckedIndexedAccess

    // toIdx must be at-or-after fromIdx
    let toIdx = -1;
    for (let i = fromIdx; i < sorted.length; i++) {
      const s = sorted[i];
      if (s && s.destination_eva === input.toEva) {
        toIdx = i;
        break;
      }
    }
    if (toIdx < 0) continue;
    const toSeg = sorted[toIdx];
    if (!toSeg) continue;

    const span = sorted.slice(fromIdx, toIdx + 1);

    const delayMinutes = span.reduce(
      (m, s) => (s.delayMinutes > m ? s.delayMinutes : m),
      0,
    );
    const any_cancelled = span.some((s) => s.is_cancelled);

    let data_quality: RouteCandidate["data_quality"];
    if (span.some((s) => s.finalized_at == null)) {
      data_quality = "PLAN_ONLY";
    } else if (hasGap(span)) {
      data_quality = "PARTIAL";
    } else {
      data_quality = "FULL";
    }

    const cand: RouteCandidate = {
      trainNr,
      abfahrt_plan: fromSeg.planned_departure,
      ankunft_plan: toSeg.planned_arrival,
      delayMinutes,
      any_cancelled,
      data_quality,
    };
    if (fromSeg.actual_departure !== undefined)
      cand.abfahrt_tatsaechlich = fromSeg.actual_departure;
    if (toSeg.actual_arrival !== undefined)
      cand.ankunft_tatsaechlich = toSeg.actual_arrival;

    candidates.push(cand);
  }

  candidates.sort((a, b) =>
    a.abfahrt_plan < b.abfahrt_plan
      ? -1
      : a.abfahrt_plan > b.abfahrt_plan
        ? 1
        : 0,
  );
  return candidates;
}

// discontinuity when consecutive segments don't chain
// (prev.destination_eva !== next.origin_eva)
function hasGap(span: SegmentDelay[]): boolean {
  for (let i = 1; i < span.length; i++) {
    const cur = span[i];
    const prev = span[i - 1];
    if (!cur || !prev) continue;
    if (cur.origin_eva !== prev.destination_eva) return true;
  }
  return false;
}
