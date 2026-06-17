import { useId } from "react";
import type { ReactNode } from "react";
import styles from "./FieldSet.module.css";

export interface FieldSetProps {
  /** Sichtbares Gruppen-Label (rendered als `<legend>`). */
  legend: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Inhalt — z. B. eine `<RadioGroup>` oder mehrere `<Checkbox>`. */
  children: ReactNode;
  className?: string;
}

/**
 * Semantischer `<fieldset>` mit `<legend>` für Gruppen-Controls
 * (Radios, Multi-Checkbox-Listen). Setzt nur Layout & Hint/Error,
 * propagiert keine Props in die Kinder — die Gruppierung erledigt
 * der Browser über das fieldset-Element selbst (§10.3).
 */
export function FieldSet({
  legend,
  hint,
  error,
  required = false,
  children,
  className,
}: FieldSetProps) {
  const id = useId();
  const hintId = hint ? `rb-fs-${id}-hint` : undefined;
  const errorId = error ? `rb-fs-${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const rootClasses = [styles.root, className ?? ""].filter(Boolean).join(" ");

  return (
    <fieldset className={rootClasses} aria-describedby={describedBy}>
      <legend className={styles.legend}>
        {legend}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>

      {children}

      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}

      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}
