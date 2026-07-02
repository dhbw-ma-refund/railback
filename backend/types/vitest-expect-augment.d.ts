// Workaround for a vitest 1.6.1 + TypeScript 5.9 typings bug. The vitest
// `expect` symbol is typed as `ExpectStatic` from `@vitest/expect`, which
// declares `interface ExpectStatic extends Chai.ExpectStatic,
// AsymmetricMatchersContaining { <T>(actual: T): Assertion<T> }`. Under our
// strict tsconfig (`strict + exactOptionalPropertyTypes + bundler`), the
// extends-chain to `Chai.ExpectStatic` lands in a state where TypeScript
// reports "Type 'ExpectStatic' has no call signatures" at every callsite —
// even though a conditional probe (`T extends (...) => any`) succeeds.
//
// The fix: locally augment `@vitest/expect` so `ExpectStatic` exposes the
// explicit `<T>(actual: T, message?: string)` signature that the original
// interface buried via inheritance. Declaration merging combines this with
// the upstream interface; runtime is untouched.
//
// Discovered: every `expect(...)` callsite errored TS2349 across the repo
// before this shim. Local repro:
//   import { expect } from "vitest"; expect(1).toBe(1);
//   // → TS2349: 'ExpectStatic' has no call signatures.
//
// File is referenced via `*.d.ts` glob in each workspace's tsconfig include.

declare module "@vitest/expect" {
  interface ExpectStatic {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <T = unknown>(actual: T, message?: string): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    soft<T = unknown>(actual: T, message?: string): any;
    unreachable(message?: string): never;
    fail(message?: string): never;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fail(actual: any, expected: any, message?: string, operator?: string): never;
  }
}

export {};
