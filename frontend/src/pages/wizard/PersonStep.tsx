import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@shared/components';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';
import { useScrollIntoViewOn } from '../../hooks/useScrollIntoViewOn';

/**
 * Step 4 — Persönliche Daten. Wireframe screen 4.
 *
 * These fields live on the user PROFILE (user row), not on the ticket.
 * Prefilled from GET /users/me/refund-data via WizardContext's hydration
 * effect. Any edits are diffed against `state.hydrated.person` at submit
 * time; ReviewStep fires a single PATCH /users/me only if the diff is
 * non-empty. Kundennummer is UI-only — retained in wizard state but never
 * submitted (no backend field).
 *
 * Weiter is never disabled — clicking with missing fields flips
 * `showErrors` on so the offending inputs paint red. That's less
 * frustrating than a mysteriously-disabled button.
 */
export const PersonStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, updatePerson } = useWizard();
  const p = state.person;

  const missing = {
    vorname: !p.vorname,
    email: !p.email,
  };
  const hasAnyMissing = Object.values(missing).some(Boolean);
  const [showErrors, setShowErrors] = useState(false);
  const bannerRef = useScrollIntoViewOn(showErrors && hasAnyMissing);
  useEffect(() => {
    if (!hasAnyMissing) setShowErrors(false);
  }, [hasAnyMissing]);

  const handleNext = (e?: FormEvent) => {
    e?.preventDefault();
    if (hasAnyMissing) {
      setShowErrors(true);
      return;
    }
    navigate('/antrag/neu/auszahlung');
  };

  const inv = (key: keyof typeof missing) => showErrors && missing[key];

  return (
    <WizardLayout activeSlug="person" title={t.wizard.person.title}>
      <form className="wizard-field-group" onSubmit={handleNext}>
        <Input
          label={t.wizard.person.fullName}
          required
          placeholder="z.B. Maria Müller"
          autoComplete="name"
          value={[p.vorname, p.nachname].filter(Boolean).join(' ')}
          onChange={(e) => {
            const parts = e.target.value.split(/\s+/);
            const vorname = parts[0] ?? '';
            const nachname = parts.slice(1).join(' ');
            updatePerson({ vorname, nachname });
          }}
          invalid={inv('vorname')}
        />
        <Input
          label={t.wizard.person.email}
          required
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="z.B. maria@email.de"
          value={p.email}
          onChange={(e) => updatePerson({ email: e.target.value })}
          invalid={inv('email')}
        />
        <Input
          label={t.wizard.person.telefonOpt}
          type="tel"
          name="tel"
          autoComplete="tel"
          inputMode="tel"
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
        <button type="submit" hidden />
      </form>

      <WizardStepButtons
        onBack={() => navigate('/antrag/neu/problem')}
        onNext={handleNext}
      />
      {showErrors && hasAnyMissing && (
        <div ref={bannerRef} className="error-message">
          {t.wizard.reise.missingSummary}
        </div>
      )}
    </WizardLayout>
  );
};
