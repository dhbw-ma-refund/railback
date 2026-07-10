import { useNavigate } from 'react-router-dom';
import { StatusChip, TicketState } from './StatusChip';
import { useLanguage } from '../lib/LanguageContext';
import { TicketSummary } from '../lib/api';
import './ClaimsList.css';

// Display: REQ-<letzte 9 Zeichen der ULID>. Backend sagt: ticketId IST die
// Antragsnummer, der REQ-Prefix ist reine Anzeige — roher ULID geht zurück.
const formatClaimId = (ticketId: string) => `REQ-${ticketId.slice(-9).toUpperCase()}`;

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

// Contract-Geld: Dezimal-String ("29.90"), EUR implizit → "29,90 €".
const formatMoney = (value: string) => `${value.replace('.', ',')} €`;

interface ClaimsListProps {
  tickets: TicketSummary[];
  loading: boolean;
  error: boolean;
}

/**
 * Rendert die Anträge des Nutzers als responsives Karten-Grid. Rein
 * präsentational — Daten kommen vom Aufrufer (siehe useTickets). Wird auf der
 * Landingpage (eingeloggt) verwendet und ist bewusst eigenständig gehalten.
 */
export const ClaimsList = ({ tickets, loading, error }: ClaimsListProps) => {
  const navigate = useNavigate();
  const { t, lang } = useLanguage();

  if (loading) {
    return <p className="claims-list__state">{t.dashboard.loading}</p>;
  }

  if (error) {
    return <p className="claims-list__state claims-list__state--error">{t.dashboard.loadError}</p>;
  }

  if (tickets.length === 0) {
    return <p className="claims-list__state">{t.dashboard.empty}</p>;
  }

  return (
    <ul className="claims-list">
      {tickets.map((ticket) => (
        <li key={ticket.ticketId} className="claims-card">
          <div className="claims-card__head">
            <span className="claims-card__id">{formatClaimId(ticket.ticketId)}</span>
            <span className="claims-card__dot" aria-hidden="true">•</span>
            <StatusChip state={ticket.ticket_state as TicketState} lang={lang} />
            <button
              type="button"
              className="claims-card__details"
              onClick={() => navigate(`/antrag/${ticket.ticketId}`)}
            >
              {t.dashboard.details}
            </button>
          </div>
          <dl className="claims-card__body">
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
            {ticket.erwartete_erstattung ? (
              <div>
                <dt>{t.dashboard.refund}:</dt>
                <dd>{formatMoney(ticket.erwartete_erstattung)}</dd>
              </div>
            ) : (
              <div>
                <dt>{t.dashboard.price}:</dt>
                <dd>{formatMoney(ticket.fahrkartenpreis)}</dd>
              </div>
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
};
