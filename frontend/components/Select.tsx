import { forwardRef } from "react";
import type { SelectHTMLAttributes, ReactNode } from "react";
import styles from "./Select.module.css";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  children: ReactNode;
}

/**
 * Native `<select>` mit RailBack-Styling. Bewusst nativ statt Custom-Listbox,
 * damit Mobile-Picker, Tastaturnavigation und Screenreader out-of-the-box
 * funktionieren (§10.3).
 *
 * Der Caret-Indikator ist eine reine Dekoration (`aria-hidden`), Optionen
 * werden vom System-Picker dargestellt.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    { invalid = false, className, children, ...rest },
    ref,
  ) {
    const selectClass = [
      invalid ? styles.error : styles.select,
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <span className={styles.wrapper}>
        <select
          ref={ref}
          aria-invalid={invalid || undefined}
          className={selectClass}
          {...rest}
        >
          {children}
        </select>
        <span className={styles.caret} aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </span>
    );
  },
);
