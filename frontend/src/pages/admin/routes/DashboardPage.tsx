import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../services/api/errors';
import { statsApi } from '../services/api/stats';
import type { AdminStats } from '../services/types/stats';
import { TICKET_STATES, type TicketState } from '../services/types/ticket';
import { fmtDateTime } from '../services/format/date';
import { fmtEUR } from '../services/format/money';
import { Button } from '../ui-library';
import { TicketStateBadge } from '../ui/TicketStateBadge';
import { useToast } from '../ui/useToast';
import '../admin.css';
import './DashboardPage.css';

interface KpiProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'accent' | 'warn' | 'success';
}

function Kpi({ label, value, hint, tone }: KpiProps) {
  const className = tone ? `rb-kpi rb-kpi--${tone}` : 'rb-kpi';
  return (
    <div className={className}>
      <span className="rb-kpi__label">{label}</span>
      <span className="rb-kpi__value">{value}</span>
      {hint && <span className="rb-kpi__hint">{hint}</span>}
    </div>
  );
}

const nfDE = new Intl.NumberFormat('de-DE');

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

/**
 * Deep-links to the ticket list pre-filtered by a specific state. Reused
 * for the state breakdown so operators can drill down straight from a KPI.
 */
function ticketsListWithState(state: TicketState): string {
  return `/admin-panel/tickets?state=${encodeURIComponent(state)}`;
}

/**
 * "Pending" is any state that still needs external action or admin review.
 * PENDING_DB_PAYMENT is what the mock's `tickets.pending` counts, but from
 * an admin's point of view VALIDATING/READY/EMAIL_SENDING are also in-flight.
 */
const IN_FLIGHT_STATES: ReadonlySet<TicketState> = new Set<TicketState>([
  'VALIDATING',
  'READY',
  'EMAIL_SENDING',
  'PENDING_DB_PAYMENT',
]);

