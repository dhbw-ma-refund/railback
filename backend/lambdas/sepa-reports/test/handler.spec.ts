// End-to-end sepa-reports pipeline tests against the in-memory backend.
// Each test seeds:
//   - a User row
//   - a Ticket row (READY-ish with a submitted service-fee)
//   - a SepaMandate row (state advanced to SUBMITTED / DEBITED as needed)
//   - the SEPA XML as a blob at the canonical S3 key
// then calls `processReport` and inspects the resulting mandate + ticket +
// SepaReport rows plus the SES mock calls.

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { db } from "@railback/lib/storage";
import { AppError } from "@railback/lib/errors";
import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import { hashPassword } from "@railback/lib/auth/password";
import { ulid } from "@railback/lib/util/ulid";
import type { MandateState } from "@railback/lib/types/enums";

import { handler, processReport } from "../src/handler.js";
import {
  installTestEnv,
  teardownTestEnv,
  installSesMock,
  type SesMockState,
} from "./setup.js";

const TEST_EMAIL = "carol@example.com";
const TEST_IBAN = "DE89370400440532013000";
const TEST_BIC = "COBADEFFXXX";
const S3_BUCKET = "memory-mock";

interface SeedOpts {
  ticketId?: string;
  mandateId?: string;
  mandate_state?: MandateState;
  fee_amount?: string;
  is_zeitkarte?: boolean;
  noUser?: boolean;
  noMandate?: boolean;
}

interface Seeded {
  email: string;
  ticketId: string;
  mandateId: string;
}

async function ensureUser(email: string): Promise<void> {
  if (await db().users.getByEmail(email)) return;
  const hashed_password = await hashPassword("carol-hunter2");
  await db().users.create({
    email,
    vorname: "Carol",
    nachname: "Schmidt",
    telefon: "+49 151 5550000",
    adresse: {
      strasse: "Bahnhofstr.",
      hausnr: "12",
      plz: "10115",
      ort: "Berlin",
      land: "DE",
    },
    hashed_password,
    iban_enc: encryptIban(TEST_IBAN),
    bic_enc: encryptBic(TEST_BIC),
    datenschutz_einwilligung: true,
    agb_akzeptiert: true,
  });
}

async function seed(opts: SeedOpts = {}): Promise<Seeded> {
  const ticketId = opts.ticketId ?? ulid();
  const email = TEST_EMAIL;
  if (!opts.noUser) await ensureUser(email);

  await db().tickets.createFromRoute({
    email,
    ticketId,
    trainNr: "ICE517",
    date: "2026-06-01",
    fromStation: "Frankfurt (Main) Hbf",
    fromEva: 8000105,
    toStation: "Berlin Hbf",
    toEva: 8011160,
    abfahrtszeit_plan: "08:00",
    ankunftszeit_plan: "12:00",
    fahrkartennummer: "9876543210",
    fahrkartenpreis: "120.00",
    is_zeitkarte: opts.is_zeitkarte ?? false,
  });
  await db().tickets.patch(email, ticketId, {
    ticket_state: "PENDING_DB_PAYMENT",
    antragsart: "ENTSCHAEDIGUNG_120_PLUS",
    antragsgrund: ["VERSPAETUNG"],
    erwartete_erstattung: "60.00",
    service_fee_betrag: opts.fee_amount ?? "0.75",
    delayMinutes: 130,
    service_fee_state: "PENDING",
    submitted_at: new Date().toISOString(),
  });

  let mandateId = "";
  if (!opts.noMandate) {
    const issued = await db().mandates.issue(email, ticketId, {
      ticketId,
      fee_amount: opts.fee_amount ?? "0.75",
      iban_enc: encryptIban(TEST_IBAN),
      bic_enc: encryptBic(TEST_BIC),
      kontoinhaber_snapshot: "Carol Schmidt",
      user_consent_at: new Date().toISOString(),
      vorabankuendigung_sent_at: new Date().toISOString(),
    });
    mandateId = issued.mandate_id;
    // Advance to target state.
    const targetState = opts.mandate_state ?? "SUBMITTED";
    if (targetState !== "ISSUED") {
      await db().mandates.stampPain008Built(email, ticketId, {
        batchId: "BATCH-" + ticketId,
        s3Key: `pain008/2026-06/BATCH-${ticketId}.xml`,
        builtAt: new Date().toISOString(),
      });
      await db().mandates.markSubmitted(email, ticketId, new Date().toISOString());
    }
    if (targetState === "DEBITED") {
      await db().mandates.markDebited(email, ticketId, new Date().toISOString());
      await db().tickets.patch(email, ticketId, { service_fee_state: "DEBITED" });
    }
    if (opts.mandateId) {
      // The in-memory issue() auto-generates a ulid mandate_id. If the test
      // wants a specific mandate_id (to align with a hand-crafted XML) we
      // reach into mem-state to overwrite. Kept behind an opt.
      const mem = await import("@railback/mocks-in-memory");
      const state = mem._activeMemState();
      const kk = await import("@railback/lib/storage/ddb/keys");
      const row = state?.rows
        .get(kk.userPk(email))
        ?.get(kk.mandateSk(ticketId)) as { mandate_id: string } | undefined;
      if (row) row.mandate_id = opts.mandateId;
      mandateId = opts.mandateId;
    }
  }

  return { email, ticketId, mandateId };
}

