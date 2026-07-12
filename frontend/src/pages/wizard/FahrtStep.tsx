import { useNavigate } from 'react-router-dom';
import { Input } from '@shared/components';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';

/**
 * Step 2 — Reisedaten prüfen. Wireframe screen 2.
 *
 * In the real flow this is where the extractor's output shows up (upload path)
 * or where the fields land pre-filled by lookup (route path) or blank (manual).
 * Regardless of mode the user always ends up here to confirm/edit — so it's
 * shared. Values live in wizardState.fahrt and map 1:1 to RefundRequest.fahrt.
 */
export const FahrtStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, updateFahrt } = useWizard();
  const f = state.fahrt;

  return (
    <WizardLayout activeSlug="reise" title={t.wizard.reise.title}>
      <div className="wizard-field-group">
        <div className="wizard-field-row">
          <Input
            label={t.wizard.reise.from}
            placeholder="z.B. Mannheim Hbf"
            value={f.abreisebahnhof ?? ''}
            onChange={(e) => updateFahrt({ abreisebahnhof: e.target.value })}
          />
          <Input
            label=" "
            placeholder="HH:MM"
            value={f.abfahrtszeit_plan ?? ''}
            onChange={(e) => updateFahrt({ abfahrtszeit_plan: e.target.value })}
          />
        </div>
        <div className="wizard-field-row">
          <Input
            label={t.wizard.reise.to}
            placeholder="z.B. Karlsruhe Hbf"
            value={f.zielbahnhof ?? ''}
            onChange={(e) => updateFahrt({ zielbahnhof: e.target.value })}
          />
          <Input
            label=" "
            placeholder="HH:MM"
            value={f.ankunftszeit_plan ?? ''}
            onChange={(e) => updateFahrt({ ankunftszeit_plan: e.target.value })}
          />
        </div>
        <Input
          label={t.wizard.reise.date}
          type="date"
          value={f.abreisedatum ?? ''}
          onChange={(e) => updateFahrt({ abreisedatum: e.target.value })}
        />
        <Input
          label={t.wizard.reise.train}
          placeholder="z.B. IC 2045"
          value={f.zugnummer_plan ?? ''}
          onChange={(e) => updateFahrt({ zugnummer_plan: e.target.value })}
        />
      </div>

      <WizardStepButtons
        onBack={() => {
          // Prefer to go back to the specific entry step we came from; if the
          // user got here via the entry selector, land there.
          if (state.mode === 'upload') navigate('/antrag/neu/upload');
          else if (state.mode === 'lookup') navigate('/antrag/neu/suche');
          else navigate('/antrag/neu');
        }}
        onNext={() => navigate('/antrag/neu/problem')}
      />
    </WizardLayout>
  );
};
