// Production storage bootstrap. Importing this module side-effect-registers
// the DynamoDB backend with the storage registry, so a Lambda whose entry
// file imports it can resolve `db()` under RAILBACK_STORAGE=ddb at cold
// start — closing the deploy-gap described in each lambda's BUILD.md
// ("Phase 5: add a bootstrap.ts").
//
// Design notes:
//   - We register "ddb" unconditionally (not branched on RAILBACK_STORAGE).
//     registerBackend is an idempotent Map.set keyed by backend name, so this
//     never clashes with the "memory" registration that tests install via
//     `@railback/mocks-in-memory`. db() still dispatches on RAILBACK_STORAGE,
//     so importing this in a memory-mode context is harmless.
//   - Unconditional (vs. a dynamic import branch) keeps this CJS-safe: the
//     lambda handler is esbuild-bundled to CJS, which has no top-level await,
//     so a synchronous static side-effect import is the only reliable option.
//     A production Lambda bundle wants the AWS SDK inlined anyway.
//   - The "memory" backend is intentionally NOT registered here — that stays
//     a test-only concern wired by the vitest setup files. Keeping the AWS
//     SDK out of nothing and the mock out of production bundles.

import "./ddb/index.js";
