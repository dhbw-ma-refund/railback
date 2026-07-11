import React, { forwardRef } from 'react';
import './Input.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', id, ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = !!error;

    return (
      <div className={`rb-input-wrapper ${className}`}>
        {label && (
          <label htmlFor={inputId} className="rb-input-label">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={`rb-input ${hasError ? 'rb-input--error' : ''}`}
          aria-invalid={hasError}
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
