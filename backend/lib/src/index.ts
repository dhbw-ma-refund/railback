// Public surface barrel. Subpath exports in package.json are layered on top
// (mocks-author task wires those); this re-export covers the default
// "@railback/lib" import.

export * from "./types/enums.js";
export * from "./types/items.js";
export * from "./types/dto.js";

export * from "./storage/types.js";
export * as keys from "./storage/ddb/keys.js";

export { AppError, ERROR_STATUS_CODES, toApiResponse } from "./errors/index.js";
export type { ApiErrorBody, ApiErrorResponse } from "./errors/index.js";

export {
  corsHeaders,
  jsonResponse,
  noContentResponse,
  errorResponse,
} from "./http/response.js";
export type { JsonResponse, NoContentResponse } from "./http/response.js";
export { log } from "./http/logging.js";
export type { LogContext } from "./http/logging.js";

export { ulid, ULID_LEN } from "./util/ulid.js";
export {
  parseDecimal,
  addDecimal,
  subDecimal,
  mulDecimal,
  sumDecimals,
  cmpDecimal,
  isZero,
  formatEur,
} from "./util/decimal.js";
export type { ParsedDecimal } from "./util/decimal.js";
export { sha256Hex, emailHash, emailFingerprint } from "./util/hash.js";
