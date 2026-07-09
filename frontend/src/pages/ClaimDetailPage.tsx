import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { StatusChip, TicketState } from '../components/StatusChip';
import { useLanguage } from '../lib/LanguageContext';
import './ClaimDetailPage.css';

// Hardcoded static ticket detail. Shape follows the backend's TicketResponse
// projection (see backend/lambdas/user-handler/src/routes/get-ticket.ts).
// Every field on this object corresponds 1:1 to a field in the real API
// contract so this page can drop in a fetched ticket later without a rewrite.
interface StaticTicketDetail {
  ticketId: string;
  ticket_state: TicketState;
  state_timeline: Array<{ state: TicketState; at: string }>;
  updated_at: string;
  submitted_at: string;

  // Traveler identity (from barcode on the ticket file)
  vorname_aus_ticket: string;
  nachname_aus_ticket: string;

  // Planned trip
  fahrt_abreisedatum: string;
  fahrt_abreisebahnhof: string;
  fahrt_zielbahnhof: string;
  fahrt_abfahrtszeit_plan: string;
  fahrt_ankunftszeit_plan: string;
  fahrt_zugnummer_plan: string;
  fahrt_fahrkartenpreis: string;

  // Actual trip
  tatsaechlich_abfahrtszeit: string;
  tatsaechlich_ankunftszeit: string;

  // Claim details
  antragsart:
    | 'ERSTATTUNG_FAHRKARTE'
    | 'ENTSCHAEDIGUNG_60_119'
    | 'ENTSCHAEDIGUNG_120_PLUS'
    | 'ENTSCHAEDIGUNG_ZEITKARTE'
    | 'KOSTEN_ALTERNATIVTRANSPORT';
  antragsgrund: Array<'VERSPAETUNG' | 'AUSFALL' | 'VERPASSTER_ANSCHLUSS'>;
  delayMinutes: number;
  erwartete_erstattung: string;

  // Email pipeline
  email_status: 'SENDING' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'FAILED';

  belege_count: number;
}

const STATIC_DETAIL: StaticTicketDetail = {
  ticketId: '01J9X2N3P4Q5R6S7T8U9V0W1X',
  ticket_state: 'PENDING_DB_PAYMENT',
  state_timeline: [
    { state: 'VALIDATING', at: '2026-06-12T09:12:04+02:00' },
    { state: 'READY', at: '2026-06-12T09:12:41+02:00' },
    { state: 'EMAIL_SENDING', at: '2026-06-12T09:15:12+02:00' },
    { state: 'PENDING_DB_PAYMENT', at: '2026-06-12T09:15:47+02:00' },
  ],
  updated_at: '2026-06-12T09:15:47+02:00',
  submitted_at: '2026-06-12T09:15:12+02:00',
  vorname_aus_ticket: 'Maria',
  nachname_aus_ticket: 'Müller',
  fahrt_abreisedatum: '2026-06-12',
  fahrt_abreisebahnhof: 'Mannheim Hbf',
  fahrt_zielbahnhof: 'Karlsruhe Hbf',
  fahrt_abfahrtszeit_plan: '08:14',
  fahrt_ankunftszeit_plan: '08:45',
  fahrt_zugnummer_plan: 'IC 2345',
  fahrt_fahrkartenpreis: '29.90',
  tatsaechlich_abfahrtszeit: '08:47',
  tatsaechlich_ankunftszeit: '09:52',
  antragsart: 'ENTSCHAEDIGUNG_60_119',
  antragsgrund: ['VERSPAETUNG'],
  delayMinutes: 67,
  erwartete_erstattung: '14.95',
  email_status: 'DELIVERED',
  belege_count: 0,
};

const ANTRAGSART_LABELS_DE: Record<StaticTicketDetail['antragsart'], string> = {
  ERSTATTUNG_FAHRKARTE: 'Erstattung Fahrkarte',
  ENTSCHAEDIGUNG_60_119: 'Entschädigung (60–119 Min. Verspätung)',
  ENTSCHAEDIGUNG_120_PLUS: 'Entschädigung (ab 120 Min. Verspätung)',
  ENTSCHAEDIGUNG_ZEITKARTE: 'Entschädigung Zeitkarte',
  KOSTEN_ALTERNATIVTRANSPORT: 'Kosten Alternativtransport',
};

