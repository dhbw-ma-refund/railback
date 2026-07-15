import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@shared/components';
import { Header } from '../../components/Header';
import { Footer } from '../../components/Footer';
import { useLanguage } from '../../lib/LanguageContext';
import { useWizard } from './WizardContext';
import { api } from '../../lib/api';
import type { EmailStatus, TicketResponse } from '../../lib/api';
import './SubmittedStep.css';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 30_000;

/**
 * Post-submit confirmation. The refund submit response (cached in
 * state.submitResult) tells us submitted_at, erwartete_erstattung, service
 * fee, and initial email_status. Then we poll GET /tickets/{id} every 3s
 * until email_status leaves SENDING or 30s elapses — that's how we know
 * whether the automated D-B email actually went out.
 *
 * "Done" (CTA) fires the full wizard reset so a subsequent /antrag/neu
 * starts fresh, then bounces to /dashboard where the ticket list picks
 * up the just-submitted claim.
 */
function formatEuroString(amount: string | undefined, currency: string): string {
  if (!amount) return '—';
  return `${amount.replace('.', ',')} ${currency}`;
}

function emailStatusLabel(status: EmailStatus | undefined, t: ReturnType<typeof useLanguage>['t']): string {
  if (!status) return t.wizard.submitted.emailSending;
  switch (status) {
    case 'SENDING':
    case 'FAILED_TRANSIENT':
      return t.wizard.submitted.emailSending;
    case 'SENT':
    case 'DELIVERED':
      return t.wizard.submitted.emailSent;
    case 'BOUNCED':
    case 'FAILED':
      return t.wizard.submitted.emailFailed;
    default:
      return t.wizard.submitted.emailSending;
  }
}

export const SubmittedStep = () => {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { t } = useLanguage();
  const { state, reset } = useWizard();

  const ticketId = search.get('id') || state.submitResult?.ticketId || state.ticketId || '';
  /** Soft-success flag from ReviewStep when the backend's PDF renderer
   *  hit an S3 IAM error. The claim is recorded, but the automated
   *  email to Deutsche Bahn couldn't be sent — we tell the user. */
  const hasPdfIssue = search.get('pdfIssue') === '1';

  const [status, setStatus] = useState<EmailStatus | undefined>(
    state.submitResult?.email_status,
  );
  const [erwartet, setErwartet] = useState<string | undefined>(state.submitResult?.erwartete_erstattung);
  const [fee, setFee] = useState<string | undefined>(state.submitResult?.service_fee_betrag);
  const [submittedAt, setSubmittedAt] = useState<string | undefined>(
    state.submitResult?.submitted_at,
  );

  useEffect(() => {
    if (!ticketId) return;
    // Poll for email status transitions. Stop when it leaves SENDING or after
    // 30s (whichever comes first).
    let cancelled = false;
    const start = Date.now();

    const tick = async () => {
      try {
        const ticket: TicketResponse = await api.getTicket(ticketId);
        if (cancelled) return;
        if (ticket.email_status) setStatus(ticket.email_status);
        if (ticket.erwartete_erstattung) setErwartet(ticket.erwartete_erstattung);
        if (ticket.service_fee_betrag) setFee(ticket.service_fee_betrag);
        if (ticket.submitted_at) setSubmittedAt(ticket.submitted_at);

        const terminal =
          !!ticket.email_status &&
          ticket.email_status !== 'SENDING' &&
          ticket.email_status !== 'FAILED_TRANSIENT';
        if (terminal) return;
        if (Date.now() - start > POLL_TIMEOUT_MS) return;
        setTimeout(() => void tick(), POLL_INTERVAL_MS);
      } catch {
        // Non-fatal — leave the last known status visible.
      }
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const done = () => {
    reset();
    navigate('/dashboard');
  };

  return (
    <div className="submitted-page">
      <Header />
      <main className="submitted-container">
        <div className="submitted-check" aria-hidden="true">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="submitted-title">
          {hasPdfIssue ? t.wizard.submitted.titleWithPdfIssue : t.wizard.submitted.title}
        </h1>
        <p className="submitted-body">
          {hasPdfIssue ? t.wizard.submitted.bodyWithPdfIssue : t.wizard.submitted.body}
        </p>

        <dl className="submitted-details">
          {submittedAt && (
            <div className="submitted-details__row">
              <dt>{t.wizard.submitted.submittedAt}</dt>
              <dd>{new Date(submittedAt).toLocaleString()}</dd>
            </div>
          )}
          {erwartet && (
            <div className="submitted-details__row">
              <dt>{t.wizard.submitted.expectedRefund}</dt>
              <dd>{formatEuroString(erwartet, 'EUR')}</dd>
            </div>
          )}
          {fee && (
            <div className="submitted-details__row">
              <dt>{t.wizard.submitted.serviceFee}</dt>
              <dd>{formatEuroString(fee, 'EUR')}</dd>
            </div>
          )}
          <div className="submitted-details__row">
            <dt>{t.wizard.submitted.emailStatus}</dt>
            <dd>{emailStatusLabel(status, t)}</dd>
          </div>
        </dl>

        <Button variant="primary" onClick={done}>
          {t.wizard.submitted.cta}
        </Button>
      </main>
      <Footer />
    </div>
  );
};
