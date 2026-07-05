import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useAdminGoBack } from '../services/hooks/useAdminGoBack';
import { ApiError } from '../services/api/errors';
import { ticketsApi } from '../services/api/tickets';
import type { Ticket } from '../services/types/ticket';
import { fmtDate, fmtDateTime } from '../services/format/date';
import { fmtEUR } from '../services/format/money';
import { TicketStateBadge } from '../ui/TicketStateBadge';
import './DetailPage.css';

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rb-detail__field">
      <span className="rb-detail__label">{label}</span>
      <span className="rb-detail__value">{value ?? '—'}</span>
    </div>
  );
}

export function TicketDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const goBack = useAdminGoBack('/admin-panel/tickets');
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!ticketId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setNotFound(false);
    ticketsApi
      .getTicket(ticketId, controller.signal)
      .then(setTicket)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Ticket konnte nicht geladen werden.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ticketId]);

  if (loading) {
    return (
      <div className="rb-detail">
        <div className="rb-detail__loading">Lädt…</div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="rb-detail">
        <button className="rb-detail__back" onClick={() => goBack()}>
          ← Zurück
        </button>
        <h1 className="rb-detail__title">Ticket nicht gefunden</h1>
        <p>Für die ID „{ticketId}" liegt kein Datensatz vor.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rb-detail">
        <button className="rb-detail__back" onClick={() => goBack()}>
          ← Zurück
        </button>
        <div className="rb-detail__error" role="alert">
          {error}
        </div>
      </div>
    );
  }
  if (!ticket) return null;

  return (
    <div className="rb-detail">
      <button className="rb-detail__back" onClick={() => goBack()}>
        ← Zurück
      </button>
      <h1 className="rb-detail__title">Ticket {ticket.ticketId}</h1>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Reisende:r</h2>
        <div className="rb-detail__grid">
          <Field label="Vorname" value={ticket.vorname} />
          <Field label="Nachname" value={ticket.nachname} />
          <Field label="E-Mail" value={ticket.email} />
        </div>
      </section>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Fahrkarte</h2>
        <div className="rb-detail__grid">
          <Field label="Fahrkartennummer" value={ticket.fahrt_fahrkartennummer} />
          <Field label="Fahrkartenpreis" value={fmtEUR(ticket.fahrt_fahrkartenpreis)} />
          <Field label="Erwartete Erstattung" value={fmtEUR(ticket.erwartete_erstattung)} />
          <Field label="Service-Fee" value={fmtEUR(ticket.service_fee_betrag)} />
        </div>
      </section>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Reise (Plan)</h2>
        <div className="rb-detail__grid">
          <Field label="Datum" value={fmtDate(ticket.fahrt_abreisedatum)} />
          <Field label="Von" value={ticket.fahrt_abreisebahnhof} />
          <Field label="Nach" value={ticket.fahrt_zielbahnhof} />
          <Field label="Abfahrt" value={ticket.fahrt_abfahrtszeit_plan} />
          <Field label="Ankunft" value={ticket.fahrt_ankunftszeit_plan} />
          <Field
            label="Zug"
            value={`${ticket.fahrt_zugnummer_plan} (${ticket.fahrt_zugkategorie_plan})`.trim()}
          />
        </div>
      </section>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Reise (Ist)</h2>
        <div className="rb-detail__grid">
          <Field label="Ankunftsdatum" value={fmtDate(ticket.tatsaechlich_ankunftsdatum)} />
          <Field label="Abfahrt (Ist)" value={ticket.tatsaechlich_abfahrtszeit} />
          <Field label="Ankunft (Ist)" value={ticket.tatsaechlich_ankunftszeit} />
          <Field label="Zug (Ist)" value={ticket.tatsaechlich_zugnummer} />
          <Field
            label="Verpasster Anschluss"
            value={ticket.tatsaechlich_verpasster_anschluss_bahnhof}
          />
          <Field
            label="Verspätung"
            value={ticket.delayMinutes !== null ? `${ticket.delayMinutes} min` : null}
          />
        </div>
      </section>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Extraktion</h2>
        <div className="rb-detail__grid">
          <Field label="Methode" value={ticket.extraction_method} />
          <Field
            label="Confidence"
            value={
              ticket.extraction_confidence !== null
                ? ticket.extraction_confidence.toFixed(3)
                : null
            }
          />
          <Field label="Barcode UID" value={ticket.barcode_uid} />
        </div>
      </section>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Status</h2>
        <div className="rb-detail__grid">
          <Field label="State" value={<TicketStateBadge state={ticket.ticket_state} />} />
          <Field label="Eingereicht" value={fmtDateTime(ticket.submitted_at)} />
          <Field label="Aktualisiert" value={fmtDateTime(ticket.updated_at)} />
          <Field label="DB bezahlt am" value={fmtDateTime(ticket.db_paid_at)} />
          <Field label="E-Mail Status" value={ticket.email_status} />
          <Field label="Admin-Notiz" value={ticket.admin_note} />
        </div>
      </section>

      {(ticket.antragsgrund.length > 0 || ticket.antragsart) && (
        <section className="rb-detail__section">
          <h2 className="rb-detail__section-title">Submission</h2>
          <div className="rb-detail__grid">
            <Field label="Antragsart" value={ticket.antragsart} />
            <Field label="Antragsgründe" value={ticket.antragsgrund.join(', ')} />
            <Field label="Antragstellung Ort" value={ticket.antragstellung_ort} />
            <Field label="Zusatz" value={ticket.zusaetzliche_angaben} />
          </div>
        </section>
      )}

      {ticket.state_timeline.length > 0 && (
        <section className="rb-detail__section">
          <h2 className="rb-detail__section-title">State-Timeline</h2>
          <ul className="rb-detail__ticket-list">
            {ticket.state_timeline.map((entry, i) => (
              <li key={`${entry.state}-${entry.at}-${i}`} className="rb-detail__ticket">
                <TicketStateBadge state={entry.state} />
                <span>{fmtDateTime(entry.at)}</span>
                <span>{entry.actor ?? '—'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
