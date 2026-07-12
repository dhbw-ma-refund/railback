import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserEditDialog } from './UserEditDialog';
import type { User, UserState } from '../services/types/user';
import { clearTokens, setTokens } from '../services/auth/storage';

function makeUser(state: UserState, overrides: Partial<User> = {}): User {
  return {
    email: 'ada@example.de',
    vorname: 'Ada',
    nachname: 'Beispiel',
    telefon: '+49 176 1234',
    adresse: {
      strasse: 'Musterstr.',
      hausnr: '1',
      plz: '10115',
      ort: 'Berlin',
      land: 'DE',
    },
    user_state: state,
    suspended_at: null,
    suspended_reason: null,
    created_at: '2026-01-01T10:00:00+02:00',
    ticket_count: 3,
    total_refunded: '42.00',
    iban: null,
    bic: null,
    ...overrides,
  };
}

describe('UserEditDialog', () => {
  beforeEach(() => {
    setTokens('a', 'r', Math.floor(Date.now() / 1000) + 3600);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('opens with Speichern disabled because no field has changed yet', () => {
    render(
      <UserEditDialog
        user={makeUser('ACTIVE')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const save = screen.getByRole('button', { name: /Speichern/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('offers only ACTIVE → {SUSPENDED, DELETION_SCHEDULED} plus Unverändert', () => {
    render(
      <UserEditDialog
        user={makeUser('ACTIVE')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const values = screen
      .getAllByRole('radio')
      .map((el) => (el as HTMLInputElement).value)
      .sort();
    expect(values).toEqual(['', 'DELETION_SCHEDULED', 'SUSPENDED']);
  });

  it('reveals the Sperrgrund textarea only when SUSPENDED is targeted', async () => {
    const user = userEvent.setup();
    render(
      <UserEditDialog
        user={makeUser('ACTIVE')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/Sperrgrund/i)).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Gesperrt/i }));
    expect(screen.getByLabelText(/Sperrgrund/i)).toBeInTheDocument();
  });

  it('blocks Save on ACTIVE → SUSPENDED until a reason is entered', async () => {
    const user = userEvent.setup();
    render(
      <UserEditDialog
        user={makeUser('ACTIVE')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /Gesperrt/i }));
    const save = screen.getByRole('button', { name: /Speichern/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(screen.getByPlaceholderText(/Grund wird beim Benutzer/i), 'Fraud probe');
    expect(save.disabled).toBe(false);
  });

  it('sends only the changed fields on PATCH (minimal diff)', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...makeUser('ACTIVE'),
          vorname: 'Grace',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    render(
      <UserEditDialog
        user={makeUser('ACTIVE')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const vornameInput = screen.getByLabelText('Vorname') as HTMLInputElement;
    await user.clear(vornameInput);
    await user.type(vornameInput, 'Grace');
    await user.click(screen.getByRole('button', { name: /Speichern/i }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ vorname: 'Grace' });
  });

  it('bundles address changes into a single adresse object', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeUser('ACTIVE')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(
      <UserEditDialog
        user={makeUser('ACTIVE')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const ort = screen.getByLabelText('Ort') as HTMLInputElement;
    await user.clear(ort);
    await user.type(ort, 'Hamburg');
    await user.click(screen.getByRole('button', { name: /Speichern/i }));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      adresse: {
        strasse: 'Musterstr.',
        hausnr: '1',
        plz: '10115',
        ort: 'Hamburg',
        land: 'DE',
      },
    });
  });

  it('surfaces the backend ERR_VALIDATION message on 400', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'ERR_VALIDATION',
            message: 'suspended_reason is required when suspending an ACTIVE user',
            details: { field: 'suspended_reason' },
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    render(
      <UserEditDialog
        user={makeUser('ACTIVE')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /Gesperrt/i }));
    await user.type(screen.getByPlaceholderText(/Grund wird beim Benutzer/i), 'reason');
    await user.click(screen.getByRole('button', { name: /Speichern/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/suspended_reason/i);
  });

  it('resets the form when opened against a different user', () => {
    const { rerender } = render(
      <UserEditDialog
        user={makeUser('ACTIVE', { vorname: 'A' })}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect((screen.getByLabelText('Vorname') as HTMLInputElement).value).toBe('A');

    rerender(
      <UserEditDialog
        user={makeUser('SUSPENDED', { vorname: 'B' })}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect((screen.getByLabelText('Vorname') as HTMLInputElement).value).toBe('B');
    // SUSPENDED → { ACTIVE, DELETION_SCHEDULED } plus Unverändert
    const values = screen
      .getAllByRole('radio')
      .map((el) => (el as HTMLInputElement).value)
      .sort();
    expect(values).toEqual(['', 'ACTIVE', 'DELETION_SCHEDULED']);
  });
});
