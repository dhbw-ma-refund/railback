import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSmartBack } from '../hooks/useSmartBack';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { StatusChip } from '../components/StatusChip';
import { useLanguage } from '../lib/LanguageContext';
import { api } from '../lib/api';
import type { Antragsart, Antragsgrund, EmailStatus, TicketResponse } from '../lib/api';
import { ApiError } from '@shared/api/errors';
import './ClaimDetailPage.css';

const ANTRAGSART_LABELS_DE: Record<Antragsart, string> = {
  ERSTATTUNG_FAHRKARTE: 'Erstattung Fahrkarte',
  ENTSCHAEDIGUNG_60_119: 'Entschädigung (60–119 Min. Verspätung)',
  ENTSCHAEDIGUNG_120_PLUS: 'Entschädigung (ab 120 Min. Verspätung)',
  ENTSCHAEDIGUNG_ZEITKARTE: 'Entschädigung Zeitkarte',
  KOSTEN_ALTERNATIVTRANSPORT: 'Kosten Alternativtransport',
};

const ANTRAGSGRUND_LABELS_DE: Record<Antragsgrund, string> = {
  VERSPAETUNG: 'Verspätung',
  AUSFALL: 'Zugausfall',
  VERPASSTER_ANSCHLUSS: 'Verpasster Anschluss',
};

const EMAIL_STATUS_LABELS_DE: Record<EmailStatus, string> = {
  SENDING: 'Wird versendet',
  SENT: 'Versendet',
  FAILED_TRANSIENT: 'Vorübergehend fehlgeschlagen',
  DELIVERED: 'Zugestellt',
  BOUNCED: 'Zurückgewiesen',
  FAILED: 'Fehlgeschlagen',
};

const formatClaimId = (ticketId: string) => `REQ-${ticketId.slice(-9).toUpperCase()}`;

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

