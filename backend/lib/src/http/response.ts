// API Gateway HTTP-API response helpers. Lambdas return these objects verbatim.
//
// CORS is NOT set here. In the deployed environment the public surface is a
// Lambda Function URL with NATIVE CORS (see DEPLOY_RUNBOOK.md). The Function
// URL platform intercepts OPTIONS preflights itself and injects the
// Access-Control-* headers on every response — a handler-set
// `access-control-allow-origin` would be ADDED to the platform's, producing a
// duplicated header value that browsers reject. So the platform is the single
// source of truth for CORS; these helpers deliberately set none.

import { toApiResponse } from "../errors/index.js";

export interface JsonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface NoContentResponse {
  statusCode: 204;
  headers: Record<string, string>;
  body: "";
}

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
};

export function jsonResponse<T>(statusCode: number, body: T): JsonResponse {
  return {
    statusCode,
    headers: { ...JSON_HEADERS },
    body: JSON.stringify(body),
  };
}

export function noContentResponse(): NoContentResponse {
  return {
    statusCode: 204,
    headers: {},
    body: "",
  };
}

export function errorResponse(err: unknown): JsonResponse {
  const { statusCode, body } = toApiResponse(err);
  return jsonResponse(statusCode, body);
}
