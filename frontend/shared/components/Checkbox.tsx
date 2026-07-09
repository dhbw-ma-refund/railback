import React, { forwardRef } from 'react';
import './Checkbox.css';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Text rendered next to the box. Rich content is fine too — use children. */
  label?: React.ReactNode;
  error?: string;
}

/**
 * Brand-compliant checkbox. Native <input type="checkbox"> is hidden but keeps
 * every accessibility affordance (focus, tab, keyboard toggle, form submit).
 * The visible box is a styled <span>; the whole label is one 44-px touch target
 * per RailBack Brand Guide §10.2.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, error, className = '', id, children, ...props }, ref) => {
    const inputId = id || `chk-${Math.random().toString(36).slice(2, 11)}`;
    const hasError = !!error;

    return (
      <div className={`rb-checkbox-wrapper ${className}`}>
        <label htmlFor={inputId} className={`rb-checkbox ${hasError ? 'rb-checkbox--error' : ''}`}>
          <input
            id={inputId}
            ref={ref}
            type="checkbox"
            className="rb-checkbox__input"
            aria-invalid={hasError}
            aria-describedby={error ? `${inputId}-error` : undefined}
            {...props}
          />
          <span className="rb-checkbox__box" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 8 7 12 13 4" />
            </svg>
          </span>
          <span className="rb-checkbox__label">{label ?? children}</span>
        </label>
        {error && (
          <div id={`${inputId}-error`} className="rb-checkbox__error">
            <span className="rb-checkbox__error-icon" aria-hidden="true">⚠</span>
            {error}
          </div>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';
