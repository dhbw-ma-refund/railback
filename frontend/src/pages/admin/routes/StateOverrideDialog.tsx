import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui-library';
import { TicketStateBadge } from '../ui/TicketStateBadge';
import { ADMIN_TICKET_TRANSITIONS, TICKET_STATE_LABELS } from '../services/transitions';
import { ticketsApi, type TicketPatchPayload } from '../services/api/tickets';
import { ApiError } from '../services/api/errors';
import type { Ticket, TicketState } from '../services/types/ticket';
import './StateOverrideDialog.css';

export interface StateOverrideDialogProps {
  ticket: Ticket;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: Ticket) => void;
}

/**
 * Datetime-local <input value> is 'YYYY-MM-DDTHH:mm' (no seconds/tz). Trim
 * the ISO the backend hands us to that shape; anything else is passed
 * through so a bogus value stays visible instead of silently dropped.
 */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(iso);
  return match ? match[1] : '';
}

/**
 * Dialog for PATCH /admin/tickets/{ticketId}. Renders only the transitions
 * BACKEND_CONTRACT.md allows from the current state — everything else is
 * either system-owned (VALIDATING/READY/EMAIL_*) or would be rejected with
 * 409 ERR_CONFLICT.
 *
 * Fields:
 *   - target state (radio, filtered by transition matrix)
 *   - db_paid_at (only when the target is APPROVED; recommended per contract)
 *   - admin_note (free text; required when rejecting per contract guidance,
 *     otherwise optional)
 *
 * Any 409 from the backend surfaces as an inline error so the admin can
 * back out without losing the note text.
 */
export function StateOverrideDialog({ ticket, open, onClose, onSaved }: StateOverrideDialogProps) {
  const allowedTargets = useMemo(
    () => ADMIN_TICKET_TRANSITIONS[ticket.ticket_state] ?? [],
    [ticket.ticket_state],
  );

  const [targetState, setTargetState] = useState<TicketState | ''>('');
  const [dbPaidAt, setDbPaidAt] = useState<string>(toDatetimeLocal(ticket.db_paid_at));
  const [adminNote, setAdminNote] = useState<string>(ticket.admin_note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the dialog re-opens against a different ticket. Without this
  // a stale "REJECTED" selection would leak across tickets.
  useEffect(() => {
    if (!open) return;
    setTargetState('');
    setDbPaidAt(toDatetimeLocal(ticket.db_paid_at));
    setAdminNote(ticket.admin_note ?? '');
    setBusy(false);
    setError(null);
  }, [open, ticket.ticketId, ticket.db_paid_at, ticket.admin_note]);

  const rejecting = targetState === 'REJECTED' || targetState === 'INVALID';
  const approving = targetState === 'APPROVED';
  // Note is required for reject/invalid per contract guidance; a note-only
  // save with no state change is allowed (audit trail).
  const noteRequired = rejecting;
  const originalNote = (ticket.admin_note ?? '').trim();
  const noteChanged = adminNote.trim() !== originalNote;
  const canSubmit =
    !busy &&
    (targetState !== '' || noteChanged) &&
    (!noteRequired || adminNote.trim().length > 0);

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const payload: TicketPatchPayload = {};
    if (targetState !== '') payload.ticket_state = targetState;
    if (approving && dbPaidAt) {
      // datetime-local has no timezone; append :00 seconds and let the
      // backend interpret in server-local time (contract accepts ISO 8601).
      payload.db_paid_at = `${dbPaidAt}:00`;
    }
    const trimmed = adminNote.trim();
    if (trimmed.length > 0) payload.admin_note = trimmed;
    else if (ticket.admin_note && trimmed.length === 0) payload.admin_note = null;

    try {
      const updated = await ticketsApi.patchTicket(ticket.ticketId, payload);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError('Der Übergang ist nicht erlaubt (409). Bitte Status neu wählen.');
        } else if (err.status === 403) {
          setError('Keine Berechtigung für diese Änderung.');
        } else if (err.status >= 500) {
          setError('Speichern fehlgeschlagen. Bitte später erneut versuchen.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Unerwarteter Fehler beim Speichern.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ticket-State überschreiben"
      primaryLabel="Speichern"
      onPrimary={handleSubmit}
      primaryDisabled={!canSubmit}
      primaryBusy={busy}
    >
      <div className="rb-state-override">
        <div className="rb-state-override__current">
          <span className="rb-state-override__label">Aktueller State</span>
          <TicketStateBadge state={ticket.ticket_state} />
        </div>

        {allowedTargets.length === 0 ? (
          <p className="rb-state-override__locked">
            Aus dem aktuellen Zustand sind keine Übergänge zulässig.
            {' '}
            Sie können lediglich die Admin-Notiz aktualisieren.
          </p>
        ) : (
          <fieldset className="rb-state-override__fieldset">
            <legend className="rb-state-override__legend">Neuer State</legend>
            {allowedTargets.map((state) => (
              <label key={state} className="rb-state-override__option">
                <input
                  type="radio"
                  name="target-state"
                  value={state}
                  checked={targetState === state}
                  onChange={() => setTargetState(state)}
                  disabled={busy}
                />
                <TicketStateBadge state={state} />
                <span className="rb-state-override__option-label">
                  {TICKET_STATE_LABELS[state]}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {approving && (
          <div className="rb-state-override__field">
            <Input
              type="datetime-local"
              label="DB-Zahlung eingegangen am"
              value={dbPaidAt}
              onChange={(e) => setDbPaidAt(e.target.value)}
              disabled={busy}
              helperText="Datum + Uhrzeit, an dem die DB-Erstattung bestätigt wurde."
            />
          </div>
        )}

        <div className="rb-state-override__field">
          <label htmlFor="admin-note" className="rb-input-label">
            Admin-Notiz
            {noteRequired && <span aria-hidden="true"> *</span>}
          </label>
          <textarea
            id="admin-note"
            className="rb-state-override__textarea"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            rows={4}
            disabled={busy}
            placeholder={
              noteRequired
                ? 'Begründung erforderlich (Audit-Trail).'
                : 'Optional. Wird als Audit-Notiz gespeichert.'
            }
            aria-required={noteRequired}
          />
        </div>

        {error && (
          <div className="rb-state-override__error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
