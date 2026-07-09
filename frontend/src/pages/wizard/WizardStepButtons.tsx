import { Button } from '@shared/components';
import { useLanguage } from '../../lib/LanguageContext';
import './WizardStepButtons.css';

interface Props {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  hideBack?: boolean;
}

/**
 * Standard Zurück / Weiter pair shown at the bottom of every wizard content area
 * (immediately above the fixed footer nav). Kept as a component so button sizing
 * stays consistent across steps.
 */
export const WizardStepButtons = ({ onBack, onNext, nextLabel, nextDisabled, hideBack }: Props) => {
  const { t } = useLanguage();
  return (
    <div className="wizard-step-buttons">
      {!hideBack && (
        <Button variant="secondary" onClick={onBack} disabled={!onBack}>
          {t.wizard.back}
        </Button>
      )}
      <Button variant="primary" onClick={onNext} disabled={nextDisabled}>
        {nextLabel ?? t.wizard.next}
      </Button>
    </div>
  );
};
