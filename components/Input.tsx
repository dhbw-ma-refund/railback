import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import styles from "./Input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visuell + semantisch als Fehlerzustand markieren (§9.2). */
  invalid?: boolean;
}

/**
 * Single-line Input gemäß §9.2.
 *
 * Der Fehler-Zustand wird zusätzlich zum visuellen `invalid` über
 * `aria-invalid` an Screenreader weitergegeben. Label, Hint und
 * Error-Text gehören in einen umgebenden `<FormField>`.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, type = "text", className, ...rest },
  ref,
) {
  const classes = [
    invalid ? styles.error : styles.input,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={classes}
      {...rest}
    />
  );
});
