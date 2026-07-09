import { useNavigate } from 'react-router-dom';
import { Input } from '@shared/components';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';

/**
 * Step 5 — Auszahlung. Wireframe screen 5.
 *
 * IBAN + BIC live on the user row (iban_enc / bic_enc), NOT on the ticket. In
 * the real flow these are read from GET /users/me/refund-data and any edits
 * fire PATCH /users/me/bank before the final POST /refund. On refund submit
 * they're snapshotted onto the SEPA mandate row.
 */
export const AuszahlungStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, updateAuszahlung } = useWizard();
  const a = state.auszahlung;

  return (
    <WizardLayout activeSlug="auszahlung" title={t.wizard.auszahlung.title}>
      <div className="wizard-field-group">
        <Input
          label={`* ${t.wizard.auszahlung.kontoinhaber}`}
          placeholder="z.B. Maria Müller"
          value={a.kontoinhaber}
          onChange={(e) => updateAuszahlung({ kontoinhaber: e.target.value })}
        />
        <Input
          label={`* ${t.wizard.auszahlung.iban}`}
          placeholder="z.B. DE89 3704 0044 …"
          value={a.iban}
          onChange={(e) => updateAuszahlung({ iban: e.target.value })}
        />
        <Input
          label={t.wizard.auszahlung.bic}
          placeholder="z.B. COBADEFFXXX"
          value={a.bic}
          onChange={(e) => updateAuszahlung({ bic: e.target.value })}
        />
      </div>

      <p className="wizard-helper">{t.wizard.auszahlung.note}</p>

      <WizardStepButtons
        onBack={() => navigate('/antrag/neu/person')}
        onNext={() => navigate('/antrag/neu/pruefen')}
        nextDisabled={!a.kontoinhaber || !a.iban}
      />
    </WizardLayout>
  );
};
