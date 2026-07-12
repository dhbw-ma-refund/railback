import { useNavigate } from 'react-router-dom';
import { Button } from '@shared/components';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { useWizard, AntragsgrundTag } from './WizardContext';
import './ReviewStep.css';

const GRUND_LABELS_DE: Record<AntragsgrundTag, string> = {
  REISEABBRUCH: 'Reiseabbruch',
  REISEUNTERBRECHUNG: 'Reiseunterbrechung',
  VERPASSTER_ANSCHLUSS: 'Verpasster Anschluss',
  LETZTER_UMSTIEG: 'Letzter Umstieg',
};

/**
 * Step 6 — Bitte prüfen Sie Ihre Angaben. Wireframe screen 6.
 *
 * Summary cards, each with a "Bearbeiten" link that jumps to the matching
 * step. "Antrag absenden" fires the equivalent of POST /refund; in this
 * static build it just navigates to the confirmation screen.
 */
export const ReviewStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { state } = useWizard();

  const submit = () => navigate('/antrag/neu/eingereicht');

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
          <p className="review-card__line review-card__line--muted">
            {t.wizard.review.noTicket}
          </p>
        )}
      </ReviewCard>

      {/* Reise */}
      <ReviewCard
        title={t.wizard.review.trip}
        editPath="/antrag/neu/reise"
        editLabel={t.wizard.review.edit}
      >
        <p className="review-card__line">
          {state.fahrt.abreisebahnhof || '—'} → {state.fahrt.zielbahnhof || '—'}
        </p>
        <p className="review-card__line review-card__line--muted">
          {state.fahrt.abreisedatum || '—'} · {state.fahrt.zugnummer_plan || '—'}
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
          </p>
        )}
      </ReviewCard>

      {/* Person */}
      <ReviewCard
        title={t.wizard.review.person}
        editPath="/antrag/neu/person"
        editLabel={t.wizard.review.edit}
      >
        <p className="review-card__line">
          {state.person.vorname} {state.person.nachname}
          {state.person.email ? ` · ${state.person.email}` : ''}
        </p>
      </ReviewCard>

      {/* Auszahlung — mask IBAN except last 4 chars */}
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

      <Button variant="primary" onClick={submit}>
        {t.wizard.review.submit}
      </Button>
      <Button variant="secondary" onClick={() => navigate('/antrag/neu/auszahlung')}>
        {t.wizard.back}
      </Button>
    </WizardLayout>
  );
};

interface CardProps {
  title: string;
  editPath: string;
  editLabel: string;
  editable?: boolean; // false hides the edit button (e.g. no upload on manual flow)
  children: React.ReactNode;
}

const ReviewCard = ({ title, editPath, editLabel, editable = true, children }: CardProps) => {
  const navigate = useNavigate();
  return (
    <section className="review-card">
      <header className="review-card__head">
        <h2 className="review-card__title">{title}</h2>
        {editable && (
          <button
            type="button"
            className="review-card__edit"
            onClick={() => navigate(editPath)}
          >
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
