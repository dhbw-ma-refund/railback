import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button } from '@shared/components';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard, AntragsgrundTag } from './WizardContext';
import { api } from '../../lib/api';
import { ApiError } from '@shared/api/errors';
import { useScrollIntoViewOn } from '../../hooks/useScrollIntoViewOn';
import './ProblemStep.css';

interface Row {
  key: AntragsgrundTag;
  labelKey: 'verspaetung' | 'ausfall' | 'verpassterAnschluss';
}

/**
 * The three real antragsgrund cases the backend accepts, in the order
 * users are most likely to need them. VERSPAETUNG is pre-checked on a
 * fresh wizard entry (see WizardContext INITIAL_STATE) — it's the
 * overwhelmingly common case; most users don't need to touch this step.
 */
const ROWS: Row[] = [
  { key: 'VERSPAETUNG',          labelKey: 'verspaetung' },
  { key: 'AUSFALL',              labelKey: 'ausfall' },
  { key: 'VERPASSTER_ANSCHLUSS', labelKey: 'verpassterAnschluss' },
];

/**
 * Step 3 — Verspätung oder Problem.
 *
 * Backend requires antragsgrund.length >= 1 on submit. We pre-check
 * VERSPAETUNG (the most common case) so a "just my train was late"
 * user can breeze past this step. Multi-select allowed: a trip can be
 * both delayed AND miss a connection.
 *
 * When VERPASSTER_ANSCHLUSS is selected, a bahnhof input appears —
 * the backend rejects a submit that includes VERPASSTER_ANSCHLUSS
 * without a non-empty verpasster_anschluss_bahnhof.
 *
 * If the user is on the upload path (a ticket already exists) we also
 * offer a "Verspätung automatisch prüfen" button — POST /delays with
 * the fahrt fields. The response caches into state.delayLookup for
 * ReviewStep to consume. On the manual/lookup paths no ticket exists
 * yet, so the button is hidden; the backend computes delay data
 * server-side at submit.
 */
export const ProblemStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, update } = useWizard();
  const p = state.problem;

  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');

  const includesMissed = p.antragsgrund.includes('VERPASSTER_ANSCHLUSS');
  const missing = {
    antragsgrund: p.antragsgrund.length === 0,
    // Bahnhof only required when the user picked "verpasster Anschluss".
    missedBahnhof: includesMissed && !p.verpasster_anschluss_bahnhof?.trim(),
  };
  const hasAnyMissing = Object.values(missing).some(Boolean);
  const [showErrors, setShowErrors] = useState(false);
  const bannerRef = useScrollIntoViewOn(showErrors && hasAnyMissing);
  useEffect(() => {
    if (!hasAnyMissing) setShowErrors(false);
  }, [hasAnyMissing]);

  const handleNext = () => {
    if (hasAnyMissing) {
      setShowErrors(true);
      return;
    }
    navigate('/antrag/neu/person');
  };

  const toggle = (key: AntragsgrundTag) => {
    const set = new Set(p.antragsgrund);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    update({ problem: { ...p, antragsgrund: Array.from(set) } });
  };

  const setMissedBahnhof = (value: string) => {
    update({ problem: { ...p, verpasster_anschluss_bahnhof: value } });
  };

  const canAutoCheck =
    !!state.ticketId &&
    !!state.fahrt.zugnummer_plan &&
    !!state.fahrt.abreisedatum &&
    !!state.fahrt.abreisebahnhof &&
    !!state.fahrt.zielbahnhof;

  const runDelayCheck = async () => {
    if (!state.ticketId) return;
    setChecking(true);
    setCheckError('');
    try {
      const res = await api.lookupDelays(state.ticketId, {
        trainNr: state.fahrt.zugnummer_plan!,
        date: state.fahrt.abreisedatum!,
        abreisebahnhof: state.fahrt.abreisebahnhof!,
        zielbahnhof: state.fahrt.zielbahnhof!,
      });
      update({ delayLookup: res });
    } catch (err) {
      if (err instanceof ApiError) {
        setCheckError(err.body.message || t.wizard.problem.autoCheckError);
      } else {
        setCheckError(t.wizard.problem.autoCheckError);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <WizardLayout activeSlug="problem" title={t.wizard.problem.title}>
      <p className="wizard-helper">{t.wizard.problem.question}</p>

      <div className="problem-rows">
        {ROWS.map((row) => {
          const active = p.antragsgrund.includes(row.key);
          const isMissed = row.key === 'VERPASSTER_ANSCHLUSS';
          return (
            <div key={row.key} className="problem-row">
              <button
                type="button"
                className={'problem-row__toggle' + (active ? ' problem-row__toggle--on' : '')}
                onClick={() => toggle(row.key)}
                aria-pressed={active}
              >
                <span className="problem-row__box" aria-hidden="true">
                  {active && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span>{t.wizard.problem[row.labelKey]}</span>
              </button>
              {active && isMissed && (
                <Input
                  label={t.wizard.problem.missedBahnhofLabel}
                  required
                  placeholder="z.B. Karlsruhe Hbf"
                  value={p.verpasster_anschluss_bahnhof ?? ''}
                  onChange={(e) => setMissedBahnhof(e.target.value)}
                  invalid={showErrors && missing.missedBahnhof}
                />
              )}
            </div>
          );
        })}
      </div>

      {canAutoCheck && (
        <div className="wizard-field-group" style={{ marginTop: 'var(--spacing-3)' }}>
          <Button variant="secondary" onClick={runDelayCheck} disabled={checking}>
            {checking ? t.wizard.problem.autoChecking : t.wizard.problem.autoCheck}
          </Button>
          {state.delayLookup && (
            <p className="wizard-helper">
              {t.wizard.problem.autoCheckResult
                .replace('{minutes}', String(state.delayLookup.maxDelayMinutes))
                .replace('{cancelled}', state.delayLookup.any_cancelled ? '✓' : '—')}
            </p>
          )}
          {checkError && <div className="error-message">{checkError}</div>}
        </div>
      )}

      <WizardStepButtons
        onBack={() => navigate('/antrag/neu/reise')}
        onNext={handleNext}
      />
      {showErrors && hasAnyMissing && (
        <div ref={bannerRef} className="error-message">
          {missing.antragsgrund
            ? t.wizard.problem.grundRequired
            : t.wizard.reise.missingSummary}
        </div>
      )}
    </WizardLayout>
  );
};
