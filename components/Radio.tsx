import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
} from "react";
import type {
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";
import styles from "./Radio.module.css";

export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  invalid?: boolean;
}

/**
 * Einzel-Radio. Für mehrere Optionen mit gemeinsamem Namen `RadioGroup`
 * verwenden — das setzt `name` und semantisch korrekte Gruppierung.
 */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
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
        type="radio"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={styles.input}
        {...rest}
      />
      <span className={styles.dot} aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
});

export interface RadioGroupProps {
  /** Gemeinsamer `name` für alle Radios in der Gruppe (Pflicht). */
  name: string;
  children: ReactNode;
  /** Optionen horizontal statt vertikal stapeln. */
  horizontal?: boolean;
  /** Für Screenreader, falls kein umgebendes FieldSet existiert. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
}

/**
 * Container für mehrere `<Radio>`-Optionen. Setzt `role="radiogroup"` und
 * propagiert `name` an die Kinder, damit Konsumenten den Gruppennamen nicht
 * an jedem Radio wiederholen müssen.
 *
 * Wenn die Gruppe Teil eines `<FieldSet>` ist, wird das Label dort gesetzt.
 * Sonst über `aria-label` / `aria-labelledby`.
 */
export function RadioGroup({
  name,
  children,
  horizontal = false,
  className,
  ...rest
}: RadioGroupProps) {
  const classes = [
    styles.group,
    horizontal ? styles.groupHorizontal : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const patched = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    if (child.type !== Radio) return child;
    const props = child.props as { name?: string };
    if (props.name) return child;
    return cloneElement(child as ReactElement<RadioProps>, { name });
  });

  return (
    <div role="radiogroup" className={classes} {...rest}>
      {patched}
    </div>
  );
}
