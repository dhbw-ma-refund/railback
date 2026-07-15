import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Checkbox } from '@shared/components';
import { StationInput } from '../../components/StationInput';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';
import { RouteTemplatePicker } from './RouteTemplatePicker';
import { DateInputWithToday } from './DateInputWithToday';
import { api } from '../../lib/api';
import type {
  RouteLookupCandidate,
  RouteLookupRequest,
  RouteTemplateView,
} from '../../lib/api';
import { useRouteTemplates } from '../../lib/useRouteTemplates';
import { ApiError } from '@shared/api/errors';
import './LookupStep.css';
import './RouteTemplatePicker.css';

/**
 * Route-lookup for past trips. This is NOT a bahn.de-style timetable search —
 * that's for buying tickets. Here the user already took the trip and needs to
 * find *the specific train that was delayed or cancelled* so its delay data
 * seeds the claim form.
 *
 * The hierarchy is optimised for that job:
 *   1. Delay minutes (red, huge) — the qualifying information.
 *   2. Cancellation status (red banner) — a hard-yes for compensation.
 *   3. Train number + times — for identifying "yes, that was my train".
 *
 * Backend contract: POST /users/me/tickets/route-lookup. Empty results come
 * back as 404 ERR_NO_CANDIDATES — the frontend catches that as an empty
 * state, NOT an error banner. Other errors surface normally.
 */

