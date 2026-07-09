// API Gateway HTTP-API response helpers. Lambdas return these objects verbatim.

import { toApiResponse } from "../errors/index.js";

export const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
};

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
  ...corsHeaders,
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
    headers: { ...corsHeaders },
    body: "",
  };
}

export function errorResponse(err: unknown): JsonResponse {
  const { statusCode, body } = toApiResponse(err);
  return jsonResponse(statusCode, body);
}
