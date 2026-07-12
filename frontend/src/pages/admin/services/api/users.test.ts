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

  it('carries iban/bic plaintext through the parser (post 2026-07-07 rollout)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        items: [{ ...USER_RAW, iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' }],
      }),
    );
    const page = await usersApi.listUsers();
    const first = page.items[0];
    expect(first.iban).toBe('DE89370400440532013000');
    expect(first.bic).toBe('COBADEFFXXX');
  });

  it('returns null iban/bic when absent (mandate not yet issued)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { items: [USER_RAW] }));
    const page = await usersApi.listUsers();
    const first = page.items[0];
    expect(first.iban).toBeNull();
    expect(first.bic).toBeNull();
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

describe('usersApi.patchUser', () => {
  beforeEach(() => {
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('PATCHes /admin/users/{email} with the payload and parses the response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { ...USER_RAW, vorname: 'New' }),
    );
    const updated = await usersApi.patchUser(USER_RAW.email, { vorname: 'New' });
    expect(updated.vorname).toBe('New');
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain('/admin/users/a%40b.example');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ vorname: 'New' });
  });

  it('URL-encodes the email in the path', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, USER_RAW));
    await usersApi.patchUser('a+b@c.example', { nachname: 'X' });
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/admin/users/a%2Bb%40c.example');
  });

  it('surfaces the ERR_VALIDATION message when the backend rejects a no-op patch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(400, {
        error: {
          code: 'ERR_VALIDATION',
          message: 'no-op patch — at least one field must change',
        },
      }),
    );
    await expect(usersApi.patchUser(USER_RAW.email, { vorname: 'Ada' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('no-op patch'),
    });
  });
});
