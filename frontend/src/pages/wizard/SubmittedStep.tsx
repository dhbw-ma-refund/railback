import { useNavigate } from 'react-router-dom';
import { Button } from '@shared/components';
import { Header } from '../../components/Header';
import { Footer } from '../../components/Footer';
import { useLanguage } from '../../lib/LanguageContext';
import { useWizard } from './WizardContext';
import './SubmittedStep.css';

/**
 * Post-submit confirmation screen. Real flow: POST /refund has returned 202
 * with ticket_state=EMAIL_SENDING; frontend polls GET /tickets/{id} for
 * email_status. Here we just show the success state and let the user go
 * back to the dashboard.
 */
export const SubmittedStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { reset } = useWizard();

  const done = () => {
    reset();
    navigate('/dashboard');
  };

  return (
    <div className="submitted-page">
      <Header />
      <main className="submitted-container">
        <div className="submitted-check" aria-hidden="true">✓</div>
        <h1 className="submitted-title">{t.wizard.submitted.title}</h1>
        <p className="submitted-body">{t.wizard.submitted.body}</p>
        <Button variant="primary" onClick={done}>
          {t.wizard.submitted.cta}
        </Button>
      </main>
      <Footer />
    </div>
  );
};
