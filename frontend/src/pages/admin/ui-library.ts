/**
 * Re-exports the shared component library so admin panel screens never
 * import from '@shared/components' directly. Keeps the swap surface small
 * if the library ever moves to its own package.
 */
export { Button, Input, Card, StatusBadge, FeatureCard } from '@shared/components';
export type {
  ButtonProps,
  ButtonVariant,
  ButtonSize,
  InputProps,
  CardProps,
  StatusBadgeProps,
  StatusType,
  FeatureCardProps,
} from '@shared/components';
