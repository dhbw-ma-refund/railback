/**
 * Train delay types mirrored from BACKEND_CONTRACT.md §Train delays.
 * `source` is worth surfacing on each row so admins know whether the value
 * comes from the live poller (`iris`) or the backfill archive (`piebro`).
 */
export type DelaySource = 'iris' | 'piebro';

export interface DelaySegment {
  segId: string;
  origin: string;
  destination: string;
  delayMinutes: number;
  reason: string | null;
  is_cancelled: boolean;
  abfahrtszeit_plan: string | null;
  abfahrtszeit_tatsaechlich: string | null;
  ankunftszeit_plan: string | null;
  ankunftszeit_tatsaechlich: string | null;
  source: DelaySource;
}

export interface TrainDelays {
  trainNr: string;
  date: string;
  segments: DelaySegment[];
}
