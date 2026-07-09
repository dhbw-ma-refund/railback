// Backend registry. Internal module — not re-exported from the lib barrel.
// Mocks (memory / file) and the ddb adapter call registerBackend at module
// load. The active backend resolves through ./index.ts (db()), which dispatches
// on RAILBACK_STORAGE.

import type { Db } from "./types.js";

export type Backend = "memory" | "file" | "ddb";

const REGISTRY = new Map<string, () => Db>();

export function registerBackend(name: Backend, factory: () => Db): void {
  REGISTRY.set(name, factory);
}

// Internal escape hatch — used by the back-compat re-export in types.ts so the
// foundation tests can register synthetic backend names. New code MUST go
// through registerBackend(Backend).
export function _registerBackendByString(name: string, factory: () => Db): void {
  REGISTRY.set(name, factory);
}

export function getRegisteredFactory(name: Backend): (() => Db) | null {
  return REGISTRY.get(name) ?? null;
}

export function getRegisteredFactoryByString(name: string): (() => Db) | null {
  return REGISTRY.get(name) ?? null;
}

export function clearRegistry(): void {
  REGISTRY.clear();
}