const formatDateTime = (iso: string) => {
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y} ${time}`;
};

const formatEuro = (decimal: string) => `${decimal.replace('.', ',')} €`;

/**
 * Live claim detail page — GET /users/me/tickets/{id} on mount. Renders
 * the same sections as before (Antrag / Trip / Traveler / Email / Timeline),
 * but every value comes from the real TicketResponse. Fields that aren't
 * yet populated (e.g. delay/actual times on a MANUAL_ROUTE ticket) are
 * shown as "—" instead of hidden, so the layout stays predictable.
 */
export const ClaimDetailPage = () => {
  const goBack = useSmartBack('/dashboard');
  const { t } = useLanguage();
  const { ticketId } = useParams<{ ticketId: string }>();

  const [ticket, setTicket] = useState<TicketResponse | null>(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;
    void (async () => {
      try {
        const t = await api.getTicket(ticketId);
        if (!cancelled) setTicket(t);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else if (err instanceof ApiError) {
          setError(err.body.message || t.claimDetail.loadError);
        } else {
          setError(t.claimDetail.loadError);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketId, t.claimDetail.loadError]);

  const displayId = ticket
    ? formatClaimId(ticket.ticketId)
    : ticketId
      ? formatClaimId(ticketId)
      : '—';

  if (notFound) {
    return (
      <div className="claim-detail-page">
        <Header />
        <main className="claim-detail-container">
          <button type="button" className="claim-detail__back" onClick={goBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {t.claimDetail.back}
          </button>
          <p className="claim-detail__updated">{t.claimDetail.notFound}</p>
        </main>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="claim-detail-page">
        <Header />
        <main className="claim-detail-container">
          <button type="button" className="claim-detail__back" onClick={goBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {t.claimDetail.back}
          </button>
          <div className="error-message">{error}</div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="claim-detail-page">
        <Header />
        <main className="claim-detail-container">
          <p className="claim-detail__updated">{t.claimDetail.loading}</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="claim-detail-page">
      <Header />
      <main className="claim-detail-container">
        <button type="button" className="claim-detail__back" onClick={goBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t.claimDetail.back}
        </button>

        <header className="claim-detail__header">
          <div className="claim-detail__id-row">
            <h1 className="claim-detail__id">{displayId}</h1>
            <StatusChip state={ticket.ticket_state} />
          </div>
          <p className="claim-detail__updated">
            {t.claimDetail.updated}: {formatDateTime(ticket.updated_at)}
          </p>
        </header>

        {/* Antrag */}
        <section className="claim-detail__section">
          <h2 className="claim-detail__section-title">{t.claimDetail.claim}</h2>
          <dl className="claim-detail__dl">
            <div>
              <dt>{t.claimDetail.antragsart}</dt>
              <dd>{ticket.antragsart ? ANTRAGSART_LABELS_DE[ticket.antragsart] : '—'}</dd>
            </div>
            <div>
              <dt>{t.claimDetail.antragsgrund}</dt>
              <dd>
                {ticket.antragsgrund && ticket.antragsgrund.length > 0
                  ? ticket.antragsgrund.map((g) => ANTRAGSGRUND_LABELS_DE[g]).join(', ')
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>{t.claimDetail.delay}</dt>
              <dd>{ticket.delayMinutes !== undefined ? `${ticket.delayMinutes} min` : '—'}</dd>
            </div>
            <div>
              <dt>{t.claimDetail.expectedRefund}</dt>
              <dd className="claim-detail__amount">
                {ticket.erwartete_erstattung ? formatEuro(ticket.erwartete_erstattung) : '—'}
              </dd>
            </div>
          </dl>
        </section>

        {/* Trip planned vs actual */}
        <section className="claim-detail__section">
          <h2 className="claim-detail__section-title">{t.claimDetail.trip}</h2>
          <dl className="claim-detail__dl">
            <div>
              <dt>{t.claimDetail.date}</dt>
              <dd>{ticket.fahrt_abreisedatum ? formatDate(ticket.fahrt_abreisedatum) : '—'}</dd>
            </div>
            <div>
              <dt>{t.claimDetail.route}</dt>
              <dd>
                {ticket.fahrt_abreisebahnhof ?? '—'} → {ticket.fahrt_zielbahnhof ?? '—'}
              </dd>
            </div>
            <div>
              <dt>{t.claimDetail.train}</dt>
              <dd>{ticket.fahrt_zugnummer_plan ?? '—'}</dd>
            </div>
            <div>
              <dt>{t.claimDetail.scheduled}</dt>
              <dd>
                {ticket.fahrt_abfahrtszeit_plan ?? '—'} → {ticket.fahrt_ankunftszeit_plan ?? '—'}
              </dd>
            </div>
            {(ticket.tatsaechlich_abfahrtszeit || ticket.tatsaechlich_ankunftszeit) && (
              <div>
                <dt>{t.claimDetail.actual}</dt>
                <dd className="claim-detail__actual">
                  {ticket.tatsaechlich_abfahrtszeit ?? '—'} →{' '}
                  {ticket.tatsaechlich_ankunftszeit ?? '—'}
                  {!!ticket.delayMinutes && ticket.delayMinutes > 0 && (
                    <span className="claim-detail__delay-tag" aria-label={t.claimDetail.delayedTag}>
                      {t.claimDetail.delayedTag}
                    </span>
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt>{t.claimDetail.ticketPrice}</dt>
              <dd>{ticket.fahrt_fahrkartenpreis ? formatEuro(ticket.fahrt_fahrkartenpreis) : '—'}</dd>
            </div>
          </dl>
        </section>

        {/* Traveler */}
        {(ticket.vorname_aus_ticket || ticket.nachname_aus_ticket) && (
          <section className="claim-detail__section">
            <h2 className="claim-detail__section-title">{t.claimDetail.traveler}</h2>
            <dl className="claim-detail__dl">
              <div>
                <dt>{t.claimDetail.name}</dt>
                <dd>
                  {ticket.vorname_aus_ticket ?? ''} {ticket.nachname_aus_ticket ?? ''}
                </dd>
              </div>
            </dl>
          </section>
        )}

        {/* Email */}
        <section className="claim-detail__section">
          <h2 className="claim-detail__section-title">{t.claimDetail.email}</h2>
          <dl className="claim-detail__dl">
            <div>
              <dt>{t.claimDetail.emailStatus}</dt>
              <dd>{ticket.email_status ? EMAIL_STATUS_LABELS_DE[ticket.email_status] : '—'}</dd>
            </div>
            <div>
              <dt>{t.claimDetail.submittedAt}</dt>
              <dd>{ticket.submitted_at ? formatDateTime(ticket.submitted_at) : '—'}</dd>
            </div>
          </dl>
        </section>

        {/* Timeline */}
        <section className="claim-detail__section">
          <h2 className="claim-detail__section-title">{t.claimDetail.timeline}</h2>
          <ol className="claim-detail__timeline">
            {ticket.state_timeline.map((step, i) => (
              <li
                key={i}
                className={
                  'claim-detail__timeline-step' +
                  (i === ticket.state_timeline.length - 1
                    ? ' claim-detail__timeline-step--current'
                    : '')
                }
              >
                <span className="claim-detail__timeline-dot" aria-hidden="true" />
                <div className="claim-detail__timeline-body">
                  <StatusChip state={step.state} />
                  <time className="claim-detail__timeline-time">{formatDateTime(step.at)}</time>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <Footer />
    </div>
  );
};
