import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  isRecord,
  readArray,
  readNumber,
  readRecord,
  readString,
  warnMissingField,
} from './parse';

describe('parse narrowers', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('readString returns null when the field is missing or not a string', () => {
    expect(readString({ a: 'x' }, 'a')).toBe('x');
    expect(readString({ a: 42 }, 'a')).toBeNull();
    expect(readString({}, 'a')).toBeNull();
  });

  it('readNumber falls back to 0 for missing / NaN / Infinity', () => {
    expect(readNumber({ n: 3 }, 'n')).toBe(3);
    expect(readNumber({ n: Number.NaN }, 'n')).toBe(0);
    expect(readNumber({ n: Number.POSITIVE_INFINITY }, 'n')).toBe(0);
    expect(readNumber({}, 'n')).toBe(0);
  });

  it('readArray returns an empty array for non-array values', () => {
    expect(readArray({ xs: [1, 2] }, 'xs')).toEqual([1, 2]);
    expect(readArray({ xs: 'nope' }, 'xs')).toEqual([]);
  });

  it('readRecord returns null for non-record values', () => {
    expect(readRecord({ o: { k: 1 } }, 'o')).toEqual({ k: 1 });
    expect(readRecord({ o: [] }, 'o')).toBeNull();
    expect(readRecord({ o: 'no' }, 'o')).toBeNull();
  });
});

// Third-party mock generics use a two-parameter arg-array shape; carrying the
// concrete signature keeps `warnSpy.mock.calls[0]` typed as a tuple so
// consumers can index without any casts.
type ConsoleWarnArgs = [message?: unknown, ...optionalParams: unknown[]];

describe('warnMissingField', () => {
  let warnSpy: MockInstance<ConsoleWarnArgs, void>;

  beforeEach(() => {
    // Force DEV so the warnMissingField dev-only branch runs even when the
    // test env would otherwise report production.
    vi.stubEnv('DEV', true);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) as unknown as MockInstance<
      ConsoleWarnArgs,
      void
    >;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('warns when a required field is missing', () => {
    warnMissingField('GET /admin/tickets item', 'ticketId', { email: 'a@b' });
    expect(warnSpy).toHaveBeenCalledOnce();
    const firstArg = warnSpy.mock.calls[0][0];
    expect(typeof firstArg).toBe('string');
    expect(firstArg as string).toContain('ticketId');
  });

  it('stays silent when the field is present', () => {
    warnMissingField('GET /admin/tickets item', 'ticketId', { ticketId: 'T1' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('dedupes per (context, field) so a 50-row list emits one warn per field', () => {
    for (let i = 0; i < 50; i += 1) {
      warnMissingField('GET /admin/tickets item', 'delayMinutes', { ticketId: `T${i}` });
    }
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('re-warns for the same field in a different context', () => {
    warnMissingField('GET /admin/tickets item', 'updated_at', {});
    warnMissingField('GET /admin/users item', 'updated_at', {});
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
