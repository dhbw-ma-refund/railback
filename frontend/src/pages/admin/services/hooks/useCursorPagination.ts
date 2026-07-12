import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Manages a forward-only cursor list with a client-side back-stack.
 *
 * The backend contract exposes only a `nextCursor` — there is no
 * "previousCursor". We keep every visited cursor on a stack so "Zurück"
 * navigates locally without a second round-trip. The current cursor is
 * mirrored through onCursorChange so screens can persist it in the URL.
 *
 * The stack resets whenever `resetKey` changes (typically a serialised
 * filter object), so filter switches restart pagination at page 1.
 */
export interface CursorPaginationHandle {
  currentCursor: string | undefined;
  hasPrev: boolean;
  hasNext: boolean;
  advance: (nextCursor: string | undefined) => void;
  goPrev: () => void;
  goNext: () => void;
}

export interface UseCursorPaginationOptions {
  urlCursor: string | undefined;
  nextCursorFromLoad: string | undefined;
  resetKey: string;
  onCursorChange: (cursor: string | undefined) => void;
  /**
   * Number of items on the currently-rendered page. Guards against the
   * backend returning `items: []` alongside a `nextCursor` — without this,
   * "Weiter" stays enabled and paginates through empty pages forever.
   */
  pageItemCount?: number;
}

export function useCursorPagination({
  urlCursor,
  nextCursorFromLoad,
  resetKey,
  onCursorChange,
  pageItemCount,
}: UseCursorPaginationOptions): CursorPaginationHandle {
  const [stack, setStack] = useState<Array<string | undefined>>(() => [urlCursor]);
  const cursorRef = useRef<string | undefined>(urlCursor);
  const lastResetKey = useRef(resetKey);

  // Filter change → wipe stack, restart from URL cursor (usually undefined
  // after filter reset in the parent).
  useEffect(() => {
    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey;
      setStack([urlCursor]);
      cursorRef.current = urlCursor;
    }
  }, [resetKey, urlCursor]);

  const currentCursor = stack[stack.length - 1];
  const hasPrev = stack.length > 1;
  const hasNext =
    nextCursorFromLoad !== undefined && (pageItemCount === undefined || pageItemCount > 0);

  const advance = useCallback((next: string | undefined) => {
    // Called by the caller after a page load. Nothing to do here — the
    // hook already knows the current cursor. Kept for symmetry with the
    // handle type in case future callers want to store a load-driven cursor.
    cursorRef.current = next;
  }, []);

  const goNext = useCallback(() => {
    if (!nextCursorFromLoad) return;
    setStack((prev) => [...prev, nextCursorFromLoad]);
    onCursorChange(nextCursorFromLoad);
  }, [nextCursorFromLoad, onCursorChange]);

  const goPrev = useCallback(() => {
    setStack((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      onCursorChange(next[next.length - 1]);
      return next;
    });
  }, [onCursorChange]);

  return { currentCursor, hasPrev, hasNext, advance, goPrev, goNext };
}
