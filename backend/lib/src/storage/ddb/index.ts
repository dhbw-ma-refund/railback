// Public surface of the DDB backend. Importing this module has the SIDE
// EFFECT of registering the "ddb" backend with the storage registry so a
// downstream `db()` call resolves transparently when RAILBACK_STORAGE=ddb.
//
// Parity with mocks/in-memory/src/index.ts (which does the same for
// "memory"). Before this file existed, buildDdbDb was exported but never
// wired — `RAILBACK_STORAGE=ddb` threw ERR_INTERNAL "no registered backend"
// in production Lambdas even though the adapter was fully built.

import { registerBackend } from "../registry.js";
import { buildDdbDb } from "./stubs.js";

export { buildDdbDb } from "./stubs.js";

// Side-effect: register with the strict-typed registry so `RAILBACK_STORAGE=ddb`
// resolves through db() without explicit wiring. The factory takes no options
// here — buildDdbDb() constructs a default DynamoDBDocumentClient from ambient
// AWS SDK credentials, which is what a running Lambda has.
registerBackend("ddb", () => buildDdbDb());
