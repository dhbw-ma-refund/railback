import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Checkbox } from '@shared/components';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { useWizard, AntragsgrundTag, BelegDraft } from './WizardContext';
import { api } from '../../lib/api';
import type {
  Antragsart,
  BelegPresignResponse,
  BelegTyp,
  FromRouteRequest,
  RefundRequest,
  SupportedMimeType,
} from '../../lib/api';
import { ApiError } from '@shared/api/errors';
import { ulid } from '../../lib/ulid';
import { normalizePrice } from '../../lib/validators/price';
import { useScrollIntoViewOn } from '../../hooks/useScrollIntoViewOn';
import { uploadToS3 } from '../../lib/uploadToS3';
import { buildRefundBody, mapAntragsgrundTags, ZEITKARTE_FAHRKARTENNUMMER, ZEITKARTE_FAHRKARTENPREIS } from './buildRefundBody';
import './ReviewStep.css';

const GRUND_LABELS_DE: Record<AntragsgrundTag, string> = {
  VERSPAETUNG: 'Verspätung',
  AUSFALL: 'Zugausfall',
  VERPASSTER_ANSCHLUSS: 'Verpasster Anschluss',
};

const ANTRAGSARTEN: Antragsart[] = [
  'ERSTATTUNG_FAHRKARTE',
  'ENTSCHAEDIGUNG_60_119',
  'ENTSCHAEDIGUNG_120_PLUS',
  'ENTSCHAEDIGUNG_ZEITKARTE',
  'KOSTEN_ALTERNATIVTRANSPORT',
];

const BELEG_TYPEN: BelegTyp[] = ['TAXI', 'BUS', 'HOTEL', 'SONSTIGES'];
const BELEG_ACCEPT = 'application/pdf,image/jpeg,image/png';
const BELEG_MAX_BYTES = 5 * 1024 * 1024;

function isSupportedMime(mime: string): mime is SupportedMimeType {
  return mime === 'application/pdf' || mime === 'image/jpeg' || mime === 'image/png';
}

/**
 * Step 6 — Bitte prüfen Sie Ihre Angaben.
 *
 * Summary cards jump back to their respective step. Below the cards:
 *   - antragstellung_ort (required text input)
 *   - antragsart radio (defaults to delayLookup.suggested_antragsart if
 *     available, else ENTSCHAEDIGUNG_60_119)
 *   - belege section (only when KOSTEN_ALTERNATIVTRANSPORT is picked)
 *   - datenschutz + wahrheitserklärung consent checkboxes
 *
 * Submit path:
 *   1. Ensure a ticket exists — createFromRoute if wizard has no ticketId.
 *   2. If person or auszahlung is dirty vs the hydrated snapshot,
 *      PATCH /users/me and/or /users/me/bank.
 *   3. Upload any staged belege (presign → S3 → confirm) in sequence.
 *   4. POST /users/me/tickets/{id}/refund.
 *   5. Cache the response and navigate to /antrag/neu/eingereicht?id=…
 */
