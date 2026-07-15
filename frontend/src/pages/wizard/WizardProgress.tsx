import { useNavigate } from 'react-router-dom';
import { WIZARD_STEPS } from './WizardContext';
import './WizardProgress.css';

interface Props {
  activeSlug: string;
}

/**
 * Inline step progress indicator. Sits below the wizard title as part of
 * the page flow — no fixed positioning, so it can't cover form content.
 *
 * Design: a horizontal row of numbered dots connected by a track line.
 * Active dot gets a soft ring; completed dots share the same filled style
 * so users see how far they've come. Below the dots, a two-piece label
 * ("Schritt 3 von 6" over the full step name) gives full context of
 * where the user is. Tapping any dot jumps to that step; wizard state
 * persists across the jump.
 */
export const WizardProgress = ({ activeSlug }: Props) => {
  const navigate = useNavigate();
  const activeIndex = WIZARD_STEPS.findIndex((s) => s.slug === activeSlug);
  const activeStep = activeIndex >= 0 ? WIZARD_STEPS[activeIndex] : null;

  return (
    <nav className="wizard-progress" aria-label="Antragsschritte">
      <ol className="wizard-progress__track">
        {WIZARD_STEPS.map((step, i) => {
          const isActive = step.slug === activeSlug;
          const isDone = i < activeIndex;
          const state = isActive ? 'active' : isDone ? 'done' : 'todo';
          return (
            <li
              key={step.slug}
              className={`wizard-progress__step wizard-progress__step--${state}`}
            >
              <button
                type="button"
                className="wizard-progress__dot"
                onClick={() => navigate(step.path)}
                aria-current={isActive ? 'step' : undefined}
                aria-label={`${step.index}. ${step.labelDe}`}
              >
                {step.index}
              </button>
            </li>
          );
        })}
      </ol>
      {activeStep && (
        <p className="wizard-progress__label">
          Schritt {activeStep.index} von {WIZARD_STEPS.length}
        </p>
      )}
    </nav>
  );
};
