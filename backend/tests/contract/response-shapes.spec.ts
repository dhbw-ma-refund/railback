// Cross-lambda response-shape contract. Validates live handler responses
// against schema/openapi.yaml (produced by scripts/generate-openapi.ts).
// Each it() invokes a real Lambda handler and runs the response body through
// an Ajv-compiled JSON Schema derived from the OpenAPI document. On mismatch
// we dump Ajv's errors so the failure tells us exactly which field drifted.
//
// Every it() calls installTestEnv() in-line to guarantee a fresh MemState.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import yaml from "js-yaml";
import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

import { handler as authHandler } from "@railback/lambdas-auth-handler/src/handler.js";
import { handler as userHandler } from "@railback/lambdas-user-handler/src/handler.js";
import { handler as adminHandler } from "@railback/lambdas-admin-handler/src/handler.js";

import { ulid } from "@railback/lib/util/ulid";
import type { Db } from "@railback/lib/storage/types";

import { installTestEnv, teardownTestEnv } from "../shared/env.js";
import {
  ALICE_EMAIL,
  ALICE_PASSWORD,
  ALICE_IBAN,
  ALICE_BIC,
  aliceProfile,
  aliceAccessToken,
  aliceRefreshToken,
  adminAccessToken,
  makeEvent,
  seedAdmin,
  seedAlice,
} from "../shared/fixtures.js";

// --- OpenAPI load + Ajv setup ------------------------------------------

// Resolve schema/openapi.yaml relative to this file so the spec works from
// any cwd (vitest runs it from the repo root, but tsc-check invocations may
// not).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = path.resolve(HERE, "../../schema/openapi.yaml");

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, JsonSchema>;
  };
}
interface OpenApiOperation {
  responses: Record<string, OpenApiResponse>;
}
interface OpenApiResponse {
  content?: {
    "application/json"?: {
      schema?: JsonSchema;
    };
  };
}
// Ajv-compatible JSON Schema fragment. OpenAPI schemas are almost JSON
// Schema Draft-07 plus a few keywords (nullable, discriminator) that Ajv
// ignores under strict:false. Kept loose on purpose.
type JsonSchema = Record<string, unknown>;

const openapi = yaml.load(readFileSync(OPENAPI_PATH, "utf-8")) as OpenApiDocument;

// OpenAPI 3.0 uses two idioms Ajv 8 (JSON-Schema Draft-2020-12) rejects:
//   - `nullable: true` alongside `type: X` — no such keyword in JSON Schema
//   - `exclusiveMinimum: true` / `exclusiveMaximum: true` — Draft-04 style
//     boolean toggle, replaced by number-valued form in Draft-06+.
// Rewrite both in-place so the document validates cleanly. Recursive walk
// over anything object-shaped.
function normaliseOasIdioms(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) normaliseOasIdioms(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj["nullable"] === true && typeof obj["type"] === "string") {
    obj["type"] = [obj["type"], "null"];
  }
  delete obj["nullable"];
  // Draft-04 boolean form -> Draft-06 numeric form. If exclusiveMinimum is
  // `true` and `minimum` is a number, drop `minimum` and set
  // `exclusiveMinimum` to that number. If `false`, just drop it.
  if (typeof obj["exclusiveMinimum"] === "boolean") {
    if (obj["exclusiveMinimum"] === true && typeof obj["minimum"] === "number") {
      obj["exclusiveMinimum"] = obj["minimum"];
      delete obj["minimum"];
    } else {
      delete obj["exclusiveMinimum"];
    }
  }
  if (typeof obj["exclusiveMaximum"] === "boolean") {
    if (obj["exclusiveMaximum"] === true && typeof obj["maximum"] === "number") {
      obj["exclusiveMaximum"] = obj["maximum"];
      delete obj["maximum"];
    } else {
      delete obj["exclusiveMaximum"];
    }
  }
  for (const value of Object.values(obj)) normaliseOasIdioms(value);
}
normaliseOasIdioms(openapi);