/** Given an HH:MM around-time, expand to a ±1h window clamped to the day. */
function expandTimeWindow(around: string): { from: string; to: string } | undefined {
  if (!around) return undefined;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(around);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const total = hh * 60 + mm;
  const fromMin = Math.max(0, total - 60);
  const toMin = Math.min(23 * 60 + 59, total + 60);
  const fmt = (v: number) =>
    `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  return { from: fmt(fromMin), to: fmt(toMin) };
}

const delayTone = (mins: number, cancelled: boolean) => {
  if (cancelled) return 'cancelled';
  if (mins >= 60) return 'severe';
  if (mins >= 15) return 'moderate';
  if (mins > 0) return 'minor';
  return 'ontime';
};

const dataQualityChip = (
  quality: RouteLookupCandidate['data_quality'],
  t: ReturnType<typeof useLanguage>['t'],
): string => {
  if (quality === 'FULL') return t.wizard.lookup.qualityFull;
  if (quality === 'PARTIAL') return t.wizard.lookup.qualityPartial;
  return t.wizard.lookup.qualityPlan;
};

export const LookupStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, update, updateFahrt } = useWizard();
  const { add: addTemplate, remove: removeTemplate } = useRouteTemplates();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [aroundTime, setAroundTime] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const [candidates, setCandidates] = useState<RouteLookupCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [emptyState, setEmptyState] = useState(false);
  /**
   * True when the first search (narrow window) returned nothing and we
   * fell back to the whole day. Surface as a small note above the
   * candidate list so the user understands why extra results appeared.
   */
  const [widened, setWidened] = useState(false);

  /**
   * Fire the lookup with an explicit time window.
   *   - narrow  → ±1h around the user's typed aroundTime (only when they typed one)
   *   - whole   → 00:00–23:59, the fallback and the default when no time is typed
   *
   * We MUST send a timeWindow — the backend's default when omitted is
   * ±1h around wall-clock "now", which is almost never what the user
   * meant (see backend/lambdas/user-handler/src/routes/post-route-lookup.ts).
   * Returns null when the backend replies ERR_NO_CANDIDATES.
   */
  const attempt = async (
    kind: 'narrow' | 'whole',
  ): Promise<{ candidates: RouteLookupCandidate[] } | null> => {
    const timeWindow =
      kind === 'narrow'
        ? expandTimeWindow(aroundTime) ?? { from: '00:00', to: '23:59' }
        : { from: '00:00', to: '23:59' };
    const req: RouteLookupRequest = {
      fromStation: from,
      toStation: to,
      date,
      timeWindow,
    };
    try {
      return await api.routeLookup(req);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && err.body.code === 'ERR_NO_CANDIDATES') {
        return null;
      }
      throw err;
    }
  };

  const runSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!from || !to || !date) return;

    setError('');
    setEmptyState(false);
    setWidened(false);
    setCandidates(null);
    setSearching(true);
    try {
      // If the user typed a time, first try ±1h around it. Otherwise go
      // straight to whole-day.
      const useNarrow = !!aroundTime;
      let res = useNarrow ? await attempt('narrow') : null;

      if (!res || res.candidates.length === 0) {
        const wide = await attempt('whole');
        if (!wide || wide.candidates.length === 0) {
          setEmptyState(true);
          setCandidates([]);
        } else {
          if (useNarrow) setWidened(true);
          setCandidates(wide.candidates);
        }
      } else {
        setCandidates(res.candidates);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.body.code === 'ERR_VALIDATION') {
          const field = (err.body.details as { field?: string } | undefined)?.field;
          setError(
            field === 'fromStation'
              ? t.wizard.lookup.errBadFrom
              : field === 'toStation'
                ? t.wizard.lookup.errBadTo
                : err.body.message || t.wizard.lookup.errGeneric,
          );
        } else {
          setError(err.body.message || t.wizard.lookup.errGeneric);
        }
      } else {
        setError(t.wizard.lookup.errGeneric);
      }
    } finally {
      setSearching(false);
    }
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
    // Manual edit — any picked template no longer describes both ends.
    if (state.pickedTemplateId) update({ pickedTemplateId: null });
  };

  /**
   * User picked a saved-route chip from RouteTemplatePicker. Fill both
   * local station fields and remember the templateId. Save affordance
   * is hidden while a picked template is active (route already exists
   * on the account).
   *
   * Local `from`/`to` are the source of truth on this screen (they
   * drive the /route-lookup request and get flushed to wizard.fahrt
   * on `pick`).
   */
  const pickTemplate = (tpl: RouteTemplateView) => {
    setFrom(tpl.fromStation);
    setTo(tpl.toStation);
    update({ pickedTemplateId: tpl.templateId });
  };

  /**
   * User edited a station field directly. Clear the picked-template
   * link. Does NOT delete a session-saved template — fine-tuning a
   * station name shouldn't wipe the saved row.
   */
  const clearPickedTemplateOnEdit = () => {
    if (state.pickedTemplateId) update({ pickedTemplateId: null });
  };

  /**
   * "Als Strecke speichern" toggle — save-on-tick / delete-on-untick,
   * same semantics as FahrtStep. See FahrtStep.onToggleSave (and the
   * comment on WizardState.savedThisSession) for the rationale; the
   * two implementations are intentionally mirror-image.
   */
  const onToggleSave = async (checked: boolean) => {
    setSaveError('');
    if (checked) {
      if (!from || !to) return;
      setSaving(true);
      try {
        const created = await addTemplate({
          label: `${from} → ${to}`,
          fromStation: from,
          toStation: to,
        });
        update({
          savedThisSession: {
            templateId: created.templateId,
            fromStation: from,
            toStation: to,
          },
        });
      } catch (err) {
        setSaveError(
          err instanceof Error ? err.message : t.wizard.reise.saveRouteError,
        );
      } finally {
        setSaving(false);
      }
    } else {
      const saved = state.savedThisSession;
      if (
        !saved ||
        saved.fromStation !== from ||
        saved.toStation !== to
      ) {
        return;
      }
      setSaving(true);
      try {
        await removeTemplate(saved.templateId);
        update({ savedThisSession: null });
      } catch (err) {
        setSaveError(
          err instanceof Error ? err.message : t.wizard.reise.saveRouteError,
        );
      } finally {
        setSaving(false);
      }
    }
  };

  /** See FahrtStep.isSavedNow — same rule, uses LookupStep's local from/to. */
  const isSavedNow =
    !!state.savedThisSession &&
    state.savedThisSession.fromStation === from &&
    state.savedThisSession.toStation === to;

  const pick = (c: RouteLookupCandidate) => {
    // Populate fahrt from the picked candidate. The user still fills
    // fahrkartennummer + fahrkartenpreis manually on FahrtStep.
    updateFahrt({
      abreisebahnhof: from,
      zielbahnhof: to,
      abreisedatum: date,
      zugnummer_plan: c.trainNr,
      zugkategorie_plan: c.zugkategorie ?? '',
      abfahrtszeit_plan: c.abfahrt_plan,
      ankunftszeit_plan: c.ankunft_plan,
    });
    navigate('/antrag/neu/reise');
  };

  return (
    <WizardLayout title={t.wizard.lookup.title}>
      <p className="wizard-helper">{t.wizard.lookup.hint}</p>

      <RouteTemplatePicker
        onPick={pickTemplate}
        activeTemplateId={state.pickedTemplateId}
      />

      <form className="rl-search" onSubmit={runSearch}>
        <div className="rl-where">
          <StationInput
            label={t.wizard.lookup.from}
            placeholder="z.B. Mannheim Hbf"
            value={from}
            onChange={(v) => {
              clearPickedTemplateOnEdit();
              setFrom(v);
            }}
          />
          <div className="rl-to">
            <div className="rl-to__labelrow">
              <span className="rl-to__label">{t.wizard.lookup.to}</span>
              <button
                type="button"
                className="rl-swap"
                onClick={swap}
                aria-label={t.wizard.lookup.swap}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                <span>{t.wizard.lookup.swap}</span>
              </button>
            </div>
            <StationInput
              placeholder="z.B. Karlsruhe Hbf"
              value={to}
              onChange={(v) => {
                clearPickedTemplateOnEdit();
                setTo(v);
              }}
              aria-label={t.wizard.lookup.to}
            />
          </div>
        </div>

        <div className="rl-when">
          <DateInputWithToday
            label={t.wizard.lookup.date}
            value={date}
            onChange={setDate}
          />
          <Input
            label={t.wizard.lookup.aroundTime}
            type="time"
            value={aroundTime}
            onChange={(e) => setAroundTime(e.target.value)}
          />
        </div>

        {/* "Als Strecke speichern" — save-on-tick, delete-on-untick,
            same rule as FahrtStep. Only offered when the user typed
            their own from/to. Rename lives on the Profile page. */}
        {!state.pickedTemplateId && !!from && !!to && (
          <div className="route-templates__save">
            <Checkbox
              label={t.wizard.reise.saveRoute}
              checked={isSavedNow}
              disabled={saving}
              onChange={(e) => void onToggleSave(e.target.checked)}
            />
            {saveError && (
              <p className="route-templates__save-error">{saveError}</p>
            )}
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          size="large"
          disabled={!from || !to || !date || searching}
          className="rl-search-btn"
        >
          {searching ? t.wizard.lookup.searching : t.wizard.lookup.search}
        </Button>
      </form>

      {error && <div className="error-message">{error}</div>}

      {emptyState && (
        <div className="rl-empty">
          <h2 className="rl-results__title">{t.wizard.lookup.noResultsTitle}</h2>
          <p className="wizard-helper">{t.wizard.lookup.noResultsHint}</p>
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <div className="rl-results">
          <h2 className="rl-results__title">{t.wizard.lookup.resultsTitle}</h2>
          {widened && (
            <p className="wizard-helper rl-results__hint">{t.wizard.lookup.widenedNote}</p>
          )}
          <p className="wizard-helper rl-results__hint">{t.wizard.lookup.pickHint}</p>

          <ul className="rl-list">
            {candidates.map((c) => {
              const tone = delayTone(c.delayMinutes, c.any_cancelled);
              const badgeClass = (c.zugkategorie ?? 'IC').toLowerCase().replace(/\s+/g, '');
              return (
                <li key={`${c.trainNr}-${c.abfahrt_plan}`} className={`rl-card rl-card--${tone}`}>
                  <button type="button" className="rl-card__hit" onClick={() => pick(c)}>
                    <span className="rl-card__rail" aria-hidden="true" />

                    <div className="rl-card__body">
                      <div className="rl-card__idrow">
                        <span className={`rl-badge rl-badge--${badgeClass}`}>
                          {c.trainNr}
                        </span>
                        <span className="rl-card__times">
                          {c.abfahrt_plan} → {c.ankunft_plan}
                        </span>
                        <span className="rl-quality" title={dataQualityChip(c.data_quality, t)}>
                          {dataQualityChip(c.data_quality, t)}
                        </span>
                      </div>

                      <div className={`rl-status rl-status--${tone}`}>
                        {c.any_cancelled ? (
                          <>
                            <span className="rl-status__icon" aria-hidden="true">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="6" y1="6" x2="18" y2="18" />
                                <line x1="18" y1="6" x2="6" y2="18" />
                              </svg>
                            </span>
                            <span className="rl-status__main">{t.wizard.lookup.cancelled}</span>
                          </>
                        ) : c.delayMinutes > 0 ? (
                          <>
                            <span className="rl-status__delta">+{c.delayMinutes}</span>
                            <div className="rl-status__stack">
                              <span className="rl-status__main">{t.wizard.lookup.minutesLate}</span>
                              {(c.abfahrt_tatsaechlich || c.ankunft_tatsaechlich) && (
                                <span className="rl-status__sub">
                                  {t.wizard.lookup.actual}: {c.abfahrt_tatsaechlich ?? '—'} →{' '}
                                  {c.ankunft_tatsaechlich ?? '—'}
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="rl-status__ok" aria-hidden="true">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                            <span className="rl-status__main">{t.wizard.lookup.onTime}</span>
                          </>
                        )}
                      </div>

                      <div className="rl-card__stations">
                        <span>{from || '—'}</span>
                        <span aria-hidden="true">→</span>
                        <span>{to || '—'}</span>
                      </div>
                    </div>

                    <span className="rl-card__chev" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 6 15 12 9 18" />
                      </svg>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <WizardStepButtons
        onBack={() => navigate('/antrag/neu')}
        onNext={() => navigate('/antrag/neu/reise')}
        nextLabel={t.wizard.lookup.skipToManual}
      />
    </WizardLayout>
  );
};
