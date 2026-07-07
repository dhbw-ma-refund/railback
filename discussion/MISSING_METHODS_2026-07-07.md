# RailBack — Missing Connector Methods (2026-07-07)

Backend-side adapter (`DdbBackend`) exposes only what the connector currently
implements. The methods below are declared on the `Db` interface but have no
connector counterpart yet. Each Lambda that needs one of these will stall until
it lands. Filing here so the DB team can prioritise.

Signatures follow the `Db` interface in `node/src/types.ts`.

---

## UserRepo

```typescript
getByEmailForAuth(email: string): Promise<UserAuthLookup | null>
```

Returns `{ email, hashedPassword, userState }` — the auth-only projection.
Needed by `auth-handler` before any other Lambda gets wired up. Highest
priority.

---

## MandateRepo — state transitions

All of the following are needed for the `pain008-generator`,
`mandate-handler`, and `sepa-reconciler` Lambdas.

```typescript
getByMandateId(mandateId: string): Promise<SepaMandate | null>
listPendingBatches(limit?: number): Promise<SepaMandate[]>
  // mandate_state = "ISSUED" AND pain008_built_at not set
listByBatchId(batchId: string, limit?: number): Promise<SepaMandate[]>
listExpiringISSUED(cutoffIso: string, limit?: number): Promise<SepaMandate[]>
  // mandate_state = "ISSUED" AND mandate_expires_at < cutoffIso
markSubmitted(email: string, ticketId: string, submittedAt: string): Promise<void>
markDebited(email: string, ticketId: string, debitedAt: string): Promise<void>
markReversed(email: string, ticketId: string, reversedAt: string): Promise<void>
markDisputed(email: string, ticketId: string, disputedAt: string): Promise<void>
markExpired(email: string, ticketId: string, expiredAt: string): Promise<void>
markCancelled(email: string, ticketId: string, cancelledAt: string): Promise<void>
```

---

## TicketRepo — watchdog scan

```typescript
scanEmailWatchdog(cutoffIso: string, limit?: number): Promise<Ticket[]>
  // Scan: ticket_state = "EMAIL_SENDING" AND email_status = "SENT"
  //        AND email_last_attempt < cutoffIso
  // Shape: Scan + FilterExpression (no GSI — SENT rows have no email-pending keys)
  // Used by: email-sweeper Pass B (24h stuck-in-SENT detection)
```

---

## Anonymisation surface

Needed for the GDPR deletion / `hgb-archiver` flow. Lower priority than
the auth and SEPA methods above, but required before any user-deletion
Lambda ships.

```typescript
// UserRepo
enumerateAllTicketIdsForUser(email: string): Promise<string[]>
  // Returns plain ticketIds only (sk = TICKET#{id}, no sub-items)
deleteAllForUser(email: string): Promise<void>
  // Full cascade: all USER#{email} rows + orphan TICKET#{id}#OWNER rows
scanDeletionScheduledExpired(cutoffIso: string, limit?: number): Promise<User[]>
  // Scan: deletion_scheduled_at < cutoffIso
scanOrphanUserPks(limit?: number): Promise<string[]>
  // Scan for TICKET#{id} OWNER rows whose USER#{email} no longer exists

// TicketRepo
anonymiseUserTickets(email: string): Promise<void>
  // Nullify PII fields on all tickets for a user (name, address, etc.)
  // Keeps ticket_state, barcode, train data intact for reporting

// MandateRepo
anonymiseUserMandates(email: string): Promise<void>
  // Nullify iban_enc, bic_enc, name on all mandates for a user
```

---

## Notes

- The `getByEmailForAuth` gap is the only one blocking an in-flight Lambda
  right now (`auth-handler`). All others will be stubbed per guardrail 5
  until the Lambda that needs them is being wired.
- State-transition methods (`markSubmitted`, etc.) should use conditional
  writes where the prior state is a precondition — same pattern as
  `stampPain008Built`. Signatures above omit the condition for brevity;
  final signature should be agreed when each Lambda is wired.
- `scanOrphanUserPks` and `scanDeletionScheduledExpired` are Scans.
  At admin scale this is fine; both run on a scheduled Lambda, not on
  the hot path.

---

*Written by backend-side on 2026-07-07.*