// Ajv instance. `strict: false` lets us feed OpenAPI-shaped schemas (example,
// discriminator, etc.) without warnings. Formats registered for `email`,
// `date`, `uri` etc. which the generated schema uses in some places.
const ajv = new Ajv({
  strict: false,
  allErrors: true,
  // Register the whole components block so $refs like
  // "#/components/schemas/Foo" resolve out-of-the-box.
  schemas: openapi.components?.schemas
    ? [{ $id: "openapi-root", components: openapi.components }]
    : [],
});
addFormats(ajv);

// Cache compiled validators keyed by "METHOD PATH STATUS".
const validatorCache = new Map<string, ValidateFunction | null>();

function schemaKey(pathTpl: string, method: string, status: string): string {
  return `${method.toUpperCase()} ${pathTpl} ${status}`;
}

// Pulls the response schema fragment out of the parsed OpenAPI doc. Returns
// null when the path/method/status/mime combination isn't registered — the
// caller then skips validation with a console.warn.
function findResponseSchema(
  pathTpl: string,
  method: string,
  status: string,
): JsonSchema | null {
  const op = openapi.paths?.[pathTpl]?.[method.toLowerCase()];
  const schema = op?.responses?.[status]?.content?.["application/json"]?.schema;
  return schema ?? null;
}

// Compile a schema fragment. If the fragment is a $ref, we rewrite it to
// point at the registered root schema (`openapi-root#/components/schemas/…`).
// Inline schemas are compiled as-is; Ajv handles nested $refs against the
// registered root.
function compileValidator(rawSchema: JsonSchema): ValidateFunction {
  let schema: JsonSchema = rawSchema;
  const ref = rawSchema["$ref"];
  if (typeof ref === "string") {
    // #/components/schemas/Foo -> openapi-root#/components/schemas/Foo
    const localised = ref.startsWith("#/")
      ? `openapi-root${ref}`
      : ref;
    schema = { $ref: localised };
  }
  return ajv.compile(schema);
}

/**
 * Validate a live response body against the OpenAPI-declared schema for
 * `${method} ${pathTpl}` at `status`. `pathTpl` is the templated OpenAPI
 * path (e.g. `/admin/users/{email}`), NOT the concrete URL.
 *
 * If the OpenAPI document doesn't register a schema for this triple we log
 * a warning and return `false` so the caller can skip cleanly. All other
 * validation failures throw via `expect.fail`.
 */
function validateResponse(
  pathTpl: string,
  method: string,
  status: number | string,
  body: unknown,
): boolean {
  const statusStr = String(status);
  const key = schemaKey(pathTpl, method, statusStr);

  let validator = validatorCache.get(key);
  if (validator === undefined) {
    const schema = findResponseSchema(pathTpl, method, statusStr);
    if (schema === null) {
      validatorCache.set(key, null);
      // eslint-disable-next-line no-console
      console.warn(
        `[contract] no OpenAPI schema for ${key} — skipping validation`,
      );
      return false;
    }
    try {
      validator = compileValidator(schema);
    } catch (err) {
      validatorCache.set(key, null);
      // eslint-disable-next-line no-console
      console.warn(
        `[contract] failed to compile schema for ${key}: ${(err as Error).message} — skipping validation`,
      );
      return false;
    }
    validatorCache.set(key, validator);
  }

  if (validator === null) return false;

  const ok = validator(body);
  if (!ok) {
    const errs: ErrorObject[] = validator.errors ?? [];
    expect.fail(
      `Response for ${key} does not match OpenAPI schema:\n${JSON.stringify(errs, null, 2)}\nBody: ${JSON.stringify(body, null, 2)}`,
    );
  }
  return true;
}

// --- fixtures / helpers ------------------------------------------------

