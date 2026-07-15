import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Checkbox } from '@shared/components';
import { StationInput } from '../../components/StationInput';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';
import { RouteTemplatePicker } from './RouteTemplatePicker';
import { DateInputWithToday } from './DateInputWithToday';
import type { RouteTemplateView } from '../../lib/api';
import { useRouteTemplates } from '../../lib/useRouteTemplates';
import { normalizePrice } from '../../lib/validators/price';
import { useScrollIntoViewOn } from '../../hooks/useScrollIntoViewOn';
import './RouteTemplatePicker.css';

/**
 * Step 2 — Reisedaten prüfen. Wireframe screen 2.
 *
 * In the real flow this is where the extractor's output shows up (upload path)
 * or where the fields land pre-filled by lookup (route path) or blank (manual).
 * Regardless of mode the user always ends up here to confirm/edit — so it's
 * shared. Values live in wizardState.fahrt and map 1:1 to RefundRequest.fahrt.
 *
 * All fields on RefundRequest.fahrt except `zugkategorie_plan` are required
 * on the wire. This form only surfaces the required ones — zugkategorie
 * is prefilled by the extractor/lookup when available and otherwise
 * omitted (users type "ICE 592" into the train field, so the category is
 * implicit and a separate select would collect a duplicate).
 * `fahrkartenpreis` must match `^-?[0-9]+\.[0-9]{2}$` (backend regex) but we
 * accept flexible input from the user (40, 40,00, 40.00, 40.5, …) and
 * normalize to the strict form on blur / before store.
 */

