// DDB backend wiring. Instantiates DdbBackend from @railback/db/adapter and
// wraps it in an adapter-boundary that translates AdapterError / ConflictError
// / NotImplementedError → AppError. This is the file the Phase 4 factory
// bootstrap will register.
//
// Historically this file held Phase-5 stubs (every method threw
// AppError("ERR_INTERNAL", "DDB backend deferred to Phase 5")). Those are
// gone: the adapter itself throws NotImplementedError for unfilled methods,
// and we translate at this boundary. Filled methods flow through unchanged.

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import {
  AdapterError,
  DdbBackend,
  NotImplementedError,
} from "@railback/db/adapter";

import { AppError } from "../../errors/index.js";
import type {
  AdminRepo,
  BlobRepo,
  Db,
  DelayRepo,
  MandateRepo,
  RouteTemplateRepo,
  SepaReportRepo,
  TicketOwnerRepo,
  TicketRepo,
  UserRepo,
} from "../types.js";

// -----------------------------------------------------------------------------
// Adapter-boundary error translation.
//
// The adapter package (@railback/db) is intentionally free of any dependency
// on @railback/lib — that avoids a cyclic dep with the DTO re-export chain.
// It throws AdapterError (with typed `code`), which we translate to AppError
// here, one place. Every wrapped method is on this layer.
// -----------------------------------------------------------------------------

function translateAdapterError(err: unknown): never {
  if (err instanceof NotImplementedError) {
    throw new AppError("ERR_INTERNAL", err.message);
  }
  if (err instanceof AdapterError) {
    // AdapterError code names map 1:1 onto AppError codes we care about.
    if (err.code === "ERR_CONFLICT") {
      throw new AppError("ERR_CONFLICT", err.message);
    }
    if (err.code === "ERR_NOT_FOUND") {
      throw new AppError("ERR_NOT_FOUND", err.message);
    }
    throw new AppError("ERR_INTERNAL", err.message);
  }
  throw err;
}

function wrap<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const val = Reflect.get(obj, prop, receiver);
      if (typeof val !== "function") return val;
      return (...args: unknown[]) => {
        try {
          const result = (val as (...a: unknown[]) => unknown).apply(obj, args);
          if (result instanceof Promise) {
            return result.catch(translateAdapterError);
          }
          return result;
        } catch (err) {
          translateAdapterError(err);
        }
      };
    },
  });
}

// -----------------------------------------------------------------------------
// buildDdbDb — instantiates DdbBackend, wraps every repo in the boundary layer.
// -----------------------------------------------------------------------------

export function buildDdbDb(opts?: { ddb?: DynamoDBDocumentClient }): Db {
  // The two workspace packages resolve @aws-sdk/lib-dynamodb from their own
  // node_modules trees when npm chooses not to hoist. That's fine at runtime
  // (both re-export the same class) but tsc sees two nominally distinct
  // types. Cast at the boundary — the adapter uses the client structurally.
  const backend = new DdbBackend(opts?.ddb as never);
  // Phase 3c: the adapter's BlobRepo now owns the full S3 path (bytes +
  // presign + delete-cascade) via its S3BlobConnector, which self-configures
  // from RAILBACK_S3_BUCKET / RAILBACK_S3_REGION / S3_ENDPOINT_URL. We route
  // blobs through it and retire the backend-local S3BlobRepo(Stub).
  return {
    users: wrap(backend.users) as UserRepo,
    tickets: wrap(backend.tickets) as TicketRepo,
    routeTemplates: wrap(backend.routeTemplates) as RouteTemplateRepo,
    blobs: wrap(backend.blobs) as BlobRepo,
    mandates: wrap(backend.mandates) as MandateRepo,
    sepaReports: wrap(backend.sepaReports) as SepaReportRepo,
    delays: wrap(backend.delays) as DelayRepo,
    admins: wrap(backend.admins) as AdminRepo,
    ticketOwners: wrap(backend.ticketOwners) as TicketOwnerRepo,
  };
}