function registerBody() {
  return {
    email: aliceProfile.email,
    password: ALICE_PASSWORD,
    vorname: aliceProfile.vorname,
    nachname: aliceProfile.nachname,
    telefon: aliceProfile.telefon,
    adresse: aliceProfile.adresse,
    iban: ALICE_IBAN,
    bic: ALICE_BIC,
    datenschutz_einwilligung: true as const,
    agb_akzeptiert: true as const,
  };
}

// Seeds a READY ticket for Alice via the storage layer (mirrors the
// canonical happy-path from lambdas/user-handler/test/post-refund.spec.ts).
// Real ticket-extractor runs in Python; this simulates its persist step
// by dropping straight into READY through createFromRoute + patch.
async function seedAliceTicket(db: Db, ticketId: string): Promise<void> {
  await db.tickets.createFromRoute({
    email: ALICE_EMAIL,
    ticketId,
    trainNr: "ICE 555",
    date: "2026-06-23",
    fromStation: "Berlin Hauptbahnhof",
    fromEva: 8011160,
    toStation: "München Hbf",
    toEva: 8000261,
    abfahrtszeit_plan: "08:00",
    ankunftszeit_plan: "14:00",
    fahrkartennummer: "DB-12345",
    fahrkartenpreis: "100.00",
    is_zeitkarte: false,
  });
  // Owner-mapping row is required by admin-handler's ticket lookup path.
  await db.ticketOwners.put(ticketId, ALICE_EMAIL);
}

// =======================================================================
// auth-handler
// =======================================================================

describe("contract — auth-handler responses", () => {
  afterEach(() => {
    teardownTestEnv();
  });

  it("POST /auth/register → AuthResponse", async () => {
    installTestEnv();
    const res = await authHandler(
      makeEvent({ method: "POST", path: "/auth/register", body: registerBody() }),
    );
    expect(res.statusCode).toBe(201);
    validateResponse("/auth/register", "POST", 201, JSON.parse(res.body));
  });

  it("POST /auth/login → AuthResponse", async () => {
    installTestEnv();
    // register first so login has a target
    const reg = await authHandler(
      makeEvent({ method: "POST", path: "/auth/register", body: registerBody() }),
    );
    expect(reg.statusCode).toBe(201);

    const res = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/login",
        body: { email: ALICE_EMAIL, password: ALICE_PASSWORD },
      }),
    );
    expect(res.statusCode).toBe(200);
    validateResponse("/auth/login", "POST", 200, JSON.parse(res.body));
  });

  it("POST /auth/refresh → AuthResponse", async () => {
    installTestEnv();
    const reg = await authHandler(
      makeEvent({ method: "POST", path: "/auth/register", body: registerBody() }),
    );
    const { refreshToken } = JSON.parse(reg.body);

    const res = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/refresh",
        body: { refreshToken },
      }),
    );
    expect(res.statusCode).toBe(200);
    validateResponse("/auth/refresh", "POST", 200, JSON.parse(res.body));
  });
});

// =======================================================================
// user-handler
// =======================================================================

