import React from 'react';
import './StatusBadge.css';

export type StatusType = 'pending' | 'approved' | 'rejected';

export interface StatusBadgeProps {
  status: StatusType;
  label: string;
  icon?: React.ReactNode;
}

const LUCIDE_BASE = 'https://cdn.jsdelivr.net/npm/lucide-static@1.24.0/icons';

const statusConfig = {
  pending: {
    color: 'var(--color-muted-gray-blue)',
    // Lucide "clock" (ISC) — https://lucide.dev/icons/clock
    icon: <span className="rb-status-badge-icon-svg" style={{ maskImage: `url(${LUCIDE_BASE}/clock.svg)`, WebkitMaskImage: `url(${LUCIDE_BASE}/clock.svg)` }} />,
  },
  approved: {
    color: 'var(--color-relief-green)',
    // Lucide "check-circle-2" (ISC) — https://lucide.dev/icons/check-circle-2
    icon: <span className="rb-status-badge-icon-svg" style={{ maskImage: `url(${LUCIDE_BASE}/check-circle-2.svg)`, WebkitMaskImage: `url(${LUCIDE_BASE}/check-circle-2.svg)` }} />,
  },
  rejected: {
    color: 'var(--color-error-red)',
    // Lucide "x-circle" (ISC) — https://lucide.dev/icons/x-circle
    icon: <span className="rb-status-badge-icon-svg" style={{ maskImage: `url(${LUCIDE_BASE}/x-circle.svg)`, WebkitMaskImage: `url(${LUCIDE_BASE}/x-circle.svg)` }} />,
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  icon
}) => {
  const config = statusConfig[status];
  const displayIcon = icon || config.icon;

  return (
    <div className={`rb-status-badge rb-status-badge--${status}`}>
      <span className="rb-status-badge-icon" aria-hidden="true">
        {displayIcon}
      </span>
      <span className="rb-status-badge-label">{label}</span>
    </div>
  );
};
