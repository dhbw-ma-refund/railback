import { apiClient } from './client';
import { isRecord, readArray, readString } from './parse';
import {
  TICKET_STATES,
  type Ticket,
  type TicketListItem,
  type TicketState,
  type TicketTimelineEntry,
  type TicketsPage,
} from '../types/ticket';

const TICKET_STATE_SET: ReadonlySet<TicketState> = new Set(TICKET_STATES);

function asTicketState(v: unknown): TicketState {
  if (typeof v === 'string' && TICKET_STATE_SET.has(v as TicketState)) {
    return v as TicketState;
  }
  return 'VALIDATING';
}

function readStringArray(source: Record<string, unknown>, key: string): string[] {
  return readArray(source, key).filter((v): v is string => typeof v === 'string');
}

function readNullableString(source: Record<string, unknown>, key: string): string | null {
  return readString(source, key);
}

function readOptionalNumber(source: Record<string, unknown>, key: string): number | null {
  const v = source[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseListItem(raw: unknown): TicketListItem {
  if (!isRecord(raw)) throw new Error('Malformed ticket payload');
  return {
    ticketId: readString(raw, 'ticketId') ?? '',
    email: readString(raw, 'email') ?? '',
    vorname: readString(raw, 'vorname') ?? '',
    nachname: readString(raw, 'nachname') ?? '',
    ticket_state: asTicketState(raw.ticket_state),
    antragsart: readString(raw, 'antragsart') ?? '',
    antragsgrund: readStringArray(raw, 'antragsgrund'),
    abreisedatum: readString(raw, 'abreisedatum') ?? '',
    abreisebahnhof: readString(raw, 'abreisebahnhof') ?? '',
    zielbahnhof: readString(raw, 'zielbahnhof') ?? '',
    zugnummer_plan: readString(raw, 'zugnummer_plan') ?? '',
    fahrkartenpreis: readString(raw, 'fahrkartenpreis') ?? '0',
    erwartete_erstattung: readString(raw, 'erwartete_erstattung') ?? '0',
    delayMinutes: readOptionalNumber(raw, 'delayMinutes'),
    submitted_at: readString(raw, 'submitted_at') ?? '',
    updated_at: readString(raw, 'updated_at') ?? '',
  };
}

function parseTimeline(raw: unknown): TicketTimelineEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const at = readString(entry, 'at');
    if (!at) return [];
    return [
      {
        state: asTicketState(entry.state),
        at,
        actor: readNullableString(entry, 'actor'),
      },
    ];
  });
}

function parseTicket(raw: unknown): Ticket {
  if (!isRecord(raw)) throw new Error('Malformed ticket payload');
  const listItem = parseListItem(raw);
  return {
    ...listItem,
    fahrt_abreisedatum: readString(raw, 'fahrt_abreisedatum') ?? '',
    fahrt_abreisebahnhof: readString(raw, 'fahrt_abreisebahnhof') ?? '',
    fahrt_zielbahnhof: readString(raw, 'fahrt_zielbahnhof') ?? '',
    fahrt_abfahrtszeit_plan: readString(raw, 'fahrt_abfahrtszeit_plan') ?? '',
    fahrt_ankunftszeit_plan: readString(raw, 'fahrt_ankunftszeit_plan') ?? '',
    fahrt_zugnummer_plan: readString(raw, 'fahrt_zugnummer_plan') ?? '',
    fahrt_zugkategorie_plan: readString(raw, 'fahrt_zugkategorie_plan') ?? '',
    fahrt_fahrkartennummer: readString(raw, 'fahrt_fahrkartennummer') ?? '',
    fahrt_fahrkartenpreis: readString(raw, 'fahrt_fahrkartenpreis') ?? '0',
    tatsaechlich_ankunftsdatum: readNullableString(raw, 'tatsaechlich_ankunftsdatum'),
    tatsaechlich_abfahrtszeit: readNullableString(raw, 'tatsaechlich_abfahrtszeit'),
    tatsaechlich_ankunftszeit: readNullableString(raw, 'tatsaechlich_ankunftszeit'),
    tatsaechlich_zugnummer: readNullableString(raw, 'tatsaechlich_zugnummer'),
    tatsaechlich_verpasster_anschluss_bahnhof: readNullableString(
      raw,
      'tatsaechlich_verpasster_anschluss_bahnhof',
    ),
    antragstellung_ort: readNullableString(raw, 'antragstellung_ort'),
    zusaetzliche_angaben: readNullableString(raw, 'zusaetzliche_angaben'),
    extraction_method: readNullableString(raw, 'extraction_method'),
    extraction_confidence: readOptionalNumber(raw, 'extraction_confidence'),
    barcode_uid: readNullableString(raw, 'barcode_uid'),
    state_timeline: parseTimeline(raw.state_timeline),
    has_belege: raw.has_belege === true,
    service_fee_betrag: readNullableString(raw, 'service_fee_betrag'),
    db_paid_at: readNullableString(raw, 'db_paid_at'),
    admin_note: readNullableString(raw, 'admin_note'),
    email_status: readNullableString(raw, 'email_status'),
    email_provider_id: readNullableString(raw, 'email_provider_id'),
    email_failed_reason: readNullableString(raw, 'email_failed_reason'),
  };
}

function parseTicketsPage(raw: unknown): TicketsPage {
  if (!isRecord(raw)) return { items: [] };
  const items = readArray(raw, 'items').map(parseListItem);
  const nextCursor = readString(raw, 'nextCursor') ?? undefined;
  return { items, nextCursor };
}

export interface ListTicketsParams {
  state?: TicketState | '';
  email?: string;
  trainNr?: string;
  date?: string;
  limit?: number;
  cursor?: string;
}

/**
 * PATCH payload matches TicketPatch in the mock's OpenAPI schema and the
 * "Editable" set in BACKEND_CONTRACT.md §PATCH /admin/tickets. Everything
 * else (money, journey, antragsart) is immutable — recourse is REJECT +
 * resubmit.
 */
export interface TicketPatchPayload {
  ticket_state?: TicketState;
  db_paid_at?: string | null;
  admin_note?: string | null;
}

export const ticketsApi = {
  async listTickets(
    params: ListTicketsParams = {},
    signal?: AbortSignal,
  ): Promise<TicketsPage> {
    const raw = await apiClient.get<unknown>('/admin/tickets', {
      query: {
        state: params.state,
        email: params.email,
        trainNr: params.trainNr,
        date: params.date,
        limit: params.limit,
        cursor: params.cursor,
      },
      signal,
    });
    return parseTicketsPage(raw);
  },

  async getTicket(ticketId: string, signal?: AbortSignal): Promise<Ticket> {
    const raw = await apiClient.get<unknown>(
      `/admin/tickets/${encodeURIComponent(ticketId)}`,
      { signal },
    );
    return parseTicket(raw);
  },

  async patchTicket(
    ticketId: string,
    payload: TicketPatchPayload,
    signal?: AbortSignal,
  ): Promise<Ticket> {
    const raw = await apiClient.patch<unknown>(
      `/admin/tickets/${encodeURIComponent(ticketId)}`,
      payload,
      { signal },
    );
    return parseTicket(raw);
  },
};
