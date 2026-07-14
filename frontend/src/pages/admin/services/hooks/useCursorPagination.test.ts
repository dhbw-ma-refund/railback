import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useCursorPagination,
  type CursorPaginationHandle,
  type UseCursorPaginationOptions,
} from './useCursorPagination';

interface HookProps {
  urlCursor: string | undefined;
  nextCursorFromLoad: string | undefined;
  resetKey: string;
  onCursorChange: (cursor: string | undefined) => void;
  pageItemCount?: number;
}

function renderPagination(initial: HookProps) {
  return renderHook<CursorPaginationHandle, HookProps>(
    (props: HookProps) => {
      const options: UseCursorPaginationOptions = {
        urlCursor: props.urlCursor,
        nextCursorFromLoad: props.nextCursorFromLoad,
        resetKey: props.resetKey,
        onCursorChange: props.onCursorChange,
        pageItemCount: props.pageItemCount,
      };
      return useCursorPagination(options);
    },
    { initialProps: initial },
  );
}

describe('useCursorPagination', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes hasNext when a next cursor and items are present', () => {
    const { result } = renderPagination({
      urlCursor: undefined,
      nextCursorFromLoad: 'c1',
      resetKey: 'k0',
      onCursorChange: () => {},
      pageItemCount: 3,
    });
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrev).toBe(false);
  });

  it('suppresses hasNext when the current page is empty even if the backend supplied a cursor', () => {
    // Regression: backend can return items:[] alongside a nextCursor
    // (observed when the ticket cursor scans an unrelated GSI partition).
    // Without pageItemCount the Weiter button would spin forever.
    const { result } = renderPagination({
      urlCursor: undefined,
      nextCursorFromLoad: 'c1',
      resetKey: 'k0',
      onCursorChange: () => {},
      pageItemCount: 0,
    });
    expect(result.current.hasNext).toBe(false);
  });

  it('leaves hasNext enabled when pageItemCount is not supplied (opt-in guard)', () => {
    const { result } = renderPagination({
      urlCursor: undefined,
      nextCursorFromLoad: 'c1',
      resetKey: 'k0',
      onCursorChange: () => {},
    });
    expect(result.current.hasNext).toBe(true);
  });

  it('resets the back-stack when resetKey changes so filter switches restart at page 1', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderPagination({
      urlCursor: undefined,
      nextCursorFromLoad: 'c1',
      resetKey: 'state=APPROVED',
      onCursorChange: onChange,
      pageItemCount: 5,
    });

    act(() => {
      result.current.goNext();
    });
    expect(result.current.hasPrev).toBe(true);

    rerender({
      urlCursor: undefined,
      nextCursorFromLoad: 'c9',
      resetKey: 'state=REJECTED',
      onCursorChange: onChange,
      pageItemCount: 5,
    });
    expect(result.current.hasPrev).toBe(false);
  });

  it('goPrev pops the stack and reports the previous cursor', () => {
    const onChange = vi.fn();
    const { result } = renderPagination({
      urlCursor: undefined,
      nextCursorFromLoad: 'c1',
      resetKey: 'k',
      onCursorChange: onChange,
      pageItemCount: 5,
    });
    act(() => {
      result.current.goNext();
    });
    expect(onChange).toHaveBeenLastCalledWith('c1');
    act(() => {
      result.current.goPrev();
    });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(result.current.hasPrev).toBe(false);
  });
});
