import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./Checkbox.module.css";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Sichtbares Label rechts neben der Box. */
  label: ReactNode;
  invalid?: boolean;
}

/**
 * Checkbox mit gerendertem Label. Das native Input bleibt funktional —
 * Form-Reset, Tastatur (Space) und Screenreader-Status („checked") sind
 * unverändert. Visuell ersetzt eine ::before-artige Box den Default.
 *
 * Touch-Target wird durch das umschließende Label garantiert (≥ 44 px,
 * §10.2). Fehlerzustand zusätzlich als `aria-invalid`.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    { label, invalid = false, disabled, className, ...rest },
    ref,
  ) {
    const rootClasses = [
      styles.root,
      invalid ? styles.error : "",
      disabled ? styles.disabled : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <label className={rootClasses}>
        <input
          ref={ref}
          type="checkbox"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={styles.input}
          {...rest}
        />
        <span className={styles.box} aria-hidden="true">
          <svg
            className={styles.check}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="5 12 10 17 19 7" />
          </svg>
        </span>
        <span>{label}</span>
      </label>
    );
  },
);
