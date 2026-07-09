// AES-256-GCM master key (KEK) for IBAN/BIC encryption. Loaded once from
// env at first use and cached. RAILBACK_IBAN_KEK is base64-encoded 32 bytes.

import { Buffer } from "node:buffer";
import { AppError } from "../errors/index.js";

const ENV_VAR = "RAILBACK_IBAN_KEK";
const KEK_BYTES = 32;

let _cached: Buffer | undefined;

export function getKek(): Buffer {
  if (_cached !== undefined) return _cached;

  const raw = process.env[ENV_VAR];
  if (raw === undefined || raw === "") {
    throw new AppError(
      "ERR_INTERNAL",
      "RAILBACK_IBAN_KEK missing or wrong length"
    );
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    throw new AppError(
      "ERR_INTERNAL",
      "RAILBACK_IBAN_KEK missing or wrong length"
    );
  }

  if (decoded.length !== KEK_BYTES) {
    throw new AppError(
      "ERR_INTERNAL",
      "RAILBACK_IBAN_KEK missing or wrong length"
    );
  }

  _cached = decoded;
  return _cached;
}

export function resetKekCache(): void {
  _cached = undefined;
}
