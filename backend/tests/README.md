# @railback/tests

Cross-Lambda integration test workspace for Phase 4. Vitest picks specs up
via the root `**/tests/**/*.spec.ts` glob. `shared/env.ts` installs the
in-memory backend plus every env var any lambda under test reads (JWT,
IBAN-KEK, SES, four SEPA vars); `shared/fixtures.ts` provides
Alice/Bob/Admin seed helpers, JWT factories, and a lambda-agnostic API
Gateway v2 event builder that flow specs feed into any handler.

## Known limitations

- **Python ticket-extractor is not booted in-process.** The extractor is
  a Python 3.12 Lambda (zxing-cpp for Aztec, pymupdf for PDF text,
  vendored onlineticket.py for UIC 918.3). It cannot be run from a Node
  vitest worker without a subprocess bridge + per-machine Python venv,
  so flow specs simulate the extractor's persist step by patching the
  `UserTicket` row directly (`db.tickets.patch(..., ticket_state: "READY",
  extraction_method: "BARCODE", ...)`). Barcode/PDF cascade + persist
  behaviour is covered by the extractor's own suite in
  `lambdas/ticket-extractor/test/` (154 tests: 128 landing + 26 fix-up).
  See the block comment in `flows/upload-ticket-to-refund-pdf.spec.ts`
  for the full rationale and `PROGRESS.md` for the plan gap.
- **S3 presigned-POST content-length-range enforcement is mock-side, not
  wire-level.** The in-memory `BlobRepo` registers the policy at
  `presignRawUploadPost`/`presignReceiptPost` issue-time and rejects
  out-of-range `putBytes` calls with `ERR_VALIDATION`. Real S3 rejects
  at the HTTP layer before bytes land; the mock rejects on the
  in-process write. Behaviour is equivalent for handler-level tests but
  the browser-side multipart POST is out of scope.

## OpenAPI drift check

`schema/openapi.yaml` is generated from the zod schemas in `@railback/lib`
via `scripts/generate-openapi.ts`. It is committed — CI diffs it against
`git` to catch schema/route changes that weren't regenerated.

- Regenerate: `npm run generate:openapi`
- Drift check: `npm run check:openapi-drift` (runs the generator, then
  `git diff --exit-code schema/openapi.yaml`). Not wired into
  `npm run check` yet (the initial commit of the yaml would self-block
  the drift check on that same commit); wire in once the file has
  stabilised on `main`.
