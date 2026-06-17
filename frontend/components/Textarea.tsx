import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import styles from "./Textarea.module.css";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/**
 * Mehrzeilige Texteingabe. Visuell wie Input (§9.2), zusätzlich vertikal
 * resizable. Default-Höhe ≥ 96 px, damit drei Zeilen Body-Text passen.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid = false, rows = 4, className, ...rest }, ref) {
    const classes = [
      invalid ? styles.error : styles.textarea,
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid || undefined}
        className={classes}
        {...rest}
      />
    );
  },
);
