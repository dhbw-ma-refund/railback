import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../services/api/errors';
import { usersApi } from '../services/api/users';
import type { User } from '../services/types/user';
import { fmtDate, fmtDateTime } from '../services/format/date';
import { fmtEUR } from '../services/format/money';
import { useAdminGoBack } from '../services/hooks/useAdminGoBack';
import { UserStateBadge } from '../ui/UserStateBadge';
import { UserEditDialog } from './UserEditDialog';
import { Button } from '../ui-library';
import './DetailPage.css';

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rb-detail__field">
      <span className="rb-detail__label">{label}</span>
      <span className="rb-detail__value">{value ?? '—'}</span>
    </div>
  );
}

export function UserDetailPage() {
  const { email } = useParams<{ email: string }>();
  const goBack = useAdminGoBack('/admin-panel/users');
  const [user, setUser] = useState<User | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!email) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setNotFound(false);
    usersApi
      .getUser(email, controller.signal)
      .then(setUser)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        setError(
          err instanceof ApiError ? err.message : 'Benutzer konnte nicht geladen werden.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [email]);

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
        <button className="rb-detail__back" onClick={goBack}>
          ← Zurück
        </button>
        <h1 className="rb-detail__title">User nicht gefunden</h1>
        <p>Für die E-Mail „{email}" liegt kein Datensatz vor.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rb-detail">
        <button className="rb-detail__back" onClick={goBack}>
          ← Zurück
        </button>
        <div className="rb-detail__error" role="alert">
          {error}
        </div>
      </div>
    );
  }

  if (!user) return null;

  const addr = user.adresse;

  return (
    <div className="rb-detail">
      <button className="rb-detail__back" onClick={goBack}>
        ← Zurück
      </button>
      <h1 className="rb-detail__title">
        {user.vorname} {user.nachname}
      </h1>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
          Bearbeiten
        </Button>
      </div>

      <UserEditDialog
        user={user}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          setUser(updated);
          setEditOpen(false);
        }}
      />

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Kontakt</h2>
        <div className="rb-detail__grid">
          <Field label="E-Mail" value={user.email} />
          <Field label="Telefon" value={user.telefon} />
          <Field label="Vorname" value={user.vorname} />
          <Field label="Nachname" value={user.nachname} />
        </div>
      </section>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Adresse</h2>
        <div className="rb-detail__grid">
          <Field
            label="Straße"
            value={addr ? `${addr.strasse} ${addr.hausnr}`.trim() : null}
          />
          <Field label="PLZ" value={addr?.plz} />
          <Field label="Ort" value={addr?.ort} />
          <Field label="Land" value={addr?.land} />
        </div>
      </section>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Bankverbindung</h2>
        <div className="rb-detail__grid">
          <Field label="IBAN" value={user.iban} />
          <Field label="BIC" value={user.bic} />
        </div>
      </section>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Status</h2>
        <div className="rb-detail__grid">
          <Field label="Status" value={<UserStateBadge state={user.user_state} />} />
          <Field label="Suspended at" value={fmtDateTime(user.suspended_at)} />
          <Field label="Grund" value={user.suspended_reason} />
          <Field label="Angelegt" value={fmtDate(user.created_at)} />
          <Field label="Tickets gesamt" value={user.ticket_count} />
          <Field label="Erstattet" value={fmtEUR(user.total_refunded)} />
        </div>
      </section>

      {user.recent_tickets && user.recent_tickets.length > 0 && (
        <section className="rb-detail__section">
          <h2 className="rb-detail__section-title">Letzte Tickets</h2>
          <ul className="rb-detail__ticket-list">
            {user.recent_tickets.map((t) => (
              <li key={t.ticketId} className="rb-detail__ticket rb-detail__ticket--recent">
                <Link to={`/admin-panel/tickets/${encodeURIComponent(t.ticketId)}`}>
                  {t.ticketId}
                </Link>
                <span>{t.ticket_state}</span>
                <span>{fmtDate(t.abreisedatum)}</span>
                <span>{fmtEUR(t.erwartete_erstattung)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
