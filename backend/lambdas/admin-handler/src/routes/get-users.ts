// GET /admin/users
// - ADMIN-only.
// - Query params: email (prefix), user_state, limit, cursor.
// - Each row's ticket_count + total_refunded is derived from
//   tickets.adminList({email}) — admin-tool scale, one extra
//   per-row read is acceptable.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { listUsersQuerySchema } from "@railback/lib/schemas/admin";
import { sumDecimals } from "@railback/lib/util/decimal";
import type { UserListQuery } from "@railback/lib/types/dto";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";
import { userSummary } from "../projections.js";

const LARGE = 100_000;

export async function handleGetUsers(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);

    const parsed = listUsersQuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "invalid query parameters",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const query: UserListQuery = { limit: parsed.data.limit };
    if (parsed.data.email !== undefined) query.emailPrefix = parsed.data.email;
    if (parsed.data.user_state !== undefined) query.state = parsed.data.user_state;
    if (parsed.data.cursor !== undefined) query.cursor = parsed.data.cursor;

    const page = await db().users.listAdminView(query);

    // Derive ticket_count + total_refunded per user. One adminList per
    // page-row — fine for admin tooling, denormalisation lands in Phase 5
    // if needed.
    const items = await Promise.all(
      page.items.map(async (u) => {
        const ticks = await db().tickets.adminList({ email: u.email, limit: LARGE });
        const ticketCount = ticks.items.length;
        const completedAmounts = ticks.items
          .filter((t) => t.ticket_state === "COMPLETED" && t.erwartete_erstattung !== undefined)
          .map((t) => t.erwartete_erstattung as string);
        const totalRefunded = sumDecimals(completedAmounts);
        return userSummary(u, { ticketCount, totalRefunded });
      }),
    );

    const out: { items: typeof items; nextCursor?: string } = { items };
    if (page.nextCursor !== undefined) out.nextCursor = page.nextCursor;
    return okJson(200, out);
  } catch (err) {
    return errorResponse(err);
  }
}
