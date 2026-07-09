// Domain error class + status code map. AppError is what handlers throw;
// toApiResponse turns anything (AppError, Error, non-Error) into the
// canonical { statusCode, body } the handlers return.

import type { ErrorCode } from "../types/enums.js";

export const ERROR_STATUS_CODES: Record<ErrorCode, number> = {
  ERR_VALIDATION: 400,
  ERR_AUTH_INVALID: 401,
  ERR_AUTH_EXPIRED: 401,
  ERR_FORBIDDEN: 403,
  ERR_NOT_FOUND: 404,
  ERR_CONFLICT: 409,
  ERR_NO_CLAIM: 422,
  ERR_NO_CANDIDATES: 404,
  ERR_INTERNAL: 500,
  ERR_EMAIL_FAILED: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode?: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode ?? ERROR_STATUS_CODES[code];
    if (details !== undefined) this.details = details;
  }
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface ApiErrorResponse {
  statusCode: number;
  body: ApiErrorBody;
}

export function toApiResponse(err: unknown): ApiErrorResponse {
  if (err instanceof AppError) {
    const body: ApiErrorBody =
      err.details === undefined
        ? { error: { code: err.code, message: err.message } }
        : { error: { code: err.code, message: err.message, details: err.details } };
    return { statusCode: err.statusCode, body };
  }
  if (err instanceof Error) {
    return {
      statusCode: ERROR_STATUS_CODES.ERR_INTERNAL,
      body: { error: { code: "ERR_INTERNAL", message: err.message } },
    };
  }
  return {
    statusCode: ERROR_STATUS_CODES.ERR_INTERNAL,
    body: { error: { code: "ERR_INTERNAL", message: "Unknown error" } },
  };
}
