import { useState, type ReactNode } from 'react';
import { Button } from '../ui-library';
import './FilterBar.css';

export interface FilterBarProps {
  children: ReactNode;
  onReset?: () => void;
  hasActiveFilters?: boolean;
}

/**
 * Layout wrapper for filter controls. Fields are passed as children so each
 * screen keeps ownership of its own inputs; the bar only manages layout,
 * the reset action, and mobile collapse.
 */
export function FilterBar({ children, onReset, hasActiveFilters }: FilterBarProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="rb-filter-bar" data-collapsed={collapsed}>
      <Button
        type="button"
        variant="secondary"
        className="rb-filter-bar__toggle"
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? 'Filter anzeigen' : 'Filter ausblenden'}
      </Button>
      {children}
      {onReset && (
        <div className="rb-filter-bar__actions">
          <Button
            type="button"
            variant="secondary"
            onClick={onReset}
            disabled={!hasActiveFilters}
          >
            Zurücksetzen
          </Button>
        </div>
      )}
    </div>
  );
}
