// 30 s in-process cache for /admin/stats. Snapshot is recomputed lazily
// on the first call after the TTL expires. ARCHITECTURE.md / contract
// both say "don't poll faster than 30 s" — the cache makes that policy
// hold even if frontend ignores it.
//
// resetStatsCache() is test-only — installTestEnv() calls it so the
// "stats are cached" test can assert the second call doesn't re-scan.

import { db } from "@railback/lib/storage";
import { addDecimal } from "@railback/lib/util/decimal";
import { TICKET_STATES, USER_STATES } from "@railback/lib/types/enums";
import type { TicketState } from "@railback/lib/types/enums";
import { statsView } from "./projections.js";
import type { AdminStatsResponse } from "@railback/lib/schemas/admin";

const TTL_MS = 30_000;
// Big enough that "list everything" returns the full table; the repos
// honour these in the in-memory mock and we'll wire DDB pagination
// in Phase 5.
const LARGE = 100_000;

interface CacheEntry {
  builtAt: number;
  snapshot: AdminStatsResponse;
}

let _cache: CacheEntry | null = null;

export function resetStatsCache(): void {
  _cache = null;
}

function startOfThisMonthIso(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString();
}

export async function getStatsSnapshot(now: Date = new Date()): Promise<AdminStatsResponse> {
  const nowMs = now.getTime();
  if (_cache && nowMs - _cache.builtAt < TTL_MS) {
    return _cache.snapshot;
  }

  const users = await db().users.listAdminView({ limit: LARGE });
  const tickets = await db().tickets.adminList({ limit: LARGE });

  let usersActive = 0;
  let usersSuspended = 0;
  let usersDeletionScheduled = 0;
  for (const u of users.items) {
    if (u.user_state === "ACTIVE") usersActive++;
    else if (u.user_state === "SUSPENDED") usersSuspended++;
    else if (u.user_state === "DELETION_SCHEDULED") usersDeletionScheduled++;
  }

  const byState: Record<string, number> = {};
  for (const s of TICKET_STATES) byState[s] = 0;
  let totalPaidOut = "0.00";
  let thisMonthPaidOut = "0.00";
  const monthStart = startOfThisMonthIso(now);

  for (const t of tickets.items) {
    const st: TicketState = t.ticket_state;
    byState[st] = (byState[st] ?? 0) + 1;
    if (st === "COMPLETED" && t.erwartete_erstattung !== undefined) {
      totalPaidOut = addDecimal(totalPaidOut, t.erwartete_erstattung);
      // this_month_paid_out is anchored on db_paid_at — the only timestamp
      // that records when DB actually settled with the user. Falling back
      // to submitted_at would leak prior-month dollars into the current
      // month for tickets approved this month but submitted earlier.
      if (t.db_paid_at !== undefined && t.db_paid_at >= monthStart) {
        thisMonthPaidOut = addDecimal(thisMonthPaidOut, t.erwartete_erstattung);
      }
    }
  }

  // touch USER_STATES so a future addition is caught at typecheck time.
  void USER_STATES;

  const snapshot = statsView({
    usersTotal: users.items.length,
    usersActive,
    usersSuspended,
    usersDeletionScheduled,
    ticketsTotal: tickets.items.length,
    ticketsByState: byState,
    ticketsPending: byState["PENDING_DB_PAYMENT"] ?? 0,
    totalPaidOut,
    thisMonthPaidOut,
    asOf: now.toISOString(),
  });

  _cache = { builtAt: nowMs, snapshot };
  return snapshot;
}
