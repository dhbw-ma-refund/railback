import { useNavigate } from 'react-router-dom';
import { Input } from '@shared/components';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';

/**
 * Step 4 — Persönliche Daten. Wireframe screen 4.
 *
 * These fields live on the user PROFILE (user row), not on the ticket. In the
 * real flow this step pulls values from GET /users/me/refund-data and any
 * edits fire PATCH /users/me before the final POST /refund. Kundennummer is
 * a UI-only optional field — the backend contract has no matching schema
 * entry today, so it is retained in wizard state but never submitted.
 */
export const PersonStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, updatePerson } = useWizard();
  const p = state.person;

  return (
    <WizardLayout activeSlug="person" title={t.wizard.person.title}>
      <div className="wizard-field-group">
        <Input
          label={`* ${t.wizard.person.fullName}`}
          placeholder="z.B. Maria Müller"
          value={
            [p.vorname, p.nachname].filter(Boolean).join(' ')
          }
          onChange={(e) => {
            // Split on the first space so single names still work.
            const parts = e.target.value.split(/\s+/);
            const vorname = parts[0] ?? '';
            const nachname = parts.slice(1).join(' ');
            updatePerson({ vorname, nachname });
          }}
        />
        <Input
          label={`* ${t.wizard.person.email}`}
          type="email"
          placeholder="z.B. maria@email.de"
          value={p.email}
          onChange={(e) => updatePerson({ email: e.target.value })}
        />
        <Input
          label={t.wizard.person.telefonOpt}
          type="tel"
          placeholder="z.B. +49 151…"
          value={p.telefon ?? ''}
          onChange={(e) => updatePerson({ telefon: e.target.value })}
        />
        <Input
          label={t.wizard.person.kundennummerOpt}
          placeholder="z.B. KD-00123"
          value={p.kundennummer ?? ''}
          onChange={(e) => updatePerson({ kundennummer: e.target.value })}
          helperText={t.wizard.person.kundennummerHelper}
        />
      </div>

      <WizardStepButtons
        onBack={() => navigate('/antrag/neu/problem')}
        onNext={() => navigate('/antrag/neu/auszahlung')}
        nextDisabled={!p.vorname || !p.email}
      />
    </WizardLayout>
  );
};
