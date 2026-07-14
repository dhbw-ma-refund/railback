import { apiClient } from './client';
import { isRecord, readArray, readNumber, readString } from './parse';
import type { DelaySegment, DelaySource, TrainDelays } from '../types/delay';

const DELAY_SOURCES: ReadonlySet<DelaySource> = new Set<DelaySource>(['iris', 'piebro']);

function asSource(v: unknown): DelaySource {
  return typeof v === 'string' && DELAY_SOURCES.has(v as DelaySource)
    ? (v as DelaySource)
    : 'iris';
}

function parseSegment(raw: unknown): DelaySegment | null {
  if (!isRecord(raw)) return null;
  return {
    segId: readString(raw, 'segId') ?? '',
    origin: readString(raw, 'origin') ?? '',
    destination: readString(raw, 'destination') ?? '',
    delayMinutes: readNumber(raw, 'delayMinutes'),
    reason: readString(raw, 'reason'),
    is_cancelled: raw['is_cancelled'] === true,
    abfahrtszeit_plan: readString(raw, 'abfahrtszeit_plan'),
    abfahrtszeit_tatsaechlich: readString(raw, 'abfahrtszeit_tatsaechlich'),
    ankunftszeit_plan: readString(raw, 'ankunftszeit_plan'),
    ankunftszeit_tatsaechlich: readString(raw, 'ankunftszeit_tatsaechlich'),
    source: asSource(raw['source']),
  };
}

function parseDelays(raw: unknown): TrainDelays {
  if (!isRecord(raw)) return { trainNr: '', date: '', segments: [] };
  return {
    trainNr: readString(raw, 'trainNr') ?? '',
    date: readString(raw, 'date') ?? '',
    segments: readArray(raw, 'segments')
      .map(parseSegment)
      .filter((seg): seg is DelaySegment => seg !== null),
  };
}

export const trainDelaysApi = {
  /**
   * Read-through to the Train Segment Delay table. `trainNr` and `date` land
   * in the path; the client URL-encodes both segments so `IC 2345` works.
   * Empty `segments` is a normal case, not an error.
   */
  async getTrainDelays(
    trainNr: string,
    date: string,
    signal?: AbortSignal,
  ): Promise<TrainDelays> {
    const raw = await apiClient.get<unknown>(
      `/admin/trains/${encodeURIComponent(trainNr)}/${encodeURIComponent(date)}/delays`,
      { signal },
    );
    return parseDelays(raw);
  },
};
