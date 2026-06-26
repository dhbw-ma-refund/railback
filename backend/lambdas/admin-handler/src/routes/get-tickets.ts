// GET /admin/tickets
// - ADMIN-only.
// - Filters: state, email, trainNr, date, from, to, limit, cursor.
// - Joins vorname/nachname off each ticket's UserProfile row (cached
//   per-email so we don't re-fetch the same user N times).

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { normaliseEmail } from "@railback/lib/storage/ddb/keys";
import { listTicketsQuerySchema } from "@railback/lib/schemas/admin";
import type { AdminTicketQuery, UserAdminView } from "@railback/lib/types/dto";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";
import { ticketSummaryView } from "../projections.js";

export async function handleGetTickets(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);

    const parsed = listTicketsQuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "invalid query parameters",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const query: AdminTicketQuery = { limit: parsed.data.limit };
    if (parsed.data.state !== undefined) query.state = parsed.data.state;
    if (parsed.data.email !== undefined) query.email = normaliseEmail(parsed.data.email);
    if (parsed.data.trainNr !== undefined) query.trainNr = parsed.data.trainNr;
    if (parsed.data.date !== undefined) query.date = parsed.data.date;
    if (parsed.data.from !== undefined) query.fromDate = parsed.data.from;
    if (parsed.data.to !== undefined) query.toDate = parsed.data.to;
    if (parsed.data.cursor !== undefined) query.cursor = parsed.data.cursor;

    const page = await db().tickets.adminList(query);

    const userCache = new Map<string, UserAdminView | null>();
    const items = await Promise.all(
      page.items.map(async (t) => {
        let u = userCache.get(t.email);
        if (u === undefined) {
          u = await db().users.getByEmailAdminView(t.email);
          userCache.set(t.email, u);
        }
        const slice = u
          ? { vorname: u.vorname, nachname: u.nachname }
          : { vorname: "", nachname: "" };
        return ticketSummaryView(t, slice);
      }),
    );

    const out: { items: typeof items; nextCursor?: string } = { items };
    if (page.nextCursor !== undefined) out.nextCursor = page.nextCursor;
    return okJson(200, out);
  } catch (err) {
    return errorResponse(err);
  }
}
