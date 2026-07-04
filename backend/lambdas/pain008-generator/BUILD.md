# pain008-generator — Build / Deploy

> **Phase 2.9 status (2026-06-29)**: this lambda is **test-only**, same
> story as auth-handler / user-handler / admin-handler / refund-pdf.
> Sync-invoked from `admin-handler` `PATCH /admin/tickets/{ticketId}`
> on the `* → APPROVED` transition via a dynamic-import shim — see
> `lambdas/admin-handler/src/routes/patch-ticket.ts` `invokePain008Generator()`.
> With the module installed in the workspace, the import resolves and
> `generatePain008({ email, ticketId })` runs in-process during
> admin-handler tests too.
>
> Same deploy gap as the other lambdas: production `handler.ts` reaches
> `db()` from `@railback/lib/storage` without side-effect-registering a
> backend. Tests work via `@railback/mocks-in-memory` in `test/setup.ts`.
> Real Lambda cold-start would throw `ERR_INTERNAL "no factory registered"`.
> Resolution lands in Phase 5 alongside the real DDB-side
> `lib/storage/ddb/` impls + the matching S3-side `lib/storage/s3/`
> wiring already in place.

## What it does

1. Load the SepaMandate row for `(email, ticketId)`; bail with
   `ERR_NOT_FOUND` if missing (zero-fee waiver = no mandate = caller
   must skip; the admin-handler guard already does that pre-check).
2. Idempotency: if `mandate.pain008_built_at` is already set, log
   `pain008.skip.already_built` and return. The `buildPain008Xml`
   validator would throw anyway, but the pre-check keeps the log
   line out of the noisy ERR_VALIDATION bucket.
3. State guard: only `mandate_state === "ISSUED"` is buildable.
   Anything else (SUBMITTED / DEBITED / REVERSED / DISPUTED /
   EXPIRED / CANCELLED) → `ERR_VALIDATION`.
4. Load the parent ticket — only `ticketId` flows into the XML
   (used in the `<RmtInf><Ustrd>` line), but the `tickets.get` call
   is also a referential-integrity gate.
5. Decrypt `iban_enc` + `bic_enc` from the **mandate snapshot** (NOT
   from the live user profile — the snapshot is locked at issue-time,
   user-profile edits after that are intentionally not reflected).
6. `generateBatchId()` (ULID) + `builtAt = new Date().toISOString()`.
7. `buildPain008Xml(...)` → XML string. All SEPA validators
   (mandate-state / sequence-type / fee-amount / expiry /
   IBAN-mod97 / BIC / Gläubiger-ID / env-vars) live inside that lib
   call; we just propagate the AppErrors.
8. Encode UTF-8 bytes and persist to S3 at
   `pain008/<YYYY-MM>/<batchId>.xml` via `BlobRepo.putBytes`.
9. Stamp the mandate row with `pain008_built_at` / `pain008_batch_id` /
   `pain008_s3_key`. **Mandate stays in `ISSUED`** — the `ISSUED → SUBMITTED`
   transition lives in admin's `POST /admin/sepa/batches/{id}/mark-submitted`,
   after the operator uploaded the XML to the bank portal.

`generatePain008` throws on every failure path (no silent retry-queue
semantics here — this is post-approval admin tooling, not user-facing).
Callers turn the throw into a 5xx; the operator can re-trigger via a
future rebuild-path or by undoing the APPROVED transition (currently
nonexistent — see DECISIONS.md).

### Write order (S3 first, then mandate stamp)

`persistPain008Xml` writes the XML bytes to S3 **before**
`mandates.stampPain008Built` updates the DDB row. Rationale: a stamped
mandate pointing at nonexistent bytes would be much worse than the
reverse — the audit path would go looking for XML that never landed.

If `stampPain008Built` fails after the S3 PutObject succeeded (loss of
the conditional race, or transient DDB error), the handler **deletes
the just-written S3 object as an orphan-cleanup** so the retry starts
clean: a subsequent `pain008-rebuild` call gets a fresh ULID batchId and
writes fresh bytes, and no stray XML lives in S3 unpaired to a mandate
row. Added in the 2026-06-29 adversarial pass — previously orphaned
bytes just accumulated (10y retention makes that annoying, not fatal).
Doc-drift-fix locked 2026-07-01 per audit finding
`build-md-drift-orphan`.

## Runtime env

- `RAILBACK_STORAGE` — `memory` for local/dev, `ddb` on Lambda
- `RAILBACK_IBAN_KEK` — AES-256-GCM master key, base64 of 32 bytes
- `RAILBACK_SEPA_KONTOINHABER` — RailBack legal name (creditor / initiating party)
- `RAILBACK_SEPA_IBAN_OWN` — RailBack business account IBAN (creditor account)
- `RAILBACK_SEPA_BIC_OWN` — RailBack business account BIC
- `RAILBACK_SEPA_GLAEUBIGER_ID` — Gläubiger-Identifikation (Creditor Identifier)
- `RAILBACK_S3_BUCKET` — required when `RAILBACK_STORAGE=ddb` (Phase 5).
  In `memory` mode the in-memory BlobRepo writes into its own
  `memory-mock` bucket — `persist.ts` mirrors that fallback.
- `RAILBACK_DDB_TABLE` — required when `RAILBACK_STORAGE=ddb` (Phase 5).

## Local dev

Tests run at root-level Vitest (per DECISIONS.md — there is no
per-workspace `test` script):

```
cd backend
RAILBACK_STORAGE=memory \
RAILBACK_IBAN_KEK=$(node -e "console.log(Buffer.alloc(32,0x42).toString('base64'))") \
RAILBACK_SEPA_KONTOINHABER="RailBack UG" \
RAILBACK_SEPA_IBAN_OWN="DE02500105170137075030" \
RAILBACK_SEPA_BIC_OWN="INGDDEFFXXX" \
RAILBACK_SEPA_GLAEUBIGER_ID="DE98ZZZ09999999999" \
npx vitest run lambdas/pain008-generator
```

Typecheck this workspace only:

```
npm run typecheck --workspace=@railback/pain008-generator
```

## Zip (Phase 5)

Single esbuild CJS bundle of `src/index.ts` with `@railback/lib` inlined.
No bundled assets (unlike refund-pdf — pain008 XML is built from
strings). The zip contains:

- `index.js` (bundled handler + lib)

`@aws-sdk/client-s3` is provided by the Lambda Node 20.x runtime and
gets marked external in the esbuild config. No native deps.

## IAM (Phase 5)

- DynamoDB:
  - `Query` on `PK=USER#<email>` (read ticket + mandate rows)
  - `UpdateItem` on `PK=USER#<email>|SK=MANDATE#<ticketId>` (stamp
    pain008_* fields)
- S3:
  - `s3:PutObject` on `pain008/*` (write batch XML, 10y retention)
- KMS: none (env-var KEK).
- CloudWatch Logs: default.
