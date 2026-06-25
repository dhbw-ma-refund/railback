// POST /users/me/tickets/route-lookup
// - Stateless query — nothing persisted. Resolves a (from, to, date,
//   optional timeWindow) into candidate direct trains, with delay
//   info pulled from the in-process delays repo.
// - One of fromStation|fromEva and one of toStation|toEva is required
//   (the schema's two .refine() guards). EVA wins if both are given.
// - Station-name resolution via @railback/lib/refund/stations
//   (case-insensitive substring + Hbf-aliasing). Unresolvable name
//   → 400 ERR_VALIDATION with details.field = "fromStation" /
//   "toStation" so the frontend can highlight the right field.
// - Empty candidates list → 404 ERR_NO_CANDIDATES per contract
//   (API_CONTRACT_USERFORMS.md). Frontend renders
//   "Keine Direktverbindung gefunden, bitte Zeitfenster erweitern oder
//   Strecke prüfen." The errors registry maps ERR_NO_CANDIDATES → 404
//   precisely for this path; a 200 with an empty list would force the
//   frontend to special-case empty arrays to surface the message.
// - data_quality bubbles up from lookupDirectRoutes (FULL / PARTIAL /
//   PLAN_ONLY). Frontend uses it to footnote the result with a hint.
// - No backend caching — see CLAUDE.md route-template-lookup section.
//   Frontend may cache 60 s.

import { routeLookupRequestSchema } from "@railback/lib/schemas/ticket";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { lookupDirectRoutes } from "@railback/lib/refund/route-lookup";
import { resolveStation } from "@railback/lib/refund/stations";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

/**
 * Compute the default route-lookup time window — ±1h around the current
 * wall-clock time, clamped to [00:00, 23:59] to keep the window inside
 * the requested date. Exported (via local use) only; lives in the handler
 * so the lib stays free of `Date.now()` for deterministic unit tests.
 */
function nowPlusMinusOneHour(): { fromTime: string; toTime: string } {
  const now = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  const fromMin = Math.max(0, totalMin - 60);
  const toMin = Math.min(23 * 60 + 59, totalMin + 60);
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { fromTime: fmt(fromMin), toTime: fmt(toMin) };
}

export async function handlePostRouteLookup(
  event: ApiGwEvent,
): Promise<ApiGwResponse> {
  try {
    requireUserCaller(event);
    const body = readJsonBody(event);
    const parsed = routeLookupRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "route-lookup body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    // Resolve fromStation/fromEva → Station. EVA-number wins if both are
    // given (numeric lookup is the unambiguous path).
    const fromStation =
      parsed.data.fromEva !== undefined
        ? resolveStation(parsed.data.fromEva)
        : resolveStation(parsed.data.fromStation as string);
    if (!fromStation) {
      throw new AppError(
        "ERR_VALIDATION",
        "fromStation could not be resolved",
        undefined,
        {
          field: "fromStation",
          value: parsed.data.fromEva ?? parsed.data.fromStation,
        },
      );
    }

    const toStation =
      parsed.data.toEva !== undefined
        ? resolveStation(parsed.data.toEva)
        : resolveStation(parsed.data.toStation as string);
    if (!toStation) {
      throw new AppError(
        "ERR_VALIDATION",
        "toStation could not be resolved",
        undefined,
        {
          field: "toStation",
          value: parsed.data.toEva ?? parsed.data.toStation,
        },
      );
    }

    const input: Parameters<typeof lookupDirectRoutes>[0] = {
      fromEva: fromStation.eva,
      toEva: toStation.eva,
      date: parsed.data.date,
    };
    if (parsed.data.timeWindow) {
      input.fromTime = parsed.data.timeWindow.from;
      input.toTime = parsed.data.timeWindow.to;
    } else {
      // Contract (API_CONTRACT_USERFORMS.md line 432-433): "default = ±1h
      // around `now` if omitted". The lib defaults to 00:00–23:59 to stay
      // deterministic for unit tests; we apply the wall-clock default
      // here at the API boundary.
      //
      // The ±1h window is clamped to [00:00, 23:59] so a request near
      // midnight doesn't wrap. We deliberately do NOT spill over to the
      // previous/next day — the user's `date` is the authoritative trip
      // day. A wider window is one explicit timeWindow away.
      const { fromTime, toTime } = nowPlusMinusOneHour();
      input.fromTime = fromTime;
      input.toTime = toTime;
    }

    const candidates = await lookupDirectRoutes(input, { delays: db().delays });
    if (candidates.length === 0) {
      throw new AppError(
        "ERR_NO_CANDIDATES",
        "no direct connections in the time window",
      );
    }
    return okJson(200, { candidates });
  } catch (err) {
    return errorResponse(err);
  }
}
