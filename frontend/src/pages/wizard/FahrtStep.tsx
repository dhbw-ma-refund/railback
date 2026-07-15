import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@shared/components';
import { StationInput } from '../../components/StationInput';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';
import { normalizePrice } from '../../lib/validators/price';
import { useScrollIntoViewOn } from '../../hooks/useScrollIntoViewOn';

/**
 * Step 2 — Reisedaten prüfen. Wireframe screen 2.
 *
 * In the real flow this is where the extractor's output shows up (upload path)
 * or where the fields land pre-filled by lookup (route path) or blank (manual).
 * Regardless of mode the user always ends up here to confirm/edit — so it's
 * shared. Values live in wizardState.fahrt and map 1:1 to RefundRequest.fahrt.
 *
 * All fields on RefundRequest.fahrt except `zugkategorie_plan` are required.
 * `fahrkartenpreis` must match `^-?[0-9]+\.[0-9]{2}$` (backend regex) but we
 * accept flexible input from the user (40, 40,00, 40.00, 40.5, …) and
 * normalize to the strict form on blur / before store.
 */

export const FahrtStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, updateFahrt } = useWizard();
  const f = state.fahrt;

  /**
   * Local uncontrolled-shape state for the price field so the user sees
   * what they typed while typing (a controlled input bound directly to
   * wizard state would either reject their input or reformat it mid-keystroke).
   * Kept in sync with wizard state when the wizard state changes from outside
   * (e.g., the extractor hydrated a value on UploadStep).
   */
  const [priceInput, setPriceInput] = useState<string>(f.fahrkartenpreis ?? '');
  useEffect(() => {
    // Extractor / lookup / persisted-state hydration can change the wizard
    // value out from under us. Only reflect the change locally when the
    // canonical wizard value doesn't match what the local input already
    // canonicalizes to — otherwise typing "40" would get clobbered back
    // to "40.00" as soon as it's stored.
    const canonicalLocal = normalizePrice(priceInput);
    if (f.fahrkartenpreis && canonicalLocal !== f.fahrkartenpreis) {
      setPriceInput(f.fahrkartenpreis);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.fahrkartenpreis]);

  const priceParsed = normalizePrice(priceInput);
  const priceInvalid = priceInput !== '' && priceParsed === null;

  const onPriceChange = (raw: string) => {
    setPriceInput(raw);
    const canonical = normalizePrice(raw);
    // Only update wizard state when we can produce a valid canonical form.
    // Keeping the last-good value in wizard state means an intermediate
    // keystroke like "40," (mid-typing) doesn't wipe the previous submit-ready
    // value on the way to a valid "40,50".
    if (canonical !== null) updateFahrt({ fahrkartenpreis: canonical });
  };

  const onPriceBlur = () => {
    // Snap the visible field to canonical form so users see "40.00" after
    // they leave the field. Leave invalid input alone so they can fix it.
    if (priceParsed !== null && priceInput !== priceParsed) {
      setPriceInput(priceParsed);
    }
  };

  // Which fields are missing / malformed. Rendered as `error` on each
  // Input only after the user tries to advance — before then, showing red
  // borders on a fresh form would be aggressive. See handleNext.
  const missing = {
    abreisebahnhof: !f.abreisebahnhof,
    zielbahnhof: !f.zielbahnhof,
    abreisedatum: !f.abreisedatum,
    abfahrtszeit_plan: !f.abfahrtszeit_plan,
    ankunftszeit_plan: !f.ankunftszeit_plan,
    zugnummer_plan: !f.zugnummer_plan,
    fahrkartennummer: !f.fahrkartennummer,
    fahrkartenpreis: !f.fahrkartenpreis || priceInvalid,
  };
  const hasAnyMissing = Object.values(missing).some(Boolean);
  const [showErrors, setShowErrors] = useState(false);
  const bannerRef = useScrollIntoViewOn(showErrors && hasAnyMissing);
  // Auto-hide the error state once every field is valid, so users don't
  // get stuck seeing red on a field they just fixed.
  useEffect(() => {
    if (!hasAnyMissing) setShowErrors(false);
  }, [hasAnyMissing]);

  const handleNext = (e?: FormEvent) => {
    e?.preventDefault();
    if (hasAnyMissing) {
      setShowErrors(true);
      return;
    }
    navigate('/antrag/neu/problem');
  };

  /**
   * Silent invalid signal — used on every field that only has a
   * "required" issue. The red border is enough; the summary banner
   * below the form tells the user what's missing (see the banner at
   * the bottom of the render). Fields with SPECIFIC error messages
   * (bad price format) keep their inline text.
   */
  const inv = (key: keyof typeof missing) => showErrors && missing[key];

  return (
    <WizardLayout activeSlug="reise" title={t.wizard.reise.title}>
      <form className="wizard-field-group" onSubmit={handleNext}>
        <div className="wizard-field-row">
          <StationInput
            label={t.wizard.reise.from}
            required
            placeholder="z.B. Mannheim Hbf"
            value={f.abreisebahnhof ?? ''}
            onChange={(v) => updateFahrt({ abreisebahnhof: v })}
            invalid={inv('abreisebahnhof')}
          />
          <Input
            aria-label={t.wizard.reise.plannedDeparture}
            required
            placeholder="HH:MM"
            type="time"
            value={f.abfahrtszeit_plan ?? ''}
            onChange={(e) => updateFahrt({ abfahrtszeit_plan: e.target.value })}
            invalid={inv('abfahrtszeit_plan')}
          />
        </div>
        <div className="wizard-field-row">
          <StationInput
            label={t.wizard.reise.to}
            required
            placeholder="z.B. Karlsruhe Hbf"
            value={f.zielbahnhof ?? ''}
            onChange={(v) => updateFahrt({ zielbahnhof: v })}
            invalid={inv('zielbahnhof')}
          />
          <Input
            aria-label={t.wizard.reise.plannedArrival}
            required
            placeholder="HH:MM"
            type="time"
            value={f.ankunftszeit_plan ?? ''}
            onChange={(e) => updateFahrt({ ankunftszeit_plan: e.target.value })}
            invalid={inv('ankunftszeit_plan')}
          />
        </div>
        <Input
          label={t.wizard.reise.date}
          required
          type="date"
          value={f.abreisedatum ?? ''}
          onChange={(e) => updateFahrt({ abreisedatum: e.target.value })}
          invalid={inv('abreisedatum')}
        />
        <Input
          label={t.wizard.reise.train}
          required
          placeholder="z.B. IC 2045"
          value={f.zugnummer_plan ?? ''}
          onChange={(e) => updateFahrt({ zugnummer_plan: e.target.value })}
          invalid={inv('zugnummer_plan')}
        />
        <Input
          label={t.wizard.reise.ticketNumber}
          required
          placeholder="z.B. 7313005"
          value={f.fahrkartennummer ?? ''}
          onChange={(e) => updateFahrt({ fahrkartennummer: e.target.value })}
          invalid={inv('fahrkartennummer')}
        />
        <Input
          label={t.wizard.reise.ticketPrice}
          required
          placeholder="z.B. 29,90"
          inputMode="decimal"
          value={priceInput}
          onChange={(e) => onPriceChange(e.target.value)}
          onBlur={onPriceBlur}
          // Malformed input keeps its specific inline message (the summary
          // banner below can't explain HOW to fix a bad number). Blank
          // uses the silent invalid signal so it joins the banner.
          error={priceInvalid ? t.wizard.reise.priceFormat : undefined}
          invalid={!priceInvalid && inv('fahrkartenpreis')}
          helperText={t.wizard.reise.priceHint}
        />
        {/* No visible submit button — the WizardStepButtons "Weiter" below
            drives navigation. The <form> wrapper is here so pressing Enter
            in any input advances the step (matches login/register pattern). */}
        <button type="submit" hidden />
      </form>

      <WizardStepButtons
        onBack={() => {
          if (state.mode === 'upload') navigate('/antrag/neu/upload');
          else if (state.mode === 'lookup') navigate('/antrag/neu/suche');
          else navigate('/antrag/neu');
        }}
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
