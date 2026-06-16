import {
  Children,
  cloneElement,
  isValidElement,
  useId,
} from "react";
import type { ReactElement, ReactNode } from "react";
import styles from "./FormField.module.css";

export interface FormFieldProps {
  /** Sichtbares Label, programmatisch mit dem Control verbunden (§10.3). */
  label: ReactNode;
  /** Optionaler Hilfetext unter dem Control (§5 — Caption / Microcopy). */
  hint?: ReactNode;
  /** Fehlertext. Sobald gesetzt, wird das Kind als invalid markiert (§9.2, §10.4). */
  error?: ReactNode;
  /** Markiert das Feld optisch als Pflichtfeld. */
  required?: boolean;
  /**
   * Optionaler Hinweis "(optional)" hinter dem Label — sinnvoll, wenn die
   * Mehrheit der Felder Pflicht ist und Optionale die Ausnahme.
   */
  optional?: boolean;
  /**
   * Eindeutige ID für das Form-Control. Wird automatisch erzeugt, wenn nicht
   * gesetzt. Gleichzeitig der Anker für `htmlFor` und `aria-describedby`.
   */
  htmlFor?: string;
  /** Genau ein Form-Control als Kind (Input, Textarea, Select, Checkbox …). */
  children: ReactElement<ChildControlProps>;
  className?: string;
}

interface ChildControlProps {
  id?: string;
  "aria-describedby"?: string;
  invalid?: boolean;
  required?: boolean;
}

/**
 * Wrapper um genau ein Form-Control. Sorgt für:
 *
 * - Sichtbares `<label htmlFor>` und programmatische Verknüpfung.
 * - Hint und Error via `aria-describedby` an den Screenreader.
 * - Automatische `aria-invalid`-Markierung, wenn `error` gesetzt ist.
 *
 * Bei Gruppen-Controls (RadioGroup, mehrere Checkboxen) stattdessen
 * `<FieldSet>` verwenden.
 */
export function FormField({
  label,
  hint,
  error,
  required = false,
  optional = false,
  htmlFor,
  children,
  className,
}: FormFieldProps) {
  const reactId = useId();
  const childProps = children.props;
  const controlId = htmlFor ?? childProps.id ?? `rb-field-${reactId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  // Existierendes aria-describedby mit unseren IDs zusammenführen, ohne es
  // zu überschreiben — falls der Konsument selbst eine Beschreibung anhängt.
  const describedBy =
    [childProps["aria-describedby"], hintId, errorId]
      .filter(Boolean)
      .join(" ") || undefined;

  const childWithProps = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        "aria-describedby": describedBy,
        invalid: error ? true : childProps.invalid,
        required: required || childProps.required,
      })
    : children;

  // Single-child Pflicht — defensiv prüfen, damit Konsumenten saubere
  // Fehlermeldung statt obskurem Render-Crash bekommen.
  const childCount = Children.count(children);
  if (childCount !== 1) {
    throw new Error(
      `FormField erwartet genau ein Kind-Element, bekam ${childCount}.`,
    );
  }

  const rootClasses = [styles.root, className ?? ""].filter(Boolean).join(" ");

  return (
    <div className={rootClasses}>
      <label htmlFor={controlId} className={styles.label}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
        {optional && !required ? (
          <span className={styles.optional}>(optional)</span>
        ) : null}
      </label>

      {childWithProps}

      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}

      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          <svg
            className={styles.errorIcon}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="7" x2="12" y2="13" />
            <line x1="12" y1="16.5" x2="12" y2="17" />
          </svg>
          {error}
        </span>
      ) : null}
    </div>
  );
}
