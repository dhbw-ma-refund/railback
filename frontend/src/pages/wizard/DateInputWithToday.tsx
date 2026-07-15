import { Input } from '@shared/components';
import type { ComponentProps } from 'react';
import { useLanguage } from '../../lib/LanguageContext';
import './DateInputWithToday.css';

type InputProps = ComponentProps<typeof Input>;

interface Props extends Omit<InputProps, 'type' | 'value' | 'onChange'> {
  value: string;
  onChange: (isoDate: string) => void;
}

/**
 * `<input type="date">` with a "Heute" quick-fill chip next to the label.
 *
 * A "today" affordance is a common enough ask (users filing a delay
 * claim on the same day they took the trip) that repeating the pattern
 * inline at every call site would be noisy. Centralised here so date
 * inputs across the wizard get it consistently.
 *
 * The chip is intentionally the label-adjacent slot (not below the
 * input) so it doesn't push the form's vertical rhythm around, and so
 * users see it before they even open the native date picker.
 *
 * Emits the ISO date string (`YYYY-MM-DD`) on chip tap — the same
 * shape the native date picker produces, so downstream code doesn't
 * need to distinguish.
 */
export const DateInputWithToday = ({ value, onChange, label, ...rest }: Props) => {
  const { t } = useLanguage();

  const setToday = () => {
    // Use LOCAL today, not UTC — a user in Berlin filing a claim at
    // 00:30 CET on Jan 5 wants "05.01.", not "04.01." (which is what
    // toISOString() returns because it always converts to UTC).
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    onChange(`${yyyy}-${mm}-${dd}`);
  };

  return (
    <div className="date-with-today">
      {label && (
        <div className="date-with-today__labelrow">
          <span className="rb-input-label">{label}</span>
          <button
            type="button"
            className="date-with-today__chip"
            onClick={setToday}
          >
            {t.wizard.common.today}
          </button>
        </div>
      )}
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </div>
  );
};
