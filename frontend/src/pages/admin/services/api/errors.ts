/**
 * Error taxonomy that mirrors BACKEND_CONTRACT.md's standard error envelope.
 *
 *     { "error": { "code": "ERR_...", "message": "...", "details"?: unknown } }
 *
 * Screens should catch ApiError, inspect .code first (for programmatic
 * handling like ERR_AUTH_EXPIRED), then fall back to .message for display.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body.code;
  }
}

/**
 * Narrow an unknown JSON payload into an ApiErrorBody. Unknown payloads are
 * mapped to a generic ERR_UNKNOWN so callers always get a stable shape.
 */
export function parseErrorBody(payload: unknown, status: number): ApiErrorBody {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const wrapper = payload.error;
    if (wrapper && typeof wrapper === 'object') {
      const code =
        'code' in wrapper && typeof wrapper.code === 'string' ? wrapper.code : 'ERR_UNKNOWN';
      const message =
        'message' in wrapper && typeof wrapper.message === 'string'
          ? wrapper.message
          : `HTTP ${status}`;
      const details = 'details' in wrapper ? wrapper.details : undefined;
      return { code, message, details };
    }
  }
  return { code: 'ERR_UNKNOWN', message: `HTTP ${status}` };
}

export const ERR_AUTH_EXPIRED = 'ERR_AUTH_EXPIRED';
export const ERR_AUTH_INVALID = 'ERR_AUTH_INVALID';
export const ERR_AUTH_FORBIDDEN = 'ERR_AUTH_FORBIDDEN';
export const ERR_NOT_FOUND = 'ERR_NOT_FOUND';
