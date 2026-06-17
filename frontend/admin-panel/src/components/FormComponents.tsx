import { JSX, splitProps } from 'solid-js';
import './FormComponents.css';

interface InputFieldProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export function InputField(props: InputFieldProps) {
  const [local, inputProps] = splitProps(props, ['label', 'error', 'helperText', 'class']);

  return (
    <div class={`input-field ${local.class || ''}`}>
      {local.label && (
        <label class="input-label">
          {local.label}
          {inputProps.required && <span class="required">*</span>}
        </label>
      )}
      <input
        {...inputProps}
        class={`input ${local.error ? 'input-error' : ''}`}
        aria-invalid={!!local.error}
        aria-describedby={local.error ? `${inputProps.id}-error` : undefined}
      />
      {local.error && (
        <div class="input-error-message" id={`${inputProps.id}-error`} role="alert">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8C1.5 11.59 4.41 14.5 8 14.5C11.59 14.5 14.5 11.59 14.5 8C14.5 4.41 11.59 1.5 8 1.5ZM8.75 11H7.25V9.5H8.75V11ZM8.75 8H7.25V5H8.75V8Z" fill="currentColor"/>
          </svg>
          {local.error}
        </div>
      )}
      {local.helperText && !local.error && (
        <div class="input-helper-text">{local.helperText}</div>
      )}
    </div>
  );
}

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  fullWidth?: boolean;
}

export function Button(props: ButtonProps) {
  const [local, buttonProps] = splitProps(props, ['variant', 'fullWidth', 'class', 'children']);

  return (
    <button
      {...buttonProps}
      class={`btn btn-${local.variant || 'primary'} ${local.fullWidth ? 'btn-full-width' : ''} ${local.class || ''}`}
    >
      {local.children}
    </button>
  );
}

interface CheckboxProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Checkbox(props: CheckboxProps) {
  const [local, inputProps] = splitProps(props, ['label', 'class']);

  return (
    <label class={`checkbox-label ${local.class || ''}`}>
      <input
        {...inputProps}
        type="checkbox"
        class="checkbox-input"
      />
      <span class="checkbox-custom"></span>
      <span class="checkbox-text">{local.label}</span>
    </label>
  );
}

interface CardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  children: JSX.Element;
}

export function Card(props: CardProps) {
  const [local, divProps] = splitProps(props, ['class', 'children']);

  return (
    <div {...divProps} class={`card ${local.class || ''}`}>
      {local.children}
    </div>
  );
}

interface ProgressStepProps {
  current: number;
  total: number;
  labels?: string[];
}

export function ProgressSteps(props: ProgressStepProps) {
  return (
    <div class="progress-steps">
      {Array.from({ length: props.total }).map((_, index) => (
        <div
          class={`progress-step ${index < props.current ? 'completed' : ''} ${index === props.current ? 'active' : ''}`}
        >
          <div class="progress-step-circle">
            {index < props.current ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.5 10.5L3.5 7.5L2.5 8.5L6.5 12.5L13.5 5.5L12.5 4.5L6.5 10.5Z" fill="currentColor"/>
              </svg>
            ) : (
              <span>{index + 1}</span>
            )}
          </div>
          {props.labels?.[index] && (
            <div class="progress-step-label">{props.labels[index]}</div>
          )}
        </div>
      ))}
    </div>
  );
}

interface StatusBadgeProps {
  status: 'pending' | 'approved' | 'rejected';
  children: JSX.Element;
}

export function StatusBadge(props: StatusBadgeProps) {
  return (
    <div class={`status-badge status-badge-${props.status}`}>
      {props.status === 'pending' && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M8 4V8L10.5 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      )}
      {props.status === 'approved' && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.5 10.5L3.5 7.5L2.5 8.5L6.5 12.5L13.5 5.5L12.5 4.5L6.5 10.5Z" fill="currentColor"/>
        </svg>
      )}
      {props.status === 'rejected' && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      )}
      {props.children}
    </div>
  );
}
