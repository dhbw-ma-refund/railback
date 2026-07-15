import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Footer } from '../../components/Footer';
import { useLanguage } from '../../lib/LanguageContext';
import { useWizard } from './WizardContext';
import './EntryStep.css';

/**
 * Landing screen at /antrag/neu — asks the user how they want to enter their trip.
 * Three cards mirror the three backend entry paths:
 *  - upload  → POST /upload  (extractor prefills fahrt.*)
 *  - lookup  → POST /route-lookup → POST /from-route
 *  - manual  → POST /from-route  (no lookup)
 * All three converge on the shared step-2 (Reisedaten) onward.
 */
export const EntryStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { update, resetTicket } = useWizard();

  const choose = (mode: 'upload' | 'lookup' | 'manual', nextPath: string) => {
    // Wipe only ticket-scoped state — keep prefilled person/auszahlung so a
    // repeat entry doesn't lose hydrated profile data or force a re-fetch.
    resetTicket();
    update({ mode });
    navigate(nextPath);
  };

  return (
    <div className="entry-step-page">
      <Header />
      <main className="entry-step-container">
        <h1 className="entry-step-title">{t.wizard.entry.title}</h1>
        <p className="entry-step-sub">{t.wizard.entry.sub}</p>

        <div className="entry-choices">
          <button
            type="button"
            className="entry-choice"
            onClick={() => choose('upload', '/antrag/neu/upload')}
          >
            <span className="entry-choice__icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </span>
            <div className="entry-choice__text">
              <h2 className="entry-choice__title">{t.wizard.entry.uploadTitle}</h2>
              <p className="entry-choice__body">{t.wizard.entry.uploadBody}</p>
            </div>
          </button>

          <button
            type="button"
            className="entry-choice"
            onClick={() => choose('lookup', '/antrag/neu/suche')}
          >
            <span className="entry-choice__icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </svg>
            </span>
            <div className="entry-choice__text">
              <h2 className="entry-choice__title">{t.wizard.entry.lookupTitle}</h2>
              <p className="entry-choice__body">{t.wizard.entry.lookupBody}</p>
            </div>
          </button>

          <button
            type="button"
            className="entry-choice"
            onClick={() => choose('manual', '/antrag/neu/reise')}
          >
            <span className="entry-choice__icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </span>
            <div className="entry-choice__text">
              <h2 className="entry-choice__title">{t.wizard.entry.manualTitle}</h2>
              <p className="entry-choice__body">{t.wizard.entry.manualBody}</p>
            </div>
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
};
