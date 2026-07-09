// SHA-256 helpers built on node:crypto. Used for email-hash anonymisation
// (S3 prefixes, anonymised PKs, log fingerprints) and similar opaque
// identifiers.

import { createHash } from "node:crypto";
import { normaliseEmail } from "../storage/ddb/keys.js";

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * 16-char hex prefix of sha256(normalised email). Used in S3 key prefixes
 * (`raw/<hash>/…`, `rendered/<hash>/…`, `belege/<hash>/…`) and as the
 * opaque correlator in structured logs.
 *
 * Do NOT use for anonymised DDB PKs — those need the FULL 64-char
 * `sha256Hex(normaliseEmail(email))` (DB_SCHEMA.md §"Cascade on user
 * delete" item 3). Reusing the 16-char prefix would write anonymised
 * rows under a different PK from where the cascade looks for them.
 */
export function emailHash(email: string): string {
  return sha256Hex(normaliseEmail(email)).slice(0, 16);
}

/**
 * Stable opaque correlator for log lines that mention an email-bound
 * subject. Same value as `emailHash(email)` — single helper kept as an
 * alias so anonymisation-sweeper / email-sweeper / admin paths can grep
 * for the fingerprint use-case without coupling to the S3-prefix one.
 *
 * Never emit `email` verbatim in structured logs; call this instead.
 */
export function emailFingerprint(email: string): string {
  return emailHash(email);
}
