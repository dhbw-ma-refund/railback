import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StateOverrideDialog } from './StateOverrideDialog';
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

describe('StateOverrideDialog', () => {
  beforeEach(() => {
    setTokens('a', 'r', Math.floor(Date.now() / 1000) + 3600);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('shows the pipeline-waiting copy for system-owned states (VALIDATING) with no radio options', () => {
    render(
      <StateOverrideDialog
        ticket={makeTicket('VALIDATING')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText(/vom System verwaltet/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows the terminal-state copy for COMPLETED with no radio options', () => {
    render(
      <StateOverrideDialog
        ticket={makeTicket('COMPLETED')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText(/Endzustand/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('renders the contract-allowed transitions from PENDING_DB_PAYMENT', () => {
    render(
      <StateOverrideDialog
        ticket={makeTicket('PENDING_DB_PAYMENT')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const values = screen
      .getAllByRole('radio')
      .map((el) => (el as HTMLInputElement).value)
      .sort();
    expect(values).toEqual(['APPROVED', 'INVALID', 'REJECTED']);
  });

  it('shows the db_paid_at datetime input only when APPROVED is selected', async () => {
    const user = userEvent.setup();
    render(
      <StateOverrideDialog
        ticket={makeTicket('PENDING_DB_PAYMENT')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/DB-Zahlung eingegangen am/i)).toBeNull();
    await user.click(screen.getByRole('radio', { name: /APPROVED/i }));
    expect(screen.getByLabelText(/DB-Zahlung eingegangen am/i)).toBeInTheDocument();
  });

  it('blocks Speichern for REJECTED until a note is entered', async () => {
    const user = userEvent.setup();
    render(
      <StateOverrideDialog
        ticket={makeTicket('PENDING_DB_PAYMENT')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /REJECTED/i }));
    const save = screen.getByRole('button', { name: /Speichern/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.type(screen.getByPlaceholderText(/Begründung/i), 'Ticket ist Fake.');
    expect(save.disabled).toBe(false);
  });

  it('PATCHes the ticket and reports the updated payload on save', async () => {
    const user = userEvent.setup();
    const updated: Ticket = makeTicket('APPROVED', { db_paid_at: '2026-07-04T12:00:00Z' });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(updated), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const onSaved = vi.fn();
    render(
      <StateOverrideDialog
        ticket={makeTicket('PENDING_DB_PAYMENT')}
        open={true}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /APPROVED/i }));
    await user.click(screen.getByRole('button', { name: /Speichern/i }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/tickets\/T1$/);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ ticket_state: 'APPROVED' });
    expect(onSaved).toHaveBeenCalledWith(updated);
  });

  it('surfaces a friendly message when the backend responds 409 ERR_CONFLICT', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'ERR_CONFLICT', message: 'invalid transition' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );
    render(
      <StateOverrideDialog
        ticket={makeTicket('PENDING_DB_PAYMENT')}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /INVALID/i }));
    await user.type(screen.getByPlaceholderText(/Begründung/i), 'Nope.');
    await user.click(screen.getByRole('button', { name: /Speichern/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/nicht erlaubt/i);
  });
});