async function putXml(s3Key: string, xml: string): Promise<void> {
  const bytes = new Uint8Array(Buffer.from(xml, "utf-8"));
  await db().blobs.putBytes(s3Key, bytes, "application/xml", new Date().toISOString());
}

// -- XML builders (minimal shapes, drawn from lib/test/sepa/parse-reports.spec.ts) --

function pain002(reportMsgId: string, mandateId: string, status: "ACSP" | "RJCT", reasonCode?: string): string {
  const rsn = reasonCode ? `<StsRsnInf><Rsn><Cd>${reasonCode}</Cd></Rsn></StsRsnInf>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10">
  <CstmrPmtStsRpt>
    <GrpHdr><MsgId>${reportMsgId}</MsgId></GrpHdr>
    <OrgnlPmtInfAndSts>
      <TxInfAndSts>
        <OrgnlEndToEndId>${mandateId}</OrgnlEndToEndId>
        <TxSts>${status}</TxSts>${rsn}
      </TxInfAndSts>
    </OrgnlPmtInfAndSts>
  </CstmrPmtStsRpt>
</Document>`;
}

function camt054(reportMsgId: string, mandateId: string, opts: { rtrCode?: string } = {}): string {
  const rtr = opts.rtrCode ? `<RtrInf><Rsn><Cd>${opts.rtrCode}</Cd></Rsn></RtrInf>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>${reportMsgId}</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>${mandateId}</EndToEndId></Refs>
            ${rtr}
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
}

function camt053(reportMsgId: string, mandateId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>${reportMsgId}</MsgId></GrpHdr>
    <Stmt>
      <Ntry>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>${mandateId}</EndToEndId></Refs>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
}

// ---------------------------------------------------------------------------

describe("sepa-reports processReport", () => {
  let ses: SesMockState;

  beforeEach(() => {
    installTestEnv();
    ses = installSesMock();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  // -- pain.002 branches ----------------------------------------------------

  it("pain.002 RJCT on SUBMITTED → mandate REVERSED, ticket mirror REVERSED, R-tx email sent", async () => {
    const { email, ticketId, mandateId } = await seed({ mandate_state: "SUBMITTED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-06-25/${reportId}.xml`;
    await putXml(key, pain002(reportId, mandateId, "RJCT", "AC04"));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });

    expect(result.idempotentSkip).toBe(false);
    expect(result.kind).toBe("PAIN002");
    expect(result.decisionsApplied).toBe(1);
    expect(result.notificationsSent).toBe(1);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate?.mandate_state).toBe("REVERSED");
    expect(mandate?.reversed_reason).toBe("AC04");
    expect(mandate?.reversed_at).toBeDefined();

    const ticket = await db().tickets.get(email, ticketId);
    expect(ticket?.service_fee_state).toBe("REVERSED");
    // ticket_state independent — untouched.
    expect(ticket?.ticket_state).toBe("PENDING_DB_PAYMENT");

    // SES call: subject carries [RailBack #<ticketId>], X-Rtx-* set.
    expect(ses.calls).toHaveLength(1);
    expect(ses.calls[0]?.to).toBe(email);
    expect(ses.calls[0]?.ticketId).toBe(ticketId);
    expect(ses.calls[0]?.rtxAction).toBe("REVERSED");
    expect(ses.calls[0]?.rtxReason).toBe("AC04");

    const report = await db().sepaReports.getByReportId("2026-06-25", reportId);
    expect(report?.report_type).toBe("PAIN002");
    expect(report?.mandates_correlated).toEqual([mandateId]);
    // 10y TTL (HGB §257 / AO §147 buchungsrelevant audit row).
    // Assert within a sane window of `now + 10y` (~9.9y lower bound covers
    // clock skew + test-vs-persist wall-time gap).
    expect(report?.ttl).toBeDefined();
    const nowSec = Math.floor(Date.now() / 1000);
    const tenYearsSec = Math.round(10 * 365.2425 * 24 * 60 * 60);
    expect(report?.ttl).toBeGreaterThan(nowSec + tenYearsSec - 60);
    expect(report?.ttl).toBeLessThan(nowSec + tenYearsSec + 60);
  });

  it("pain.002 ACSP on SUBMITTED → mandate untouched (informational)", async () => {
    const { email, ticketId, mandateId } = await seed({ mandate_state: "SUBMITTED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-06-25/${reportId}.xml`;
    await putXml(key, pain002(reportId, mandateId, "ACSP"));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });

    expect(result.decisionsApplied).toBe(0);
    expect(result.decisionsSkipped).toBe(1);
    expect(result.notificationsSent).toBe(0);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate?.mandate_state).toBe("SUBMITTED");
    const ticket = await db().tickets.get(email, ticketId);
    expect(ticket?.service_fee_state).toBe("PENDING");
    expect(ses.calls).toHaveLength(0);

    // Report row still written for audit.
    const report = await db().sepaReports.getByReportId("2026-06-25", reportId);
    expect(report?.mandates_correlated).toEqual([mandateId]);
  });

  // -- camt.054 branches ---------------------------------------------------

  it("camt.054 BOOKED on SUBMITTED → mandate DEBITED, ticket mirror DEBITED, no notify", async () => {
    const { email, ticketId, mandateId } = await seed({ mandate_state: "SUBMITTED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-06-26/${reportId}.xml`;
    await putXml(key, camt054(reportId, mandateId));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });

    expect(result.kind).toBe("CAMT054");
    expect(result.decisionsApplied).toBe(1);
    expect(result.notificationsSent).toBe(0);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate?.mandate_state).toBe("DEBITED");
    expect(mandate?.debited_at).toBeDefined();

    const ticket = await db().tickets.get(email, ticketId);
    expect(ticket?.service_fee_state).toBe("DEBITED");
    expect(ses.calls).toHaveLength(0);
  });

  it("camt.054 RtrInf AM04 on SUBMITTED → mandate REVERSED + notify", async () => {
    const { email, ticketId, mandateId } = await seed({ mandate_state: "SUBMITTED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-06-27/${reportId}.xml`;
    await putXml(key, camt054(reportId, mandateId, { rtrCode: "AM04" }));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
    expect(result.decisionsApplied).toBe(1);
    expect(result.notificationsSent).toBe(1);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate?.mandate_state).toBe("REVERSED");
    expect(mandate?.reversed_reason).toBe("AM04");

    const ticket = await db().tickets.get(email, ticketId);
    expect(ticket?.service_fee_state).toBe("REVERSED");

    expect(ses.calls[0]?.rtxAction).toBe("REVERSED");
    expect(ses.calls[0]?.rtxReason).toBe("AM04");
  });

  it("camt.054 RtrInf MD06 on DEBITED → mandate DISPUTED + notify", async () => {
    const { email, ticketId, mandateId } = await seed({ mandate_state: "DEBITED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-06-28/${reportId}.xml`;
    await putXml(key, camt054(reportId, mandateId, { rtrCode: "MD06" }));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
    expect(result.decisionsApplied).toBe(1);
    expect(result.notificationsSent).toBe(1);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate?.mandate_state).toBe("DISPUTED");
    expect(mandate?.dispute_opened_at).toBeDefined();
    // markDisputed doesn't stamp reversed_reason.
    expect(mandate?.reversed_reason).toBeUndefined();

    const ticket = await db().tickets.get(email, ticketId);
    expect(ticket?.service_fee_state).toBe("REVERSED");

    expect(ses.calls[0]?.rtxAction).toBe("DISPUTED");
    expect(ses.calls[0]?.rtxReason).toBe("MD06");
  });

  it("camt.054 with our-fault reason AG02 → REVERSED but NO user notification", async () => {
    const { email, ticketId, mandateId } = await seed({ mandate_state: "SUBMITTED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-06-29/${reportId}.xml`;
    await putXml(key, camt054(reportId, mandateId, { rtrCode: "AG02" }));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
    expect(result.decisionsApplied).toBe(1);
    expect(result.notificationsSent).toBe(0);
    expect(ses.calls).toHaveLength(0);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate?.mandate_state).toBe("REVERSED");
    expect(mandate?.reversed_reason).toBe("AG02");
  });

  // -- camt.053 branch -----------------------------------------------------

  it("camt.053 statement → SepaReport row written, no mandate/ticket changes", async () => {
    const { email, ticketId, mandateId } = await seed({ mandate_state: "DEBITED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-06-30/${reportId}.xml`;
    await putXml(key, camt053(reportId, mandateId));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
    expect(result.kind).toBe("CAMT053");
    expect(result.decisionsApplied).toBe(0);
    expect(result.decisionsSkipped).toBe(1);
    expect(result.notificationsSent).toBe(0);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate?.mandate_state).toBe("DEBITED");
    const ticket = await db().tickets.get(email, ticketId);
    expect(ticket?.service_fee_state).toBe("DEBITED");
    expect(ses.calls).toHaveLength(0);

    const report = await db().sepaReports.getByReportId("2026-06-30", reportId);
    expect(report?.report_type).toBe("CAMT053");
  });

  // -- Idempotency ---------------------------------------------------------

  it("idempotency: replay of the same report is a no-op (skip)", async () => {
    const { email, ticketId, mandateId } = await seed({ mandate_state: "SUBMITTED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-07-01/${reportId}.xml`;
    await putXml(key, camt054(reportId, mandateId));

    const first = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
    expect(first.idempotentSkip).toBe(false);
    expect(first.decisionsApplied).toBe(1);

    // Manually revert the ticket + mandate to their pre-first-run state so
    // that a re-application would be visible. If the second run were to
    // re-apply, we'd see the mandate flipping back to DEBITED. Idempotency
    // means it stays SUBMITTED.
    await db().mandates.get(email, ticketId); // just a fetch, no mutate
    // Reset the mandate to SUBMITTED by hand for the assertion.
    const mem = await import("@railback/mocks-in-memory");
    const state = mem._activeMemState();
    const kk = await import("@railback/lib/storage/ddb/keys");
    const bucket = state!.rows.get(kk.userPk(email));
    const row = bucket!.get(kk.mandateSk(ticketId)) as { mandate_state: MandateState; debited_at?: string };
    row.mandate_state = "SUBMITTED";
    delete row.debited_at;

    const second = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
    expect(second.idempotentSkip).toBe(true);
    expect(second.decisionsApplied).toBe(0);

    // Confirm nothing changed on the second call.
    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate?.mandate_state).toBe("SUBMITTED");
  });

  // -- Unknown mandate -----------------------------------------------------

  it("unknown mandateId in report → SepaReport row still written with mandateId correlated; no crash", async () => {
    // Seed nothing — no user, no ticket, no mandate.
    const bogusMandateId = "01UNKNOWN00000000000000000";
    const reportId = ulid();
    const key = `sepa-reports/2026-07-02/${reportId}.xml`;
    await putXml(key, camt054(reportId, bogusMandateId, { rtrCode: "AC04" }));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
    expect(result.decisionsApplied).toBe(0);
    expect(result.decisionsSkipped).toBe(1);
    expect(result.notificationsSent).toBe(0);

    const report = await db().sepaReports.getByReportId("2026-07-02", reportId);
    expect(report).not.toBeNull();
    expect(report?.mandates_correlated).toEqual([bogusMandateId]);
    expect(ses.calls).toHaveLength(0);
  });

  // -- Illegal transition guard --------------------------------------------

  it("illegal transition (camt.054 BOOKED while ISSUED) → skipped, no state mutation", async () => {
    const { email, ticketId, mandateId } = await seed({ mandate_state: "ISSUED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-07-03/${reportId}.xml`;
    await putXml(key, camt054(reportId, mandateId));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
    expect(result.decisionsApplied).toBe(0);
    expect(result.decisionsSkipped).toBe(1);

    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate?.mandate_state).toBe("ISSUED");
    const ticket = await db().tickets.get(email, ticketId);
    expect(ticket?.service_fee_state).toBe("PENDING");
  });

  // -- Malformed XML -------------------------------------------------------

  it("malformed XML → throws ERR_VALIDATION (S3 retry semantics), no report row written", async () => {
    const reportId = ulid();
    const key = `sepa-reports/2026-07-04/${reportId}.xml`;
    await putXml(key, "<Document><UnrecognisedRoot/></Document>");

    await expect(processReport({ s3Bucket: S3_BUCKET, s3Key: key })).rejects.toMatchObject({
      code: "ERR_VALIDATION",
    });
    const report = await db().sepaReports.getByReportId("2026-07-04", reportId);
    expect(report).toBeNull();
  });

  it("bad S3 key (not sepa-reports/<date>/<id>.xml) → ERR_VALIDATION", async () => {
    await expect(
      processReport({ s3Bucket: S3_BUCKET, s3Key: "wrong-prefix/foo.xml" }),
    ).rejects.toMatchObject({ code: "ERR_VALIDATION" });
  });

  it("S3 object missing → ERR_NOT_FOUND (S3 retry semantics)", async () => {
    const reportId = ulid();
    const key = `sepa-reports/2026-07-05/${reportId}.xml`;
    // Deliberately do NOT put the blob.
    await expect(
      processReport({ s3Bucket: S3_BUCKET, s3Key: key }),
    ).rejects.toMatchObject({ code: "ERR_NOT_FOUND" });
  });

  // -- SES failure doesn't roll back the state change ----------------------

  it("SES send failure on R-tx notification: mandate still transitions, warning logged", async () => {
    // Re-install SES mock with a throwing response for the first call.
    ses = installSesMock({
      responses: [{ kind: "throw", name: "ThrottlingException", message: "slow down" }],
    });
    const { email, ticketId, mandateId } = await seed({ mandate_state: "SUBMITTED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-07-06/${reportId}.xml`;
    await putXml(key, camt054(reportId, mandateId, { rtrCode: "MD07" }));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
    // Decision applied, but notification NOT counted as sent.
    expect(result.decisionsApplied).toBe(1);
    expect(result.notificationsSent).toBe(0);

    // Mandate still transitioned.
    const mandate = await db().mandates.get(email, ticketId);
    expect(mandate?.mandate_state).toBe("REVERSED");
    expect(mandate?.reversed_reason).toBe("MD07");
    // SES was called (mock captured the request) even though it threw.
    expect(ses.callCount).toBe(1);
  });

  // -- Permanent storage failure on one entry doesn't kill the batch ------

  it("multi-entry camt.054 with one PERMANENT storage failure: other entries still succeed, audit row written", async () => {
    const s1 = await seed({ mandate_state: "SUBMITTED" });
    const s2 = await seed({ mandate_state: "SUBMITTED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-07-07/${reportId}.xml`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>${reportId}</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry><NtryDtls><TxDtls><Refs><EndToEndId>${s1.mandateId}</EndToEndId></Refs></TxDtls></NtryDtls></Ntry>
      <Ntry><NtryDtls><TxDtls><Refs><EndToEndId>${s2.mandateId}</EndToEndId></Refs></TxDtls></NtryDtls></Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
    await putXml(key, xml);

    // Inject a PERMANENT failure (AppError ERR_VALIDATION) on tickets.patch
    // for s1's ticket. Permanent failures don't trip the transient-abort
    // path; the batch continues and the audit row IS written.
    const tRepo = db().tickets;
    const origPatch = tRepo.patch.bind(tRepo);
    let failed = false;
    tRepo.patch = async (email, id, patch) => {
      if (!failed && id === s1.ticketId && patch.service_fee_state !== undefined) {
        failed = true;
        throw new AppError("ERR_VALIDATION", "simulated permanent patch failure");
      }
      return origPatch(email, id, patch);
    };
    try {
      const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
      expect(result.decisionsApplied).toBe(1);
      expect(result.decisionsSkipped).toBe(1);
    } finally {
      tRepo.patch = origPatch;
    }

    // s1's mandate should NOT have transitioned (ticket patch failed first).
    const m1 = await db().mandates.get(s1.email, s1.ticketId);
    expect(m1?.mandate_state).toBe("SUBMITTED");
    // s2's should be DEBITED.
    const m2 = await db().mandates.get(s2.email, s2.ticketId);
    expect(m2?.mandate_state).toBe("DEBITED");

    // Both mandateIds still recorded on the SepaReport audit row.
    const report = await db().sepaReports.getByReportId("2026-07-07", reportId);
    expect(report?.mandates_correlated).toEqual([s1.mandateId, s2.mandateId]);
  });

  // -- Transient storage failure aborts + preserves idempotency slot -------

  it("TRANSIENT storage failure (raw Error): handler throws, SepaReport row NOT written, mandate unchanged (so S3 retry can resume)", async () => {
    const s = await seed({ mandate_state: "SUBMITTED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-07-09/${reportId}.xml`;
    await putXml(key, camt054(reportId, s.mandateId, { rtrCode: "AM04" }));

    // Monkey-patch markReversed on the mandate repo to throw a raw Error.
    // A raw Error is classified as TRANSIENT (could be a ThrottlingException,
    // network blip, etc.) — the handler must throw and NOT commit the audit
    // row, so the next S3 retry re-enters the pipeline.
    const mRepo = db().mandates;
    const origMarkReversed = mRepo.markReversed.bind(mRepo);
    mRepo.markReversed = async () => {
      throw new Error("simulated transient DDB throttle");
    };
    try {
      await expect(
        processReport({ s3Bucket: S3_BUCKET, s3Key: key }),
      ).rejects.toMatchObject({
        code: "ERR_INTERNAL",
      });
    } finally {
      mRepo.markReversed = origMarkReversed;
    }

    // Audit row NOT written — retry slot preserved.
    const report = await db().sepaReports.getByReportId("2026-07-09", reportId);
    expect(report).toBeNull();

    // Mandate unchanged. Note: applyDecision does tickets.patch FIRST, so on
    // this path the ticket's service_fee_state DID get flipped to REVERSED
    // before markReversed threw. That's the documented ordering (ticket
    // trails mandate by at most one report-ingest tick). What matters is:
    // the mandate row itself did not transition, and the audit row is not
    // committed, so the retry re-runs cleanly.
    const mandate = await db().mandates.get(s.email, s.ticketId);
    expect(mandate?.mandate_state).toBe("SUBMITTED");
    expect(mandate?.reversed_reason).toBeUndefined();
  });

  it("TRANSIENT storage failure via S3-event handler entrypoint: rethrows to trigger S3 retry", async () => {
    const s = await seed({ mandate_state: "SUBMITTED" });
    const reportId = ulid();
    const key = `sepa-reports/2026-07-10/${reportId}.xml`;
    await putXml(key, camt054(reportId, s.mandateId, { rtrCode: "AM04" }));

    const mRepo = db().mandates;
    const origMarkReversed = mRepo.markReversed.bind(mRepo);
    mRepo.markReversed = async () => {
      throw new Error("simulated transient DDB throttle");
    };
    try {
      await expect(
        handler({
          Records: [{ s3: { bucket: { name: S3_BUCKET }, object: { key } } }],
        }),
      ).rejects.toMatchObject({ code: "ERR_INTERNAL" });
    } finally {
      mRepo.markReversed = origMarkReversed;
    }
    const report = await db().sepaReports.getByReportId("2026-07-10", reportId);
    expect(report).toBeNull();
  });

  // -- MsgId / key mismatch warning path -----------------------------------

  it("MsgId inside XML ≠ key reportId → still processed using key reportId, warn logged", async () => {
    const { email, ticketId, mandateId } = await seed({ mandate_state: "SUBMITTED" });
    const keyReportId = ulid();
    const key = `sepa-reports/2026-07-08/${keyReportId}.xml`;
    await putXml(key, pain002("SOME-OTHER-ID", mandateId, "RJCT", "AC04"));

    const result = await processReport({ s3Bucket: S3_BUCKET, s3Key: key });
    expect(result.reportId).toBe(keyReportId);
    expect(result.decisionsApplied).toBe(1);

    // Report row landed under the KEY reportId, not the MsgId.
    const report = await db().sepaReports.getByReportId("2026-07-08", keyReportId);
    expect(report).not.toBeNull();
    const wrong = await db().sepaReports.getByReportId("2026-07-08", "SOME-OTHER-ID");
    expect(wrong).toBeNull();
    expect(email).toBe(TEST_EMAIL);
    expect(ticketId).toBeDefined();
  });

  // -- Multi-record handler batch behaviour --------------------------------

  it("multi-record S3 event: middle record fails, first + third still land, handler throws aggregate at end", async () => {
    const s1 = await seed({ mandate_state: "SUBMITTED" });
    const s3 = await seed({ mandate_state: "SUBMITTED" });

    const reportId1 = ulid();
    const key1 = `sepa-reports/2026-07-09/${reportId1}.xml`;
    await putXml(key1, camt054(reportId1, s1.mandateId));

    // Middle record: bad key shape → parseKey throws ERR_VALIDATION inside
    // processReport. This is a per-record failure that must NOT abort the
    // batch.
    const badKey = "wrong-prefix/does-not-match.xml";

    const reportId3 = ulid();
    const key3 = `sepa-reports/2026-07-09/${reportId3}.xml`;
    await putXml(key3, camt054(reportId3, s3.mandateId));

    const event = {
      Records: [
        { s3: { bucket: { name: S3_BUCKET }, object: { key: key1 } } },
        { s3: { bucket: { name: S3_BUCKET }, object: { key: badKey } } },
        { s3: { bucket: { name: S3_BUCKET }, object: { key: key3 } } },
      ],
    };

    await expect(handler(event)).rejects.toMatchObject({
      code: "ERR_INTERNAL",
      details: {
        failed_count: 1,
        first_error_code: "ERR_VALIDATION",
        failed_keys: [badKey],
      },
    });

    // First + third records landed their SepaReport rows.
    const r1 = await db().sepaReports.getByReportId("2026-07-09", reportId1);
    expect(r1).not.toBeNull();
    expect(r1?.report_type).toBe("CAMT054");
    expect(r1?.mandates_correlated).toEqual([s1.mandateId]);

    const r3 = await db().sepaReports.getByReportId("2026-07-09", reportId3);
    expect(r3).not.toBeNull();
    expect(r3?.report_type).toBe("CAMT054");
    expect(r3?.mandates_correlated).toEqual([s3.mandateId]);

    // Both mandate transitions applied on their respective records.
    const m1 = await db().mandates.get(s1.email, s1.ticketId);
    expect(m1?.mandate_state).toBe("DEBITED");
    const m3 = await db().mandates.get(s3.email, s3.ticketId);
    expect(m3?.mandate_state).toBe("DEBITED");
  });
});
