import { useNavigate } from 'react-router-dom';
import { WIZARD_STEPS } from './WizardContext';
import './WizardFooterNav.css';

interface Props {
  activeSlug: string;
}

/**
 * Fixed bottom bar showing the six numbered wizard steps. Matches the sketch:
 * every screen has the same tab row, current step highlighted, tapping a step
 * jumps to it. Steps stay clickable so a user can bail out of a mid-flow
 * detour and come back later; wizard state persists across the jump.
 */
export const WizardFooterNav = ({ activeSlug }: Props) => {
  const navigate = useNavigate();

  return (
    <nav className="wizard-footer" aria-label="Antragsschritte">
      {WIZARD_STEPS.map((step) => {
        const active = step.slug === activeSlug;
        return (
          <button
            key={step.slug}
            type="button"
            className={'wizard-footer__step' + (active ? ' wizard-footer__step--active' : '')}
            onClick={() => navigate(step.path)}
            aria-current={active ? 'step' : undefined}
          >
            <span className="wizard-footer__num">{step.index}.</span>
            <span className="wizard-footer__label">{step.shortDe}</span>
          </button>
        );
      })}
    </nav>
  );
};
