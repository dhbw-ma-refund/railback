import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usersApi } from './users';
import { clearTokens, setTokens } from '../auth/storage';

const USER_RAW = {
  email: 'a@b.example',
  vorname: 'Ada',
  nachname: 'Beispiel',
  telefon: '+49 176',
  adresse: {
    strasse: 'Bahnhofstraße',
    hausnr: '1',
    plz: '12345',
    ort: 'Berlin',
    land: 'DE',
  },
  user_state: 'ACTIVE',
  suspended_at: null,
  suspended_reason: null,
  created_at: '2025-01-01T00:00:00+02:00',
  ticket_count: 3,
  total_refunded: '42.00',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('usersApi.listUsers', () => {
  beforeEach(() => {
    clearTokens();
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('parses items and nextCursor', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { items: [USER_RAW], nextCursor: 'c1' }),
    );
    const page = await usersApi.listUsers({ limit: 20 });
    expect(page.nextCursor).toBe('c1');
    expect(page.items).toHaveLength(1);
    expect(page.items[0].email).toBe('a@b.example');
    expect(page.items[0].adresse?.ort).toBe('Berlin');
    expect(page.items[0].total_refunded).toBe('42.00');
  });

  it('passes filter query params through', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    await usersApi.listUsers({ email: 'foo', user_state: 'SUSPENDED', limit: 10, cursor: 'x' });
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/admin/users?');
    expect(url).toContain('email=foo');
    expect(url).toContain('user_state=SUSPENDED');
    expect(url).toContain('limit=10');
    expect(url).toContain('cursor=x');
  });

  it('skips iban/bic and any unmodeled fields silently', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { items: [{ ...USER_RAW, iban: 'DE1', bic: 'BIC' }] }),
    );
    const page = await usersApi.listUsers();
    // iban/bic aren't in User's type; asserting absence at runtime for safety.
    const first = page.items[0];
    expect('iban' in first).toBe(false);
    expect('bic' in first).toBe(false);
  });
});

describe('usersApi.getUser', () => {
  beforeEach(() => {
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('URL-encodes the email', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, USER_RAW));
    await usersApi.getUser('a+b@c.example');
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/admin/users/a%2Bb%40c.example');
  });

  it('parses recent_tickets into typed shape', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        ...USER_RAW,
        recent_tickets: [
          {
            ticketId: 'T1',
            ticket_state: 'APPROVED',
            abreisedatum: '2026-01-01',
            erwartete_erstattung: '10.00',
          },
        ],
      }),
    );
    const user = await usersApi.getUser(USER_RAW.email);
    expect(user.recent_tickets).toHaveLength(1);
    expect(user.recent_tickets?.[0].ticketId).toBe('T1');
  });
});
