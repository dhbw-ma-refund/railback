import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@shared/components';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';
import { validateIban, validateBic } from '../../lib/validators/iban';
import { useScrollIntoViewOn } from '../../hooks/useScrollIntoViewOn';

/**
 * Step 5 — Auszahlung. Wireframe screen 5.
 *
 * IBAN + BIC live on the user row (iban_enc / bic_enc), NOT on the ticket.
 * Prefilled from GET /users/me/refund-data via WizardContext's hydration
 * effect. Any edits are diffed against `state.hydrated.auszahlung` at submit
 * time; ReviewStep fires a single PATCH /users/me/bank if the diff is
 * non-empty. On refund submit the values are re-read server-side and
 * snapshotted onto the SEPA mandate row.
 *
 * Local validation mirrors backend/lib/src/schemas/common.ts:
 *   IBAN — structure regex + mod-97 checksum
 *   BIC  — 8- or 11-character alnum
 *
 * Weiter is never disabled — clicking with missing/malformed fields sets
 * `showErrors` and lets the Input error props surface the specific issue.
 */
export const AuszahlungStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, updateAuszahlung } = useWizard();
  const a = state.auszahlung;

  const ibanInvalid = !!a.iban && !validateIban(a.iban);
  const bicInvalid = !!a.bic && !validateBic(a.bic);

  const missing = {
    kontoinhaber: !a.kontoinhaber,
    iban: !a.iban,
    bic: !a.bic,
  };
  const hasAnyMissing =
    Object.values(missing).some(Boolean) || ibanInvalid || bicInvalid;
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
    navigate('/antrag/neu/pruefen');
  };

  const inv = (key: keyof typeof missing) => showErrors && missing[key];

  return (
    <WizardLayout activeSlug="auszahlung" title={t.wizard.auszahlung.title}>
      <form className="wizard-field-group" onSubmit={handleNext}>
        <Input
          label={t.wizard.auszahlung.kontoinhaber}
          required
          autoComplete="name"
          placeholder="z.B. Maria Müller"
          value={a.kontoinhaber}
          onChange={(e) => updateAuszahlung({ kontoinhaber: e.target.value })}
          invalid={inv('kontoinhaber')}
        />
        <Input
          label={t.wizard.auszahlung.iban}
          required
          name="iban"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="z.B. DE89 3704 0044 …"
          value={a.iban}
          onChange={(e) => updateAuszahlung({ iban: e.target.value })}
          // Malformed IBAN keeps its inline explanation. Blank uses the
          // silent invalid so it joins the summary banner below.
          error={ibanInvalid ? t.wizard.auszahlung.ibanInvalid : undefined}
          invalid={!ibanInvalid && inv('iban')}
        />
        <Input
          label={t.wizard.auszahlung.bic}
          required
          name="bic"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="z.B. COBADEFFXXX"
          value={a.bic}
          onChange={(e) => updateAuszahlung({ bic: e.target.value })}
          error={bicInvalid ? t.wizard.auszahlung.bicInvalid : undefined}
          invalid={!bicInvalid && inv('bic')}
        />
        <button type="submit" hidden />
      </form>

      <p className="wizard-helper">{t.wizard.auszahlung.note}</p>

      <WizardStepButtons
        onBack={() => navigate('/antrag/neu/person')}
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
