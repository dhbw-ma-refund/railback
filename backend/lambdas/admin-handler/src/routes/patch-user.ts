// PATCH /admin/users/{email}
// - ADMIN-only.
// - Body: subset of {vorname, nachname, telefon, adresse, user_state,
//   suspended_reason}. Strict schema rejects iban/bic/email/created_at.
// - State machine: see src/state-machines.ts. SUSPENDED requires
//   non-empty suspended_reason (enforced by the schema's refine).
// - DELETION_SCHEDULED → SUSPENDED forbidden (CLAUDE.md / contract).

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { normaliseEmail } from "@railback/lib/storage/ddb/keys";
import { patchAdminUserRequestSchema } from "@railback/lib/schemas/admin";
import { sumDecimals } from "@railback/lib/util/decimal";
import type { ProfilePatch } from "@railback/lib/types/dto";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";
import { userDetailView } from "../projections.js";
import { assertUserTransition } from "../state-machines.js";

const LARGE = 100_000;
const SECONDS_PER_DAY = 24 * 60 * 60;

function extractEmail(event: ApiGwEvent): string {
  const raw = event.pathParameters?.["email"];
  if (typeof raw === "string" && raw.length > 0) return normaliseEmail(decodeURIComponent(raw));
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/admin\/users\/([^/]+)$/);
  if (!m || !m[1]) {
    throw new AppError("ERR_VALIDATION", "email path parameter is missing");
  }
  return normaliseEmail(decodeURIComponent(m[1]));
}

export async function handlePatchUser(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);
    const email = extractEmail(event);

    const body = readJsonBody(event);
    const parsed = patchAdminUserRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "patch body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const user = await db().users.getByEmailAdminView(email);
    if (!user) {
      throw new AppError("ERR_NOT_FOUND", `user ${email} not found`);
    }

    const patch: ProfilePatch = {};
    if (parsed.data.vorname !== undefined) patch.vorname = parsed.data.vorname;
    if (parsed.data.nachname !== undefined) patch.nachname = parsed.data.nachname;
    if (parsed.data.telefon !== undefined) patch.telefon = parsed.data.telefon;
    if (parsed.data.adresse !== undefined) patch.adresse = parsed.data.adresse;

    if (parsed.data.user_state !== undefined) {
      assertUserTransition(user.user_state, parsed.data.user_state);
      const next = parsed.data.user_state;
      const isStateChange = next !== user.user_state;
      patch.user_state = next;
      if (next === "SUSPENDED") {
        // Enforce ACTIVE→SUSPENDED requires non-empty reason (the schema
        // can't reach for current state). SUSPENDED→SUSPENDED may omit it.
        if (isStateChange) {
          const reason = parsed.data.suspended_reason?.trim();
          if (!reason) {
            throw new AppError(
              "ERR_VALIDATION",
              "suspended_reason is required when suspending an ACTIVE user",
              undefined,
              { field: "suspended_reason" },
            );
          }
          patch.suspended_at = new Date().toISOString();
          patch.suspended_reason = reason;
        } else if (parsed.data.suspended_reason !== undefined) {
          patch.suspended_reason = parsed.data.suspended_reason.trim();
        }
      } else if (next === "ACTIVE" && isStateChange) {
        // Unban / rescue — clear suspended_*, ttl. Skip on ACTIVE→ACTIVE
        // no-op (don't bump a write just to clear already-cleared fields).
        patch.clear = ["suspended_at", "suspended_reason", "ttl"];
      } else if (next === "DELETION_SCHEDULED" && isStateChange) {
        patch.ttl = Math.floor(Date.now() / 1000) + 30 * SECONDS_PER_DAY;
        // DB_SCHEMA.md U5: SUSPENDED → DELETION_SCHEDULED clears the
        // suspension metadata (row is on its way out, no point retaining
        // a stale ban reason on a tombstoned user). Same shape as the
        // ACTIVE-unban clear, minus `ttl` (we just set it).
        if (user.user_state === "SUSPENDED") {
          patch.clear = ["suspended_at", "suspended_reason"];
        }
      }
    }

    // Reject "only user_state but no actual transition" — a body of just
    // {user_state: "ACTIVE"} on an already-ACTIVE user has no effect and
    // is almost certainly a frontend bug.
    //
    // suspended_reason is included in the change-set: SUSPENDED→SUSPENDED
    // with a new reason is a legitimate admin edit (revising the ban
    // reason without unbanning). The block above at line 84-85 already
    // writes `patch.suspended_reason` in that case; the guard must
    // reflect that we're actually mutating a row-level field. Locked
    // 2026-07-01 per audit finding
    // `patch-user-suspended-reason-only-rejected`.
    const hasProfileChanges =
      parsed.data.vorname !== undefined ||
      parsed.data.nachname !== undefined ||
      parsed.data.telefon !== undefined ||
      parsed.data.adresse !== undefined ||
      patch.suspended_reason !== undefined;
    const hasStateChange = parsed.data.user_state !== undefined && parsed.data.user_state !== user.user_state;
    if (!hasProfileChanges && !hasStateChange) {
      throw new AppError(
        "ERR_VALIDATION",
        "no-op patch — at least one field must change",
      );
    }

    await db().users.updateProfile(email, patch);
    // Re-read through the admin-view so the response is built off the
    // ciphertext-stripped projection (repo-layer privacy boundary).
    const updated = await db().users.getByEmailAdminView(email);
    if (!updated) {
      throw new AppError("ERR_INTERNAL", "user vanished after updateProfile");
    }

    const ticks = await db().tickets.adminList({ email: updated.email, limit: LARGE });
    const completedAmounts = ticks.items
      .filter((t) => t.ticket_state === "COMPLETED" && t.erwartete_erstattung !== undefined)
      .map((t) => t.erwartete_erstattung as string);
    const totalRefunded = sumDecimals(completedAmounts);
    const recent = [...ticks.items]
      .sort((a, b) => {
        const ka = a.submitted_at ?? a.updated_at;
        const kb = b.submitted_at ?? b.updated_at;
        return kb.localeCompare(ka);
      })
      .slice(0, 10);

    return okJson(200, userDetailView(
      updated,
      { ticketCount: ticks.items.length, totalRefunded },
      recent,
    ));
  } catch (err) {
    return errorResponse(err);
  }
}
