// Cross-lambda upload → extraction → refund flow spec.
//
// Exercises the full path from a fresh ticketId through the presigned-POST
// upload handshake, the (out-of-process) Python ticket-extractor's persist
// step (simulated via db.tickets.patch), and the final POST /refund which
// sync-invokes refund-pdf → SES.
//
// Also covers:
//   - the alternative from-route entry point that skips /upload entirely,
//     and
//   - a race case where the extractor completes before /upload-confirm
//     lands (the RAW# sibling row is not on the extractor's critical path).
//
// Every it() calls installTestEnv() in-line for a fresh MemState so cases
// don't leak. The default SES mock in shared/env.ts returns 2xx, so the
// happy path lands email_status=SENT.

import { afterEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";
import type { RefundRequest } from "@railback/lib/schemas/ticket";

import { handler as userHandler } from "@railback/lambdas-user-handler/src/handler.js";

import { installTestEnv, teardownTestEnv } from "../shared/env.js";
import {
  ALICE_EMAIL,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "../shared/fixtures.js";

const TRAIN_NR = "ICE 555";
const DATE = "2026-06-23";
const FROM_STATION = "Berlin Hauptbahnhof";
const TO_STATION = "München Hbf";

// Mirrors user-handler/test/post-refund.spec.ts::validBody. 14:00 planned →
// 15:30 actual = 90 min delay → antragsart=ENTSCHAEDIGUNG_60_119 → 25% * 100.
function refundBody(overrides: Partial<RefundRequest> = {}): RefundRequest {
  return {
    antragsgrund: ["VERSPAETUNG"],
    antragsart: "ENTSCHAEDIGUNG_60_119",
    fahrt: {
      abreisedatum: DATE,
      abreisebahnhof: FROM_STATION,
      zielbahnhof: TO_STATION,
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

describe("flow — upload → extraction → refund", () => {
  afterEach(() => {
    teardownTestEnv();
  });

  it("A. presigned upload path with simulated extractor → refund lands", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();

    // 1. POST /upload — presign issued, TicketOwner + UserTicket land.
    const uploadRes = await userHandler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
      }),
    );
    expect(uploadRes.statusCode).toBe(200);
    const upload = JSON.parse(uploadRes.body);
    expect(upload.ticketId).toBe(ticketId);
    expect(typeof upload.s3_key).toBe("string");
    expect(typeof upload.uploadUrl).toBe("string");
    // 2026-06-18 lock: presigned POST, not PUT. POST-policies can enforce
    // content-length-range server-side; PUT-signatures can't. If the
    // handler ever regressed to a presigned PUT `fields` would be absent
    // (PUT returns headers instead) and this shape assertion would fail.
    expect(upload.fields).toBeDefined();
    expect(typeof upload.fields).toBe("object");
    // Mock mirrors the S3 v4 POST policy shape via `x-amz-content-length-range-max`.
    // 10 MB cap for raw uploads (CLAUDE.md "Belege cap. Max 5 per ticket, 5 MB
    // pro Beleg." — raw upload cap is 10 MB, belege is 5 MB).
    expect(upload.fields["x-amz-content-length-range-max"]).toBe("10485760");
    expect(upload.fields["x-amz-content-length-range-min"]).toBe("1");

    // TicketOwner + UserTicket exist per the 2026-06-24 lock (rows before
    // presign so the extractor's reverse-lookup can't race the S3 event).
    const owner = await db.ticketOwners.get(ticketId);
    expect(owner?.email).toBe(ALICE_EMAIL);
    const preExtract = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(preExtract).not.toBeNull();
    expect(preExtract?.ticket_state).toBe("VALIDATING");

    // 2. POST /upload-confirm — RAW# sibling row lands.
    const confirmRes = await userHandler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: {
          s3_key: upload.s3_key,
          filename: "ticket.pdf",
          mimeType: "application/pdf",
        },
      }),
    );
    expect(confirmRes.statusCode).toBe(202);
    const raw = await db.blobs.getRawUpload(ALICE_EMAIL, ticketId);
    expect(raw).not.toBeNull();
    expect(raw?.s3_key).toBe(upload.s3_key);

    // 3. Simulate the Python ticket-extractor persist step.
    //
    // KNOWN LIMITATION — Phase 4 test harness.
    // ------------------------------------------------------------------
    // The production ticket-extractor is a Python Lambda: it boots an
    // S3 ObjectCreated event on the `raw/` prefix, decodes the Aztec 2D
    // barcode (`zxing-cpp`), parses the UIC 918.3 payload (`onlineticket.py`),
    // falls back to PDF text mining (`pymupdf`) when no barcode is present,
    // and then writes the extraction result back to the `UserTicket` row.
    // Codex's Phase 4 plan called for driving that end-to-end from vitest
    // ("S3 ObjectCreated → ticket-extractor in-process → real Aztec fixture
    // → PDF snapshot"), but the Python runtime cannot be booted in-process
    // from a Node vitest worker — bridging would need a subprocess spawn
    // per case plus a Python virtualenv on every dev + CI machine, which
    // outweighs the coverage delta.
    //
    // Instead the extractor's own suite (lambdas/ticket-extractor/test/)
    // exercises Aztec parse + UIC 918.3 decode + PDF-text cascade + the
    // DDB persist path with 154 tests (128 landing + 26 fix-up). Here we
    // stand in for the extractor by directly patching the row the way the
    // Python persist step would (ticket_state=READY, extraction_method=
    // BARCODE, fahrt_* fields the /refund path reads back for computeFee).
    // Documented in PROGRESS.md alongside the rest of the Phase 4 gaps.
    await db.tickets.patch(ALICE_EMAIL, ticketId, {
      ticket_state: "READY",
      extraction_status: "DONE",
      extraction_method: "BARCODE",
      extraction_confidence: 1.0,
      barcode_uid: "TEST-BARCODE-UID",
      fahrt_zugnummer_plan: TRAIN_NR,
      fahrt_abreisedatum: DATE,
      fahrt_abreisebahnhof: FROM_STATION,
      fahrt_zielbahnhof: TO_STATION,
      fahrt_abfahrtszeit_plan: "08:00",
      fahrt_ankunftszeit_plan: "14:00",
      fahrt_fahrkartennummer: "DB-12345",
      fahrt_fahrkartenpreis: "100.00",
    });

    // 4. GET /users/me/tickets/{id} → READY + extraction fields visible.
    const getRes = await userHandler(
      makeEvent({
        method: "GET",
        path: `/users/me/tickets/${ticketId}`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
      }),
    );
    expect(getRes.statusCode).toBe(200);
    const view = JSON.parse(getRes.body);
    expect(view.ticket_state).toBe("READY");
    expect(view.extraction_method).toBe("BARCODE");
    expect(view.extraction_confidence).toBe(1.0);
    expect(view.barcode_uid).toBe("TEST-BARCODE-UID");
    expect(view.fahrt_zugnummer_plan).toBe(TRAIN_NR);
    expect(view.fahrt_fahrkartenpreis).toBe("100.00");

    // 5. POST /refund — sync-invokes refund-pdf; default SES mock 2xx →
    // ticket lands EMAIL_SENDING with email_status=SENT.
    const refundRes = await userHandler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: refundBody(),
      }),
    );
    expect(refundRes.statusCode).toBe(202);
    const refund = JSON.parse(refundRes.body);
    expect(refund.ticket_state).toBe("EMAIL_SENDING");
    expect(refund.erwartete_erstattung).toBe("25.00");
    expect(refund.service_fee_betrag).toBe("0.75");
    expect(refund.email_status).toBe("SENT");
    expect(typeof refund.submitted_at).toBe("string");

    // 6. SepaMandate row is issued with the snapshotted fee and its
    // vorabankuendigung_sent_at anchored (mandate-issue = pre-notification).
    const mandate = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(mandate).not.toBeNull();
    expect(mandate?.fee_amount).toBe("0.75");
    expect(typeof mandate?.vorabankuendigung_sent_at).toBe("string");

    // 7. Rendered PDF metadata + bytes exist in S3-mock.
    const rendered = await db.blobs.getRenderedPdf(ALICE_EMAIL, ticketId);
    expect(rendered).not.toBeNull();
    const bytes = await db.blobs.getBytes(rendered!.s3_key);
    expect(bytes).not.toBeNull();
    expect(bytes!.bytes.byteLength).toBeGreaterThan(0);

    // 8. Ticket email_status reflects the post-invoke SES 2xx result.
    const finalTicket = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(finalTicket?.email_status).toBe("SENT");
  });

  it("B. from-route path (no upload) → refund lands", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    // 1. POST /from-route — creates a ticket directly in READY with
    // extraction_method=MANUAL_ROUTE, no /upload / /upload-confirm.
    const fromRouteRes = await userHandler(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        token: aliceAccessToken(),
        body: {
          fromStation: FROM_STATION,
          toStation: TO_STATION,
          trainNr: TRAIN_NR,
          date: DATE,
          abfahrtszeit_plan: "08:00",
          ankunftszeit_plan: "14:00",
          fahrkartennummer: "DB-12345",
          fahrkartenpreis: "100.00",
        },
      }),
    );
    expect(fromRouteRes.statusCode).toBe(201);
    const created = JSON.parse(fromRouteRes.body);
    expect(created.ticket_state).toBe("READY");
    expect(created.extraction_method).toBe("MANUAL_ROUTE");
    expect(created.extraction_confidence).toBe(0);
    const ticketId: string = created.ticketId;
    expect(typeof ticketId).toBe("string");

    // TicketOwner mapping is written by /from-route.
    const owner = await db.ticketOwners.get(ticketId);
    expect(owner?.email).toBe(ALICE_EMAIL);

    // 2. POST /refund — same happy-path landing as variant A.
    const refundRes = await userHandler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/refund`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: refundBody(),
      }),
    );
    expect(refundRes.statusCode).toBe(202);
    const refund = JSON.parse(refundRes.body);
    expect(refund.ticket_state).toBe("EMAIL_SENDING");
    expect(refund.erwartete_erstattung).toBe("25.00");
    expect(refund.service_fee_betrag).toBe("0.75");
    expect(refund.email_status).toBe("SENT");

    const mandate = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(mandate?.fee_amount).toBe("0.75");
    expect(typeof mandate?.vorabankuendigung_sent_at).toBe("string");

    const rendered = await db.blobs.getRenderedPdf(ALICE_EMAIL, ticketId);
    expect(rendered).not.toBeNull();
    const bytes = await db.blobs.getBytes(rendered!.s3_key);
    expect(bytes!.bytes.byteLength).toBeGreaterThan(0);
  });

  // /upload-confirm is idempotent + strictly blob-metadata-only: the handler
  // writes only the RAW# sibling row. Its documented invariant is that a
  // late-arriving /upload-confirm (after the extractor's S3-event-triggered
  // persist step has already flipped the ticket to READY) MUST NOT rewind
  // ticket_state or clobber extractor-written fields (barcode_uid,
  // extraction_method, extraction_confidence, fahrt_*). This test proves
  // that invariant by inspecting the pre/post row shapes — any regression
  // that made /upload-confirm touch UserTicket fields would fail here.
  it("C. /upload-confirm preserves extractor-written extraction + fahrt_* fields", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();

    // 1. POST /upload — presign issued, VALIDATING row lands.
    const uploadRes = await userHandler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
      }),
    );
    expect(uploadRes.statusCode).toBe(200);
    const upload = JSON.parse(uploadRes.body);

    // 2. Skip /upload-confirm.
    // 3. Simulate extractor completing first (real extractor is Python,
    // triggered by S3 ObjectCreated — this is its persist step).
    await db.tickets.patch(ALICE_EMAIL, ticketId, {
      ticket_state: "READY",
      extraction_status: "DONE",
      extraction_method: "BARCODE",
      extraction_confidence: 1.0,
      barcode_uid: "TEST-BARCODE-UID",
      fahrt_zugnummer_plan: TRAIN_NR,
      fahrt_abreisedatum: DATE,
      fahrt_abreisebahnhof: FROM_STATION,
      fahrt_zielbahnhof: TO_STATION,
      fahrt_abfahrtszeit_plan: "08:00",
      fahrt_ankunftszeit_plan: "14:00",
      fahrt_fahrkartennummer: "DB-12345",
      fahrt_fahrkartenpreis: "100.00",
    });

    // 4. Snapshot the extractor-written fields so we can compare after
    // /upload-confirm lands.
    const afterExtract = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(afterExtract?.ticket_state).toBe("READY");
    expect(afterExtract?.extraction_method).toBe("BARCODE");
    const extractionSnapshot = {
      ticket_state: afterExtract?.ticket_state,
      extraction_status: afterExtract?.extraction_status,
      extraction_method: afterExtract?.extraction_method,
      extraction_confidence: afterExtract?.extraction_confidence,
      barcode_uid: afterExtract?.barcode_uid,
      fahrt_zugnummer_plan: afterExtract?.fahrt_zugnummer_plan,
      fahrt_abreisedatum: afterExtract?.fahrt_abreisedatum,
      fahrt_abreisebahnhof: afterExtract?.fahrt_abreisebahnhof,
      fahrt_zielbahnhof: afterExtract?.fahrt_zielbahnhof,
      fahrt_abfahrtszeit_plan: afterExtract?.fahrt_abfahrtszeit_plan,
      fahrt_ankunftszeit_plan: afterExtract?.fahrt_ankunftszeit_plan,
      fahrt_fahrkartennummer: afterExtract?.fahrt_fahrkartennummer,
      fahrt_fahrkartenpreis: afterExtract?.fahrt_fahrkartenpreis,
    };

    // 5. NOW POST /upload-confirm arrives late. Must land the RAW# row
    // and must NOT touch UserTicket state / extraction / fahrt_* fields.
    const confirmRes = await userHandler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: {
          s3_key: upload.s3_key,
          filename: "ticket.pdf",
          mimeType: "application/pdf",
        },
      }),
    );
    expect(confirmRes.statusCode).toBe(202);

    const raw = await db.blobs.getRawUpload(ALICE_EMAIL, ticketId);
    expect(raw).not.toBeNull();
    expect(raw?.s3_key).toBe(upload.s3_key);

    // Field-by-field equality with the pre-confirm snapshot. Any handler
    // regression that writes to UserTicket would surface as a diff here.
    const afterConfirm = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(afterConfirm?.ticket_state).toBe(extractionSnapshot.ticket_state);
    expect(afterConfirm?.extraction_status).toBe(extractionSnapshot.extraction_status);
    expect(afterConfirm?.extraction_method).toBe(extractionSnapshot.extraction_method);
    expect(afterConfirm?.extraction_confidence).toBe(extractionSnapshot.extraction_confidence);
    expect(afterConfirm?.barcode_uid).toBe(extractionSnapshot.barcode_uid);
    expect(afterConfirm?.fahrt_zugnummer_plan).toBe(extractionSnapshot.fahrt_zugnummer_plan);
    expect(afterConfirm?.fahrt_abreisedatum).toBe(extractionSnapshot.fahrt_abreisedatum);
    expect(afterConfirm?.fahrt_abreisebahnhof).toBe(extractionSnapshot.fahrt_abreisebahnhof);
    expect(afterConfirm?.fahrt_zielbahnhof).toBe(extractionSnapshot.fahrt_zielbahnhof);
    expect(afterConfirm?.fahrt_abfahrtszeit_plan).toBe(extractionSnapshot.fahrt_abfahrtszeit_plan);
    expect(afterConfirm?.fahrt_ankunftszeit_plan).toBe(extractionSnapshot.fahrt_ankunftszeit_plan);
    expect(afterConfirm?.fahrt_fahrkartennummer).toBe(extractionSnapshot.fahrt_fahrkartennummer);
    expect(afterConfirm?.fahrt_fahrkartenpreis).toBe(extractionSnapshot.fahrt_fahrkartenpreis);
  });

  // Anchors the 2026-06-18 lock ("presigned POST, not PUT") on the mock
  // side: the URL carries a `content-length-range` policy, and S3 enforces
  // it server-side. The in-memory mock mirrors that enforcement — a
  // `putBytes` on a presigned key with bytes above the raw-upload cap must
  // reject with `ERR_VALIDATION`. Kept intentionally light: full
  // policy-boundary coverage lives in
  // `mocks/in-memory/test/blobs.spec.ts`.
  it("D. presigned upload rejects oversize (>10 MB raw cap)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();

    const uploadRes = await userHandler(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
      }),
    );
    expect(uploadRes.statusCode).toBe(200);
    const upload = JSON.parse(uploadRes.body);
    expect(upload.fields["x-amz-content-length-range-max"]).toBe("10485760");

    // Direct putBytes on the presigned key with 10 MB + 1 byte — the
    // registered policy must reject.
    const oversize = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(
      db.blobs.putBytes(
        upload.s3_key,
        oversize,
        "application/pdf",
        new Date().toISOString(),
      ),
    ).rejects.toMatchObject({ code: "ERR_VALIDATION" });
  });
});
