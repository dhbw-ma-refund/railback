import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Streckt den Button auf 100 % der Containerbreite. */
  block?: boolean;
  /** Optionales Icon links vom Label. */
  leadingIcon?: ReactNode;
  /** Optionales Icon rechts vom Label. */
  trailingIcon?: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
};

const sizeClass: Record<ButtonSize, string> = {
  sm: styles["size-sm"],
  md: styles["size-md"],
  lg: styles["size-lg"],
};

/**
 * Pillenförmiger Button gemäß Brand-Styleguide §9.1.
 *
 * - Primary für die Hauptaktion pro View (eine pro Page).
 * - Secondary für Begleitaktionen ("Später erledigen", "Abbrechen").
 *
 * Touch-Target ≥ 44 px (§10.2). Disabled wird sowohl über `disabled`
 * als auch `aria-disabled` korrekt gestylt.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      block = false,
      leadingIcon,
      trailingIcon,
      type = "button",
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const classes = [
      styles.button,
      variantClass[variant],
      sizeClass[size],
      block ? styles.block : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button ref={ref} type={type} className={classes} {...rest}>
        {leadingIcon}
        {children}
        {trailingIcon}
      </button>
    );
  },
);
