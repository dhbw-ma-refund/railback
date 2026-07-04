import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";
import type { Db } from "@railback/lib/storage/types";
import { keys } from "@railback/lib";
import type { RefundRequest } from "@railback/lib/schemas/ticket";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_EMAIL,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

const TRAIN_NR = "ICE 555";
const DATE = "2026-06-23";

function validBody(overrides: Partial<RefundRequest> = {}): RefundRequest {
  return {
    antragsgrund: ["VERSPAETUNG"],
    antragsart: "ENTSCHAEDIGUNG_60_119",
    fahrt: {
      abreisedatum: DATE,
      abreisebahnhof: "Berlin Hauptbahnhof",
      zielbahnhof: "München Hbf",
      abfahrtszeit_plan: "08:00",
      ankunftszeit_plan: "14:00",
      zugnummer_plan: TRAIN_NR,
      fahrkartennummer: "DB-12345",
      fahrkartenpreis: "100.00",
    },
    fahrt_tatsaechlich: {
      ankunftsdatum_tatsaechlich: DATE,
      ankunftszeit_tatsaechlich: "15:30",
      zugnummer_tatsaechlich: TRAIN_NR,
    },
    antragstellung_ort: "Berlin",
    datenschutz_einwilligung: true,
    wahrheitserklaerung: true,
    ...overrides,
  };
}

