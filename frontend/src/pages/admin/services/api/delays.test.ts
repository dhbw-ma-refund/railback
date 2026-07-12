import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trainDelaysApi } from './delays';
import { clearTokens, setTokens } from '../auth/storage';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('trainDelaysApi.getTrainDelays', () => {
  beforeEach(() => {
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('URL-encodes train number and date, parses segments', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        trainNr: 'IC 2345',
        date: '2026-05-12',
        segments: [
          {
            segId: '8000244-8000191',
            origin: 'Mannheim Hbf',
            destination: 'Karlsruhe Hbf',
            delayMinutes: 65,
            reason: 'Stellwerksstörung',
            is_cancelled: false,
            abfahrtszeit_plan: '14:22',
            abfahrtszeit_tatsaechlich: '15:27',
            ankunftszeit_plan: '14:56',
            ankunftszeit_tatsaechlich: '16:01',
            source: 'iris',
          },
        ],
      }),
    );
    const result = await trainDelaysApi.getTrainDelays('IC 2345', '2026-05-12');
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/admin/trains/IC%202345/2026-05-12/delays');
    expect(result.trainNr).toBe('IC 2345');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].delayMinutes).toBe(65);
    expect(result.segments[0].source).toBe('iris');
  });

  it('defaults unknown source to iris and drops non-object segments', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        trainNr: 'IC 500',
        date: '2026-07-01',
        segments: [
          {
            segId: 's1',
            origin: 'A',
            destination: 'B',
            delayMinutes: 30,
            reason: null,
            is_cancelled: true,
            abfahrtszeit_plan: null,
            abfahrtszeit_tatsaechlich: null,
            ankunftszeit_plan: null,
            ankunftszeit_tatsaechlich: null,
            source: 'garbage',
          },
          'not a segment',
          null,
        ],
      }),
    );
    const result = await trainDelaysApi.getTrainDelays('IC 500', '2026-07-01');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].source).toBe('iris');
    expect(result.segments[0].is_cancelled).toBe(true);
  });

  it('treats empty segments as a valid, non-error response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { trainNr: 'RE 1', date: '2026-06-01', segments: [] }),
    );
    const result = await trainDelaysApi.getTrainDelays('RE 1', '2026-06-01');
    expect(result.segments).toEqual([]);
  });
});
