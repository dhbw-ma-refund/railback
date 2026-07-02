// POST /users/me/tickets/{ticketId}/refund
//
// The big submit endpoint. End-of-wizard call that locks the refund:
//
//   1. Auth + own-ticket lookup (404 if not yours).
//   2. zod-parse refundRequestSchema.
//   3. Load the user row (IBAN/BIC live there, not on the request).
//   4. State guard: only READY or VALIDATING tickets may be submitted.
//      Anything past READY → 409 ERR_CONFLICT. This is the idempotency
//      gate — a second submit on an already-EMAIL_SENDING ticket would
//      double-issue the SEPA mandate, which is unrecoverable.
//   5. validateRefundSubmission — business rules (IBAN/BIC on file,
//      consent literals true, antragsart vs antragsgrund cross-checks,
//      KOSTEN_ALTERNATIVTRANSPORT requires ≥1 beleg).
//   6. computeFee — locks both erwartete_erstattung AND service_fee_betrag.
//      These are IMMUTABLE per CLAUDE.md ("Refund amount is computed once
//      at submit and immutable"). Admin cannot edit them later; only path
//      to change is admin-reject + user-resubmit.
//   7. mandates.issue — new SepaMandate row in DDB (no PDF, electronic
//      consent only — locked 2026-06-17). fee_amount is snapshotted from
//      service_fee_betrag at this point, so a later business-model change
//      to the fee formula does NOT retroactively rewrite already-issued
//      mandates.
//      Vorabankuendigung-Versand wird hier laut CLAUDE.md ausgelöst
//      (≥1 Tag pre-notification ist immer erfüllt weil Admin-Approval
//      Tage später kommt). Implementation lands together with refund-pdf
//      + email-sweeper in phase 5.
//   8. Patch the ticket: copy the form payload onto the row, set the
//      computed amounts, transition ticket_state → EMAIL_SENDING and
//      email_status → SENDING (sweeper-eligible).
//   9. Sync-invoke refund-pdf (dynamic-import shim — see invokeRefundPdf
//      below). No-op until phase 5 lands the module.
//
// PUNT — KOSTEN_ALTERNATIVTRANSPORT: compute-fee needs a belegeSumme but
// the Receipt DTO carries no amount field in v1 (open question, see
// CLAUDE.md "Open / Service-fee + Erstattungsbetrag-Formel"). For this
// PR we accept a `belegeSumme` only if the frontend stuffs it into
// `zusaetzliche_angaben` as plaintext — which we do NOT parse. The
// short-term contract: KOSTEN_ALTERNATIVTRANSPORT submissions return
// 400 ERR_VALIDATION ("belege sum not yet captured"). When phase 5
// lands a beleg-amount field, drop this guard and pass it through to
// computeFee.
//
// Phase 5 hooks in this file:
//   - SES Vorabankuendigung dispatch on mandate.issue
//   - refund-pdf invoke is already wired via invokeRefundPdf below; it
//     no-ops in phase 2.3 because the module is not installed yet.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { computeFee } from "@railback/lib/refund/compute-fee";
import { validateRefundSubmission } from "@railback/lib/refund/validate-submission";
import { refundRequestSchema } from "@railback/lib/schemas/ticket";
import type { RefundRequest } from "@railback/lib/schemas/ticket";
import type { TicketPatch, User } from "@railback/lib";
import { sumDecimals } from "@railback/lib/util/decimal";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

/**
 * Dynamic-import-shim for the refund-pdf Lambda. In phase 2.3 the module
 * does not ship yet — a missing module is treated as a no-op (the ticket
 * stays in EMAIL_SENDING/SENDING and waits for phase 5 to land the
 * renderer). Any error from a present module propagates out so the
 * frontend sees a 5xx.
 *
 * Phase 5 (sync invoke in-process):
 *   - Add @railback/refund-pdf as a workspace dep, export
 *     `renderAndSend({ email, ticketId })`.
 *   - This shim resolves it via the registered specifier below.
 *
 * Phase 6 (RAILBACK_STORAGE=ddb, cross-Lambda AWS Invoke):
 *   - Branch on env and use @aws-sdk/client-lambda InvokeCommand instead.
 */
