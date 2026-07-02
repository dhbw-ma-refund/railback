// Public surface of @railback/mocks-in-memory. Importing this module has the
// SIDE EFFECT of registering the "memory" backend with @railback/lib so a
// downstream `db()` call resolves transparently.

import { registerBackend } from "@railback/lib/storage/registry";
import type { Db } from "@railback/lib";

import { InMemoryAdminRepo } from "./admins.js";
import { InMemoryBlobRepo } from "./blobs.js";
import { InMemoryDelayRepo } from "./delays.js";
import { InMemoryMandateRepo } from "./mandates.js";
import { InMemoryRouteTemplateRepo } from "./route-templates.js";
import { InMemorySepaReportRepo } from "./sepa-reports.js";
import { makeState, type MemState } from "./state.js";
import { InMemoryTicketOwnerRepo } from "./ticket-owners.js";
import { InMemoryTicketRepo } from "./tickets.js";
import { InMemoryUserRepo } from "./users.js";

export { clearState, makeState } from "./state.js";
export type { MemState } from "./state.js";
export { seedSegment } from "./delays.js";
export { seedAdmin } from "./admins.js";
export { uploadRawBlob, readBlob, MEMORY_BLOB_BUCKET } from "./blobs.js";

// Most-recent state handed back by the storage registry, so test code that
// only sees `db()` (which hides the closure) can still seed rows.
let _lastState: MemState | null = null;

/** Construct a fresh Db wired against a brand-new MemState. Each call returns
 *  an independent universe — useful for parallel tests. */
export function buildMemoryDb(): Db {
  const inst = new InMemoryDb();
  _lastState = inst.state;
  return inst.db;
}

/** Same as buildMemoryDb() but exposes the underlying state for tests that
 *  need to seed rows directly. */
export class InMemoryDb {
  readonly state: MemState;
  readonly db: Db;

  constructor(state?: MemState) {
    this.state = state ?? makeState();
    _lastState = this.state;
    this.db = {
      users: new InMemoryUserRepo(this.state),
      tickets: new InMemoryTicketRepo(this.state),
      routeTemplates: new InMemoryRouteTemplateRepo(this.state),
      blobs: new InMemoryBlobRepo(this.state),
      mandates: new InMemoryMandateRepo(this.state),
      sepaReports: new InMemorySepaReportRepo(this.state),
      delays: new InMemoryDelayRepo(this.state),
      admins: new InMemoryAdminRepo(this.state),
      ticketOwners: new InMemoryTicketOwnerRepo(this.state),
    };
  }
}

/**
 * The MemState backing the most-recently-built in-memory Db. Tests use
 * this to seed rows that the public Repo API can't write (e.g. admin
 * rows, which are out-of-band-provisioned and have no `create()` method).
 *
 * Returns null if no Db has been built yet in the current process.
 */
export function _activeMemState(): MemState | null {
  return _lastState;
}

// Side-effect: register with the strict-typed registry so `RAILBACK_STORAGE=memory`
// resolves through db() without explicit wiring.
registerBackend("memory", () => buildMemoryDb());
