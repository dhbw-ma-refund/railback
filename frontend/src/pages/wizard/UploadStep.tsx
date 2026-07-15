import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';
import { api } from '../../lib/api';
import type { SupportedMimeType, TicketResponse } from '../../lib/api';
import { ApiError } from '@shared/api/errors';
import { ulid } from '../../lib/ulid';
import { uploadToS3 } from '../../lib/uploadToS3';
import type { FahrtFields } from './WizardContext';
import './UploadStep.css';

const ACCEPTED = 'application/pdf,image/jpeg,image/png';
const MAX_BYTES = 10 * 1024 * 1024;

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

type Phase = 'idle' | 'presigning' | 'uploading' | 'confirming' | 'extracting' | 'done' | 'error';

/**
 * Outcome after extraction settles. `filled` means the extractor gave us
 * at least one Fahrt field; `empty` means it ran but couldn't read the
 * ticket (barcode too blurry, non-Bahn PDF, etc.). Both are non-fatal —
 * the user just needs to know whether they'll be verifying prefilled
 * values or typing everything in.
 */
type ExtractionOutcome = 'filled' | 'empty' | 'failed' | 'timedOut';

/**
 * Real upload flow:
 *   1. Mint a client-side ULID `ticketId` (backend rejects non-ULID).
 *   2. POST /users/me/tickets/{id}/upload — receive presigned S3 envelope.
 *      Ticket row is now in VALIDATING, extraction_status = PROCESSING.
 *   3. multipart POST to S3.
 *   4. POST /upload-confirm — writes RAW# row and (if the extractor is
 *      configured in this deploy) inline-invokes the extractor Lambda.
 *   5. Poll GET /tickets/{id} at 1.5s intervals for up to 60s until
 *      ticket_state = READY (success) or extraction_status = FAILED
 *      (fallback to manual entry).
 *
 * Once the ticket settles, the user sees one of three outcomes:
 *   - filled  → "Wir haben deine Daten übernommen — jetzt prüfen"
 *   - empty   → "Wir konnten nichts auslesen — bitte manuell eintragen"
 *   - failed  → "Auslesen ist fehlgeschlagen — bitte manuell eintragen"
 * All three offer a Next button that navigates to /antrag/neu/reise.
 * We deliberately do NOT auto-navigate — the previous behaviour dropped
 * users into a blank form with no idea why.
 */
function isSupportedMime(mime: string): mime is SupportedMimeType {
  return mime === 'application/pdf' || mime === 'image/jpeg' || mime === 'image/png';
}

/**
 * Extract Fahrt fields that the backend actually populated. Missing fields
 * are omitted from the returned partial — never overwrite existing wizard
 * state with empty strings.
 */
/**
 * Extract Fahrt fields that the backend actually populated. Missing fields
 * are omitted from the returned partial — never overwrite existing wizard
 * state with empty strings.
 *
 * `00:00` is treated as a placeholder for "unknown" rather than as a real
 * midnight departure/arrival. The extractor emits `00:00` when it can't
 * find the field in the UIC 918.3 payload; keeping that would fill the
 * Reise form with a wrong-but-plausible value and gate the user's ability
 * to correct it. If a user actually rode a midnight train they can still
 * type `00:00` by hand — the barcode just doesn't give us this info
 * reliably enough to trust it verbatim.
 */
function isPlaceholderTime(hhmm: string | undefined): boolean {
  return hhmm === '00:00';
}

function partialFahrtFromTicket(t: TicketResponse): Partial<FahrtFields> {
  const patch: Partial<FahrtFields> = {};
  if (t.fahrt_abreisebahnhof) patch.abreisebahnhof = t.fahrt_abreisebahnhof;
  if (t.fahrt_zielbahnhof) patch.zielbahnhof = t.fahrt_zielbahnhof;
  if (t.fahrt_abreisedatum) patch.abreisedatum = t.fahrt_abreisedatum;
  if (t.fahrt_abfahrtszeit_plan && !isPlaceholderTime(t.fahrt_abfahrtszeit_plan))
    patch.abfahrtszeit_plan = t.fahrt_abfahrtszeit_plan;
  if (t.fahrt_ankunftszeit_plan && !isPlaceholderTime(t.fahrt_ankunftszeit_plan))
    patch.ankunftszeit_plan = t.fahrt_ankunftszeit_plan;
  if (t.fahrt_zugnummer_plan) patch.zugnummer_plan = t.fahrt_zugnummer_plan;
  if (t.fahrt_zugkategorie_plan) patch.zugkategorie_plan = t.fahrt_zugkategorie_plan;
  if (t.fahrt_fahrkartennummer) patch.fahrkartennummer = t.fahrt_fahrkartennummer;
  if (t.fahrt_fahrkartenpreis) patch.fahrkartenpreis = t.fahrt_fahrkartenpreis;
  return patch;
}

