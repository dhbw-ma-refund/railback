import { describe, expect, it } from 'vitest';
import { decodeJwt, isExpired } from './jwt';
import { makeJwt } from './__testing__/tokens';

describe('decodeJwt', () => {
  it('extracts role and exp', () => {
    const token = makeJwt({ sub: 'a@b', role: 'ADMIN', exp: 1_800_000_000 });
    expect(decodeJwt(token)).toMatchObject({ sub: 'a@b', role: 'ADMIN', exp: 1_800_000_000 });
  });

  it('returns null for malformed tokens', () => {
    expect(decodeJwt('not-a-token')).toBeNull();
    expect(decodeJwt('a.b')).toBeNull();
  });
});

describe('isExpired', () => {
  it('returns true when exp is in the past', () => {
    expect(isExpired({ exp: 1_000_000_000 }, 2_000_000_000_000)).toBe(true);
  });
  it('returns false when exp is in the future', () => {
    expect(isExpired({ exp: 2_000_000_000 }, 1_000_000_000_000)).toBe(false);
  });
  it('returns true for a null payload', () => {
    expect(isExpired(null)).toBe(true);
  });
});
