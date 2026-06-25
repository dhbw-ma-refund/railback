// Tiny response helpers — see lambdas/user-handler/src/response.ts.

import {
  errorResponse as libErrorResponse,
  jsonResponse,
  noContentResponse as libNoContentResponse,
} from "@railback/lib/http/response";
import type { ApiGwResponse } from "./event.js";

export function okJson<T>(statusCode: number, body: T): ApiGwResponse {
  return jsonResponse(statusCode, body) as ApiGwResponse;
}

export function noContent(): ApiGwResponse {
  return libNoContentResponse() as ApiGwResponse;
}

export function errorResponse(err: unknown): ApiGwResponse {
  return libErrorResponse(err) as ApiGwResponse;
}
