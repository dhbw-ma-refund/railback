import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { statsApi } from './stats';
import { setTokens, clearTokens } from '../auth/storage';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const RAW = {
  users: { total: 123, active: 117, suspended: 1, deletion_scheduled: 5 },
  tickets: {
    total: 380,
    by_state: {
      VALIDATING: 10,
      READY: 4,
      EMAIL_SENDING: 11,
      PENDING_DB_PAYMENT: 34,
      APPROVED: 43,
      REJECTED: 20,
      COMPLETED: 240,
      EMAIL_FAILED: 2,
      INVALID: 16,
      GARBAGE_STATE: 999,
    },
    pending: 34,
  },
  refunds: {
    total_paid_out: '6721.00',
    currency: 'EUR',
    this_month_paid_out: '452.41',
  },
  as_of: '2026-07-09T17:26:27+02:00',
};

describe('statsApi.getStats', () => {
  beforeEach(() => {
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('parses the full contract shape', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, RAW));
    const stats = await statsApi.getStats();
    expect(stats.users.total).toBe(123);
    expect(stats.users.active).toBe(117);
    expect(stats.tickets.total).toBe(380);
    expect(stats.tickets.pending).toBe(34);
    expect(stats.tickets.by_state.COMPLETED).toBe(240);
    expect(stats.refunds.total_paid_out).toBe('6721.00');
    expect(stats.refunds.this_month_paid_out).toBe('452.41');
    expect(stats.as_of).toBe('2026-07-09T17:26:27+02:00');
  });

  it('drops unknown ticket states from by_state', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, RAW));
    const stats = await statsApi.getStats();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((stats.tickets.by_state as Record<string, number>).GARBAGE_STATE).toBeUndefined();
  });

  it('falls back to safe defaults when the endpoint returns junk', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, 'garbage'));
    const stats = await statsApi.getStats();
    expect(stats.users.total).toBe(0);
    expect(stats.tickets.total).toBe(0);
    expect(stats.refunds.total_paid_out).toBe('0');
    expect(stats.refunds.currency).toBe('EUR');
    expect(stats.as_of).toBe('');
  });

  it('hits GET /admin/stats', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, RAW));
    await statsApi.getStats();
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/admin/stats');
  });
});