async function pollUntilReady(
  ticketId: string,
  signal?: AbortSignal,
): Promise<TicketResponse | { timedOut: true }> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const t = await api.getTicket(ticketId);
    if (t.ticket_state === 'READY' || t.extraction_status === 'FAILED') return t;
    if (Date.now() - start > POLL_TIMEOUT_MS) return { timedOut: true };
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export const UploadStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, update, updateFahrt } = useWizard();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>('');
  const [outcome, setOutcome] = useState<ExtractionOutcome | null>(null);

  const processing = phase !== 'idle' && phase !== 'error' && phase !== 'done';

  const onPickFile = () => fileRef.current?.click();

  const settle = (o: ExtractionOutcome) => {
    setOutcome(o);
    setPhase('done');
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';

    if (!isSupportedMime(f.type)) {
      setError(t.wizard.upload.errBadType);
      setPhase('error');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(t.wizard.upload.errTooLarge);
      setPhase('error');
      return;
    }

    setError('');
    setOutcome(null);
    const ticketId = state.ticketId ?? ulid();
    update({
      ticketId,
      ticketFile: { name: f.name, sizeBytes: f.size, mimeType: f.type },
    });

    try {
      setPhase('presigning');
      const envelope = await api.presignUpload(ticketId, {
        filename: f.name,
        mimeType: f.type,
      });

      setPhase('uploading');
      const s3Res = await uploadToS3(envelope, f);
      if (!s3Res.ok) {
        throw new Error(`S3 upload failed (HTTP ${s3Res.status})`);
      }

      setPhase('confirming');
      const confirm = await api.confirmUpload(ticketId, {
        s3_key: envelope.s3_key,
        filename: f.name,
        mimeType: f.type,
      });

      // Handle each of the three post-confirm states.
      if (confirm.extraction_status === 'FAILED') {
        settle('failed');
        return;
      }

      let ticket: TicketResponse;
      if (confirm.extraction_status === 'DONE') {
        ticket = await api.getTicket(ticketId);
      } else {
        // PROCESSING — poll.
        setPhase('extracting');
        const result = await pollUntilReady(ticketId);
        if ('timedOut' in result) {
          settle('timedOut');
          return;
        }
        ticket = result;
      }

      if (ticket.extraction_status === 'FAILED') {
        settle('failed');
        return;
      }

      const patch = partialFahrtFromTicket(ticket);
      if (Object.keys(patch).length === 0) {
        // Extractor ran but produced no usable fields — barcode unreadable,
        // non-Bahn PDF, etc. Don't clobber existing fahrt state, don't
        // silently forward the user into a blank form; tell them what
        // happened.
        settle('empty');
        return;
      }
      updateFahrt(patch);
      settle('filled');
    } catch (err) {
      setPhase('error');
      if (err instanceof ApiError) {
        setError(err.body.message || t.wizard.upload.errGeneric);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t.wizard.upload.errGeneric);
      }
    }
  };

  const clearFile = () => {
    update({ ticketFile: null, ticketId: null });
    setOutcome(null);
    setError('');
    setPhase('idle');
  };

  const phaseLabel = () => {
    switch (phase) {
      case 'presigning':
        return t.wizard.upload.presigning;
      case 'uploading':
        return t.wizard.upload.uploading;
      case 'confirming':
        return t.wizard.upload.confirming;
      case 'extracting':
        return t.wizard.upload.extracting;
      default:
        return t.wizard.upload.processing;
    }
  };

  const outcomeMessage = (): { tone: 'info' | 'warning'; text: string } | null => {
    if (!outcome) return null;
    if (outcome === 'filled') return { tone: 'info', text: t.wizard.upload.outcomeFilled };
    if (outcome === 'empty') return { tone: 'warning', text: t.wizard.upload.outcomeEmpty };
    if (outcome === 'failed') return { tone: 'warning', text: t.wizard.upload.outcomeFailed };
    return { tone: 'warning', text: t.wizard.upload.outcomeTimeout };
  };

  const om = outcomeMessage();

  return (
    <WizardLayout activeSlug="upload" title={t.wizard.upload.title}>
      <p className="wizard-helper">{t.wizard.upload.hint}</p>

      <div
        className={'upload-drop' + (processing ? ' upload-drop--processing' : '')}
        onClick={processing ? undefined : onPickFile}
        role="button"
        tabIndex={0}
        aria-busy={processing}
      >
        {processing ? (
          <>
            <span className="upload-drop__spinner" aria-hidden="true" />
            <span className="upload-drop__label">{phaseLabel()}</span>
            <span className="upload-drop__meta">{t.wizard.upload.processingHint}</span>
          </>
        ) : (
          <>
            <span className="upload-drop__icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </span>
            <span className="upload-drop__label">{t.wizard.upload.pick}</span>
            <span className="upload-drop__meta">{t.wizard.upload.formats}</span>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          onChange={(e) => void onFile(e)}
          hidden
        />
      </div>

      {state.ticketFile && !processing && (
        <div className="upload-chip">
          <span className="upload-chip__name">{state.ticketFile.name}</span>
          <button
            type="button"
            className="upload-chip__remove"
            onClick={clearFile}
            aria-label={t.wizard.upload.removeFile}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {om && (
        <div className={om.tone === 'info' ? 'wizard-helper' : 'error-message'}>{om.text}</div>
      )}

      {error && <div className="error-message">{error}</div>}

      <p className="wizard-helper">
        {t.wizard.upload.maxSize.replace('{mb}', String(MAX_BYTES / 1024 / 1024))}
      </p>

      <WizardStepButtons
        onBack={() => navigate('/antrag/neu')}
        onNext={() => navigate('/antrag/neu/reise')}
        // Only block Next during in-flight async work (S3 upload, extractor
        // poll). Otherwise the button is always live — no ticket file =
        // user chose to skip and enter manually, and that's a valid path.
        nextDisabled={processing}
        nextLabel={
          !state.ticketFile
            ? t.wizard.upload.enterManually
            : outcome === 'empty' || outcome === 'failed' || outcome === 'timedOut'
              ? t.wizard.upload.continueManually
              : undefined
        }
      />
    </WizardLayout>
  );
};
