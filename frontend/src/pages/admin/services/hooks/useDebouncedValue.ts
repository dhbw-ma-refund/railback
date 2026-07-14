import { useEffect, useState } from 'react';

/**
 * Debounces a value so callers do not fire a network request on every
 * keystroke. Uses timers on purpose — that's the debounce contract. Tests
 * around this hook must use fake timers.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
