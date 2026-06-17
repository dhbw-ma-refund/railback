import React from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary';
export type ButtonSize = 'medium' | 'large';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  children,
  disabled,
  className = '',
  ...props
}) => {
  const classNames = [
    'rb-button',
    `rb-button--${variant}`,
    `rb-button--${size}`,
    disabled && 'rb-button--disabled',
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      className={classNames}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