async function invokeRefundPdf(args: { email: string; ticketId: string }): Promise<void> {
  let mod: { renderAndSend?: (args: { email: string; ticketId: string }) => Promise<void> };
  try {
    // @ts-expect-error — module is not in the workspace yet (phase 5 lands it).
    mod = await import("@railback/refund-pdf");
  } catch {
    // Module not installed — phase 2.3 path. No-op; the email-sweeper
    // is not yet running either, so the ticket simply waits.
    return;
  }
  if (typeof mod.renderAndSend === "function") {
    await mod.renderAndSend(args);
  }
}

function extractTicketId(event: ApiGwEvent): string | undefined {
  const fromParams = event.pathParameters?.["ticketId"];
  if (typeof fromParams === "string" && fromParams.length > 0) return fromParams;
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/users\/me\/tickets\/([^/]+)\/refund$/);
  return m?.[1];
}

/**
 * Robust zero-detection on a decimal-string amount. Accepts "0", "0.0",
 * "0.00", " 0.000 ", etc. Returns false on anything non-zero or unparseable —
 * we'd rather try to issue a mandate than silently waive it.
 */
function isZeroFee(amount: string): boolean {
  const trimmed = amount.trim();
  if (trimmed === "") return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && n === 0;
}

/**
 * Compute delayMinutes for fee-tiering purposes. Preference order:
 *   1. ticket.delayMinutes (set by an earlier /delays call — authoritative).
 *   2. fahrt_tatsaechlich.ankunftszeit_tatsaechlich − fahrt.ankunftszeit_plan, when both
 *      are present (and on the same day — we don't have a date for the
 *      actual arrival except when ankunftsdatum is set, so fall back to
 *      treating it as same-day).
 *   3. 0 (worst-case for the user; only matters for the ZEITKARTE tier
 *      ladder, and ERR_NO_CLAIM falls out of compute-fee for delay < 60).
 */
