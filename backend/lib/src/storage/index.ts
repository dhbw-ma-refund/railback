// Storage entry-point. Reads RAILBACK_STORAGE, dispatches to the registered
// factory, caches per backend-name. Phase 1a only ships the in-memory mock —
// "file" and "ddb" surface a "deferred to Phase 5" error if not registered.

import { AppError } from "../errors/index.js";
import { getRegisteredFactoryByString } from "./registry.js";
import type { Db } from "./types.js";

let CACHED: { name: string; db: Db } | null = null;

export function db(): Db {
  const name = (process.env.RAILBACK_STORAGE ?? "memory").toLowerCase();
  if (CACHED && CACHED.name === name) return CACHED.db;
  const factory = getRegisteredFactoryByString(name);
  if (!factory) {
    throw new AppError(
      "ERR_INTERNAL",
      `RAILBACK_STORAGE="${name}" has no registered backend (file/ddb deferred to Phase 5)`
    );
  }
  const built = factory();
  CACHED = { name, db: built };
  return built;
}

export function resetDbCache(): void {
  CACHED = null;
}
