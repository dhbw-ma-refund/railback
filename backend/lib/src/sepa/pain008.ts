// pain.008.001.09 XML builder. Single mandate per batch (OOFF-only in v1).
// Validates fully before emitting any XML; bank XSD validation runs in the
// pain008-generator Lambda's CI (see SEPA_PAIN008.md).

import { AppError } from "../errors/index.js";
import type { SepaMandate } from "../types/dto.js";
import { cmpDecimal } from "../util/decimal.js";
import {
  assertValidBic,
  assertValidGlaeubigerId,
  assertValidIban,
} from "./validators.js";

export interface BuildPain008Input {
  batchId: string;
  builtAt: string;
  mandate: SepaMandate;
  ticket: { ticketId: string };
  debtorIbanPlain: string;
  debtorBicPlain: string;
}

interface Env {
  kontoinhaber: string;
  ibanOwn: string;
  bicOwn: string;
  glaeubigerId: string;
}

function readEnv(): Env {
  const kontoinhaber = process.env.RAILBACK_SEPA_KONTOINHABER;
  const ibanOwn = process.env.RAILBACK_SEPA_IBAN_OWN;
  const bicOwn = process.env.RAILBACK_SEPA_BIC_OWN;
  const glaeubigerId = process.env.RAILBACK_SEPA_GLAEUBIGER_ID;
  for (const [k, v] of [
    ["RAILBACK_SEPA_KONTOINHABER", kontoinhaber],
    ["RAILBACK_SEPA_IBAN_OWN", ibanOwn],
    ["RAILBACK_SEPA_BIC_OWN", bicOwn],
    ["RAILBACK_SEPA_GLAEUBIGER_ID", glaeubigerId],
  ] as const) {
    if (!v || v.length === 0) {
      throw new AppError(
        "ERR_INTERNAL",
        `pain008: missing env var ${k}`,
        undefined,
        { field: k }
      );
    }
  }
  const kontoinhaberStr = kontoinhaber as string;
  // Config-level Max70Text guard: misconfiguration surfaces at readEnv()
  // so operators see a clear ERR_INTERNAL instead of an opaque bank XSD reject.
  if (kontoinhaberStr.length > 70) {
    throw new AppError(
      "ERR_INTERNAL",
      "pain008: env.kontoinhaber exceeds 70-char SEPA Max70Text limit",
      undefined,
      { field: "RAILBACK_SEPA_KONTOINHABER", length: kontoinhaberStr.length }
    );
  }
  return {
    kontoinhaber: kontoinhaberStr,
    ibanOwn: ibanOwn as string,
    bicOwn: bicOwn as string,
    glaeubigerId: glaeubigerId as string,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Minimal TARGET2 calendar approximation: skip Sat/Sun and four fixed dates.
// TODO: real TARGET2 calendar (Good Friday, Easter Monday, German bank-holidays etc.)
const FIXED_HOLIDAYS = new Set(["01-01", "05-01", "12-25", "12-26"]);

function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return !FIXED_HOLIDAYS.has(`${mm}-${dd}`);
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computeReqdColltnDt(builtAt: string, vorabankuendigungSentAt?: string): string {
  const base = new Date(builtAt);
  if (Number.isNaN(base.getTime())) {
    throw new AppError(
      "ERR_VALIDATION",
      `pain008: invalid builtAt "${builtAt}"`,
      undefined,
      { field: "builtAt" }
    );
  }
  // Start with builtAt + 1 calendar day. SEPA pre-notification window is
  // ≥1 calendar day before debit. The vorabankuendigung is typically sent
  // at mandate-issue time (days before approval), but on the legitimate
  // same-day approval path the vorabankuendigung might be only minutes
  // older than builtAt — defend by taking max(builtAt + 1d, vorab + 1d).
  let target = new Date(Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate() + 1
  ));
  if (vorabankuendigungSentAt !== undefined) {
    // If the caller supplies a vorabankuendigung timestamp it MUST parse.
    // Silently degrading to builtAt-only weakens the ≥1-day pre-notification
    // guarantee whenever the stored value is malformed (DB corruption,
    // admin-tooling bypass, partially-restored backup). Buildup step is
    // idempotent-precheck-gated so throwing here surfaces cleanly as a 500
    // to the operator retry path (`POST /admin/tickets/{id}/pain008-rebuild`).
    // Locked 2026-07-01 per audit finding `vorab-silent-degrade`.
    const vorab = new Date(vorabankuendigungSentAt);
    if (Number.isNaN(vorab.getTime())) {
      throw new AppError(
        "ERR_VALIDATION",
        `pain008: invalid vorabankuendigung_sent_at "${vorabankuendigungSentAt}"`,
        undefined,
        { field: "mandate.vorabankuendigung_sent_at" }
      );
    }
    const vorabPlusOne = new Date(Date.UTC(
      vorab.getUTCFullYear(),
      vorab.getUTCMonth(),
      vorab.getUTCDate() + 1
    ));
    if (vorabPlusOne.getTime() > target.getTime()) target = vorabPlusOne;
  }
  while (!isBusinessDay(target)) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return toIsoDate(target);
}

function dateOnly(iso: string, field: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(
      "ERR_VALIDATION",
      `pain008: invalid ${field} "${iso}"`,
      undefined,
      { field }
    );
  }
  return toIsoDate(d);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

// SEPA pain.008 XSD requires amounts in `Fractional2DecimalAmount` form:
// 1-2 decimal places, dot separator, no thousands sep, no currency suffix.
// compute-fee.ts is the contract source — today's flat "0.75" satisfies
// this, but ENTSCHAEDIGUNG_ZEITKARTE math via mulDecimal can produce 4-dp
// strings, and admin-tooling writes are not yet schema-policed. Fail
// loudly with ERR_VALIDATION so the malformed value never lands in the
// bank's XSD parser as an opaque 400.
const SEPA_AMOUNT_RE = /^[0-9]+\.[0-9]{2}$/;

function assertValidSepaAmount(amount: string, field: string): void {
  if (!SEPA_AMOUNT_RE.test(amount)) {
    throw new AppError(
      "ERR_VALIDATION",
      `pain008: amount must match /^[0-9]+\\.[0-9]{2}$/, got "${amount}"`,
      undefined,
      { field }
    );
  }
}

export function buildPain008Xml(input: BuildPain008Input): string {
  const env = readEnv();
  const { batchId, builtAt, mandate, ticket, debtorIbanPlain, debtorBicPlain } = input;

  // Validate mandate state + idempotency.
  if (mandate.mandate_state !== "ISSUED") {
    throw new AppError(
      "ERR_VALIDATION",
      `pain008: mandate_state must be ISSUED, got ${mandate.mandate_state}`,
      undefined,
      { field: "mandate.mandate_state" }
    );
  }
  if (mandate.pain008_built_at) {
    throw new AppError(
      "ERR_VALIDATION",
      "pain008: already built for this mandate",
      undefined,
      { field: "mandate.pain008_built_at" }
    );
  }
  if (mandate.sequence_type !== "OOFF") {
    throw new AppError(
      "ERR_VALIDATION",
      `pain008: sequence_type must be OOFF, got ${mandate.sequence_type}`,
      undefined,
      { field: "mandate.sequence_type" }
    );
  }
  if (cmpDecimal(mandate.fee_amount, "0.00") <= 0) {
    throw new AppError(
      "ERR_VALIDATION",
      `pain008: fee_amount must be > 0, got ${mandate.fee_amount}`,
      undefined,
      { field: "mandate.fee_amount" }
    );
  }
  // XSD Fractional2DecimalAmount conformance.
  assertValidSepaAmount(mandate.fee_amount, "mandate.fee_amount");
  // Vorabankündigung is mandatory ≥1 calendar day before debit. The /refund
  // issue path sets `vorabankuendigung_sent_at` at mandate-issue time; this
  // check hardens against an admin-tooling-created mandate or a partially-
  // restored backup that bypassed that path.
  if (!mandate.vorabankuendigung_sent_at) {
    throw new AppError(
      "ERR_VALIDATION",
      "pain008: vorabankuendigung_sent_at is required before pain008 build",
      undefined,
      { field: "mandate.vorabankuendigung_sent_at" }
    );
  }
  const builtAtMs = new Date(builtAt).getTime();
  const expiresMs = new Date(mandate.expires_at).getTime();
  if (Number.isNaN(builtAtMs)) {
    throw new AppError("ERR_VALIDATION", `pain008: invalid builtAt "${builtAt}"`, undefined, { field: "builtAt" });
  }
  if (Number.isNaN(expiresMs)) {
    throw new AppError("ERR_VALIDATION", `pain008: invalid mandate.expires_at`, undefined, { field: "mandate.expires_at" });
  }
  if (expiresMs <= builtAtMs) {
    throw new AppError(
      "ERR_VALIDATION",
      "pain008: mandate expired before builtAt",
      undefined,
      { field: "mandate.expires_at" }
    );
  }

  // IBAN/BIC/Gläubiger validation (debtor user-supplied + own from env).
  assertValidIban(debtorIbanPlain, "debtorIbanPlain");
  assertValidBic(debtorBicPlain, "debtorBicPlain");
  assertValidIban(env.ibanOwn, "RAILBACK_SEPA_IBAN_OWN");
  assertValidBic(env.bicOwn, "RAILBACK_SEPA_BIC_OWN");
  assertValidGlaeubigerId(env.glaeubigerId, "RAILBACK_SEPA_GLAEUBIGER_ID");

  const reqdColltnDt = computeReqdColltnDt(builtAt, mandate.vorabankuendigung_sent_at);
  const dtOfSgntr = dateOnly(mandate.user_consent_at, "mandate.user_consent_at");
  const creDtTm = new Date(builtAt).toISOString().replace(/\.\d{3}Z$/, "Z");

  const amount = mandate.fee_amount;
  const ustrd = truncate(
    `RailBack Service-Fee Antrag #${ticket.ticketId} Mandat ${mandate.mandate_id}`,
    140
  );
  // Truncation policy: combined vorname+nachname up to 100+100 chars each
  // could exceed 70; we truncate the snapshot to 70 to satisfy XSD Max70Text.
  // Acceptable because bank-side displays this name only on operator screens;
  // the user-side reference (`Ustrd`) carries the full ticketId + mandate_id
  // for unambiguous traceability. Truncate BEFORE escapeXml — same ordering
  // as ustrd above; escaping a truncated string is safe whereas truncating
  // an escaped string could split a `&amp;` mid-entity.
  const dbtrNm = truncate(mandate.kontoinhaber_snapshot, 70);

  const e = escapeXml;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.09">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${e(batchId)}</MsgId>
      <CreDtTm>${e(creDtTm)}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${e(amount)}</CtrlSum>
      <InitgPty>
        <Nm>${e(env.kontoinhaber)}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${e(batchId)}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${e(amount)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
        <LclInstrm>
          <Cd>CORE</Cd>
        </LclInstrm>
        <SeqTp>OOFF</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${e(reqdColltnDt)}</ReqdColltnDt>
      <Cdtr>
        <Nm>${e(env.kontoinhaber)}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <IBAN>${e(env.ibanOwn)}</IBAN>
        </Id>
      </CdtrAcct>
      <CdtrAgt>
        <FinInstnId>
          <BICFI>${e(env.bicOwn)}</BICFI>
        </FinInstnId>
      </CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId>
        <Id>
          <PrvtId>
            <Othr>
              <Id>${e(env.glaeubigerId)}</Id>
              <SchmeNm>
                <Prtry>SEPA</Prtry>
              </SchmeNm>
            </Othr>
          </PrvtId>
        </Id>
      </CdtrSchmeId>
      <DrctDbtTxInf>
        <PmtId>
          <EndToEndId>${e(mandate.mandate_id)}</EndToEndId>
        </PmtId>
        <InstdAmt Ccy="EUR">${e(amount)}</InstdAmt>
        <DrctDbtTx>
          <MndtRltdInf>
            <MndtId>${e(mandate.mandate_id)}</MndtId>
            <DtOfSgntr>${e(dtOfSgntr)}</DtOfSgntr>
          </MndtRltdInf>
        </DrctDbtTx>
        <DbtrAgt>
          <FinInstnId>
            <BICFI>${e(debtorBicPlain)}</BICFI>
          </FinInstnId>
        </DbtrAgt>
        <Dbtr>
          <Nm>${e(dbtrNm)}</Nm>
        </Dbtr>
        <DbtrAcct>
          <Id>
            <IBAN>${e(debtorIbanPlain)}</IBAN>
          </Id>
        </DbtrAcct>
        <RmtInf>
          <Ustrd>${e(ustrd)}</Ustrd>
        </RmtInf>
      </DrctDbtTxInf>
    </PmtInf>
  </CstmrDrctDbtInitn>
</Document>
`;

  return xml;
}
