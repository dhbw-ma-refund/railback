import { ReactNode } from 'react';
import { Header } from '../../components/Header';
import { WizardFooterNav } from './WizardFooterNav';
import './WizardLayout.css';

interface Props {
  /** Slug of the currently active step. Passed to the footer nav for the active pip. */
  activeSlug?: string;
  /** Optional page title — rendered as h1 at the top of the content area. */
  title?: string;
  children: ReactNode;
}

/**
 * Shared shell for all wizard steps: header, title, content slot, and the numbered
 * step tabs pinned at the bottom (from the wireframe).
 */
export const WizardLayout = ({ activeSlug, title, children }: Props) => {
  return (
    <div className="wizard-page">
      <Header />
      <main className="wizard-container">
        {title && <h1 className="wizard-title">{title}</h1>}
        <div className="wizard-content">{children}</div>
      </main>
      {activeSlug && <WizardFooterNav activeSlug={activeSlug} />}
    </div>
  );
};