function deriveDelayMinutes(
  body: RefundRequest,
  ticketDelay: number | undefined,
): number {
  if (typeof ticketDelay === "number" && ticketDelay >= 0) return ticketDelay;
  const actual = body.fahrt_tatsaechlich.ankunftszeit_tatsaechlich;
  const planned = body.fahrt.ankunftszeit_plan;
  if (!actual || !planned) return 0;
  const toMin = (hhmm: string): number | null => {
    const m = hhmm.match(/^(\d{2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
    return h * 60 + mm;
  };
  const a = toMin(actual);
  const p = toMin(planned);
  if (a === null || p === null) return 0;
  // Handle midnight-wrap: if actual is more than 12h before planned, assume
  // it rolled to the next day.
  let diff = a - p;
  if (diff < -12 * 60) diff += 24 * 60;
  return diff > 0 ? diff : 0;
}

export async function handlePostRefund(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);

    const ticketId = extractTicketId(event);
    if (!ticketId) {
      throw new AppError("ERR_VALIDATION", "ticketId path parameter missing");
    }

    const body = readJsonBody(event);
    const parsed = refundRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "refund body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }
    const reqBody = parsed.data;

    const ticket = await db().tickets.get(email, ticketId);
    if (!ticket) {
      throw new AppError("ERR_NOT_FOUND", `ticket ${ticketId} not found`);
    }

    // Idempotency / state guard. Only READY tickets may be submitted. Per
    // API_CONTRACT_USERFORMS.md ERR_CONFLICT (ticket_state !== "READY"):
    // submission is only valid after extraction finishes. VALIDATING is
    // rejected so the wizard cannot land before barcode-uid / extraction
    // fields settle.
    if (ticket.ticket_state !== "READY") {
      throw new AppError(
        "ERR_CONFLICT",
        `ticket already submitted (state=${ticket.ticket_state})`,
        undefined,
        { current_state: ticket.ticket_state },
      );
    }

    const user: User | null = await db().users.getByEmail(email);
    if (!user) {
      throw new AppError("ERR_AUTH_EXPIRED", "user account no longer exists");
    }

    const belege = await db().blobs.listReceipts(email, ticketId);
    const belegeCount = belege.length;

    // Business-rule validation (consent literals, antragsart guards,
    // IBAN/BIC on file, KOSTEN_ALTERNATIVTRANSPORT requires belege).
    validateRefundSubmission({ body: reqBody, user, belegeCount });

    // For KOSTEN_ALTERNATIVTRANSPORT, sum the per-beleg `amount` field
    // (locked 2026-06-24 — every beleg-confirm captures its EUR value,
    // so the backend can derive belegeSumme deterministically without
    // re-prompting at submit time). For other antragsarts belegeSumme
    // stays undefined; computeFee ignores it.
    const belegeSumme = reqBody.antragsart === "KOSTEN_ALTERNATIVTRANSPORT"
      ? sumDecimals(belege.map((b) => b.amount))
      : undefined;

    const delayMinutes = deriveDelayMinutes(reqBody, ticket.delayMinutes);

    const computed = computeFee({
      antragsart: reqBody.antragsart,
      fahrkartenpreis: reqBody.fahrt.fahrkartenpreis,
      delayMinutes,
      ...(belegeSumme !== undefined ? { belegeSumme } : {}),
      ...(reqBody.is_zeitkarte !== undefined
        ? { isZeitkarte: reqBody.is_zeitkarte }
        : {}),
    });

    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    // Zero-fee guard (locked CLAUDE.md 2026-06-20): if the computed
    // service fee is zero, skip the SEPA-mandate path entirely. pain.008
    // rejects zero-amount mandates downstream. service_fee_state = WAIVED
    // is the marker that the SEPA pipeline was bypassed.
    //
    // Robust to "0", "0.0", "0.00", "0.000" representations.
    const isFeeWaived = isZeroFee(computed.service_fee_betrag);
    let serviceFeeState: "WAIVED" | "PENDING" | undefined;

    if (isFeeWaived) {
      serviceFeeState = "WAIVED";
    } else {
      // Non-zero fee → SEPA pipeline runs. State starts at PENDING
      // (DB_SCHEMA.md: "Defaults to PENDING at submit") and advances
      // to DEBITED / REVERSED via sepa-reports later. Setting it
      // explicitly here so consumers (admin UI, frontend) don't have
      // to assume an implicit default.
      serviceFeeState = "PENDING";

      // Idempotent recovery: if a previous /refund call issued a mandate
      // but failed before the ticket patch landed, the next call would
      // re-issue and create a double mandate. Skip the issue when a
      // mandate row already exists for this (email, ticketId).
      const existingMandate = await db().mandates.get(email, ticketId);
      if (!existingMandate) {
        // Issue the SEPA mandate FIRST so that if it fails (e.g. KEK
        // missing), we never transition the ticket into EMAIL_SENDING.
        // Order matters: a half-submitted ticket is worse than a clean ERR.
        const sourceIp = event.requestContext?.http?.sourceIp;
        const userAgent = event.requestContext?.http?.userAgent;
        await db().mandates.issue(email, ticketId, {
          ticketId,
          fee_amount: computed.service_fee_betrag,
          iban_enc: user.iban_enc ?? "",
          bic_enc: user.bic_enc ?? "",
          kontoinhaber_snapshot: `${user.vorname} ${user.nachname}`,
          user_consent_at: now,
          ...(sourceIp !== undefined ? { user_consent_ip: sourceIp } : {}),
          ...(userAgent !== undefined ? { user_consent_user_agent: userAgent } : {}),
          // Phase 5: vorabankuendigung_sent_at set when SES dispatch lands.
          // Per CLAUDE.md, the pre-notification email goes out at mandate-issue
          // time (NOT at pain.008-generation) to keep the ≥1-day window
          // satisfied. Implementation deferred together with SES wiring.
        });
      }
    }

    // Build the ticket patch. Use a conditional-spread pattern so that
    // undefined optionals don't trip exactOptionalPropertyTypes.
    //
    // Note: we deliberately do NOT touch extraction_status here. The
    // contract requires ticket_state=READY at submit, which implies
    // extraction is already DONE (or MANUAL_ROUTE never ran one).
    // Overwriting extraction_status would clobber an in-flight extractor
    // result on the rare TOCTOU window.
    const patch: TicketPatch = {
      ticket_state: "EMAIL_SENDING",
      antragsgrund: reqBody.antragsgrund,
      antragsart: reqBody.antragsart,
      fahrt_abreisedatum: reqBody.fahrt.abreisedatum,
      fahrt_abreisebahnhof: reqBody.fahrt.abreisebahnhof,
      fahrt_zielbahnhof: reqBody.fahrt.zielbahnhof,
      fahrt_abfahrtszeit_plan: reqBody.fahrt.abfahrtszeit_plan,
      fahrt_ankunftszeit_plan: reqBody.fahrt.ankunftszeit_plan,
      fahrt_zugnummer_plan: reqBody.fahrt.zugnummer_plan,
      fahrt_fahrkartennummer: reqBody.fahrt.fahrkartennummer,
      fahrt_fahrkartenpreis: reqBody.fahrt.fahrkartenpreis,
      antragstellung_ort: reqBody.antragstellung_ort,
      antragstellung_datum: today,
      datenschutz_einwilligung: true,
      wahrheitserklaerung: true,
      delayMinutes,
      erwartete_erstattung: computed.erwartete_erstattung,
      service_fee_betrag: computed.service_fee_betrag,
      submitted_at: now,
      email_status: "SENDING",
      email_attempts: 0,
      email_last_attempt: now,
    };
    if (serviceFeeState !== undefined) patch.service_fee_state = serviceFeeState;
    if (reqBody.is_zeitkarte !== undefined) patch.is_zeitkarte = reqBody.is_zeitkarte;
    if (reqBody.fahrt.zugkategorie_plan !== undefined) {
      patch.fahrt_zugkategorie_plan = reqBody.fahrt.zugkategorie_plan;
    }
    if (reqBody.fahrt_tatsaechlich.ankunftsdatum_tatsaechlich != null) {
      patch.tatsaechlich_ankunftsdatum = reqBody.fahrt_tatsaechlich.ankunftsdatum_tatsaechlich;
    }
    if (reqBody.fahrt_tatsaechlich.abfahrtszeit_tatsaechlich != null) {
      patch.tatsaechlich_abfahrtszeit = reqBody.fahrt_tatsaechlich.abfahrtszeit_tatsaechlich;
    }
    if (reqBody.fahrt_tatsaechlich.ankunftszeit_tatsaechlich != null) {
      patch.tatsaechlich_ankunftszeit = reqBody.fahrt_tatsaechlich.ankunftszeit_tatsaechlich;
    }
    if (reqBody.fahrt_tatsaechlich.zugnummer_tatsaechlich != null) {
      patch.tatsaechlich_zugnummer = reqBody.fahrt_tatsaechlich.zugnummer_tatsaechlich;
    }
    if (reqBody.fahrt_tatsaechlich.verpasster_anschluss_bahnhof != null) {
      patch.tatsaechlich_verpasster_anschluss_bahnhof =
        reqBody.fahrt_tatsaechlich.verpasster_anschluss_bahnhof;
    }
    if (reqBody.zusaetzliche_angaben !== undefined) {
      patch.zusaetzliche_angaben = reqBody.zusaetzliche_angaben;
    }

    const updated = await db().tickets.patch(email, ticketId, patch);

    // Sync-invoke refund-pdf so the email can go out inline (CLAUDE.md /
    // IMPLEMENTATION_PLAN.md "MVP: sync"). For local dev with both
    // Lambdas loaded in-process this is a direct function call; the
    // AWS-SDK Invoke variant lands when RAILBACK_STORAGE=ddb (Phase 5).
    //
    // Phase 2.3 reality: the refund-pdf module doesn't ship yet. We
    // dynamic-import behind a try/catch so a missing module is a no-op
    // and the ticket simply sits in EMAIL_SENDING/SENDING until phase 5
    // plugs in the renderer — which is the exact state shape the
    // sweeper will expect. Any throw from the real handler propagates
    // out so the frontend sees a 5xx and the user can retry.
    await invokeRefundPdf({ email, ticketId });

    return okJson(202, {
      ticketId: updated.ticketId,
      ticket_state: "EMAIL_SENDING" as const,
      submitted_at: updated.submitted_at ?? now,
      email_status: updated.email_status ?? "SENDING",
      erwartete_erstattung: computed.erwartete_erstattung,
      service_fee_betrag: computed.service_fee_betrag,
      ...(serviceFeeState !== undefined ? { service_fee_state: serviceFeeState } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
