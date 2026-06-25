// GET /admin/users/{email}
// - ADMIN-only.
// - Returns the list-item shape plus a recent_tickets (max 10) sub-array.
// - email arrives URL-encoded — decodeURIComponent first.
//
// Frontend null-vs-missing contract: the contract emits `suspended_at: null`
// when the user is ACTIVE. We emit it as missing (undefined → omitted by
// JSON.stringify); frontend treats missing === null. Same for all
// optional fields in this projection.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { normaliseEmail } from "@railback/lib/storage/ddb/keys";
import { sumDecimals } from "@railback/lib/util/decimal";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";
import { userDetailView } from "../projections.js";

const LARGE = 100_000;

function extractEmail(event: ApiGwEvent): string {
  const raw = event.pathParameters?.["email"];
  if (typeof raw === "string" && raw.length > 0) {
    return normaliseEmail(decodeURIComponent(raw));
  }
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/admin\/users\/([^/]+)$/);
  if (!m || !m[1]) {
    throw new AppError("ERR_VALIDATION", "email path parameter is missing");
  }
  return normaliseEmail(decodeURIComponent(m[1]));
}

export async function handleGetUser(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);
    const email = extractEmail(event);

    const user = await db().users.getByEmail(email);
    if (!user) {
      throw new AppError("ERR_NOT_FOUND", `user ${email} not found`);
    }

    const ticks = await db().tickets.adminList({ email: user.email, limit: LARGE });
    const completedAmounts = ticks.items
      .filter((t) => t.ticket_state === "COMPLETED" && t.erwartete_erstattung !== undefined)
      .map((t) => t.erwartete_erstattung as string);
    const totalRefunded = sumDecimals(completedAmounts);

    // recent_tickets: 10 most recent by submitted_at / updated_at.
    const recent = [...ticks.items]
      .sort((a, b) => {
        const ka = a.submitted_at ?? a.updated_at;
        const kb = b.submitted_at ?? b.updated_at;
        return kb.localeCompare(ka);
      })
      .slice(0, 10);

    return okJson(200, userDetailView(
      user,
      { ticketCount: ticks.items.length, totalRefunded },
      recent,
    ));
  } catch (err) {
    return errorResponse(err);
  }
}
