// GET /admin/trains/{trainNr}/{date}/delays
// - ADMIN-only. Pure read-through to DelayRepo.segmentsForTrain.
// - trainNr arrives URL-encoded (spaces in "IC 2345"); decodeURIComponent
//   it before query.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function extractParams(event: ApiGwEvent): { trainNr: string; date: string } {
  const fromParams = event.pathParameters;
  const trainNrRaw = fromParams?.["trainNr"];
  const dateRaw = fromParams?.["date"];
  if (typeof trainNrRaw === "string" && trainNrRaw.length > 0 &&
      typeof dateRaw === "string" && DATE_RE.test(dateRaw)) {
    return { trainNr: decodeURIComponent(trainNrRaw), date: dateRaw };
  }
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/admin\/trains\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/delays$/);
  if (!m || !m[1] || !m[2]) {
    throw new AppError(
      "ERR_VALIDATION",
      "trainNr / date path parameters are invalid",
    );
  }
  return { trainNr: decodeURIComponent(m[1]), date: m[2] };
}

export async function handleGetTrainDelays(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);
    const { trainNr, date } = extractParams(event);
    const segments = await db().delays.segmentsForTrain(trainNr, date);
    return okJson(200, {
      trainNr,
      date,
      segments: segments.map((s) => {
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
          source: "iris" | "piebro";
        } = {
          segId: s.segId,
          origin: s.origin,
          destination: s.destination,
          delayMinutes: s.delayMinutes,
          reason: s.reason,
          is_cancelled: s.is_cancelled,
          abfahrtszeit_plan: s.planned_departure,
          ankunftszeit_plan: s.planned_arrival,
          source: s.source,
        };
        if (s.actual_departure !== undefined) out.abfahrtszeit_tatsaechlich = s.actual_departure;
        if (s.actual_arrival !== undefined) out.ankunftszeit_tatsaechlich = s.actual_arrival;
        return out;
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
