import { apiClient } from './client';
import { isRecord, readNumber, readRecord, readString } from './parse';
import { TICKET_STATES, type TicketState } from '../types/ticket';
import type { AdminStats } from '../types/stats';

const TICKET_STATE_SET: ReadonlySet<TicketState> = new Set(TICKET_STATES);

function parseUsersBlock(raw: Record<string, unknown> | null): AdminStats['users'] {
  if (!raw) return { total: 0, active: 0, suspended: 0, deletion_scheduled: 0 };
  return {
    total: readNumber(raw, 'total'),
    active: readNumber(raw, 'active'),
    suspended: readNumber(raw, 'suspended'),
    deletion_scheduled: readNumber(raw, 'deletion_scheduled'),
  };
}

function parseTicketsBlock(raw: Record<string, unknown> | null): AdminStats['tickets'] {
  if (!raw) return { total: 0, by_state: {}, pending: 0 };
  const byStateRaw = readRecord(raw, 'by_state');
  const by_state: Partial<Record<TicketState, number>> = {};
  if (byStateRaw) {
    for (const [key, value] of Object.entries(byStateRaw)) {
      if (TICKET_STATE_SET.has(key as TicketState) && typeof value === 'number') {
        by_state[key as TicketState] = value;
      }
    }
  }
  return {
    total: readNumber(raw, 'total'),
    by_state,
    pending: readNumber(raw, 'pending'),
  };
}

function parseRefundsBlock(raw: Record<string, unknown> | null): AdminStats['refunds'] {
  if (!raw) return { total_paid_out: '0', currency: 'EUR', this_month_paid_out: '0' };
  return {
    total_paid_out: readString(raw, 'total_paid_out') ?? '0',
    currency: readString(raw, 'currency') ?? 'EUR',
    this_month_paid_out: readString(raw, 'this_month_paid_out') ?? '0',
  };
}

function parseStats(raw: unknown): AdminStats {
  if (!isRecord(raw)) {
    return {
      users: parseUsersBlock(null),
      tickets: parseTicketsBlock(null),
      refunds: parseRefundsBlock(null),
      as_of: '',
    };
  }
  return {
    users: parseUsersBlock(readRecord(raw, 'users')),
    tickets: parseTicketsBlock(readRecord(raw, 'tickets')),
    refunds: parseRefundsBlock(readRecord(raw, 'refunds')),
    as_of: readString(raw, 'as_of') ?? '',
  };
}

export const statsApi = {
  async getStats(signal?: AbortSignal): Promise<AdminStats> {
    const raw = await apiClient.get<unknown>('/admin/stats', { signal });
    return parseStats(raw);
  },
};