export const ReviewStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, update } = useWizard();

  const suggested = state.delayLookup?.suggested_antragsart;
  // Zeitkarte flow: the antragsart is fixed to ENTSCHAEDIGUNG_ZEITKARTE
  // regardless of what the delay lookup suggests (the other antragsart
  // enums are single-trip categories). The user chose the Zeitkarte path
  // on TicketArtStep — we honor it here.
  //
  // Single-trip flow: symmetric — if a persisted state.antragsart or a
  // suggested value from the delay lookup lands on ENTSCHAEDIGUNG_ZEITKARTE
  // here, ignore it. Zeitkarte is the top-level branch on TicketArtStep;
  // the single-trip radio group can't offer it and mustn't silently
  // preselect it either.
  const singleTripFallback = (art: Antragsart | undefined): Antragsart | undefined =>
    art === 'ENTSCHAEDIGUNG_ZEITKARTE' ? undefined : art;
  const currentAntragsart: Antragsart = state.is_zeitkarte
    ? 'ENTSCHAEDIGUNG_ZEITKARTE'
    : singleTripFallback(state.antragsart ?? undefined) ??
      singleTripFallback(suggested) ??
      'ENTSCHAEDIGUNG_60_119';

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitProgress, setSubmitProgress] = useState<string>('');

  const needsBelege = currentAntragsart === 'KOSTEN_ALTERNATIVTRANSPORT';
  const belegeIncomplete = useMemo(() => {
    if (!needsBelege) return false;
    if (state.belege.length === 0) return true;
    return state.belege.some(
      (b) =>
        !b.amount ||
        normalizePrice(b.amount) === null ||
        (b.status === 'draft' && !b.file) ||
        b.status === 'error',
    );
  }, [needsBelege, state.belege]);

  const missing = {
    antragsart: !currentAntragsart,
    antragstellung_ort: !state.antragstellung_ort.trim(),
    datenschutz: !state.datenschutz_einwilligung,
    wahrheit: !state.wahrheitserklaerung,
    antragsgrund: state.problem.antragsgrund.length === 0,
    // Zeitkarte branch injects the sentinels in buildRefundBody, so empty
    // state.fahrt.fahrkartennummer / fahrkartenpreis are expected — don't
    // gate submit on them.
    fahrkartennummer: !state.is_zeitkarte && !state.fahrt.fahrkartennummer,
    fahrkartenpreis: !state.is_zeitkarte && !state.fahrt.fahrkartenpreis,
    belege: belegeIncomplete,
  };
  const hasAnyMissing = Object.values(missing).some(Boolean);
  const [showErrors, setShowErrors] = useState(false);
  // The consents banner is above the submit button; the "early step missing"
  // banner is between the two. Both are inside the consents/summary region,
  // so a single ref anchored at the consents section is enough to bring
  // them + the submit button into view.
  const bannerRef = useScrollIntoViewOn<HTMLElement>(showErrors && hasAnyMissing);
  useEffect(() => {
    if (!hasAnyMissing) setShowErrors(false);
  }, [hasAnyMissing]);

  // ─── Belege editing (draft rows) ───────────────────────────────────────
  const addBelegDraft = () => {
    if (state.belege.length >= 5) return;
    update({
      belege: [
        ...state.belege,
        {
          localId: ulid(),
          typ: 'SONSTIGES',
          amount: '',
          status: 'draft',
        },
      ],
    });
  };
  const removeBeleg = (localId: string) => {
    // Client-side remove only. If it was uploaded server-side, DELETE it too.
    const target = state.belege.find((b) => b.localId === localId);
    if (target?.belegId && state.ticketId) {
      void api.deleteBeleg(state.ticketId, target.belegId).catch(() => undefined);
    }
    update({ belege: state.belege.filter((b) => b.localId !== localId) });
  };
  const editBeleg = (localId: string, patch: Partial<BelegDraft>) => {
    update({
      belege: state.belege.map((b) => (b.localId === localId ? { ...b, ...patch } : b)),
    });
  };

  // ─── Submit orchestration ─────────────────────────────────────────────
  const doSubmit = async () => {
    if (hasAnyMissing) {
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    setSubmitProgress('');
    // Hoisted so the catch can reference it — the S3-IAM soft-success
    // path needs it after api.submitRefund() has thrown.
    let ticketId = state.ticketId;
    try {
      // 1. Ensure a ticketId exists.
      if (!ticketId) {
        setSubmitProgress(t.wizard.review.creatingTicket);
        // Manual + lookup paths land here. The backend will create the ticket
        // in READY (extraction_method = MANUAL_ROUTE).
        const req: FromRouteRequest = {
          ticketId: ulid(),
          trainNr: state.fahrt.zugnummer_plan!,
          date: state.fahrt.abreisedatum!,
          fromStation: state.fahrt.abreisebahnhof!,
          toStation: state.fahrt.zielbahnhof!,
          abfahrtszeit_plan: state.fahrt.abfahrtszeit_plan!,
          ankunftszeit_plan: state.fahrt.ankunftszeit_plan!,
          // fromRouteRequestSchema.fahrkartennummer is min(1) and
          // .fahrkartenpreis matches ^-?[0-9]+\.[0-9]{2}$ — inject the
          // Zeitkarte sentinels so the manual/lookup path still passes
          // the backend refine (same rationale as buildRefundBody).
          fahrkartennummer: state.is_zeitkarte
            ? ZEITKARTE_FAHRKARTENNUMMER
            : state.fahrt.fahrkartennummer!,
          fahrkartenpreis: state.is_zeitkarte
            ? ZEITKARTE_FAHRKARTENPREIS
            : state.fahrt.fahrkartenpreis!,
          is_zeitkarte: state.is_zeitkarte || false,
          // Informational on the wire (the backend accepts but doesn't
          // persist templateId on the ticket yet — see the note on
          // FromRouteRequest.templateId). Forward it anyway so analytics
          // and future persistence work retroactively. Either the user
          // picked a saved template on FahrtStep/LookupStep, OR they
          // saved a new one via the "Als Strecke speichern" tick during
          // this session — either way, we have a template id to attach.
          //
          // For the session-saved case we still only forward the id if
          // the current from/to actually match the row we saved; if the
          // user has since edited the stations, the session pointer no
          // longer describes this trip and forwarding it would attach a
          // ticket to the wrong template.
          ...(state.pickedTemplateId
            ? { templateId: state.pickedTemplateId }
            : state.savedThisSession &&
                state.savedThisSession.fromStation === state.fahrt.abreisebahnhof &&
                state.savedThisSession.toStation === state.fahrt.zielbahnhof
              ? { templateId: state.savedThisSession.templateId }
              : {}),
        };
        const res = await api.createFromRoute(req);
        ticketId = res.ticketId;
        update({ ticketId });
      }

      // 2. PATCH profile + bank if dirty vs the hydrated snapshot.
      const hp = state.hydrated.person;
      const ha = state.hydrated.auszahlung;
      const personDirty =
        hp !== undefined &&
        (hp.vorname !== state.person.vorname ||
          hp.nachname !== state.person.nachname ||
          hp.telefon !== (state.person.telefon ?? ''));
      const bankDirty =
        ha !== undefined && (ha.iban !== state.auszahlung.iban || ha.bic !== state.auszahlung.bic);

      if (personDirty) {
        setSubmitProgress(t.wizard.review.savingProfile);
        // Address stays on the user row via PATCH /users/me too. The wizard
        // doesn't edit address in this pass, so we send just the mutable
        // fields it does capture.
        await api.updateProfile({
          vorname: state.person.vorname,
          nachname: state.person.nachname,
          telefon: state.person.telefon ?? '',
        });
      }
      if (bankDirty) {
        setSubmitProgress(t.wizard.review.savingBank);
        await api.updateBank(state.auszahlung.iban, state.auszahlung.bic);
      }

      // 3. Upload staged belege (presign → S3 → confirm) for any row still
      //    in draft state. Rows already uploaded (status === 'uploaded')
      //    are skipped.
      if (needsBelege) {
        for (const b of state.belege) {
          if (b.status === 'uploaded' && b.belegId) continue;
          if (!b.file) throw new Error('missing beleg file');
          setSubmitProgress(t.wizard.review.uploadingBelege);
          editBeleg(b.localId, { status: 'uploading', error: undefined });
          const mime = b.file.type;
          if (!isSupportedMime(mime)) throw new Error('unsupported beleg mime');
          const envelope: BelegPresignResponse = await api.presignBeleg(ticketId, {
            filename: b.file.name,
            mimeType: mime,
            typ: b.typ,
          });
          const s3Res = await uploadToS3(envelope, b.file);
          if (!s3Res.ok) throw new Error(`beleg S3 upload failed (HTTP ${s3Res.status})`);
          // Belege amount may be non-canonical if the user tabbed to Submit
          // without ever blurring the amount input. Normalize before send —
          // the belegeIncomplete gate above already rejects unparseable
          // amounts, so the fallback here is defensive.
          const canonicalAmount = normalizePrice(b.amount) ?? b.amount;
          await api.confirmBeleg(ticketId, envelope.belegId, {
            s3_key: envelope.s3_key,
            filename: b.file.name,
            mimeType: mime,
            typ: b.typ,
            size_bytes: b.file.size,
            amount: canonicalAmount,
          });
          editBeleg(b.localId, {
            status: 'uploaded',
            belegId: envelope.belegId,
            filename: b.file.name,
            mimeType: mime,
            size_bytes: b.file.size,
          });
        }
      }

      // 4. Submit the refund body.
      setSubmitProgress(t.wizard.review.submitting);
      const body: RefundRequest = buildRefundBody({ ...state, antragsart: currentAntragsart });
      const result = await api.submitRefund(ticketId, body);

      // 5. Cache result and navigate.
      update({ submitResult: result });
      navigate(`/antrag/neu/eingereicht?id=${encodeURIComponent(result.ticketId)}`);
    } catch (err) {
      // Soft-success path: the backend's refund-pdf renderer can hit an
      // IAM error trying to write the rendered PDF to S3
      // (`s3:PutObject on arn:aws:s3:::railback/rendered/…`). When that
      // happens the ticket has ALREADY been created + priced server-side
      // — the email dispatch is what failed, not the claim itself. Show
      // the /eingereicht screen with a warning rather than a hard error
      // that hides a successfully-recorded claim.
      const isPdfRenderIamError =
        err instanceof ApiError &&
        err.status === 500 &&
        err.body.code === 'ERR_INTERNAL' &&
        typeof err.body.message === 'string' &&
        err.body.message.includes('s3:PutObject') &&
        err.body.message.includes('/rendered/');
      if (isPdfRenderIamError && ticketId) {
        navigate(
          `/antrag/neu/eingereicht?id=${encodeURIComponent(ticketId)}&pdfIssue=1`,
        );
        return;
      }

      if (err instanceof ApiError) {
        const field = (err.body.details as { field?: string } | undefined)?.field;
        const suffix = field ? ` (${field})` : '';
        setSubmitError((err.body.message || t.wizard.review.submitError) + suffix);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError(t.wizard.review.submitError);
      }
      setSubmitProgress('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WizardLayout activeSlug="pruefen" title={t.wizard.review.title}>
      {/* Ticket / Upload */}
      <ReviewCard
        title={t.wizard.review.ticket}
        editPath="/antrag/neu/upload"
        editable={state.mode === 'upload'}
        editLabel={t.wizard.review.edit}
      >
        {state.ticketFile ? (
          <p className="review-card__line">{state.ticketFile.name}</p>
        ) : (
          <p className="review-card__line review-card__line--muted">{t.wizard.review.noTicket}</p>
        )}
      </ReviewCard>

      {/* Reise */}
      <ReviewCard title={t.wizard.review.trip} editPath="/antrag/neu/reise" editLabel={t.wizard.review.edit}>
        <p className="review-card__line">
          {state.fahrt.abreisebahnhof || '—'} → {state.fahrt.zielbahnhof || '—'}
        </p>
        <p className="review-card__line review-card__line--muted">
          {state.fahrt.abreisedatum || '—'} · {state.fahrt.zugnummer_plan || '—'}
          {state.fahrt.fahrkartenpreis ? ` · ${state.fahrt.fahrkartenpreis} €` : ''}
        </p>
      </ReviewCard>

      {/* Problem */}
      <ReviewCard
        title={t.wizard.review.problem}
        editPath="/antrag/neu/problem"
        editLabel={t.wizard.review.edit}
      >
        {state.problem.antragsgrund.length === 0 ? (
          <p className="review-card__line review-card__line--muted">—</p>
        ) : (
          <p className="review-card__line">
            {state.problem.antragsgrund.map((g) => GRUND_LABELS_DE[g]).join(', ')}
            {state.delayLookup && ` · +${state.delayLookup.maxDelayMinutes} min`}
          </p>
        )}
      </ReviewCard>

      {/* Person */}
      <ReviewCard title={t.wizard.review.person} editPath="/antrag/neu/person" editLabel={t.wizard.review.edit}>
        <p className="review-card__line">
          {state.person.vorname} {state.person.nachname}
          {state.person.email ? ` · ${state.person.email}` : ''}
        </p>
      </ReviewCard>

      {/* Auszahlung */}
      <ReviewCard
        title={t.wizard.review.payout}
        editPath="/antrag/neu/auszahlung"
        editLabel={t.wizard.review.edit}
      >
        <p className="review-card__line">
          {state.auszahlung.kontoinhaber || '—'}
          {state.auszahlung.iban ? ` · ${maskIban(state.auszahlung.iban)}` : ''}
        </p>
      </ReviewCard>

      {/* Antragsart + place */}
      <section className="review-card">
        <header className="review-card__head">
          <h2 className="review-card__title">{t.wizard.review.claimTypeTitle}</h2>
        </header>
        {suggested && !state.is_zeitkarte && suggested !== 'ENTSCHAEDIGUNG_ZEITKARTE' && (
          <p className="wizard-helper">
            {t.wizard.review.suggested.replace('{art}', t.wizard.antragsart[suggested])}
          </p>
        )}
        {state.is_zeitkarte && (
          <p className="wizard-helper">
            {t.wizard.review.zeitkarteLocked}
          </p>
        )}
        <div className="wizard-field-group">
          {ANTRAGSARTEN
            .filter((art) =>
              // Zeitkarte flow: only ENTSCHAEDIGUNG_ZEITKARTE is valid,
              // the other four are single-trip categories that would
              // confuse the DB reviewer.
              // Single-trip flow: hide ENTSCHAEDIGUNG_ZEITKARTE — that's
              // its own top-level branch, picked on TicketArtStep. A user
              // who reached this screen via Einzelfahrkarte has already
              // said "not a season pass"; showing it as a radio option
              // here contradicts that choice and would silently mis-file
              // the claim.
              state.is_zeitkarte
                ? art === 'ENTSCHAEDIGUNG_ZEITKARTE'
                : art !== 'ENTSCHAEDIGUNG_ZEITKARTE',
            )
            .map((art) => (
              <label key={art} className="review-radio">
                <input
                  type="radio"
                  name="antragsart"
                  value={art}
                  checked={currentAntragsart === art}
                  // is_zeitkarte is set upstream on TicketArtStep now;
                  // this radio only picks the antragsart.
                  onChange={() => update({ antragsart: art })}
                />
                <span>{t.wizard.antragsart[art]}</span>
              </label>
            ))}
          <Input
            label={t.wizard.review.antragstellungOrt}
            required
            placeholder="z.B. Mannheim"
            value={state.antragstellung_ort}
            onChange={(e) => update({ antragstellung_ort: e.target.value })}
            invalid={showErrors && missing.antragstellung_ort}
          />
          <Input
            label={t.wizard.review.zusaetzlicheAngaben}
            placeholder=""
            value={state.zusaetzliche_angaben}
            onChange={(e) => update({ zusaetzliche_angaben: e.target.value })}
            helperText={t.wizard.review.zusaetzlicheAngabenHint}
          />
        </div>
      </section>

      {/* Belege — only when antragsart requires them */}
      {needsBelege && (
        <section className="review-card">
          <header className="review-card__head">
            <h2 className="review-card__title">{t.wizard.review.belegeTitle}</h2>
          </header>
          <p className="wizard-helper">{t.wizard.review.belegeHint}</p>
          <div className="wizard-field-group">
            {state.belege.map((b) => (
              <BelegRow
                key={b.localId}
                beleg={b}
                onChange={(patch) => editBeleg(b.localId, patch)}
                onRemove={() => removeBeleg(b.localId)}
                labels={{
                  typ: t.wizard.review.belegeTyp,
                  amount: t.wizard.review.belegeAmount,
                  file: t.wizard.review.belegeFile,
                  remove: t.wizard.review.belegeRemove,
                }}
                typLabels={t.wizard.belegTyp}
                amountFormat={t.wizard.review.belegeAmountFormat}
              />
            ))}
            {state.belege.length < 5 && (
              <Button variant="secondary" onClick={addBelegDraft}>
                {t.wizard.review.belegeAdd}
              </Button>
            )}
          </div>
        </section>
      )}

      {/* Consents */}
      <section className="review-card" ref={bannerRef}>
        <div className="wizard-field-group">
          <Checkbox
            checked={state.datenschutz_einwilligung}
            onChange={(e) => update({ datenschutz_einwilligung: e.target.checked })}
            label={t.wizard.review.consentDatenschutz}
          />
          <Checkbox
            checked={state.wahrheitserklaerung}
            onChange={(e) => update({ wahrheitserklaerung: e.target.checked })}
            label={t.wizard.review.consentWahrheit}
          />
          {showErrors && (missing.datenschutz || missing.wahrheit) && (
            <div className="error-message">{t.wizard.review.consentsRequired}</div>
          )}
        </div>
      </section>

      {/* If there are still-missing pieces after the user hits Submit and
          they belong to earlier steps (fahrkartennummer/preis, antragsgrund),
          we can't paint them red from here — show a summary error banner
          so the user knows to go back. */}
      {showErrors &&
        (missing.antragsgrund || missing.fahrkartennummer || missing.fahrkartenpreis) && (
          <div className="error-message">{t.wizard.review.earlyStepMissing}</div>
        )}

      {submitProgress && <p className="wizard-helper">{submitProgress}</p>}
      {submitError && <div className="error-message">{submitError}</div>}

      <div className="wizard-field-group">
        <Button variant="primary" onClick={doSubmit} disabled={submitting}>
          {submitting ? t.wizard.review.submittingLabel : t.wizard.review.submit}
        </Button>
        <Button variant="secondary" onClick={() => navigate('/antrag/neu/auszahlung')}>
          {t.wizard.back}
        </Button>
      </div>

      {/* Debug — non-user visible */}
      <span hidden data-antragsgrund={mapAntragsgrundTags(state.problem.antragsgrund).join(',')} />
    </WizardLayout>
  );
};

// ─── Review-card sub-component (unchanged from static version) ───────────

interface CardProps {
  title: string;
  editPath: string;
  editLabel: string;
  editable?: boolean;
  children: React.ReactNode;
}

const ReviewCard = ({ title, editPath, editLabel, editable = true, children }: CardProps) => {
  const navigate = useNavigate();
  return (
    <section className="review-card">
      <header className="review-card__head">
        <h2 className="review-card__title">{title}</h2>
        {editable && (
          <button type="button" className="review-card__edit" onClick={() => navigate(editPath)}>
            {editLabel}
          </button>
        )}
      </header>
      {children}
    </section>
  );
};

const maskIban = (iban: string) => {
  const stripped = iban.replace(/\s+/g, '');
  if (stripped.length <= 8) return iban;
  return `${stripped.slice(0, 2)} •••• ${stripped.slice(-4)}`;
};

// ─── Beleg-row sub-component ───────────────────────────────────────────

interface BelegRowProps {
  beleg: BelegDraft;
  onChange: (patch: Partial<BelegDraft>) => void;
  onRemove: () => void;
  labels: { typ: string; amount: string; file: string; remove: string };
  typLabels: Record<BelegTyp, string>;
  amountFormat: string;
}

const BelegRow = ({ beleg, onChange, onRemove, labels, typLabels, amountFormat }: BelegRowProps) => {
  const amountInvalid = !!beleg.amount && normalizePrice(beleg.amount) === null;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onAmountBlur = () => {
    // Snap to canonical XX.XX form when leaving the field, so the user
    // sees the exact string that'll be sent to the backend.
    const canonical = normalizePrice(beleg.amount);
    if (canonical !== null && canonical !== beleg.amount) {
      onChange({ amount: canonical });
    }
  };

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    if (f.size > BELEG_MAX_BYTES) {
      onChange({ status: 'error', error: 'Datei zu groß (max. 5 MB)' });
      return;
    }
    onChange({ file: f, filename: f.name, status: 'draft', error: undefined });
  };

  const clearFile = () =>
    onChange({ file: undefined, filename: undefined, status: 'draft', error: undefined });

  const fileSize = beleg.file?.size ?? beleg.size_bytes;
  const fileSizeLabel =
    fileSize !== undefined
      ? fileSize < 1024
        ? `${fileSize} B`
        : fileSize < 1024 * 1024
          ? `${(fileSize / 1024).toFixed(0)} KB`
          : `${(fileSize / 1024 / 1024).toFixed(1)} MB`
      : undefined;

  return (
    <div className="beleg-row">
      <button
        type="button"
        className="beleg-row__remove"
        onClick={onRemove}
        aria-label={labels.remove}
        title={labels.remove}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>

      <div className="beleg-row__grid">
        <div className="rb-input-wrapper beleg-row__typ">
          <label className="rb-input-label">{labels.typ}</label>
          <select
            value={beleg.typ}
            onChange={(e) => onChange({ typ: e.target.value as BelegTyp })}
            className="rb-input"
          >
            {BELEG_TYPEN.map((tp) => (
              <option key={tp} value={tp}>
                {typLabels[tp]}
              </option>
            ))}
          </select>
        </div>

        <Input
          className="beleg-row__amount"
          label={labels.amount}
          placeholder="z.B. 12,50"
          inputMode="decimal"
          value={beleg.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          onBlur={onAmountBlur}
          error={amountInvalid ? amountFormat : undefined}
        />
      </div>

      {/* File picker: styled label that triggers a hidden native input.
          Once a file is attached, we swap the button for a filename chip
          matching the ticket-upload chip style. */}
      {!beleg.filename ? (
        <>
          <button
            type="button"
            className="beleg-row__pick"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{labels.file}</span>
          </button>
          <p className="beleg-row__hint">PDF, JPG oder PNG · max. 5 MB</p>
        </>
      ) : (
        <div className="beleg-row__file">
          <svg className="beleg-row__file-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <div className="beleg-row__file-body">
            <span className="beleg-row__file-name">{beleg.filename}</span>
            {fileSizeLabel && <span className="beleg-row__file-meta">{fileSizeLabel}</span>}
          </div>
          {beleg.status === 'uploading' && (
            <span className="beleg-row__pill beleg-row__pill--info">Wird hochgeladen …</span>
          )}
          {beleg.status === 'uploaded' && (
            <span className="beleg-row__pill beleg-row__pill--success">✓ Hochgeladen</span>
          )}
          {beleg.status === 'draft' && (
            <button
              type="button"
              className="beleg-row__file-clear"
              onClick={clearFile}
              aria-label="Datei entfernen"
              title="Datei entfernen"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {beleg.error && <div className="error-message">{beleg.error}</div>}

      <input
        ref={fileInputRef}
        type="file"
        accept={BELEG_ACCEPT}
        onChange={onFilePick}
        hidden
      />
    </div>
  );
};