export const FahrtStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, update, updateFahrt } = useWizard();
  const { add: addTemplate, remove: removeTemplate } = useRouteTemplates();
  const f = state.fahrt;
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

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
    if (canonical !== null) {
      // Valid keystroke — persist canonical form.
      updateFahrt({ fahrkartenpreis: canonical });
    } else if (raw === '') {
      // Explicit clear — zero the wizard value so a subsequent Submit
      // doesn't ship the previous price. NOTE: only reacts to a fully-
      // empty input, not to intermediate mid-typing states like "40,"
      // (which parse to null but SHOULDN'T wipe a still-valid stored
      // value on the way to "40,50").
      updateFahrt({ fahrkartenpreis: '' });
    }
    // Otherwise (raw is non-empty but unparseable) — leave the wizard
    // value alone. priceInvalid flags this to the user via the input's
    // red border + priceFormat message.
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
  //
  // fahrkartennummer AND fahrkartenpreis are only required for single-trip
  // tickets. The Zeitkarte / Deutschland-Ticket branch skips both inputs:
  // the ticket file is the proof, and Zeitkarte compensation is a fixed
  // flat rate — a per-trip price would be misleading anyway. buildRefundBody
  // injects sentinels ("DEUTSCHLANDTICKET" / "0.00") for the backend's
  // min(1) / decimal-EUR constraints.
  const missing = {
    abreisebahnhof: !f.abreisebahnhof,
    zielbahnhof: !f.zielbahnhof,
    abreisedatum: !f.abreisedatum,
    abfahrtszeit_plan: !f.abfahrtszeit_plan,
    ankunftszeit_plan: !f.ankunftszeit_plan,
    zugnummer_plan: !f.zugnummer_plan,
    fahrkartennummer: !state.is_zeitkarte && !f.fahrkartennummer,
    fahrkartenpreis: !state.is_zeitkarte && (!f.fahrkartenpreis || priceInvalid),
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
   * User tapped a saved-route chip. Apply the template's from/to to
   * wizard.fahrt, remember `templateId` so ReviewStep can forward it to
   * /from-route. The template already exists on the account — no save
   * affordance is shown while a picked-template is active.
   *
   * We intentionally do NOT populate fahrkartennummer / fahrkartenpreis
   * from the template even when it carries them:
   *   - Zeitkarte flow doesn't show those inputs.
   *   - Single-trip flow: the price varies per trip (day-of-week,
   *     Sparpreis vs Flexpreis) so a stored value is more misleading
   *     than helpful. The template exists to save the route, not the
   *     ticket.
   * zugkategorie_pref DOES apply — it's a per-route preference the
   * user has declared ("ICE on this line"), and the field lives on
   * FahrtStep now-invisibly (extractor/lookup still fill it when they
   * can). Setting it here lets it flow into buildRefundBody at submit.
   */
  const pickTemplate = (tpl: RouteTemplateView) => {
    updateFahrt({
      abreisebahnhof: tpl.fromStation,
      zielbahnhof: tpl.toStation,
      zugkategorie_plan: tpl.zugkategorie_pref ?? state.fahrt.zugkategorie_plan ?? '',
    });
    update({ pickedTemplateId: tpl.templateId });
  };

  /**
   * User edited a station field directly. Clear the "picked template"
   * link so we don't ship a mismatched templateId on submit and don't
   * highlight the wrong chip. Called from the onChange of both station
   * inputs. Does NOT auto-delete a session-saved template — the user
   * might just be fine-tuning a station name and doesn't expect their
   * saved route to disappear.
   */
  const clearPickedTemplateOnEdit = () => {
    if (state.pickedTemplateId) {
      update({ pickedTemplateId: null });
    }
  };

  /**
   * "Als Strecke speichern" toggle. Save-on-tick / delete-on-untick,
   * both fire the network call immediately so the user sees the chip
   * appear/disappear right away. The pointer is stashed on wizard
   * state (with the from/to it applies to) so:
   *   - navigating between FahrtStep and LookupStep with the same
   *     from/to keeps the toggle in sync, AND
   *   - editing either station uncouples the pointer from the current
   *     form fields, so untick can't accidentally delete a template
   *     for a route the user is no longer looking at (isSavedNow
   *     evaluates false → checkbox is unchecked → onToggleSave(true)
   *     saves the NEW route, not deletes the old one).
   *
   * On error: revert the toggle, show a small inline message. We do
   * NOT block navigation on save errors — the wizard flow itself is
   * unaffected.
   */
  const onToggleSave = async (checked: boolean) => {
    setSaveError('');
    if (checked) {
      if (!f.abreisebahnhof || !f.zielbahnhof) return;
      setSaving(true);
      try {
        const created = await addTemplate({
          label: `${f.abreisebahnhof} → ${f.zielbahnhof}`,
          fromStation: f.abreisebahnhof,
          toStation: f.zielbahnhof,
          ...(f.zugkategorie_plan ? { zugkategorie_pref: f.zugkategorie_plan } : {}),
        });
        update({
          savedThisSession: {
            templateId: created.templateId,
            fromStation: f.abreisebahnhof,
            toStation: f.zielbahnhof,
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
      // Only delete if the pointer STILL describes the fields on
      // screen. If it doesn't (user edited stations after saving),
      // the checkbox shouldn't have been rendered as checked in the
      // first place; guard defensively.
      const saved = state.savedThisSession;
      if (
        !saved ||
        saved.fromStation !== f.abreisebahnhof ||
        saved.toStation !== f.zielbahnhof
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

  /**
   * True when we saved a template during this wizard session AND the
   * current from/to still match it. Used to drive the checkbox's
   * `checked` state — see the comment on WizardState.savedThisSession
   * for the whole rationale.
   */
  const isSavedNow =
    !!state.savedThisSession &&
    state.savedThisSession.fromStation === f.abreisebahnhof &&
    state.savedThisSession.toStation === f.zielbahnhof;

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
      <RouteTemplatePicker
        onPick={pickTemplate}
        activeTemplateId={state.pickedTemplateId}
      />
      <form className="wizard-field-group" onSubmit={handleNext}>
        <div className="wizard-field-row">
          <StationInput
            label={t.wizard.reise.from}
            required
            placeholder="z.B. Mannheim Hbf"
            value={f.abreisebahnhof ?? ''}
            onChange={(v) => {
              clearPickedTemplateOnEdit();
              updateFahrt({ abreisebahnhof: v });
            }}
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
            onChange={(v) => {
              clearPickedTemplateOnEdit();
              updateFahrt({ zielbahnhof: v });
            }}
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

        {/* "Als Strecke speichern" — save-on-tick, delete-on-untick.
            Only offered when the user typed their own from/to (i.e. no
            picked template) and both stations have text. Rename lives
            on the Profile page. */}
        {!state.pickedTemplateId &&
          !!f.abreisebahnhof &&
          !!f.zielbahnhof && (
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

        <DateInputWithToday
          label={t.wizard.reise.date}
          required
          value={f.abreisedatum ?? ''}
          onChange={(v) => updateFahrt({ abreisedatum: v })}
          invalid={inv('abreisedatum')}
        />
        {/* Train number carries the category prefix in practice ("ICE 592",
            "RE 4") — a separate zugkategorie select was collecting a value
            the user had already typed. The wire field is optional; extractor
            and lookup still populate it automatically when they can. */}
        <Input
          label={t.wizard.reise.train}
          required
          placeholder="z.B. ICE 592"
          value={f.zugnummer_plan ?? ''}
          onChange={(e) => updateFahrt({ zugnummer_plan: e.target.value })}
          invalid={inv('zugnummer_plan')}
        />
        {!state.is_zeitkarte && (
          <Input
            label={t.wizard.reise.ticketNumber}
            required
            placeholder="z.B. 7313005"
            value={f.fahrkartennummer ?? ''}
            onChange={(e) => updateFahrt({ fahrkartennummer: e.target.value })}
            invalid={inv('fahrkartennummer')}
          />
        )}
        {!state.is_zeitkarte && (
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
        )}
        {/* No visible submit button — the WizardStepButtons "Weiter" below
            drives navigation. The <form> wrapper is here so pressing Enter
            in any input advances the step (matches login/register pattern). */}
        <button type="submit" hidden />
      </form>

      <WizardStepButtons
        onBack={() => {
          if (state.mode === 'upload') navigate('/antrag/neu/upload');
          else if (state.mode === 'lookup') navigate('/antrag/neu/suche');
          // Manual Einzelfahrkarte path — back through the sub-picker,
          // not all the way to the ticket-art picker at /antrag/neu.
          else navigate('/antrag/neu/entry');
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
