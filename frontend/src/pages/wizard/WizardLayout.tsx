import { ReactNode } from 'react';
import { Header } from '../../components/Header';
import { WizardProgress } from './WizardProgress';
import './WizardLayout.css';

interface Props {
  /** Slug of the currently active step. Passed to the progress indicator. */
  activeSlug?: string;
  /** Optional page title — rendered as h1 at the top of the content area. */
  title?: string;
  children: ReactNode;
}

/**
 * Shared shell for all wizard steps: header, title, inline step-progress
 * indicator, and the step's content. The old fixed-bottom nav bar has
 * been replaced by an inline WizardProgress that lives in the page flow
 * — so it can't cover form content on small viewports.
 */
export const WizardLayout = ({ activeSlug, title, children }: Props) => {
  return (
    <div className="wizard-page">
      <Header />
      <main className="wizard-container">
        {title && <h1 className="wizard-title">{title}</h1>}
        {activeSlug && <WizardProgress activeSlug={activeSlug} />}
        <div className="wizard-content">{children}</div>
      </main>
    </div>
  );
};
