// Phase 4 cross-lambda flow: admin approve → pain008 build → pending-batches
// → mark-submitted, plus operator-retry via pain008-rebuild.
//
// Wires user-handler (POST from-route + POST /refund) → refund-pdf (rendered
// via user-handler's sync invoke shim, default SES mock 2xx → email SENT)
// → simulated SES-Delivery (direct db.tickets.patch — same effect as running
// email-webhook, but no SNS payload to construct) → admin-handler PATCH →
// pain008-generator (invoked in-process by patch-ticket) → GET pending-batches
// → POST mark-submitted → POST pain008-rebuild happy + 409.
//
// Every it() calls installTestEnv() in-line for a fresh MemState. No leakage
// between cases.

import { afterEach, describe, expect, it, vi } from "vitest";

import { handler as userHandler } from "@railback/lambdas-user-handler/src/handler.js";
import { handler as adminHandler } from "@railback/lambdas-admin-handler/src/handler.js";
import { processReport } from "@railback/sepa-reports";

import type { Db } from "@railback/lib/storage/types";
import type { RefundRequest } from "@railback/lib/schemas/ticket";
import { ulid } from "@railback/lib/util/ulid";

import {
  installTestEnv,
  teardownTestEnv,
  TEST_GLAEUBIGER_ID,
} from "../shared/env.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAdmin,
  seedAlice,
} from "../shared/fixtures.js";

const TRAIN_NR = "ICE 555";
const DATE = "2026-06-23";

// --- helpers ------------------------------------------------------------

function fromRouteBody() {
  return {
    trainNr: TRAIN_NR,
    date: DATE,
    fromStation: "Berlin Hauptbahnhof",
    toStation: "München Hbf",
    abfahrtszeit_plan: "08:00",
    ankunftszeit_plan: "14:00",
    fahrkartennummer: "DB-12345",
    fahrkartenpreis: "100.00",
    is_zeitkarte: false,
  };
}

