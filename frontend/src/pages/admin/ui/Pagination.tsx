import { Button } from '../ui-library';
import './Pagination.css';

export interface PaginationProps {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Forward/back buttons for cursor-based lists. The screen owns the cursor
 * stack; this component is pure UI so we can drop it into any list.
 */
export function Pagination({ hasPrev, hasNext, onPrev, onNext }: PaginationProps) {
  return (
    <nav className="rb-pagination" aria-label="Seitennavigation">
      <Button
        type="button"
        variant="secondary"
        className="rb-pagination__button"
        onClick={onPrev}
        disabled={!hasPrev}
      >
        Zurück
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="rb-pagination__button"
        onClick={onNext}
        disabled={!hasNext}
      >
        Weiter
      </Button>
    </nav>
  );
}