const ANTRAGSGRUND_LABELS_DE: Record<StaticTicketDetail['antragsgrund'][number], string> = {
  VERSPAETUNG: 'Verspätung',
  AUSFALL: 'Zugausfall',
  VERPASSTER_ANSCHLUSS: 'Verpasster Anschluss',
};

const EMAIL_STATUS_LABELS_DE: Record<StaticTicketDetail['email_status'], string> = {
  SENDING: 'Wird versendet',
  SENT: 'Versendet',
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

export const ClaimDetailPage = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { ticketId } = useParams<{ ticketId: string }>();

  // Static: always render the same detail regardless of :ticketId. We keep
  // ticketId in the URL so the REQ chip and back-link reflect what the user
  // clicked; the underlying data is fixed until the API is wired up.
  const ticket = STATIC_DETAIL;
  const displayId = ticketId ? formatClaimId(ticketId) : formatClaimId(ticket.ticketId);

  return (
    <div className="claim-detail-page">
      <Header />
      <main className="claim-detail-container">
        <button
          type="button"
          className="claim-detail__back"
          onClick={() => navigate('/dashboard')}
        >
          ← {t.claimDetail.back}
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
              <dd>{ANTRAGSART_LABELS_DE[ticket.antragsart]}</dd>
            </div>
            <div>
              <dt>{t.claimDetail.antragsgrund}</dt>
              <dd>
                {ticket.antragsgrund.map((g) => ANTRAGSGRUND_LABELS_DE[g]).join(', ')}
              </dd>
            </div>
            <div>
              <dt>{t.claimDetail.delay}</dt>
              <dd>{ticket.delayMinutes} min</dd>
            </div>
            <div>
              <dt>{t.claimDetail.expectedRefund}</dt>
              <dd className="claim-detail__amount">
                {formatEuro(ticket.erwartete_erstattung)}
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
              <dd>{formatDate(ticket.fahrt_abreisedatum)}</dd>
            </div>
            <div>
              <dt>{t.claimDetail.route}</dt>
              <dd>
                {ticket.fahrt_abreisebahnhof} → {ticket.fahrt_zielbahnhof}
              </dd>
            </div>
            <div>
              <dt>{t.claimDetail.train}</dt>
              <dd>{ticket.fahrt_zugnummer_plan}</dd>
            </div>
            <div>
              <dt>{t.claimDetail.scheduled}</dt>
              <dd>
                {ticket.fahrt_abfahrtszeit_plan} → {ticket.fahrt_ankunftszeit_plan}
              </dd>
            </div>
            <div>
              <dt>{t.claimDetail.actual}</dt>
              <dd className="claim-detail__actual">
                {ticket.tatsaechlich_abfahrtszeit} → {ticket.tatsaechlich_ankunftszeit}
              </dd>
            </div>
            <div>
              <dt>{t.claimDetail.ticketPrice}</dt>
              <dd>{formatEuro(ticket.fahrt_fahrkartenpreis)}</dd>
            </div>
          </dl>
        </section>

        {/* Traveler */}
        <section className="claim-detail__section">
          <h2 className="claim-detail__section-title">{t.claimDetail.traveler}</h2>
          <dl className="claim-detail__dl">
            <div>
              <dt>{t.claimDetail.name}</dt>
              <dd>
                {ticket.vorname_aus_ticket} {ticket.nachname_aus_ticket}
              </dd>
            </div>
          </dl>
        </section>

        {/* Email */}
        <section className="claim-detail__section">
          <h2 className="claim-detail__section-title">{t.claimDetail.email}</h2>
          <dl className="claim-detail__dl">
            <div>
              <dt>{t.claimDetail.emailStatus}</dt>
              <dd>{EMAIL_STATUS_LABELS_DE[ticket.email_status]}</dd>
            </div>
            <div>
              <dt>{t.claimDetail.submittedAt}</dt>
              <dd>{formatDateTime(ticket.submitted_at)}</dd>
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
                  <time className="claim-detail__timeline-time">
                    {formatDateTime(step.at)}
                  </time>
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
