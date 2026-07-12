import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TicketDetailPage } from './TicketDetailPage';
import { ToastProvider } from '../ui/Toast';
import type { Ticket, TicketState } from '../services/types/ticket';
import { clearTokens, setTokens } from '../services/auth/storage';

function makeTicket(state: TicketState, overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticketId: 'T1',
    email: 'a@b.example',
    vorname: 'Ada',
    nachname: 'Beispiel',
    ticket_state: state,
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
    fahrt_abreisedatum: '2026-07-01',
    fahrt_abreisebahnhof: 'Berlin Hbf',
    fahrt_zielbahnhof: 'Hamburg Hbf',
    fahrt_abfahrtszeit_plan: '10:00',
    fahrt_ankunftszeit_plan: '12:00',
    fahrt_zugnummer_plan: 'ICE 500',
    fahrt_zugkategorie_plan: 'ICE',
    fahrt_fahrkartennummer: 'F-1',
    fahrt_fahrkartenpreis: '49.00',
    tatsaechlich_ankunftsdatum: null,
    tatsaechlich_abfahrtszeit: null,
    tatsaechlich_ankunftszeit: null,
    tatsaechlich_zugnummer: null,
    tatsaechlich_verpasster_anschluss_bahnhof: null,
    antragstellung_ort: null,
    zusaetzliche_angaben: null,
    extraction_method: 'BARCODE',
    extraction_confidence: 0.9,
    barcode_uid: null,
    state_timeline: [],
    has_belege: false,
    service_fee_betrag: '1.50',
    db_paid_at: null,
    admin_note: null,
    email_status: null,
    email_provider_id: null,
    email_failed_reason: null,
    mandate_id: null,
    pain008_batch_id: null,
    pain008_built_at: null,
    pain008_s3_key: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/admin-panel/tickets/T1']}>
        <Routes>
          <Route path="/admin-panel/tickets/:ticketId" element={<TicketDetailPage />} />
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

describe('TicketDetailPage — pain.008 rebuild button', () => {
  beforeEach(() => {
    setTokens('a', 'r', Math.floor(Date.now() / 1000) + 3600);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('is disabled when ticket_state !== APPROVED', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeTicket('PENDING_DB_PAYMENT')));
    renderPage();
    const btn = await screen.findByRole('button', { name: /pain\.008 neu erzeugen/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/APPROVED/);
  });

  it('is disabled when pain008_built_at is already set', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        200,
        makeTicket('APPROVED', {
          pain008_built_at: '2026-07-12T09:14:00.000Z',
          pain008_batch_id: 'B1',
        }),
      ),
    );
    renderPage();
    const btn = await screen.findByRole('button', { name: /pain\.008 neu erzeugen/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/bereits/i);
  });

  it('is enabled on APPROVED with no built_at, and POSTs on confirm', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeTicket('APPROVED')))
      // rebuild call
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ticketId: 'T1',
          mandate_id: 'MND-1',
          pain008_batch_id: 'B1',
          pain008_built_at: '2026-07-12T10:05:00.000Z',
          pain008_s3_key: 'pain008/2026-07-12/B1.xml',
        }),
      )
      // refetch after rebuild
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          makeTicket('APPROVED', {
            mandate_id: 'MND-1',
            pain008_batch_id: 'B1',
            pain008_built_at: '2026-07-12T10:05:00.000Z',
            pain008_s3_key: 'pain008/2026-07-12/B1.xml',
          }),
        ),
      );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /pain\.008 neu erzeugen/i });
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    // The rebuild POST landed on the right URL with an empty body.
    const rebuildCall = vi.mocked(fetch).mock.calls[1];
    expect(String(rebuildCall[0])).toContain('/admin/tickets/T1/pain008-rebuild');
    expect((rebuildCall[1] as RequestInit).method).toBe('POST');
    expect((rebuildCall[1] as RequestInit).body).toBe('{}');
  });

  it('does not send when the confirm dialog is dismissed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeTicket('APPROVED')));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /pain\.008 neu erzeugen/i });
    await user.click(btn);
    // Only the initial GET happened.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });
});
