import React, { forwardRef } from 'react';
import './Input.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /**
   * When true, render the invalid state (red border, aria-invalid) but
   * suppress the icon + text row below the input. Use when the form
   * shows a single summary message elsewhere (e.g. wizard steps that
   * put a "please fill in the missing fields" note near the button).
   */
  invalid?: boolean;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, invalid, helperText, className = '', id, ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = !!error;
    const looksInvalid = hasError || invalid === true;

    return (
      <div className={`rb-input-wrapper ${className}`}>
        {label && (
          <label htmlFor={inputId} className="rb-input-label">
            {label}
            {props.required && (
              <span className="rb-input-required" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={`rb-input ${looksInvalid ? 'rb-input--error' : ''}`}
          aria-invalid={looksInvalid}
          aria-describedby={
            error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined
          }
          {...props}
        />
        {error && (
          <div id={`${inputId}-error`} className="rb-input-error">
            <span className="rb-input-error-icon" aria-hidden="true" />
            {error}
          </div>
        )}
        {helperText && !error && (
          <div id={`${inputId}-helper`} className="rb-input-helper">
            {helperText}
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
