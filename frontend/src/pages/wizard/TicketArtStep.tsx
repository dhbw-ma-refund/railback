import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Footer } from '../../components/Footer';
import { useLanguage } from '../../lib/LanguageContext';
import { useWizard } from './WizardContext';
import './EntryStep.css';

/**
 * Step 0 — Which kind of ticket are we claiming for?
 *
 * Two cards:
 *  - Einzelfahrkarte (single-trip) → falls through to the classic
 *    EntryStep at /antrag/neu/entry where the user picks upload / lookup
 *    / manual.
 *  - Zeitkarte / Deutschland-Ticket → straight to /antrag/neu/upload.
 *    The UploadStep detects `is_zeitkarte` and skips the barcode
 *    extractor (which is trained on UIC 918.3 single-trip tickets).
 *    Downstream, FahrtStep hides the `fahrkartennummer` input and
 *    buildRefundBody injects the sentinel "DEUTSCHLANDTICKET" so the
 *    backend's `min(1)` constraint on RefundFahrt.fahrkartennummer is
 *    still satisfied. Backend already accepts `is_zeitkarte: true` on
 *    both /refund and /from-route.
 *
 * We set `is_zeitkarte` on the wizard state HERE — before any upload —
 * so every downstream branch (Upload, Fahrt, Review) can key off it
 * without re-derivation. resetTicket() runs first so a repeat entry
 * doesn't inherit a stale ticket file / extracted fahrt fields from a
 * previous single-trip attempt.
 */
export const TicketArtStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { update, resetTicket } = useWizard();

  const pickEinzel = () => {
    resetTicket();
    update({ is_zeitkarte: false });
    navigate('/antrag/neu/entry');
  };

  const pickZeitkarte = () => {
    resetTicket();
    update({ is_zeitkarte: true, mode: 'upload' });
    navigate('/antrag/neu/upload');
  };

  return (
    <div className="entry-step-page">
      <Header />
      <main className="entry-step-container">
        <h1 className="entry-step-title">{t.wizard.ticketArt.title}</h1>
        <p className="entry-step-sub">{t.wizard.ticketArt.sub}</p>

        <div className="entry-choices">
          <button type="button" className="entry-choice" onClick={pickEinzel}>
            <span className="entry-choice__icon" aria-hidden="true">
              {/* single ticket */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" />
                <line x1="10" y1="8" x2="10" y2="16" strokeDasharray="1 3" />
              </svg>
            </span>
            <div className="entry-choice__text">
              <h2 className="entry-choice__title">{t.wizard.ticketArt.einzelTitle}</h2>
              <p className="entry-choice__body">{t.wizard.ticketArt.einzelBody}</p>
            </div>
          </button>

          <button type="button" className="entry-choice" onClick={pickZeitkarte}>
            <span className="entry-choice__icon" aria-hidden="true">
              {/* recurring / subscription */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
              </svg>
            </span>
            <div className="entry-choice__text">
              <h2 className="entry-choice__title">{t.wizard.ticketArt.zeitkarteTitle}</h2>
              <p className="entry-choice__body">{t.wizard.ticketArt.zeitkarteBody}</p>
            </div>
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
};
