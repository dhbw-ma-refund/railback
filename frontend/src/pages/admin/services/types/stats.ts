/**
 * Types mirroring GET /v1/admin/stats. Money fields stay strings (see the
 * usersApi / ticketsApi rationale — no float rounding).
 */
import type { TicketState } from './ticket';
import type { UserState } from './user';

export interface UsersStats {
  total: number;
  active: number;
  suspended: number;
  deletion_scheduled: number;
}

export interface TicketsStats {
  total: number;
  by_state: Partial<Record<TicketState, number>>;
  pending: number;
}

export interface RefundsStats {
  total_paid_out: string;
  currency: string;
  this_month_paid_out: string;
}

export interface AdminStats {
  users: UsersStats;
  tickets: TicketsStats;
  refunds: RefundsStats;
  as_of: string;
}

/** Keeps the dashboard's user-segment order stable across renders. */
export const USER_STATE_ORDER: UserState[] = ['ACTIVE', 'SUSPENDED', 'DELETION_SCHEDULED'];
