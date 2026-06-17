import React from 'react';
import './StatusBadge.css';

export type StatusType = 'pending' | 'approved' | 'rejected';

export interface StatusBadgeProps {
  status: StatusType;
  label: string;
  icon?: React.ReactNode;
}

const statusConfig = {
  pending: {
    color: 'var(--color-muted-gray-blue)',
    icon: '🕐'
  },
  approved: {
    color: 'var(--color-relief-green)',
    icon: '✓'
  },
  rejected: {
    color: 'var(--color-error-red)',
    icon: '⚠'
  }
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
