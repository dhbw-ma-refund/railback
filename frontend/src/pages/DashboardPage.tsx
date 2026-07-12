import { useNavigate } from 'react-router-dom';
import { Button } from '@shared/components';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { StatusChip, TicketState } from '../components/StatusChip';
import { useLanguage } from '../lib/LanguageContext';
import './DashboardPage.css';

// Hardcoded static tickets. Shape follows the backend's TicketSummary contract
// (see backend/lambdas/user-handler/src/routes/get-tickets.ts) so this page
// can drop in real data later without a rewrite.
interface StaticTicket {
  ticketId: string;
  ticket_state: TicketState;
  abreisedatum: string;      // YYYY-MM-DD
  abreisebahnhof: string;
  zielbahnhof: string;
  reisende: string;
}

const STATIC_TICKETS: StaticTicket[] = [
  {
    ticketId: '01J9X2N3P4Q5R6S7T8U9V0W1X',
    ticket_state: 'PENDING_DB_PAYMENT',
    abreisedatum: '2026-06-12',
    abreisebahnhof: 'Mannheim Hbf',
    zielbahnhof: 'Karlsruhe Hbf',
    reisende: 'Maria Müller',
  },
  {
    ticketId: '01J9Y3M4N5P6Q7R8S9T0U1V2W',
    ticket_state: 'APPROVED',
    abreisedatum: '2026-05-28',
    abreisebahnhof: 'Frankfurt Hbf',
    zielbahnhof: 'Stuttgart Hbf',
    reisende: 'Maria Müller',
  },
  {
    ticketId: '01J9Z4L5M6N7P8Q9R0S1T2U3V',
    ticket_state: 'VALIDATING',
    abreisedatum: '2026-07-02',
    abreisebahnhof: 'Heidelberg Hbf',
    zielbahnhof: 'München Hbf',
    reisende: 'Maria Müller',
  },
];

// Display: REQ-<last 6 chars of ULID> keeps the sketch's "REQ-2026-000123" feel
// without inventing a separate namespace (backend explicitly says ticketId IS
// the Antragsnummer, prefix is display-only).
const formatClaimId = (ticketId: string) => `REQ-${ticketId.slice(-9).toUpperCase()}`;

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

export const DashboardPage = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();

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

          {STATIC_TICKETS.length === 0 ? (
            <p className="dashboard-claims__empty">{t.dashboard.empty}</p>
          ) : (
            <ul className="dashboard-claims__list">
              {STATIC_TICKETS.map((ticket) => (
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
                    <div>
                      <dt>{t.dashboard.date}:</dt>
                      <dd>{formatDate(ticket.abreisedatum)}</dd>
                    </div>
                    <div>
                      <dt>{t.dashboard.trip}:</dt>
                      <dd>
                        {ticket.abreisebahnhof} → {ticket.zielbahnhof}
                      </dd>
                    </div>
                    <div>
                      <dt>{t.dashboard.traveler}:</dt>
                      <dd>{ticket.reisende}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="dashboard-actions">
          <Button variant="secondary" onClick={() => navigate('/faq')}>
            {t.dashboard.faq}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = 'mailto:support@railback.de?subject=Support-Anfrage%20RailBack';
            }}
          >
            {t.dashboard.help}
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
};
