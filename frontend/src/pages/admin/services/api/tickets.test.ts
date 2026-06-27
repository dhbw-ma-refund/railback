import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ticketsApi } from './tickets';
import { clearTokens, setTokens } from '../auth/storage';

const LIST_ITEM = {
  ticketId: 'T1',
  email: 'a@b.example',
  vorname: 'Ada',
  nachname: 'Beispiel',
  ticket_state: 'APPROVED',
  antragsart: 'ENTSCHAEDIGUNG_60_119',
  antragsgrund: ['VERSPAETUNG'],
  abreisedatum: '2026-07-01',
  abreisebahnhof: 'Berlin Hbf',
  zielbahnhof: 'Hamburg Hbf',
  zugnummer_plan: 'ICE 500',
  fahrkartenpreis: '49.00',
  erwartete_erstattung: '12.25',
  delayMinutes: 80,
  submitted_at: '2026-07-01T10:00:00+02:00',
  updated_at: '2026-07-02T11:00:00+02:00',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ticketsApi.listTickets', () => {
  beforeEach(() => {
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('parses items and passes all filter params', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { items: [LIST_ITEM], nextCursor: 'c1' }),
    );
    const page = await ticketsApi.listTickets({
      state: 'APPROVED',
      email: 'a@b',
      trainNr: 'ICE 500',
      date: '2026-07-01',
      limit: 20,
      cursor: 'x',
    });
    expect(page.nextCursor).toBe('c1');
    expect(page.items[0].ticket_state).toBe('APPROVED');
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('state=APPROVED');
    expect(url).toContain('trainNr=ICE');
    expect(url).toContain('date=2026-07-01');
  });

  it('defaults unknown ticket_state to VALIDATING', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { items: [{ ...LIST_ITEM, ticket_state: 'GARBAGE' }] }),
    );
    const page = await ticketsApi.listTickets();
    expect(page.items[0].ticket_state).toBe('VALIDATING');
  });
});

describe('ticketsApi.getTicket', () => {
  beforeEach(() => {
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('URL-encodes the ticket id and parses journey + timeline', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        ...LIST_ITEM,
        fahrt_abreisedatum: '2026-07-01',
        fahrt_abreisebahnhof: 'Berlin Hbf',
        fahrt_zielbahnhof: 'Hamburg Hbf',
        fahrt_abfahrtszeit_plan: '10:00',
        fahrt_ankunftszeit_plan: '12:00',
        fahrt_zugnummer_plan: 'ICE 500',
        fahrt_zugkategorie_plan: 'ICE',
        fahrt_fahrkartennummer: 'DE123',
        fahrt_fahrkartenpreis: '49.00',
        service_fee_betrag: '0.75',
        state_timeline: [
          { state: 'APPROVED', at: '2026-07-02T10:00:00+02:00', actor: 'admin' },
          { state: 'GARBAGE', at: '2026-07-03T10:00:00+02:00', actor: null },
        ],
      }),
    );
    const t = await ticketsApi.getTicket('01KABC/def');
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/admin/tickets/01KABC%2Fdef');
    expect(t.fahrt_fahrkartennummer).toBe('DE123');
    expect(t.state_timeline).toHaveLength(2);
    expect(t.state_timeline[1].state).toBe('VALIDATING'); // GARBAGE → default
  });
});
