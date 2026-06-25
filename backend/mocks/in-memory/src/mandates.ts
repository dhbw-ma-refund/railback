import { AppError } from "@railback/lib";
import { keys, ulid } from "@railback/lib";
import type {
  MandateRepo,
  NewMandate,
  SepaMandate,
} from "@railback/lib";
import type { SepaMandateItem } from "@railback/lib";

import { getRow, type MemState, putRow } from "./state.js";

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;
const MANDATE_TTL_MONTHS = 36;

function toItem(email: string, m: SepaMandate): SepaMandateItem {
  const norm = keys.normaliseEmail(email);
  const item: SepaMandateItem = {
    PK: keys.userPk(norm),
    SK: keys.mandateSk(m.ticketId),
    mandate_id: m.mandate_id,
    mandate_state: m.mandate_state,
    sequence_type: m.sequence_type,
    fee_amount: m.fee_amount,
    iban_enc: m.iban_enc,
    bic_enc: m.bic_enc,
    kontoinhaber_snapshot: m.kontoinhaber_snapshot,
    user_consent_at: m.user_consent_at,
    expires_at: m.expires_at,
    issued_at: m.issued_at,
  };
  const opt = [
    "user_consent_ip", "user_consent_user_agent", "vorabankuendigung_sent_at",
    "pain008_built_at", "pain008_batch_id", "pain008_s3_key",
    "pain008_submitted_at", "debited_at", "reversed_at", "reversed_reason",
    "dispute_opened_at", "ttl",
  ] as const;
  for (const k of opt) {
    const v = m[k];
    if (v !== undefined) (item as unknown as Record<string, unknown>)[k] = v;
  }
  return item;
}

function fromItem(it: SepaMandateItem): SepaMandate {
  const email = keys.parseUserPk(it.PK);
  if (!email) throw new AppError("ERR_INTERNAL", `bad PK ${it.PK}`);
  // SK = TICKET#<ticketId>#MANDATE
  const skBody = it.SK.slice("TICKET#".length, -"#MANDATE".length);
  const m: SepaMandate = {
    email,
    ticketId: skBody,
    mandate_id: it.mandate_id,
    mandate_state: it.mandate_state,
    sequence_type: it.sequence_type,
    fee_amount: it.fee_amount,
    iban_enc: it.iban_enc,
    bic_enc: it.bic_enc,
    kontoinhaber_snapshot: it.kontoinhaber_snapshot,
    user_consent_at: it.user_consent_at,
    expires_at: it.expires_at,
    issued_at: it.issued_at,
  };
  const opt = [
    "user_consent_ip", "user_consent_user_agent", "vorabankuendigung_sent_at",
    "pain008_built_at", "pain008_batch_id", "pain008_s3_key",
    "pain008_submitted_at", "debited_at", "reversed_at", "reversed_reason",
    "dispute_opened_at", "ttl",
  ] as const;
  for (const k of opt) {
    const v = (it as unknown as Record<string, unknown>)[k];
    if (v !== undefined) (m as unknown as Record<string, unknown>)[k] = v;
  }
  return m;
}

export class InMemoryMandateRepo implements MandateRepo {
  constructor(private readonly state: MemState) {}

  async get(email: string, id: string): Promise<SepaMandate | null> {
    const it = getRow<SepaMandateItem>(this.state, keys.userPk(email), keys.mandateSk(id));
    return it ? fromItem(it) : null;
  }

  async issue(email: string, id: string, mandate: NewMandate): Promise<SepaMandate> {
    const issuedAt = new Date().toISOString();
    const expires = new Date(Date.parse(issuedAt) + MANDATE_TTL_MONTHS * MS_PER_MONTH).toISOString();
    const m: SepaMandate = {
      email: keys.normaliseEmail(email),
      ticketId: id,
      mandate_id: ulid(),
      mandate_state: "ISSUED",
      sequence_type: "OOFF",
      fee_amount: mandate.fee_amount,
      iban_enc: mandate.iban_enc,
      bic_enc: mandate.bic_enc,
      kontoinhaber_snapshot: mandate.kontoinhaber_snapshot,
      user_consent_at: mandate.user_consent_at,
      expires_at: expires,
      issued_at: issuedAt,
    };
    if (mandate.user_consent_ip !== undefined) m.user_consent_ip = mandate.user_consent_ip;
    if (mandate.user_consent_user_agent !== undefined) m.user_consent_user_agent = mandate.user_consent_user_agent;
    if (mandate.vorabankuendigung_sent_at !== undefined) m.vorabankuendigung_sent_at = mandate.vorabankuendigung_sent_at;
    const item = toItem(email, m);
    putRow(this.state, item.PK, item.SK, item);
    return m;
  }