function sumInFlight(byState: Partial<Record<TicketState, number>>): number {
  let sum = 0;
  for (const state of IN_FLIGHT_STATES) {
    sum += byState[state] ?? 0;
  }
  return sum;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setForbidden(false);
    statsApi
      .getStats(controller.signal)
      .then(setStats)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError) {
          if (err.status === 403) {
            setForbidden(true);
            return;
          }
          if (err.status >= 500) {
            toast.show('Serverfehler beim Laden der Statistik.');
            setError(err.message);
            return;
          }
          setError(err.message);
          return;
        }
        setError('Statistik konnte nicht geladen werden.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [toast]);

  if (loading) {
    return (
      <div className="rb-dashboard">
        <h1 className="rb-dashboard__title">Dashboard</h1>
        <p>Lädt…</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="rb-dashboard">
        <h1 className="rb-dashboard__title">Dashboard</h1>
        <div role="alert" style={{ color: 'var(--color-error-red)' }}>
          Keine Berechtigung, die Statistik einzusehen.
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="rb-dashboard">
        <h1 className="rb-dashboard__title">Dashboard</h1>
        <div role="alert" style={{ color: 'var(--color-error-red)' }}>
          {error ?? 'Keine Daten verfügbar.'}
        </div>
      </div>
    );
  }

  const { users, tickets, refunds } = stats;
  const inFlight = sumInFlight(tickets.by_state);
  const maxStateCount = Math.max(1, ...TICKET_STATES.map((s) => tickets.by_state[s] ?? 0));

  return (
    <div className="rb-dashboard">
      <div className="rb-dashboard__head">
        <h1 className="rb-dashboard__title">Dashboard</h1>
        {stats.as_of && (
          <span className="rb-dashboard__as-of">Stand: {fmtDateTime(stats.as_of)}</span>
        )}
      </div>

      <section className="rb-dashboard__kpis" aria-label="Kennzahlen">
        <Kpi
          label="Benutzer gesamt"
          value={nfDE.format(users.total)}
          hint={`${nfDE.format(users.active)} aktiv`}
          tone="accent"
        />
        <Kpi
          label="Tickets gesamt"
          value={nfDE.format(tickets.total)}
          hint={`${nfDE.format(tickets.by_state.COMPLETED ?? 0)} abgeschlossen`}
          tone="accent"
        />
        <Kpi
          label="In Bearbeitung"
          value={nfDE.format(inFlight)}
          hint={`${nfDE.format(tickets.pending)} warten auf DB-Zahlung`}
          tone="warn"
        />
        <Kpi
          label="Erstattungen gesamt"
          value={fmtEUR(refunds.total_paid_out)}
          hint={refunds.currency}
          tone="success"
        />
        <Kpi
          label="Diesen Monat"
          value={fmtEUR(refunds.this_month_paid_out)}
          hint="ausgezahlt"
          tone="success"
        />
        <Kpi
          label="Abgelehnt / ungültig"
          value={nfDE.format(
            (tickets.by_state.REJECTED ?? 0) +
              (tickets.by_state.INVALID ?? 0) +
              (tickets.by_state.EMAIL_FAILED ?? 0),
          )}
          hint="terminal"
        />
      </section>

      <div className="rb-dashboard__grid">
        <section className="rb-panel" aria-labelledby="rb-panel-users">
          <h2 id="rb-panel-users" className="rb-panel__title">
            Benutzer-Verteilung
          </h2>
          <div
            className="rb-segbar"
            role="img"
            aria-label={`Aktiv ${users.active}, gesperrt ${users.suspended}, Löschung geplant ${users.deletion_scheduled}`}
          >
            <div
              className="rb-segbar__seg--active"
              style={{ width: `${pct(users.active, users.total)}%` }}
            />
            <div
              className="rb-segbar__seg--suspended"
              style={{ width: `${pct(users.suspended, users.total)}%` }}
            />
            <div
              className="rb-segbar__seg--deletion"
              style={{ width: `${pct(users.deletion_scheduled, users.total)}%` }}
            />
          </div>
          <ul className="rb-legend">
            <li className="rb-legend__item">
              <span
                className="rb-legend__dot"
                style={{ background: 'var(--color-relief-green)' }}
              />
              Aktiv: <strong>{nfDE.format(users.active)}</strong>
            </li>
            <li className="rb-legend__item">
              <span
                className="rb-legend__dot"
                style={{ background: 'var(--color-error-red)' }}
              />
              Gesperrt: <strong>{nfDE.format(users.suspended)}</strong>
            </li>
            <li className="rb-legend__item">
              <span
                className="rb-legend__dot"
                style={{ background: 'var(--color-warning-yellow)' }}
              />
              Löschung geplant: <strong>{nfDE.format(users.deletion_scheduled)}</strong>
            </li>
          </ul>
          <div className="rb-dashboard__actions">
            <Button variant="secondary" onClick={() => navigate('/admin-panel/users')}>
              Zur Benutzerliste
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate('/admin-panel/users?user_state=SUSPENDED')}
            >
              Gesperrte anzeigen
            </Button>
          </div>
        </section>

        <section className="rb-panel" aria-labelledby="rb-panel-tickets">
          <h2 id="rb-panel-tickets" className="rb-panel__title">
            Tickets nach State
          </h2>
          <ul className="rb-state-list">
            {TICKET_STATES.map((state) => {
              const count = tickets.by_state[state] ?? 0;
              return (
                <li key={state} className="rb-state-list__row">
                  <Link
                    to={ticketsListWithState(state)}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                    aria-label={`${state}, ${count} Tickets, Liste öffnen`}
                  >
                    <TicketStateBadge state={state} />
                  </Link>
                  <span className="rb-state-list__count">{nfDE.format(count)}</span>
                  <div className="rb-state-list__bar">
                    <div
                      className="rb-state-list__bar-fill"
                      style={{ width: `${pct(count, maxStateCount)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="rb-dashboard__actions">
            <Button variant="secondary" onClick={() => navigate('/admin-panel/tickets')}>
              Alle Tickets
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate('/admin-panel/tickets?state=PENDING_DB_PAYMENT')}
            >
              Wartend auf DB
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
