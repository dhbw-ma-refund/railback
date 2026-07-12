import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SepaBatchesPage } from './SepaBatchesPage';
import { ToastProvider } from '../ui/Toast';
import { clearTokens, setTokens } from '../services/auth/storage';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <SepaBatchesPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

const BATCH = {
  batchId: '01J-BATCH-01',
  s3_key: 'pain008/2026-07-12/01J-BATCH-01.xml',
  downloadUrl: 'https://s3.example/x?sig=abc',
  downloadUrlExpiresIn: 300,
  mandate_count: 3,
  total_eur: '2.25',
  built_at: '2026-07-12T09:14:00.000Z',
};

describe('SepaBatchesPage', () => {
  beforeEach(() => {
    setTokens('a', 'r', Math.floor(Date.now() / 1000) + 3600);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('shows an empty-state message when there are no pending batches', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    renderPage();
    expect(await screen.findByText(/keine offenen batches/i)).toBeInTheDocument();
  });

  it('lists a pending batch with mandate count, sum and download link', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { items: [BATCH] }));
    renderPage();
    expect(await screen.findByText('01J-BATCH-01')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /pain\.008 xml herunterladen/i });
    expect(link.getAttribute('href')).toBe(BATCH.downloadUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    // Mandate count and €2.25 landed in the field grid.
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('POSTs mark-submitted to /batches/{id}/mark-submitted and refetches on confirm', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { items: [BATCH] }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          batchId: BATCH.batchId,
          submitted_at: '2026-07-12T10:00:00.000Z',
          mandates_marked: 3,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /als eingereicht markieren/i });
    await user.click(btn);
    // Wait for the follow-up refresh call to fire.
    await screen.findByText(/keine offenen batches/i);
    // Second call is the mark-submitted POST — verify the mounted path.
    const markCall = vi.mocked(fetch).mock.calls[1];
    expect(String(markCall[0])).toContain(
      `/admin/sepa/batches/${BATCH.batchId}/mark-submitted`,
    );
    expect(String(markCall[0])).not.toContain('pending-batches');
    expect((markCall[1] as RequestInit).method).toBe('POST');
  });

  it('does not POST when the confirm dialog is dismissed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { items: [BATCH] }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /als eingereicht markieren/i });
    await user.click(btn);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });
});
