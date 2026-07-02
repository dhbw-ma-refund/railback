// POST /users/me/tickets/{ticketId}/delays
// - Bearer auth (USER only). Caller must own the ticket — the repo is keyed
//   on (email, ticketId) so an unowned ticket simply returns null and we
//   surface 404. No need for a separate ownership lookup.
// - Body: { trainNr, date, abreisebahnhof, zielbahnhof }. The ticket on file
//   may not yet have these (route-template tickets do, barcode-extracted
//   tickets do, but PDF_TEXT-only ones might still need user-typed input);
//   we never read them off the row — frontend submits exactly what to look
//   up for THIS view.
// - Looks up segments via DelayRepo.segmentsForTrain (one DDB Query, no
//   separate Lambda — locked in CLAUDE.md / ARCHITECTURE.md).
// - Station resolution via @railback/lib/refund/stations.resolveStation:
//   if either side fails to resolve to a known EVA, return 404 with
//   details.field so the frontend can highlight the offending input. We
//   match the span on EVA-numbers (not name strings) to mirror the
//   route-lookup lib and stay robust to "Hbf"/spelling variants.
// - No delay data for the train+date → 200 with segments:[] and
//   maxDelayMinutes:0, data_quality:"PLAN_ONLY" (per API_CONTRACT_USERFORMS.md
//   Step 3: "If `segments` is empty, the train wasn't covered by the delay
//   archive ... they can still submit but the delay will be Section 3.3
//   manual entry"). 404 is reserved for input errors (unresolvable station,
//   span-not-found on a covered train).
// - Span aggregation (mirrors @railback/lib/refund/route-lookup):
//     delayMinutes = max(seg.delayMinutes) over span
//     any_cancelled = any seg.is_cancelled in span
//     data_quality  = PLAN_ONLY if any seg.finalized_at missing
//                   | PARTIAL   if chain has a gap (origin_eva mismatch)
//                   | FULL      otherwise
// - data_quality is the user-facing trust signal: FULL only when we saw
//   the whole chain finalised. PARTIAL/PLAN_ONLY do NOT block submission;
//   frontend shows a banner.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { resolveStation } from "@railback/lib/refund/stations";
import { delaysRequestSchema } from "@railback/lib/schemas/ticket";
import { deriveAntragsart } from "@railback/lib/refund/derive-antragsart";
import type { SegmentDelay } from "@railback/lib";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

function extractTicketId(event: ApiGwEvent): string | undefined {
  const fromParams = event.pathParameters?.["ticketId"];
  if (typeof fromParams === "string" && fromParams.length > 0) return fromParams;
  // Fallback: dispatcher hasn't pre-extracted — derive from path.
  // Expected shape: /users/me/tickets/<ticketId>/delays
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/users\/me\/tickets\/([^/]+)\/delays$/);
  return m?.[1];
}