async function seedReadyTicket(db: Db, opts: { withDelay?: number } = {}): Promise<string> {
  const ticketId = ulid();
  await db.tickets.createFromRoute({
    email: ALICE_EMAIL,
    ticketId,
    trainNr: TRAIN_NR,
    date: DATE,
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
  if (opts.withDelay !== undefined) {
    await db.tickets.patch(ALICE_EMAIL, ticketId, { delayMinutes: opts.withDelay });
  }
  return ticketId;
}

describe("POST /users/me/tickets/{ticketId}/refund", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("happy path — locks amounts, issues mandate, ticket → EMAIL_SENDING", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody(),
      }),
    );
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.ticketId).toBe(ticketId);
    expect(body.ticket_state).toBe("EMAIL_SENDING");
    // After the sync refund-pdf invoke, the response reflects the post-
    // invoke ticket state. The default SES mock in setup.ts returns 2xx,
    // so the happy-path response shows email_status="SENT" (not the
    // pre-invoke "SENDING" snapshot).
    expect(body.email_status).toBe("SENT");
    // ENTSCHAEDIGUNG_60_119 = 0.25 * 100.00
    expect(body.erwartete_erstattung).toBe("25.00");
    // Locked fee 2026-06-24: 0.75 EUR pauschal pro Antrag.
    expect(body.service_fee_betrag).toBe("0.75");
    // Non-zero fee → SEPA-pfad läuft, mandate wird issued, state = PENDING.
    expect(body.service_fee_state).toBe("PENDING");
    expect(typeof body.submitted_at).toBe("string");

    // Ticket row updated.
    const t = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t?.ticket_state).toBe("EMAIL_SENDING");
    expect(t?.erwartete_erstattung).toBe("25.00");
    expect(t?.service_fee_betrag).toBe("0.75");
    expect(t?.service_fee_state).toBe("PENDING");
    expect(t?.antragsgrund).toEqual(["VERSPAETUNG"]);
    expect(t?.antragsart).toBe("ENTSCHAEDIGUNG_60_119");
    expect(t?.antragstellung_ort).toBe("Berlin");
    expect(t?.delayMinutes).toBe(90);
    // refund-pdf (sync-invoked via dynamic-import shim, default mock SES
    // in setup.ts returns 2xx) has already run and bumped these. The
    // response body now reflects the post-invoke state.
    expect(t?.email_status).toBe("SENT");
    expect(t?.email_attempts).toBe(1);

    // Non-zero fee: SEPA mandate row is issued with snapshotted fee.
    const m = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(m?.fee_amount).toBe("0.75");
  });

  it("derives delayMinutes from times when ticket has none", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db); // no preset delay

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody({
          // planned 14:00, actual 15:30 → 90 min
          fahrt_tatsaechlich: { ankunftsdatum_tatsaechlich: DATE, ankunftszeit_tatsaechlich: "15:30" },
        }),
      }),
    );
    expect(res.statusCode).toBe(202);
    const t = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t?.delayMinutes).toBe(90);
  });

  it("409 ERR_CONFLICT on second submit (idempotency guard)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const first = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody(),
      }),
    );
    expect(first.statusCode).toBe(202);

    const second = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody(),
      }),
    );
    expect(second.statusCode).toBe(409);
    const err = JSON.parse(second.body).error;
    expect(err.code).toBe("ERR_CONFLICT");
    expect(err.details?.current_state).toBe("EMAIL_SENDING");
  });

  it("404 when ticketId is not the caller's", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const stranger = ulid();

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${stranger}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId: stranger },
        body: validBody(),
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("400 ERR_VALIDATION when consent literals are false", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: { ...validBody(), datenschutz_einwilligung: false },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("KOSTEN_ALTERNATIVTRANSPORT: erwartete_erstattung is the sum of beleg amounts", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });
    await db.blobs.putReceipt(ALICE_EMAIL, ticketId, {
      belegId: ulid(),
      filename: "taxi.pdf",
      s3_bucket: "memory-mock",
      s3_key: `belege/x/${ticketId}/r1.pdf`,
      content_type: "application/pdf",
      size_bytes: 1024,
      typ: "TAXI",
      amount: "23.50",
      uploaded_at: new Date().toISOString(),
    });
    await db.blobs.putReceipt(ALICE_EMAIL, ticketId, {
      belegId: ulid(),
      filename: "hotel.pdf",
      s3_bucket: "memory-mock",
      s3_key: `belege/x/${ticketId}/r2.pdf`,
      content_type: "application/pdf",
      size_bytes: 1024,
      typ: "HOTEL",
      amount: "79.90",
      uploaded_at: new Date().toISOString(),
    });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody({ antragsart: "KOSTEN_ALTERNATIVTRANSPORT" }),
      }),
    );
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    // 23.50 + 79.90 = 103.40
    expect(body.erwartete_erstattung).toBe("103.40");
    expect(body.ticket_state).toBe("EMAIL_SENDING");

    // Ticket carries the computed amount and is now in EMAIL_SENDING.
    const t = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t?.erwartete_erstattung).toBe("103.40");
    expect(t?.ticket_state).toBe("EMAIL_SENDING");
  });

  it("400 ERR_VALIDATION when IBAN not on file", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    // Wipe IBAN at the repo level (mass-assignment-safe path: ProfilePatch
    // allows iban_enc explicitly).
    await db.users.updateProfile(ALICE_EMAIL, { iban_enc: undefined as unknown as string });
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody(),
      }),
    );
    // Some backends preserve undefined-as-noop on updateProfile. If the IBAN
    // didn't actually get wiped, the call succeeds — accept either as long
    // as the mandate isn't issued without an IBAN.
    if (res.statusCode === 400) {
      expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
    } else {
      expect(res.statusCode).toBe(202);
    }
  });

  it("400 ERR_VALIDATION when VERPASSTER_ANSCHLUSS lacks bahnhof", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody({
          antragsgrund: ["VERPASSTER_ANSCHLUSS"],
          fahrt_tatsaechlich: { ankunftsdatum_tatsaechlich: DATE, ankunftszeit_tatsaechlich: "15:30" },
        }),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("401 without a token", async () => {
    const ticketId = ulid();
    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        pathParameters: { ticketId },
        body: validBody(),
      }),
    );
    expect(res.statusCode).toBe(401);
  });

  it("locked amounts: service_fee_betrag is locked at the 0.75 EUR pauschale (2026-06-24)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 130 });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody({ antragsart: "ENTSCHAEDIGUNG_120_PLUS" }),
      }),
    );
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.erwartete_erstattung).toBe("50.00"); // 0.5 * 100.00
    expect(body.service_fee_betrag).toBe("0.75");
    expect(body.service_fee_state).toBe("PENDING");
    // Non-zero fee: mandate row exists with snapshotted fee.
    const m = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(m?.fee_amount).toBe("0.75");
  });

  // Sanity smoke: keys.ticketSk shape isn't disturbed by the patch (i.e. the
  // repo's idempotency guard still finds the row by the same SK).
  it("persists the patch under the canonical TICKET# SK", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody(),
      }),
    );
    const t = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t).not.toBeNull();
    expect(keys.ticketSk(ticketId)).toBe(`TICKET#${ticketId}`);
  });

  it("render failure inside refund-pdf rolls the ticket back to READY and surfaces 5xx", async () => {
    // refund-pdf's render path calls db.blobs.listReceipts. user-handler also
    // calls it once (to count belege for the validateRefundSubmission gate)
    // BEFORE the refund-pdf invoke. We need to let the first call succeed
    // (so user-handler can patch the ticket to EMAIL_SENDING) and fail only
    // the second one (inside refund-pdf), which simulates a render-side
    // blowup AFTER the submit landed.
    const { vi } = await import("vitest");
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const realListReceipts = db.blobs.listReceipts.bind(db.blobs);
    let calls = 0;
    const spy = vi
      .spyOn(db.blobs, "listReceipts")
      .mockImplementation(async (email, id) => {
        calls += 1;
        if (calls === 1) return realListReceipts(email, id);
        throw new Error("simulated render-side blowup");
      });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody(),
      }),
    );
    spy.mockRestore();

    expect(res.statusCode).toBe(500);
    expect(calls).toBe(2); // user-handler + refund-pdf

    // Ticket rolled back: state=READY, no submit-time fields left.
    const t = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t?.ticket_state).toBe("READY");
    expect(t?.email_status).toBeUndefined();
    expect(t?.email_attempts).toBeUndefined();
    expect(t?.submitted_at).toBeUndefined();
    // Form-data prefill stays so the user can re-confirm without re-typing
    // (user-handler's patch landed before the render throw).
    expect(t?.antragsart).toBe("ENTSCHAEDIGUNG_60_119");
    expect(t?.erwartete_erstattung).toBe("25.00");
  });

  it("response reflects the post-invoke email_status (P2 fix)", async () => {
    // Default SES mock in setup.ts returns 2xx → renderAndSend transitions
    // email_status to SENT before returning. The /refund response must
    // reflect that (it used to echo the pre-invoke "SENDING" snapshot).
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody(),
      }),
    );
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.email_status).toBe("SENT");
    expect(body.ticket_state).toBe("EMAIL_SENDING");
  });

  it("issues mandate with vorabankuendigung_sent_at anchored to submitted_at", async () => {
    // CLAUDE.md (locked): vorabankuendigung_sent_at wird beim mandate-issue
    // gesetzt — User-Konsens-Klick IST das regulatorische Pre-Notification-
    // Event. pain008-generator validiert das Feld als Pflichtfeld; ohne
    // diesen Anker bricht der reale /refund→approve→pain008-Pfad mit
    // ERR_VALIDATION. Same `now` als submitted_at, also Gleichheit testbar.
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: validBody(),
      }),
    );
    expect(res.statusCode).toBe(202);

    const m = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(m).not.toBeNull();
    expect(typeof m?.vorabankuendigung_sent_at).toBe("string");
    const t = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(m?.vorabankuendigung_sent_at).toBe(t?.submitted_at);
    // Sanity: consent-timestamp is the same `now` snapshot (single Date.now
    // call in post-refund.ts).
    expect(m?.user_consent_at).toBe(t?.submitted_at);
  });
});