function refundBody(overrides: Partial<RefundRequest> = {}): RefundRequest {
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

// Submit ticket end-to-end: from-route → /refund → EMAIL_SENDING (email SENT
// per default SES mock). Real extractor is Python + out-of-process; from-route
// bypasses extraction entirely (extraction_method=MANUAL_ROUTE, state=READY).
async function submitToEmailSending(db: Db): Promise<string> {
  const fromRouteRes = await userHandler(
    makeEvent({
      method: "POST",
      path: "/users/me/tickets/from-route",
      token: aliceAccessToken(),
      body: fromRouteBody(),
    }),
  );
  expect(fromRouteRes.statusCode).toBe(201);
  const { ticketId } = JSON.parse(fromRouteRes.body);
  expect(typeof ticketId).toBe("string");

  // Seed delayMinutes so compute-fee produces a non-zero erwartete_erstattung
  // without depending on plan-vs-actual arithmetic; the /refund body still
  // carries the same-shape trip data. Real /fchg pipeline is out-of-scope
  // for this flow spec.
  await db.tickets.patch(ALICE_EMAIL, ticketId, { delayMinutes: 90 });

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
  expect(refund.email_status).toBe("SENT");
  expect(refund.service_fee_betrag).toBe("0.75");

  return ticketId;
}

// Advance to PENDING_DB_PAYMENT. Same terminal effect as running the
// email-webhook Delivery route; we skip the SNS event round-trip because the
// webhook path is exercised in its own test file.
async function simulateSesDelivery(db: Db, ticketId: string): Promise<void> {
  await db.tickets.patch(ALICE_EMAIL, ticketId, {
    email_status: "DELIVERED",
    ticket_state: "PENDING_DB_PAYMENT",
  });
}

async function approve(ticketId: string, dbPaidAt: string) {
  return adminHandler(
    makeEvent({
      method: "PATCH",
      path: `/admin/tickets/${ticketId}`,
      token: adminAccessToken(),
      body: { ticket_state: "APPROVED", db_paid_at: dbPaidAt },
    }),
  );
}

// --- specs --------------------------------------------------------------

describe("flow: admin approve → pain008 build → mark-submitted → rebuild", () => {
  afterEach(() => {
    teardownTestEnv();
  });

  it("APPROVE stamps mandate with pain008 batch and persists XML to S3", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAdmin();

    const ticketId = await submitToEmailSending(db);
    await simulateSesDelivery(db, ticketId);

    const res = await approve(ticketId, "2026-06-25T10:00:00.000Z");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ticket_state).toBe("APPROVED");
    expect(body.db_paid_at).toBe("2026-06-25T10:00:00.000Z");

    const mandate = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(mandate).not.toBeNull();
    expect(typeof mandate!.pain008_batch_id).toBe("string");
    expect(mandate!.pain008_batch_id!.length).toBeGreaterThan(0);
    expect(typeof mandate!.pain008_s3_key).toBe("string");
    expect(mandate!.pain008_s3_key).toMatch(
      /^pain008\/\d{4}-\d{2}\/[0-9A-HJKMNP-TV-Z]{26}\.xml$/,
    );
    expect(typeof mandate!.pain008_built_at).toBe("string");
    // Mandate not yet submitted — mark-submitted is a separate admin call.
    expect(mandate!.mandate_state).toBe("ISSUED");
    expect(mandate!.pain008_submitted_at).toBeUndefined();

    // XML bytes actually landed in the S3 mock at the stamped key.
    const blob = await db.blobs.getBytes(mandate!.pain008_s3_key!);
    expect(blob).not.toBeNull();
    expect(blob!.bytes.length).toBeGreaterThan(0);
    expect(blob!.contentType).toBe("application/xml");
  });

  it("GET /admin/sepa/pending-batches lists the freshly-built batch", async () => {
    const db = installTestEnv();
    // Fake AWS creds so the S3 v4 signer produces a presigned URL locally
    // instead of trying to hit the EC2 metadata endpoint. Signing math is
    // deterministic; the URL doesn't need to resolve to a real object.
    // Mirrors lambdas/admin-handler/test/setup.ts.
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    vi.stubEnv("AWS_REGION", "eu-central-1");
    await seedAlice(db);
    await seedAdmin();

    const ticketId = await submitToEmailSending(db);
    await simulateSesDelivery(db, ticketId);
    const approveRes = await approve(ticketId, "2026-06-25T10:00:00.000Z");
    expect(approveRes.statusCode).toBe(200);

    const mandate = await db.mandates.get(ALICE_EMAIL, ticketId);
    const batchId = mandate!.pain008_batch_id!;

    const res = await adminHandler(
      makeEvent({
        method: "GET",
        path: "/admin/sepa/pending-batches",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const ours = body.items.find(
      (b: { batchId: string }) => b.batchId === batchId,
    );
    expect(ours).toBeDefined();
    expect(typeof ours.downloadUrl).toBe("string");
    expect(ours.downloadUrl.length).toBeGreaterThan(0);
    expect(ours.mandate_count).toBe(1);
  });

  it("POST mark-submitted flips ISSUED → SUBMITTED and stamps submitted_at", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAdmin();

    const ticketId = await submitToEmailSending(db);
    await simulateSesDelivery(db, ticketId);
    const approveRes = await approve(ticketId, "2026-06-25T10:00:00.000Z");
    expect(approveRes.statusCode).toBe(200);

    const before = await db.mandates.get(ALICE_EMAIL, ticketId);
    const batchId = before!.pain008_batch_id!;

    const res = await adminHandler(
      makeEvent({
        method: "POST",
        path: `/admin/sepa/batches/${batchId}/mark-submitted`,
        token: adminAccessToken(),
        pathParameters: { batchId },
        body: {},
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.batchId).toBe(batchId);
    expect(body.mandates_marked).toBeGreaterThanOrEqual(1);
    expect(typeof body.submitted_at).toBe("string");

    const after = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(after!.mandate_state).toBe("SUBMITTED");
    expect(typeof after!.pain008_submitted_at).toBe("string");
  });

  it("pain008-rebuild recovers when the in-line invoke failed", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAdmin();

    const ticketId = await submitToEmailSending(db);
    await simulateSesDelivery(db, ticketId);

    // Break a SEPA env var so buildPain008Xml throws inside patch-ticket's
    // invoke. Admin-handler's adversarial-fix pattern: the ticket_state
    // patch has already been committed when the invoke throws, so the
    // ticket lands in APPROVED but the mandate has no pain008_* fields.
    vi.stubEnv("RAILBACK_SEPA_GLAEUBIGER_ID", "");

    const patchRes = await approve(ticketId, "2026-06-25T10:00:00.000Z");
    expect(patchRes.statusCode).toBe(500);
    const midTicket = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(midTicket!.ticket_state).toBe("APPROVED");
    const midMandate = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(midMandate!.pain008_built_at).toBeUndefined();

    // Restore the env var. The empty stub is scoped to this test only —
    // teardownTestEnv() clears it via unstubAllEnvs() in afterEach. We
    // re-stub with the valid value here so the rebuild call sees a good env.
    vi.stubEnv("RAILBACK_SEPA_GLAEUBIGER_ID", TEST_GLAEUBIGER_ID);

    const rebuildRes = await adminHandler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/${ticketId}/pain008-rebuild`,
        token: adminAccessToken(),
        pathParameters: { ticketId },
        body: {},
      }),
    );
    expect(rebuildRes.statusCode).toBe(200);
    const rebuilt = JSON.parse(rebuildRes.body);
    expect(rebuilt.ticketId).toBe(ticketId);
    expect(typeof rebuilt.pain008_batch_id).toBe("string");
    expect(typeof rebuilt.pain008_built_at).toBe("string");
    expect(typeof rebuilt.pain008_s3_key).toBe("string");

    const finalMandate = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(finalMandate!.pain008_batch_id).toBe(rebuilt.pain008_batch_id);
    expect(finalMandate!.pain008_built_at).toBe(rebuilt.pain008_built_at);
    expect(finalMandate!.pain008_s3_key).toBe(rebuilt.pain008_s3_key);
  });

  it("pain008-rebuild rejects with 409 ERR_CONFLICT when already built", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAdmin();

    const ticketId = await submitToEmailSending(db);
    await simulateSesDelivery(db, ticketId);
    const approveRes = await approve(ticketId, "2026-06-25T10:00:00.000Z");
    expect(approveRes.statusCode).toBe(200);

    // Sanity: first build did land.
    const mandate = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(typeof mandate!.pain008_built_at).toBe("string");

    const res = await adminHandler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/${ticketId}/pain008-rebuild`,
        token: adminAccessToken(),
        pathParameters: { ticketId },
        body: {},
      }),
    );
    expect(res.statusCode).toBe(409);
    const err = JSON.parse(res.body).error;
    expect(err.code).toBe("ERR_CONFLICT");
    // Details should carry the existing pain008 fields for admin triage.
    expect(err.details?.pain008_built_at).toBe(mandate!.pain008_built_at);
    expect(err.details?.pain008_batch_id).toBe(mandate!.pain008_batch_id);
  });

  it("sepa-reports ingests pain.002 ACSP: SUBMITTED → DEBITED, ticket service_fee_state=DEBITED", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAdmin();

    const ticketId = await submitToEmailSending(db);
    await simulateSesDelivery(db, ticketId);
    const approveRes = await approve(ticketId, "2026-06-25T10:00:00.000Z");
    expect(approveRes.statusCode).toBe(200);

    const mandate = await db.mandates.get(ALICE_EMAIL, ticketId);
    const batchId = mandate!.pain008_batch_id!;

    // Advance to SUBMITTED via mark-submitted.
    const markRes = await adminHandler(
      makeEvent({
        method: "POST",
        path: `/admin/sepa/batches/${batchId}/mark-submitted`,
        token: adminAccessToken(),
        pathParameters: { batchId },
        body: {},
      }),
    );
    expect(markRes.statusCode).toBe(200);

    // Admin uploads the bank's pain.002 ACSP report to S3. In prod this is
    // POST /admin/sepa/reports/upload → S3 PutObject → sepa-reports lambda;
    // here we shortcut the transport and drop bytes at the canonical key,
    // then call processReport() directly.
    const mandateId = mandate!.mandate_id;
    const reportId = ulid();
    const s3Key = `sepa-reports/2026-06-25/${reportId}.xml`;
    const pain002 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10">
  <CstmrPmtStsRpt>
    <GrpHdr><MsgId>${reportId}</MsgId></GrpHdr>
    <OrgnlPmtInfAndSts>
      <TxInfAndSts>
        <OrgnlEndToEndId>${mandateId}</OrgnlEndToEndId>
        <TxSts>ACSP</TxSts>
      </TxInfAndSts>
    </OrgnlPmtInfAndSts>
  </CstmrPmtStsRpt>
</Document>`;
    await db.blobs.putBytes(
      s3Key,
      new Uint8Array(Buffer.from(pain002, "utf-8")),
      "application/xml",
      new Date().toISOString(),
    );

    const result = await processReport({ s3Bucket: "memory-mock", s3Key });
    expect(result.idempotentSkip).toBe(false);
    expect(result.kind).toBe("PAIN002");
    // ACSP is informational — mandate stays SUBMITTED (no decision applied).
    expect(result.decisionsApplied).toBe(0);
    const afterAcsp = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(afterAcsp?.mandate_state).toBe("SUBMITTED");

    // Now the camt.054 debit-notification lands → DEBITED.
    const reportId2 = ulid();
    const s3Key2 = `sepa-reports/2026-06-26/${reportId2}.xml`;
    const camt054 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>${reportId2}</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>${mandateId}</EndToEndId></Refs>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
    await db.blobs.putBytes(
      s3Key2,
      new Uint8Array(Buffer.from(camt054, "utf-8")),
      "application/xml",
      new Date().toISOString(),
    );
    const result2 = await processReport({ s3Bucket: "memory-mock", s3Key: s3Key2 });
    expect(result2.kind).toBe("CAMT054");
    expect(result2.decisionsApplied).toBe(1);

    const finalMandate = await db.mandates.get(ALICE_EMAIL, ticketId);
    expect(finalMandate?.mandate_state).toBe("DEBITED");
    const finalTicket = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(finalTicket?.service_fee_state).toBe("DEBITED");
  });
});