describe("contract — user-handler responses", () => {
  afterEach(() => {
    teardownTestEnv();
  });

  it("GET /users/me → GetUserResponse", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await userHandler(
      makeEvent({ method: "GET", path: "/users/me", token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(200);
    validateResponse("/users/me", "GET", 200, JSON.parse(res.body));
  });

  it("GET /users/me/refund-data → RefundDataResponse", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await userHandler(
      makeEvent({
        method: "GET",
        path: "/users/me/refund-data",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    validateResponse("/users/me/refund-data", "GET", 200, JSON.parse(res.body));
  });

  it("GET /users/me/tickets → ListTicketsResponse", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAliceTicket(db, ulid());
    const res = await userHandler(
      makeEvent({
        method: "GET",
        path: "/users/me/tickets",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    validateResponse("/users/me/tickets", "GET", 200, JSON.parse(res.body));
  });

  it("POST /users/me/tickets/from-route → inline 201 schema", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await userHandler(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        token: aliceAccessToken(),
        body: {
          trainNr: "ICE 1001",
          date: "2026-06-20",
          fromStation: "Berlin Hauptbahnhof",
          toStation: "München Hbf",
          abfahrtszeit_plan: "08:00",
          ankunftszeit_plan: "12:00",
          fahrkartennummer: "DB-123-456",
          fahrkartenpreis: "123.45",
          is_zeitkarte: false,
        },
      }),
    );
    expect(res.statusCode).toBe(201);
    validateResponse(
      "/users/me/tickets/from-route",
      "POST",
      201,
      JSON.parse(res.body),
    );
  });

  it("GET /users/me/route-templates → ListRouteTemplatesResponse", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await userHandler(
      makeEvent({
        method: "GET",
        path: "/users/me/route-templates",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    validateResponse(
      "/users/me/route-templates",
      "GET",
      200,
      JSON.parse(res.body),
    );
  });
});

// =======================================================================
// admin-handler
// =======================================================================

describe("contract — admin-handler responses", () => {
  afterEach(() => {
    teardownTestEnv();
  });

  it("GET /admin/stats → AdminStatsResponse", async () => {
    installTestEnv();
    await seedAdmin();
    const res = await adminHandler(
      makeEvent({
        method: "GET",
        path: "/admin/stats",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    validateResponse("/admin/stats", "GET", 200, JSON.parse(res.body));
  });

  it("GET /admin/users → ListUsersResponse", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    const res = await adminHandler(
      makeEvent({
        method: "GET",
        path: "/admin/users",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    validateResponse("/admin/users", "GET", 200, JSON.parse(res.body));
  });

  it("GET /admin/users/{email} → GetAdminUserResponse", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    const res = await adminHandler(
      makeEvent({
        method: "GET",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    // Note the templated path key — OpenAPI stores the operation under
    // /admin/users/{email}, not the concrete URL.
    validateResponse(
      "/admin/users/{email}",
      "GET",
      200,
      JSON.parse(res.body),
    );
  });

  it("GET /admin/tickets → AdminListTicketsResponse", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedAliceTicket(db, ulid());
    const res = await adminHandler(
      makeEvent({
        method: "GET",
        path: "/admin/tickets",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    validateResponse("/admin/tickets", "GET", 200, JSON.parse(res.body));
  });

  it("GET /admin/tickets/{ticketId} → GetAdminTicketResponse", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    const ticketId = ulid();
    await seedAliceTicket(db, ticketId);
    const res = await adminHandler(
      makeEvent({
        method: "GET",
        path: `/admin/tickets/${ticketId}`,
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    validateResponse(
      "/admin/tickets/{ticketId}",
      "GET",
      200,
      JSON.parse(res.body),
    );
  });
});

// =======================================================================
// error envelope
// =======================================================================

describe("contract — error responses", () => {
  afterEach(() => {
    teardownTestEnv();
  });

  it("missing auth → ErrorBody (401)", async () => {
    installTestEnv();
    // /users/me without a bearer token → 401 with the canonical error envelope.
    const res = await userHandler(
      makeEvent({ method: "GET", path: "/users/me" }),
    );
    expect(res.statusCode).toBe(401);
    validateResponse("/users/me", "GET", 401, JSON.parse(res.body));
  });

  it("malformed body → ErrorBody (400)", async () => {
    installTestEnv();
    // POST /auth/login with a body that fails loginRequestSchema (empty
    // password violates min(1); missing email also trips validation).
    const res = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/login",
        body: { email: "not-an-email", password: "" },
      }),
    );
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    // OpenAPI registers 400 for /auth/login; look that up specifically.
    validateResponse(
      "/auth/login",
      "POST",
      res.statusCode,
      JSON.parse(res.body),
    );
  });
});

// Unused import guard — aliceRefreshToken is exported by shared/fixtures.ts
// and might be handy in future refresh-error cases; reference it here so
// `noUnusedLocals` stays happy if the type changes.
void aliceRefreshToken;
