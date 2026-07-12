import { useNavigate } from 'react-router-dom';
import { Input } from '@shared/components';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard, AntragsgrundTag } from './WizardContext';
import './ProblemStep.css';

interface Row {
  key: AntragsgrundTag;
  labelKey: 'reiseabbruch' | 'reiseunterbrechung' | 'verpassterAnschluss' | 'letzterUmstieg';
  bahnhofField: 'reiseabbruch_bahnhof' | 'reiseunterbrechung_bahnhof' | 'verpasster_anschluss_bahnhof' | 'letzter_umstieg_bahnhof';
}

const ROWS: Row[] = [
  { key: 'REISEABBRUCH',         labelKey: 'reiseabbruch',        bahnhofField: 'reiseabbruch_bahnhof' },
  { key: 'REISEUNTERBRECHUNG',   labelKey: 'reiseunterbrechung',  bahnhofField: 'reiseunterbrechung_bahnhof' },
  { key: 'VERPASSTER_ANSCHLUSS', labelKey: 'verpassterAnschluss', bahnhofField: 'verpasster_anschluss_bahnhof' },
  { key: 'LETZTER_UMSTIEG',      labelKey: 'letzterUmstieg',      bahnhofField: 'letzter_umstieg_bahnhof' },
];

/**
 * Step 3 — Verspätung oder Problem. Wireframe screen 3.
 *
 * Local UI tags map onto backend antragsgrund enum values at submit time:
 *   REISEABBRUCH, REISEUNTERBRECHUNG → VERSPAETUNG (with additional context in
 *       zusaetzliche_angaben)
 *   VERPASSTER_ANSCHLUSS            → VERPASSTER_ANSCHLUSS
 *   LETZTER_UMSTIEG                 → VERSPAETUNG (context field)
 * Each row also captures a "welcher Bahnhof" so we can populate
 *   fahrt_tatsaechlich.verpasster_anschluss_bahnhof and the like.
 */
export const ProblemStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, update } = useWizard();
  const p = state.problem;

  const toggle = (key: AntragsgrundTag) => {
    const set = new Set(p.antragsgrund);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    update({ problem: { ...p, antragsgrund: Array.from(set) } });
  };

  const setBahnhof = (field: Row['bahnhofField'], value: string) => {
    update({ problem: { ...p, [field]: value } });
  };

  return (
    <WizardLayout activeSlug="problem" title={t.wizard.problem.title}>
      <p className="wizard-helper">{t.wizard.problem.question}</p>

      <div className="problem-rows">
        {ROWS.map((row) => {
          const active = p.antragsgrund.includes(row.key);
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
              {active && (
                <Input
                  placeholder="z.B. Karlsruhe Hbf"
                  value={(p as any)[row.bahnhofField] ?? ''}
                  onChange={(e) => setBahnhof(row.bahnhofField, e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      <WizardStepButtons
        onBack={() => navigate('/antrag/neu/reise')}
        onNext={() => navigate('/antrag/neu/person')}
        nextDisabled={p.antragsgrund.length === 0}
      />
    </WizardLayout>
  );
};
