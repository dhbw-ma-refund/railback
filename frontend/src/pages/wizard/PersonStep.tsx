import { useState } from 'react';
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

  // Local buffer so trailing spaces stay visible while the user types
  // between first and last name. Wizard state is kept in sync on every
  // change (split on the first space).
  const [fullName, setFullName] = useState(
    p.nachname ? `${p.vorname} ${p.nachname}` : p.vorname,
  );

  return (
    <WizardLayout activeSlug="person" title={t.wizard.person.title}>
      <div className="wizard-field-group">
        <Input
          label={`* ${t.wizard.person.fullName}`}
          placeholder="z.B. Maria Müller"
          value={fullName}
          onChange={(e) => {
            const raw = e.target.value;
            setFullName(raw);
            const idx = raw.indexOf(' ');
            const vorname = idx === -1 ? raw : raw.slice(0, idx);
            const nachname = idx === -1 ? '' : raw.slice(idx + 1);
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
