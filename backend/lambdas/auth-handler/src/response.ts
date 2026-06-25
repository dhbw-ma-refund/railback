// Tiny response helpers — wrap @railback/lib's jsonResponse / errorResponse
// with the API GW v2 envelope shape this lambda emits.

import { errorResponse as libErrorResponse, jsonResponse } from "@railback/lib/http/response";
import type { ApiGwResponse } from "./event.js";

export function okJson<T>(statusCode: number, body: T): ApiGwResponse {
  return jsonResponse(statusCode, body) as ApiGwResponse;
}

export function errorResponse(err: unknown): ApiGwResponse {
  return libErrorResponse(err) as ApiGwResponse;
}
