import { useState } from 'react';
import { Card, Button, Input } from '@shared/components';
import { useLanguage } from '../lib/LanguageContext';
import { useRouteTemplates } from '../lib/useRouteTemplates';
import type { RouteTemplateView } from '../lib/api';
import './SavedRoutesSection.css';

/**
 * "Meine Strecken" section on the Profile page. Full CRUD for saved
 * route templates:
 *   - list every saved route
 *   - inline rename (click the label → edit → Enter or blur to save)
 *   - delete with a confirm gate
 *
 * Adding new routes is intentionally NOT here — that's a wizard-time
 * action (tick "Als Strecke speichern" while filing a claim). Keeping
 * add out of the profile keeps the surface small and avoids repeating
 * the station-autocomplete UX. Users add via the wizard, manage here.
 *
 * Reads/writes go through the shared useRouteTemplates hook, so a save
 * or delete here immediately shrinks/grows the wizard chip picker with
 * no refetch — same in-memory list.
 */
export const SavedRoutesSection = () => {
  const { t } = useLanguage();
  const T = t.auth.profile.savedRoutes;
  const { templates, loading, error, refresh, rename, remove } = useRouteTemplates();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const startRename = (tpl: RouteTemplateView) => {
    setEditingId(tpl.templateId);
    setEditingLabel(tpl.label);
    setRowError((prev) => {
      const { [tpl.templateId]: _drop, ...rest } = prev;
      return rest;
    });
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingLabel('');
  };

  const commitRename = async (templateId: string) => {
    const trimmed = editingLabel.trim();
    if (!trimmed) {
      // Empty label is invalid on the backend (min(1)); treat as cancel.
      cancelRename();
      return;
    }
    setBusy(templateId);
    try {
      await rename(templateId, trimmed);
      setEditingId(null);
      setEditingLabel('');
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [templateId]: err instanceof Error ? err.message : T.renameError,
      }));
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (templateId: string) => {
    setBusy(templateId);
    try {
      await remove(templateId);
      setConfirmDelete(null);
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [templateId]: err instanceof Error ? err.message : T.deleteError,
      }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="profile-section">
      <div className="section-header">
        <h2 className="h2">{T.title}</h2>
      </div>
      <p className="saved-routes__hint">{T.hint}</p>

      {loading && templates === null && (
        <p className="saved-routes__muted">{T.loading}</p>
      )}

      {error && (
        <div className="error-message">
          {error}
          <Button variant="secondary" onClick={() => void refresh()}>
            {T.retry}
          </Button>
        </div>
      )}

      {templates && templates.length === 0 && !loading && (
        <p className="saved-routes__muted">{T.empty}</p>
      )}

      {templates && templates.length > 0 && (
        <ul className="saved-routes__list" role="list">
          {templates.map((tpl) => {
            const isEditing = editingId === tpl.templateId;
            const isConfirmingDelete = confirmDelete === tpl.templateId;
            const isBusy = busy === tpl.templateId;
            const err = rowError[tpl.templateId];
            return (
              <li key={tpl.templateId} className="saved-routes__row">
                <div className="saved-routes__row-main">
                  {isEditing ? (
                    <form
                      className="saved-routes__rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void commitRename(tpl.templateId);
                      }}
                    >
                      <Input
                        aria-label={T.rename}
                        value={editingLabel}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        onBlur={() => void commitRename(tpl.templateId)}
                      />
                      <button
                        type="button"
                        className="saved-routes__link-btn"
                        onClick={cancelRename}
                        // Fire on mousedown, not click — click fires
                        // AFTER the input's onBlur, and by then the
                        // rename has already been committed.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          cancelRename();
                        }}
                      >
                        {T.cancel}
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="saved-routes__label-btn"
                      onClick={() => startRename(tpl)}
                      aria-label={T.rename}
                    >
                      <span className="saved-routes__label">{tpl.label}</span>
                    </button>
                  )}
                  <p className="saved-routes__route">
                    {tpl.fromStation} → {tpl.toStation}
                  </p>
                  {err && <p className="saved-routes__error">{err}</p>}
                </div>
                <div className="saved-routes__actions">
                  {isConfirmingDelete ? (
                    <>
                      <span className="saved-routes__confirm-label">
                        {T.deleteConfirm}
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmDelete(null)}
                        disabled={isBusy}
                      >
                        {T.cancel}
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => void doDelete(tpl.templateId)}
                        disabled={isBusy}
                      >
                        {T.deleteYes}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmDelete(tpl.templateId)}
                      disabled={isBusy || isEditing}
                    >
                      {T.delete}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};
