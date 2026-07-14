import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UserDetailPage } from './UserDetailPage';
import { ToastProvider } from '../ui/Toast';
import { clearTokens, setTokens } from '../services/auth/storage';

function renderPage(email = 'ada%40example.de') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/admin-panel/users/${email}`]}>
        <Routes>
          <Route path="/admin-panel/users/:email" element={<UserDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const BASE_USER = {
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
  user_state: 'ACTIVE',
  suspended_at: null,
  suspended_reason: null,
  created_at: '2026-01-01T10:00:00+02:00',
  ticket_count: 3,
  total_refunded: '42.00',
};

describe('UserDetailPage — Bankverbindung', () => {
  beforeEach(() => {
    setTokens('a', 'r', Math.floor(Date.now() / 1000) + 3600);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('renders IBAN and BIC when the backend returns them', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        ...BASE_USER,
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
      }),
    );
    renderPage();
    expect(await screen.findByText('DE89370400440532013000')).toBeInTheDocument();
    expect(screen.getByText('COBADEFFXXX')).toBeInTheDocument();
    expect(screen.getByText('Bankverbindung')).toBeInTheDocument();
  });

  it('renders em-dashes when IBAN/BIC are null (mandate not yet issued)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { ...BASE_USER, iban: null, bic: null }),
    );
    renderPage();
    // Ensure the section still renders and there are placeholders.
    expect(await screen.findByText('Bankverbindung')).toBeInTheDocument();
    // Two Field rows in this section should render '—' when values are null.
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});
