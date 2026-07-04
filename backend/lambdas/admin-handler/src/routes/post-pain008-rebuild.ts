// POST /admin/tickets/{ticketId}/pain008-rebuild
// - ADMIN-only. Empty body.
// - Operator retry path when patch-ticket's * → APPROVED invoke threw
//   (transient S3 throttle, missing SEPA env, IBAN-decrypt fail, etc.).
//   The ticket already landed in APPROVED but the mandate has no
//   pain008_built_at and `isTicketTransitionAllowed` rejects
//   APPROVED→APPROVED, so re-PATCHing won't trigger a rebuild.
//
// Guards (all must hold before invoke):
//   1. ticket_state === "APPROVED" — can't pre-build before approval.
//   2. mandate row exists — zero-fee waiver path has no mandate.
//   3. mandate.pain008_built_at NOT already set — no double-build; admin
//      should look at the existing pain008_s3_key instead.
//
// Idempotency: enforced by the pre-checks above plus the existing
// `stampPain008Built` conditional inside pain008-generator (which throws
// ERR_VALIDATION on re-stamp). A successful call returns the freshly-built
// pain008_* fields; a second call returns 409 ERR_CONFLICT with the same
// fields in details.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";
import { pain008RebuildRequestSchema } from "@railback/lib/schemas/admin";
import { emailHash as hashEmailForLog } from "@railback/lib/util/hash";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";
import { invokePain008Generator } from "../pain008-invoke.js";

function extractTicketId(event: ApiGwEvent): string {
  const fromParams = event.pathParameters?.["ticketId"];
  if (typeof fromParams === "string" && fromParams.length > 0) return decodeURIComponent(fromParams);
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/admin\/tickets\/([^/]+)\/pain008-rebuild$/);
  if (!m || !m[1]) {
    throw new AppError("ERR_VALIDATION", "ticketId path parameter is missing");
  }
  return decodeURIComponent(m[1]);
}

export async function handlePain008Rebuild(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);
    const ticketId = extractTicketId(event);

    // Empty-body strict validation — mirrors mark-submitted. A body with
    // any field is a client bug (this endpoint has no inputs beyond the
    // path param + admin identity) and should surface ERR_VALIDATION,
    // not silently ignore. Locked 2026-07-01 per audit finding
    // `pain008-rebuild-body-unvalidated`.
    const raw = readJsonBody(event) ?? {};
    const parsedBody = pain008RebuildRequestSchema.safeParse(raw);
    if (!parsedBody.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "pain008-rebuild expects an empty body",
        undefined,
        { issues: parsedBody.error.issues },
      );
    }

    const owner = await db().ticketOwners.get(ticketId);
    if (!owner) {
      throw new AppError("ERR_NOT_FOUND", `ticket ${ticketId} not found`);
    }
    const ticket = await db().tickets.get(owner.email, ticketId);
    if (!ticket) {
      throw new AppError("ERR_NOT_FOUND", `ticket ${ticketId} not found`);
    }

    if (ticket.ticket_state !== "APPROVED") {
      throw new AppError(
        "ERR_CONFLICT",
        "pain008 rebuild only allowed when ticket_state is APPROVED",
        undefined,
        { from: ticket.ticket_state },
      );
    }

    const mandate = await db().mandates.get(owner.email, ticketId);
    if (!mandate) {
      throw new AppError("ERR_NOT_FOUND", `mandate for ticket ${ticketId} not found`);
    }

    if (mandate.pain008_built_at) {
      // Already built — admin should reuse the existing batch; double-build
      // would orphan the prior XML and confuse SEPA-audit reconciliation.
      const details: Record<string, unknown> = {
        pain008_built_at: mandate.pain008_built_at,
      };
      if (mandate.pain008_batch_id) details["pain008_batch_id"] = mandate.pain008_batch_id;
      if (mandate.pain008_s3_key) details["pain008_s3_key"] = mandate.pain008_s3_key;
      throw new AppError(
        "ERR_CONFLICT",
        "pain008 already built for this mandate",
        undefined,
        details,
      );
    }

    try {
      await invokePain008Generator({ email: owner.email, ticketId });
    } catch (err) {
      // Same PII-leakage guard as patch-ticket: pain008 validation errors
      // can carry `details.field` values like "debtorIbanPlain"; surface an
      // opaque ERR_INTERNAL and log the real reason server-side.
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof AppError ? err.code : "ERR_UNKNOWN";
      const field = err instanceof AppError ? err.details?.["field"] : undefined;
      log.error("pain008-generator.rebuild.failed", {
        ticketId,
        emailHash: hashEmailForLog(owner.email),
        code,
        field,
        message,
      });
      if (err instanceof AppError && err.code === "ERR_VALIDATION") {
        throw new AppError(
          "ERR_INTERNAL",
          "pain008-build failed; an operator will follow up",
        );
      }
      throw err;
    }

    const rebuilt = await db().mandates.get(owner.email, ticketId);
    if (!rebuilt || !rebuilt.pain008_built_at) {
      // Defensive: the generator returned without throwing but didn't stamp.
      // Treat as 500 — something silently mis-fired.
      throw new AppError(
        "ERR_INTERNAL",
        "pain008 invoke returned but mandate was not stamped",
      );
    }

    return okJson(200, {
      ticketId,
      mandate_id: rebuilt.mandate_id,
      pain008_batch_id: rebuilt.pain008_batch_id,
      pain008_built_at: rebuilt.pain008_built_at,
      pain008_s3_key: rebuilt.pain008_s3_key,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
