import { apiClient } from './client';
import { isRecord, readArray, readNumber, readRecord, readString, warnMissingField } from './parse';
import type {
  RecentTicket,
  User,
  UserAddress,
  UserAddressPatch,
  UserPatchPayload,
  UserState,
  UsersPage,
} from '../types/user';

function asUserState(v: unknown): UserState {
  return v === 'SUSPENDED' || v === 'DELETION_SCHEDULED' ? v : 'ACTIVE';
}

function parseAddress(r: Record<string, unknown> | null): UserAddress | null {
  if (!r) return null;
  return {
    strasse: readString(r, 'strasse') ?? '',
    hausnr: readString(r, 'hausnr') ?? '',
    plz: readString(r, 'plz') ?? '',
    ort: readString(r, 'ort') ?? '',
    land: readString(r, 'land') ?? '',
  };
}

function parseRecentTicket(raw: unknown): RecentTicket | null {
  if (!isRecord(raw)) return null;
  for (const field of RECENT_TICKET_REQUIRED_FIELDS) {
    warnMissingField('GET /admin/users/{email} recent_ticket', field, raw);
  }
  const id = readString(raw, 'ticketId');
  if (!id) return null;
  return {
    ticketId: id,
    ticket_state: readString(raw, 'ticket_state') ?? '',
    abreisedatum: readString(raw, 'abreisedatum') ?? '',
    erwartete_erstattung: readString(raw, 'erwartete_erstattung') ?? '0',
  };
}

const USER_REQUIRED_FIELDS: readonly string[] = [
  'email',
  'vorname',
  'nachname',
  'user_state',
  'created_at',
  'ticket_count',
  'total_refunded',
];

const RECENT_TICKET_REQUIRED_FIELDS: readonly string[] = [
  'ticketId',
  'ticket_state',
  'abreisedatum',
  'erwartete_erstattung',
];

function parseUser(raw: unknown): User {
  if (!isRecord(raw)) throw new Error('Malformed user payload');
  for (const field of USER_REQUIRED_FIELDS) {
    warnMissingField('GET /admin/users(/{email})', field, raw);
  }
  const recent = readArray(raw, 'recent_tickets')
    .map(parseRecentTicket)
    .filter((t): t is RecentTicket => t !== null);
  return {
    email: readString(raw, 'email') ?? '',
    vorname: readString(raw, 'vorname') ?? '',
    nachname: readString(raw, 'nachname') ?? '',
    telefon: readString(raw, 'telefon'),
    adresse: parseAddress(readRecord(raw, 'adresse')),
    user_state: asUserState(raw.user_state),
    suspended_at: readString(raw, 'suspended_at'),
    suspended_reason: readString(raw, 'suspended_reason'),
    created_at: readString(raw, 'created_at') ?? '',
    ticket_count: readNumber(raw, 'ticket_count'),
    total_refunded: readString(raw, 'total_refunded') ?? '0',
    recent_tickets: 'recent_tickets' in raw ? recent : undefined,
  };
}

function parseUsersPage(raw: unknown): UsersPage {
  if (!isRecord(raw)) return { items: [] };
  const items = readArray(raw, 'items').map(parseUser);
  const nextCursor = readString(raw, 'nextCursor') ?? undefined;
  return { items, nextCursor };
}

export interface ListUsersParams {
  email?: string;
  user_state?: UserState | '';
  limit?: number;
  cursor?: string;
}

export const usersApi = {
  async listUsers(params: ListUsersParams = {}, signal?: AbortSignal): Promise<UsersPage> {
    const raw = await apiClient.get<unknown>('/admin/users', {
      query: {
        email: params.email,
        user_state: params.user_state,
        limit: params.limit,
        cursor: params.cursor,
      },
      signal,
    });
    return parseUsersPage(raw);
  },

  async getUser(email: string, signal?: AbortSignal): Promise<User> {
    const raw = await apiClient.get<unknown>(`/admin/users/${encodeURIComponent(email)}`, {
      signal,
    });
    return parseUser(raw);
  },

  /**
   * PATCH /admin/users/{email}. Backend rejects empty patches with 400
   * ERR_VALIDATION and requires `suspended_reason` on ACTIVE → SUSPENDED —
   * both surfaced through the standard ApiError path so the dialog can map
   * them to specific inline copy.
   */
  async patchUser(email: string, payload: UserPatchPayload): Promise<User> {
    const raw = await apiClient.patch<unknown>(
      `/admin/users/${encodeURIComponent(email)}`,
      payload,
    );
    return parseUser(raw);
  },
};

export type { UserAddressPatch, UserPatchPayload };