  private async update(email: string, id: string, mut: (it: SepaMandateItem) => SepaMandateItem): Promise<void> {
    const it = getRow<SepaMandateItem>(this.state, keys.userPk(email), keys.mandateSk(id));
    if (!it) throw new AppError("ERR_NOT_FOUND", `Mandate for ticket ${id} not found`);
    const next = mut(it);
    putRow(this.state, next.PK, next.SK, next);
  }

  async stampPain008Built(email: string, id: string, info: { batchId: string; s3Key: string; builtAt: string }): Promise<void> {
    await this.update(email, id, (it) => ({
      ...it,
      pain008_built_at: info.builtAt,
      pain008_batch_id: info.batchId,
      pain008_s3_key: info.s3Key,
    }));
  }

  async markSubmitted(email: string, id: string, submittedAt: string): Promise<void> {
    await this.update(email, id, (it) => ({
      ...it,
      mandate_state: "SUBMITTED",
      pain008_submitted_at: submittedAt,
    }));
  }

  async markDebited(email: string, id: string, debitedAt: string): Promise<void> {
    await this.update(email, id, (it) => ({
      ...it,
      mandate_state: "DEBITED",
      debited_at: debitedAt,
    }));
  }

  async markReversed(email: string, id: string, info: { reversedAt: string; reason: string }): Promise<void> {
    await this.update(email, id, (it) => ({
      ...it,
      mandate_state: "REVERSED",
      reversed_at: info.reversedAt,
      reversed_reason: info.reason,
    }));
  }

  async markDisputed(email: string, id: string, disputeOpenedAt: string): Promise<void> {
    await this.update(email, id, (it) => ({
      ...it,
      mandate_state: "DISPUTED",
      dispute_opened_at: disputeOpenedAt,
    }));
  }

  async markExpired(email: string, id: string): Promise<void> {
    await this.update(email, id, (it) => ({ ...it, mandate_state: "EXPIRED" }));
  }

  async markCancelled(email: string, id: string): Promise<void> {
    await this.update(email, id, (it) => ({ ...it, mandate_state: "CANCELLED" }));
  }

  async listPendingBatches(): Promise<SepaMandate[]> {
    // ARCHITECTURE.md (line 478) defines pending as:
    //   mandate_state === "ISSUED"
    //     AND pain008_built_at IS NOT NULL   (XML has been built)
    //     AND pain008_submitted_at IS NULL   (admin hasn't bank-uploaded yet)
    // SUBMITTED mandates have already been handed to the bank — they are
    // NOT pending; the sepa-reports Lambda owns their next transition.
    const out: SepaMandate[] = [];
    for (const [pk, bucket] of this.state.rows) {
      if (!pk.startsWith("USER#")) continue;
      for (const [sk, item] of bucket) {
        if (!sk.endsWith("#MANDATE")) continue;
        const it = item as SepaMandateItem;
        if (
          it.mandate_state === "ISSUED" &&
          it.pain008_built_at &&
          !it.pain008_submitted_at
        ) {
          out.push(fromItem(it));
        }
      }
    }
    return out;
  }

  async listExpiringISSUED(now: string): Promise<SepaMandate[]> {
    const out: SepaMandate[] = [];
    for (const [pk, bucket] of this.state.rows) {
      if (!pk.startsWith("USER#")) continue;
      for (const [sk, item] of bucket) {
        if (!sk.endsWith("#MANDATE")) continue;
        const it = item as SepaMandateItem;
        if (it.mandate_state === "ISSUED" && it.expires_at < now) out.push(fromItem(it));
      }
    }
    return out;
  }
}
