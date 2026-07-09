import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';
import './UploadStep.css';

const ACCEPTED = 'application/pdf,image/jpeg,image/png';
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Fake extractor output — the values a real backend extractor would return
 * after reading the ticket barcode / OCR'ing the PDF. Populates every wizard
 * slice so the user can jump straight to the review screen and submit.
 *
 * Kept co-located with the upload step because that's the only place we fake
 * an extraction. When the real POST /upload → poll → GET /tickets/{id} flow
 * comes online, replace this constant with the projected TicketResponse.
 */
const FAKE_EXTRACTED = {
  fahrt: {
    abreisebahnhof: 'Mannheim Hbf',
    zielbahnhof: 'Karlsruhe Hbf',
    abreisedatum: '2026-06-12',
    abfahrtszeit_plan: '08:14',
    ankunftszeit_plan: '08:45',
    zugnummer_plan: 'IC 2345',
    fahrkartennummer: '7313005',
    fahrkartenpreis: '29.90',
  },
  problem: {
    antragsgrund: ['REISEUNTERBRECHUNG' as const],
    reiseunterbrechung_bahnhof: 'Karlsruhe Hbf',
  },
  person: {
    vorname: 'Maria',
    nachname: 'Müller',
    email: 'maria.mueller@example.de',
    telefon: '+49 151 23456789',
  },
  auszahlung: {
    kontoinhaber: 'Maria Müller',
    iban: 'DE89 3704 0044 0532 0130 00',
    bic: 'COBADEFFXXX',
  },
  antragstellung_ort: 'Mannheim',
};

export const UploadStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state, update } = useWizard();
  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  const onPickFile = () => fileRef.current?.click();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    // Static-only: we don't upload anything. Record the file's identity so the
    // review screen can show it, prefill every wizard slice with fake extractor
    // output, then skip straight to the review step. The brief spinner keeps
    // the UX honest — a real POST /upload → poll cycle takes real time, and an
    // instant teleport would feel jarring.
    update({
      ticketFile: { name: f.name, sizeBytes: f.size, mimeType: f.type },
      fahrt: FAKE_EXTRACTED.fahrt,
      problem: FAKE_EXTRACTED.problem,
      person: FAKE_EXTRACTED.person,
      auszahlung: FAKE_EXTRACTED.auszahlung,
      antragstellung_ort: FAKE_EXTRACTED.antragstellung_ort,
    });

    setProcessing(true);
    window.setTimeout(() => {
      setProcessing(false);
      navigate('/antrag/neu/pruefen');
    }, 700);
  };

  const clearFile = () => update({ ticketFile: null });

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
            <span className="upload-drop__label">{t.wizard.upload.processing}</span>
            <span className="upload-drop__meta">{t.wizard.upload.processingHint}</span>
          </>
        ) : (
          <>
            <span className="upload-drop__icon" aria-hidden="true">↑</span>
            <span className="upload-drop__label">{t.wizard.upload.pick}</span>
            <span className="upload-drop__meta">{t.wizard.upload.formats}</span>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          onChange={onFile}
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
            ×
          </button>
        </div>
      )}

      <p className="wizard-helper">
        {t.wizard.upload.maxSize.replace('{mb}', String(MAX_BYTES / 1024 / 1024))}
      </p>

      <WizardStepButtons
        onBack={() => navigate('/antrag/neu')}
        onNext={() => navigate('/antrag/neu/pruefen')}
        nextDisabled={!state.ticketFile || processing}
      />
    </WizardLayout>
  );
};
