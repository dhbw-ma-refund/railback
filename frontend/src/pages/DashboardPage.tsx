import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@shared/components';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { StatusChip } from '../components/StatusChip';
import { useLanguage } from '../lib/LanguageContext';
import { api } from '../lib/api';
import type { TicketSummary } from '../lib/api';
import { ApiError } from '@shared/api/errors';
import './DashboardPage.css';

/**
 * Live user dashboard — GET /users/me/tickets on mount, then render one
 * card per ticket. The backend returns items sorted by updated_at DESC.
 * "Erstattung starten" jumps into the wizard.
 *
 * The "reisende" field the static version showed doesn't exist on the
 * TicketSummary schema (backend serialises only trip data); we display
 * antragsart / erwartete_erstattung / email_status instead where present.
 */
const formatClaimId = (ticketId: string) => `REQ-${ticketId.slice(-9).toUpperCase()}`;

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

export const DashboardPage = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.getTickets();
        if (cancelled) return;
        setTickets(res.items);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.body.message || t.dashboard.loadError : t.dashboard.loadError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t.dashboard.loadError]);

  return (
    <div className="dashboard-page">
      <Header />
      <main className="dashboard-container">
        <section className="dashboard-hero">
          <h1 className="dashboard-hero__title">{t.dashboard.heroTitle}</h1>
          <p className="dashboard-hero__sub">{t.dashboard.heroSub}</p>
          <Button variant="primary" onClick={() => navigate('/antrag/neu')}>
            {t.dashboard.startCta}
          </Button>
        </section>

        <section className="dashboard-claims" aria-labelledby="claims-heading">
          <h2 id="claims-heading" className="dashboard-claims__title">
            {t.dashboard.claimsTitle}
          </h2>

          {error && <div className="error-message">{error}</div>}

          {tickets === null && !error ? (
            <p className="dashboard-claims__empty">{t.dashboard.loading}</p>
          ) : tickets && tickets.length === 0 ? (
            <p className="dashboard-claims__empty">{t.dashboard.empty}</p>
          ) : tickets ? (
            <ul className="dashboard-claims__list">
              {tickets.map((ticket) => (
                <li key={ticket.ticketId} className="claim-card">
                  <div className="claim-card__row claim-card__row--head">
                    <span className="claim-card__id">{formatClaimId(ticket.ticketId)}</span>
                    <StatusChip state={ticket.ticket_state} />
                    <button
                      type="button"
                      className="claim-card__details"
                      onClick={() => navigate(`/antrag/${ticket.ticketId}`)}
                    >
                      {t.dashboard.details}
                    </button>
                  </div>
                  <dl className="claim-card__body">
                    {ticket.abreisedatum && (
                      <div>
                        <dt>{t.dashboard.date}:</dt>
                        <dd>{formatDate(ticket.abreisedatum)}</dd>
                      </div>
                    )}
                    {(ticket.abreisebahnhof || ticket.zielbahnhof) && (
                      <div>
                        <dt>{t.dashboard.trip}:</dt>
                        <dd>
                          {ticket.abreisebahnhof ?? '—'} → {ticket.zielbahnhof ?? '—'}
                        </dd>
                      </div>
                    )}
                    {ticket.erwartete_erstattung && (
                      <div>
                        <dt>{t.dashboard.expected}:</dt>
                        <dd>{ticket.erwartete_erstattung.replace('.', ',')} €</dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </main>
      <Footer />
    </div>
  );
};
