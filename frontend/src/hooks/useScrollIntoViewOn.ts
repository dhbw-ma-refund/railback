import { RefObject, useEffect, useRef } from 'react';

/**
 * Small helper for wizard steps: attach the returned ref to a "missing
 * fields" summary banner, pass in the boolean that flips when the banner
 * becomes relevant, and the browser will smooth-scroll it into view.
 *
 * Guards against firing on every render — only scrolls on the transition
 * from `false` → `true`. When the user fixes a field and the summary
 * disappears, subsequent re-appearance triggers another scroll.
 *
 * Generic on the element type because callers may anchor to a `<div>`
 * banner or a wider `<section>` container.
 */
export function useScrollIntoViewOn<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
): RefObject<T> {
  // React's ref type wants non-null for JSX assignment. useRef<T>(null)
  // returns RefObject<T> exactly, no cast needed with the T generic.
  const ref = useRef<T>(null!) as RefObject<T>;
  const wasActive = useRef(false);

  useEffect(() => {
    if (active && !wasActive.current && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    wasActive.current = active;
  }, [active]);

  return ref;
}
