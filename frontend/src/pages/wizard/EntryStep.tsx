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
  const { update, reset } = useWizard();

  const choose = (mode: 'upload' | 'lookup' | 'manual', nextPath: string) => {
    reset();
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
            <span className="entry-choice__icon" aria-hidden="true">↑</span>
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
            <span className="entry-choice__icon" aria-hidden="true">🔎</span>
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
            <span className="entry-choice__icon" aria-hidden="true">✎</span>
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
