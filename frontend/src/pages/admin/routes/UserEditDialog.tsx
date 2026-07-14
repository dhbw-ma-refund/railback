import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui-library';
import { UserStateBadge } from '../ui/UserStateBadge';
import { ADMIN_USER_TRANSITIONS, USER_STATE_LABELS } from '../services/transitions';
import { usersApi, type UserPatchPayload } from '../services/api/users';
import { ApiError } from '../services/api/errors';
import type { User, UserAddress, UserState } from '../services/types/user';
import './UserEditDialog.css';

export interface UserEditDialogProps {
  user: User;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: User) => void;
}

interface FormState {
  vorname: string;
  nachname: string;
  telefon: string;
  strasse: string;
  hausnr: string;
  plz: string;
  ort: string;
  land: string;
  targetState: UserState | '';
  suspendedReason: string;
}

function initial(user: User): FormState {
  const a: UserAddress | null = user.adresse;
  return {
    vorname: user.vorname,
    nachname: user.nachname,
    telefon: user.telefon ?? '',
    strasse: a?.strasse ?? '',
    hausnr: a?.hausnr ?? '',
    plz: a?.plz ?? '',
    ort: a?.ort ?? '',
    land: a?.land ?? '',
    targetState: '',
    suspendedReason: '',
  };
}

/**
 * Builds the minimal PATCH body from what actually changed. Sending
 * unchanged fields triggers the backend's `no-op patch` 400, so the diff
 * must be tight. Address is sent as a whole object because the backend
 * accepts it that way and validating sub-fields piecemeal is not exposed.
 */
function buildPayload(user: User, form: FormState): UserPatchPayload {
  const payload: UserPatchPayload = {};
  if (form.vorname.trim() !== user.vorname) payload.vorname = form.vorname.trim();
  if (form.nachname.trim() !== user.nachname) payload.nachname = form.nachname.trim();

  const originalTel = user.telefon ?? '';
  const newTel = form.telefon.trim();
  if (newTel !== originalTel) payload.telefon = newTel.length > 0 ? newTel : null;

  const a = user.adresse;
  const addressChanged =
    (a?.strasse ?? '') !== form.strasse.trim() ||
    (a?.hausnr ?? '') !== form.hausnr.trim() ||
    (a?.plz ?? '') !== form.plz.trim() ||
    (a?.ort ?? '') !== form.ort.trim() ||
    (a?.land ?? '') !== form.land.trim();
  if (addressChanged) {
    payload.adresse = {
      strasse: form.strasse.trim(),
      hausnr: form.hausnr.trim(),
      plz: form.plz.trim(),
      ort: form.ort.trim(),
      land: form.land.trim(),
    };
  }

  if (form.targetState !== '' && form.targetState !== user.user_state) {
    payload.user_state = form.targetState;
    if (form.targetState === 'SUSPENDED') {
      payload.suspended_reason = form.suspendedReason.trim();
    }
  }

  return payload;
}

/**
 * Dialog for PATCH /admin/users/{email}. Renders the profile fields the
 * backend accepts (name, telefon, adresse) plus a status radio filtered by
 * the transition matrix. `iban`/`bic` are deliberately not editable — the
 * backend rejects them and they are considered financial data owned by the
 * user, not the admin.
 *
 * Rules enforced client-side to avoid round-tripping to a 400:
 *   - Save is disabled when no field changed (`no-op patch`).
 *   - `ACTIVE → SUSPENDED` requires a non-empty suspended_reason.
 * Everything else falls back to the API error mapping (409 conflict,
 * 400 ERR_VALIDATION, 403, 5xx).
 */
