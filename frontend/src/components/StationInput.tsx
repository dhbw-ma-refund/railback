/**
 * Station name input with autocomplete suggestions from the bundled
 * DB station list (see src/lib/stations.ts — mirror of the backend's
 * refund/stations.ts, so any suggestion the user picks is guaranteed
 * to resolve on the backend).
 *
 * UX:
 *   - Prefix matches rank above substring matches, both case-insensitive
 *     with umlaut folding (typing "muenchen" finds "München Hbf").
 *   - Up to 8 suggestions.
 *   - Arrow keys move highlight, Enter picks, Esc closes.
 *   - Blur closes after a short delay so a mouse-click on a suggestion
 *     lands before the popover disappears.
 *
 * Composes the shared <Input> so it inherits the label / error / helperText
 * conventions used everywhere else in the wizard.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@shared/components';
import type { InputProps } from '@shared/components';
import { STATIONS } from '../lib/stations';
import './StationInput.css';

const MAX_SUGGESTIONS = 8;

/** Normalise umlauts + case for match comparison. */
function foldForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

/**
 * Return up to `MAX_SUGGESTIONS` station names ranked by:
 *   1. exact prefix match (case + umlaut insensitive)
 *   2. word-boundary prefix (matches "Berlin" in "Berlin Hbf")
 *   3. substring anywhere
 */
export function suggestStations(query: string): string[] {
  const q = foldForMatch(query.trim());
  if (!q) return [];
  const prefix: string[] = [];
  const wordPrefix: string[] = [];
  const substring: string[] = [];
  for (const name of STATIONS) {
    const folded = foldForMatch(name);
    if (folded.startsWith(q)) {
      prefix.push(name);
    } else if (folded.split(/\s+/).some((w) => w.startsWith(q))) {
      wordPrefix.push(name);
    } else if (folded.includes(q)) {
      substring.push(name);
    }
    if (prefix.length >= MAX_SUGGESTIONS) break;
  }
  const out = [...prefix, ...wordPrefix, ...substring].slice(0, MAX_SUGGESTIONS);
  return out;
}

export interface StationInputProps extends Omit<InputProps, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  /** Emitted when the user commits a suggestion (click or Enter). */
  onCommit?: (value: string) => void;
}

export const StationInput = ({ value, onChange, onCommit, ...rest }: StationInputProps) => {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    // Never suggest when the input already exactly matches a station —
    // the user is done, no reason to keep nagging.
    if (STATIONS.includes(value)) return [];
    return suggestStations(value);
  }, [value]);

  // Reset the highlight when the list changes so Enter doesn't pick a stale row.
  useEffect(() => {
    setHighlight(0);
  }, [suggestions.length]);

  // Click outside → close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const commit = (val: string) => {
    onChange(val);
    onCommit?.(val);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      // Prevent form submit — the user meant "pick this suggestion", not
      // "advance to the next step".
      e.preventDefault();
      commit(suggestions[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && focused && suggestions.length > 0;

  return (
    <div className="station-input" ref={containerRef}>
      <Input
        {...rest}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={(e) => {
          setFocused(true);
          setOpen(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          // Delay so a mouse-down on a suggestion has time to fire its
          // onClick before the popover disappears.
          window.setTimeout(() => setFocused(false), 150);
          rest.onBlur?.(e);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={showList}
      />
      {showList && (
        <ul className="station-input__list" role="listbox">
          {suggestions.map((name, i) => (
            <li
              key={name}
              role="option"
              aria-selected={i === highlight}
              className={
                'station-input__item' + (i === highlight ? ' station-input__item--active' : '')
              }
              // onMouseDown fires before the input's onBlur — using onClick
              // would race and lose to the popover-close timer.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(name);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