export async function handlePostDelays(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);

    const ticketId = extractTicketId(event);
    if (!ticketId) {
      throw new AppError("ERR_VALIDATION", "ticketId path parameter missing");
    }

    const body = readJsonBody(event);
    const parsed = delaysRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "delays body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const ticket = await db().tickets.get(email, ticketId);
    if (!ticket) {
      throw new AppError("ERR_NOT_FOUND", `ticket ${ticketId} not found`);
    }

    const fromStation = resolveStation(parsed.data.abreisebahnhof);
    if (!fromStation) {
      throw new AppError(
        "ERR_NOT_FOUND",
        `abreisebahnhof not resolvable: ${parsed.data.abreisebahnhof}`,
        undefined,
        { field: "abreisebahnhof" },
      );
    }
    const toStation = resolveStation(parsed.data.zielbahnhof);
    if (!toStation) {
      throw new AppError(
        "ERR_NOT_FOUND",
        `zielbahnhof not resolvable: ${parsed.data.zielbahnhof}`,
        undefined,
        { field: "zielbahnhof" },
      );
    }

    const allSegments = await db().delays.segmentsForTrain(
      parsed.data.trainNr,
      parsed.data.date,
    );
    // Coverage gap — train not in the delay archive. Contract requires a
    // 200 response with an empty span so the wizard can advance to Section
    // 3.3 manual delay entry. The station resolves above already passed,
    // so the user-typed station names are fine; we just have no data.
    if (allSegments.length === 0) {
      return okJson(200, {
        trainNr: parsed.data.trainNr,
        date: parsed.data.date,
        segments: [],
        maxDelayMinutes: 0,
        any_cancelled: false,
        suggested_antragsart: "ENTSCHAEDIGUNG_60_119" as const,
        data_quality: "PLAN_ONLY" as const,
      });
    }

    // The repo already returns segments sorted by planned_departure; be
    // defensive in case a future backend changes that.
    const sorted = [...allSegments].sort((a, b) =>
      a.planned_departure < b.planned_departure
        ? -1
        : a.planned_departure > b.planned_departure
          ? 1
          : 0,
    );

    const fromIdx = sorted.findIndex((s) => s.origin_eva === fromStation.eva);
    if (fromIdx < 0) {
      throw new AppError(
        "ERR_NOT_FOUND",
        `train ${parsed.data.trainNr} does not depart from ${fromStation.name} on ${parsed.data.date}`,
        undefined,
        { field: "abreisebahnhof" },
      );
    }
    let toIdx = -1;
    for (let i = fromIdx; i < sorted.length; i++) {
      const seg = sorted[i];
      if (seg && seg.destination_eva === toStation.eva) {
        toIdx = i;
        break;
      }
    }
    if (toIdx < 0) {
      throw new AppError(
        "ERR_NOT_FOUND",
        `train ${parsed.data.trainNr} does not reach ${toStation.name} after ${fromStation.name}`,
        undefined,
        { field: "zielbahnhof" },
      );
    }

    const span: SegmentDelay[] = sorted.slice(fromIdx, toIdx + 1);

    const maxDelayMinutes = span.reduce(
      (m, s) => (s.delayMinutes > m ? s.delayMinutes : m),
      0,
    );
    const any_cancelled = span.some((s) => s.is_cancelled);

    let data_quality: "FULL" | "PARTIAL" | "PLAN_ONLY";
    if (span.some((s) => s.finalized_at === undefined)) {
      data_quality = "PLAN_ONLY";
    } else if (hasGap(span)) {
      data_quality = "PARTIAL";
    } else {
      data_quality = "FULL";
    }

    // suggested_antragsart per API_CONTRACT_USERFORMS.md Step 3 — backend's
    // default for the "Problem auswählen" step. We default to VERSPAETUNG-
    // as-grund because /delays runs before the user picks their grund-set;
    // the frontend then re-derives client-side once the user has chosen.
    let suggested_antragsart;
    try {
      suggested_antragsart = deriveAntragsart({
        delayMinutes: maxDelayMinutes,
        anyCancelled: any_cancelled,
        antragsgrund: ["VERSPAETUNG"],
        hasBelege: false,
        isZeitkarte: false,
      });
    } catch {
      // ERR_NO_CLAIM — under 60 min, no cancellation. We still hand the
      // frontend SOMETHING to pre-select; the 60–119 default is the most
      // common path and the user can override.
      suggested_antragsart = "ENTSCHAEDIGUNG_60_119" as const;
    }

    return okJson(200, {
      trainNr: parsed.data.trainNr,
      date: parsed.data.date,
      segments: span.map((s) => {
        const out: {
          segId: string;
          origin: string;
          destination: string;
          delayMinutes: number;
          reason: string;
          is_cancelled: boolean;
          abfahrtszeit_plan: string;
          abfahrtszeit_tatsaechlich?: string;
          ankunftszeit_plan: string;
          ankunftszeit_tatsaechlich?: string;
        } = {
          segId: s.segId,
          origin: s.origin,
          destination: s.destination,
          delayMinutes: s.delayMinutes,
          reason: s.reason,
          is_cancelled: s.is_cancelled,
          abfahrtszeit_plan: s.planned_departure,
          ankunftszeit_plan: s.planned_arrival,
        };
        if (s.actual_departure !== undefined) out.abfahrtszeit_tatsaechlich = s.actual_departure;
        if (s.actual_arrival !== undefined) out.ankunftszeit_tatsaechlich = s.actual_arrival;
        return out;
      }),
      maxDelayMinutes,
      any_cancelled,
      suggested_antragsart,
      data_quality,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function hasGap(span: SegmentDelay[]): boolean {
  for (let i = 1; i < span.length; i++) {
    const cur = span[i];
    const prev = span[i - 1];
    if (!cur || !prev) continue;
    if (cur.origin_eva !== prev.destination_eva) return true;
  }
  return false;
}