export function UserEditDialog({ user, open, onClose, onSaved }: UserEditDialogProps) {
  const [form, setForm] = useState<FormState>(() => initial(user));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowedTargets = useMemo(
    () => ADMIN_USER_TRANSITIONS[user.user_state] ?? [],
    [user.user_state],
  );

  // Reset on (re-)open so a stale draft never leaks between users.
  useEffect(() => {
    if (!open) return;
    setForm(initial(user));
    setBusy(false);
    setError(null);
  }, [open, user]);

  const suspending = form.targetState === 'SUSPENDED';
  const reasonMissing = suspending && form.suspendedReason.trim().length === 0;
  const payload = buildPayload(user, form);
  const hasChanges = Object.keys(payload).length > 0;
  const canSubmit = !busy && hasChanges && !reasonMissing;

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await usersApi.patchUser(user.email, payload);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError('Konflikt beim Speichern. Daten wurden zwischenzeitlich geändert.');
        } else if (err.status === 403) {
          setError('Keine Berechtigung für diese Änderung.');
        } else if (err.status === 400) {
          // Backend validation — surface its message verbatim so admins see
          // exactly which field the server rejected.
          setError(err.message || 'Speichern fehlgeschlagen (Validierung).');
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
      title="Benutzer bearbeiten"
      primaryLabel="Speichern"
      onPrimary={handleSubmit}
      primaryDisabled={!canSubmit}
      primaryBusy={busy}
    >
      <div className="rb-state-override">
        <div className="rb-state-override__current">
          <span className="rb-state-override__label">Aktueller Status</span>
          <UserStateBadge state={user.user_state} />
        </div>

        <fieldset className="rb-state-override__fieldset" disabled={busy}>
          <legend className="rb-state-override__legend">Profil</legend>
          <div className="rb-state-override__field">
            <Input
              label="Vorname"
              value={form.vorname}
              onChange={(e) => patch({ vorname: e.target.value })}
            />
          </div>
          <div className="rb-state-override__field">
            <Input
              label="Nachname"
              value={form.nachname}
              onChange={(e) => patch({ nachname: e.target.value })}
            />
          </div>
          <div className="rb-state-override__field">
            <Input
              label="Telefon"
              type="tel"
              value={form.telefon}
              onChange={(e) => patch({ telefon: e.target.value })}
              helperText="Leer lassen, um die Telefonnummer zu entfernen."
            />
          </div>
        </fieldset>

        <fieldset className="rb-state-override__fieldset" disabled={busy}>
          <legend className="rb-state-override__legend">Adresse</legend>
          <div className="rb-state-override__field">
            <Input
              label="Straße"
              value={form.strasse}
              onChange={(e) => patch({ strasse: e.target.value })}
            />
          </div>
          <div className="rb-state-override__field">
            <Input
              label="Hausnummer"
              value={form.hausnr}
              onChange={(e) => patch({ hausnr: e.target.value })}
            />
          </div>
          <div className="rb-state-override__field">
            <Input
              label="PLZ"
              value={form.plz}
              onChange={(e) => patch({ plz: e.target.value })}
            />
          </div>
          <div className="rb-state-override__field">
            <Input
              label="Ort"
              value={form.ort}
              onChange={(e) => patch({ ort: e.target.value })}
            />
          </div>
          <div className="rb-state-override__field">
            <Input
              label="Land"
              value={form.land}
              onChange={(e) => patch({ land: e.target.value })}
              helperText="ISO-3166-1 alpha-2, z.B. DE."
            />
          </div>
        </fieldset>

        {allowedTargets.length > 0 && (
          <fieldset className="rb-state-override__fieldset" disabled={busy}>
            <legend className="rb-state-override__legend">Statuswechsel</legend>
            <label className="rb-state-override__option">
              <input
                type="radio"
                name="user-target-state"
                value=""
                checked={form.targetState === ''}
                onChange={() => patch({ targetState: '', suspendedReason: '' })}
              />
              <span className="rb-state-override__option-label">Unverändert</span>
            </label>
            {allowedTargets.map((state) => (
              <label key={state} className="rb-state-override__option">
                <input
                  type="radio"
                  name="user-target-state"
                  value={state}
                  checked={form.targetState === state}
                  onChange={() => patch({ targetState: state })}
                />
                <UserStateBadge state={state} />
                <span className="rb-state-override__option-label">
                  {USER_STATE_LABELS[state]}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {suspending && (
          <div className="rb-state-override__field">
            <label htmlFor="suspended-reason" className="rb-input-label">
              Sperrgrund <span aria-hidden="true">*</span>
            </label>
            <textarea
              id="suspended-reason"
              className="rb-state-override__textarea"
              value={form.suspendedReason}
              onChange={(e) => patch({ suspendedReason: e.target.value })}
              rows={3}
              disabled={busy}
              placeholder="Grund wird beim Benutzer als Audit-Notiz gespeichert."
              aria-required={true}
            />
          </div>
        )}

        {error && (
          <div className="rb-state-override__error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
