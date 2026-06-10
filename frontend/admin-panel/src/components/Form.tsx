import { JSX, Show, splitProps } from 'solid-js';
import styles from './ui.module.css';

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: JSX.Element;
}
export function Field(props: FieldProps) {
  return (
    <label class={styles.field}>
      <span class={styles.field_label}>
        {props.label}
        <Show when={props.required}>
          <span class={styles.field_required} aria-hidden="true"> *</span>
        </Show>
      </span>
      {props.children}
      <Show when={props.error}>
        <span class={styles.field_error}>{props.error}</span>
      </Show>
      <Show when={!props.error && props.hint}>
        <span class={styles.field_hint}>{props.hint}</span>
      </Show>
    </label>
  );
}

interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}
export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, ['invalid', 'class']);
  return (
    <input
      {...rest}
      class={`${styles.input} ${local.invalid ? styles.input_invalid : ''} ${local.class ?? ''}`}
    />
  );
}

interface SelectProps extends JSX.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}
export function Select(props: SelectProps) {
  const [local, rest] = splitProps(props, ['invalid', 'class', 'children']);
  return (
    <div class={styles.select_wrap}>
      <select
        {...rest}
        class={`${styles.select} ${local.invalid ? styles.input_invalid : ''} ${local.class ?? ''}`}
      >
        {local.children}
      </select>
      <svg class={styles.select_caret} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 4.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
  );
}
