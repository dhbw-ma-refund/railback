import type { CSSProperties } from 'react';
import './Skeleton.css';

export interface SkeletonProps {
  /** Visual variant. `text` is a short pill for inline runs; `block` for a rectangle. */
  variant?: 'text' | 'block';
  /** Any CSS length. Defaults to 100% for block, ~10ch for text. */
  width?: string;
  /** Any CSS length. Defaults are token-driven so lines match the surrounding type scale. */
  height?: string;
  /** Overrides the default border-radius. */
  radius?: string;
  className?: string;
  style?: CSSProperties;
  /** For screen readers; defaults to "Lädt". */
  ariaLabel?: string;
}

/**
 * Neutral placeholder tile with a subtle shimmer. Colors and radii come from
 * the design tokens (input-border + warm-off-white) so it visually belongs to
 * the same surface family as KPI cards, table cells and inputs. Set
 * `prefers-reduced-motion` and the shimmer stops.
 *
 * Compose several of these to mirror the shape of the real UI — see
 * `Table` loading and `DetailPageSkeleton` / `DashboardSkeleton` for callers.
 */
export function Skeleton({
  variant = 'block',
  width,
  height,
  radius,
  className = '',
  style,
  ariaLabel = 'Lädt',
}: SkeletonProps) {
  const merged: CSSProperties = {
    width: width ?? (variant === 'text' ? '10ch' : '100%'),
    height: height ?? (variant === 'text' ? '0.9em' : '16px'),
    borderRadius: radius,
    ...style,
  };
  return (
    <span
      className={`rb-skel rb-skel--${variant} ${className}`.trim()}
      style={merged}
      role="status"
      aria-label={ariaLabel}
      aria-busy="true"
    />
  );
}
