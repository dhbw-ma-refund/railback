// handler.spec.ts — end-to-end generatePain008 pipeline against the
// in-memory backend. Covers the happy path + idempotency + state guards
// + validator failures + decryption failure + persist failure.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Buffer } from "node:buffer";

import { generatePain008 } from "../src/handler.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import { db } from "@railback/lib/storage";
import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import { hashPassword } from "@railback/lib/auth/password";
import { ulid } from "@railback/lib/util/ulid";
import { _activeMemState } from "@railback/mocks-in-memory";
import * as keys from "@railback/lib/storage/ddb/keys";

const TEST_EMAIL = "carol@example.com";
const TEST_IBAN = "DE89370400440532013000";
const TEST_BIC = "COBADEFFXXX";

interface SeedOpts {
  mandate_state?: import("@railback/lib/types/dto").SepaMandate["mandate_state"];
  expires_at?: string;
  pain008_built_at?: string;
  pain008_batch_id?: string;
  pain008_s3_key?: string;
  fee_amount?: string;
  noMandate?: boolean;
  noTicket?: boolean;
  ibanEnc?: string;
  bicEnc?: string;
  vorabankuendigungSentAt?: string | null; // null → omit (validator-failure tests)
}

async function seedMandated(opts: SeedOpts = {}): Promise<{ email: string; ticketId: string }> {
  const ticketId = ulid();
  const hashed_password = await hashPassword("carol-hunter2");
  const ibanEnc = opts.ibanEnc ?? encryptIban(TEST_IBAN);
  const bicEnc = opts.bicEnc ?? encryptBic(TEST_BIC);

  await db().users.create({
    email: TEST_EMAIL,
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
    iban_enc: ibanEnc,
    bic_enc: bicEnc,
    datenschutz_einwilligung: true,
    agb_akzeptiert: true,
  });

  if (!opts.noTicket) {
    const now = new Date().toISOString();
    await db().tickets.createFromRoute({
      email: TEST_EMAIL,
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
      is_zeitkarte: false,
    });
    await db().tickets.patch(TEST_EMAIL, ticketId, {
      ticket_state: "APPROVED",
      antragsart: "ENTSCHAEDIGUNG_120_PLUS",
      antragsgrund: ["VERSPAETUNG"],
      erwartete_erstattung: "60.00",
      service_fee_betrag: "0.75",
      delayMinutes: 130,
      submitted_at: now,
    });
  }

  if (!opts.noMandate) {
    const vorab = opts.vorabankuendigungSentAt === null
      ? undefined
      : opts.vorabankuendigungSentAt ?? new Date().toISOString();
    await db().mandates.issue(TEST_EMAIL, ticketId, {
      ticketId,
      fee_amount: opts.fee_amount ?? "0.75",
      iban_enc: ibanEnc,
      bic_enc: bicEnc,
      kontoinhaber_snapshot: "Carol Schmidt",
      user_consent_at: new Date().toISOString(),
      ...(vorab !== undefined ? { vorabankuendigung_sent_at: vorab } : {}),
    });
    // Mandate state defaults to ISSUED on issue(). Override via direct
    // state-flip helpers if asked. Do NOT pre-stamp pain008_built_at here
    // even for SUBMITTED/DEBITED — otherwise the handler's idempotency
    // pre-check would short-circuit before reaching the state-guard.
    if (opts.mandate_state && opts.mandate_state !== "ISSUED") {
      switch (opts.mandate_state) {
        case "SUBMITTED":
          await db().mandates.markSubmitted(TEST_EMAIL, ticketId, new Date().toISOString());
          break;
        case "DEBITED":
          await db().mandates.markSubmitted(TEST_EMAIL, ticketId, new Date().toISOString());
          await db().mandates.markDebited(TEST_EMAIL, ticketId, new Date().toISOString());
          break;
        case "REVERSED":
          await db().mandates.markSubmitted(TEST_EMAIL, ticketId, new Date().toISOString());
          await db().mandates.markDebited(TEST_EMAIL, ticketId, new Date().toISOString());
          await db().mandates.markReversed(TEST_EMAIL, ticketId, {
            reversedAt: new Date().toISOString(),
            reason: "MS03",
          });
          break;
        case "DISPUTED":
          await db().mandates.markSubmitted(TEST_EMAIL, ticketId, new Date().toISOString());
          await db().mandates.markDebited(TEST_EMAIL, ticketId, new Date().toISOString());
          await db().mandates.markDisputed(TEST_EMAIL, ticketId, new Date().toISOString());
          break;
        case "EXPIRED":
          await db().mandates.markExpired(TEST_EMAIL, ticketId);
          break;
        case "CANCELLED":
          await db().mandates.markCancelled(TEST_EMAIL, ticketId);
          break;
        default:
          throw new Error(`seedMandated: unsupported state ${opts.mandate_state}`);
      }
    }
    if (opts.pain008_built_at && opts.pain008_batch_id && opts.pain008_s3_key) {
      // stampPain008Built is conditional (SEPA_PAIN008.md §7) — only valid
      // when state is still ISSUED and pain008_built_at is not yet set.
      // Callers using this must NOT also pass mandate_state.
      await db().mandates.stampPain008Built(TEST_EMAIL, ticketId, {
        batchId: opts.pain008_batch_id,
        s3Key: opts.pain008_s3_key,
        builtAt: opts.pain008_built_at,
      });
    }
  }

  return { email: TEST_EMAIL, ticketId };
}

describe("generatePain008", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("happy path: mandate ISSUED → XML in S3 + mandate stamped", async () => {
    const { email, ticketId } = await seedMandated();

    await generatePain008({ email, ticketId });

    const after = await db().mandates.get(email, ticketId);
    expect(after).not.toBeNull();
    expect(after!.pain008_built_at).toBeDefined();
    expect(after!.pain008_batch_id).toBeDefined();
    expect(after!.pain008_s3_key).toBeDefined();
    // Mandate stays in ISSUED — admin flips to SUBMITTED later.
    expect(after!.mandate_state).toBe("ISSUED");

    // XML bytes are at the canonical key.
    const key = after!.pain008_s3_key!;
    expect(key).toMatch(/^pain008\/\d{4}-\d{2}\/[0-9A-HJKMNP-TV-Z]{26}\.xml$/);
    const blob = await db().blobs.getBytes(key);
    expect(blob).not.toBeNull();
    expect(blob!.contentType).toBe("application/xml");
    const xml = Buffer.from(blob!.bytes).toString("utf-8");
    expect(xml).toContain("<Document xmlns=\"urn:iso:std:iso:20022:tech:xsd:pain.008.001.09\">");
    expect(xml).toContain(`<MsgId>${after!.pain008_batch_id}</MsgId>`);
    // ticketId leaks into the <Ustrd> line per pain008.ts.
    expect(xml).toContain(ticketId);
  });

  it("idempotency: pain008_built_at already set → no-op, no new S3 write", async () => {
    const { email, ticketId } = await seedMandated({
      pain008_built_at: "2026-06-28T12:00:00.000Z",
      pain008_batch_id: "01HSEEDEDPRIORPAIN0080000",
      pain008_s3_key: "pain008/2026-06/01HSEEDEDPRIORPAIN0080000.xml",
    });

    const before = await db().mandates.get(email, ticketId);
    expect(before!.pain008_built_at).toBe("2026-06-28T12:00:00.000Z");

    await generatePain008({ email, ticketId });

    const after = await db().mandates.get(email, ticketId);
    // Unchanged.
    expect(after!.pain008_built_at).toBe("2026-06-28T12:00:00.000Z");
    expect(after!.pain008_batch_id).toBe("01HSEEDEDPRIORPAIN0080000");
    expect(after!.pain008_s3_key).toBe("pain008/2026-06/01HSEEDEDPRIORPAIN0080000.xml");
    // No bytes at that key (we never actually wrote them in the seed —
    // proves we didn't write any either).
    const blob = await db().blobs.getBytes(after!.pain008_s3_key!);
    expect(blob).toBeNull();
  });

  it("ERR_NOT_FOUND when mandate is missing (zero-fee waiver path)", async () => {
    const { email, ticketId } = await seedMandated({ noMandate: true });

    await expect(generatePain008({ email, ticketId })).rejects.toMatchObject({
      code: "ERR_NOT_FOUND",
    });
  });

  it.each([
    ["SUBMITTED"] as const,
    ["DEBITED"] as const,
    ["REVERSED"] as const,
    ["DISPUTED"] as const,
    ["EXPIRED"] as const,
    ["CANCELLED"] as const,
  ])("ERR_VALIDATION when mandate_state = %s, no S3 write, no stamp", async (state) => {
    const { email, ticketId } = await seedMandated({ mandate_state: state });

    const before = await db().mandates.get(email, ticketId);
    const builtAtBefore = before!.pain008_built_at;

    await expect(generatePain008({ email, ticketId })).rejects.toMatchObject({
      code: "ERR_VALIDATION",
    });

    const after = await db().mandates.get(email, ticketId);
    // Mandate state untouched.
    expect(after!.mandate_state).toBe(before!.mandate_state);
    expect(after!.pain008_built_at).toBe(builtAtBefore);
  });

  it("ERR_VALIDATION when mandate has expired (expires_at < builtAt)", async () => {
    // Reach into the mem-state to backdate `expires_at` on the stored row.
    // `db().mandates.get()` returns a clone (fromItem(...)), so a top-level
    // mutation wouldn't survive. We mutate the underlying SepaMandateItem
    // directly. The handler reads via .get() — by then the new expires_at
    // is the value on the row.
    const { email, ticketId } = await seedMandated();
    const state = _activeMemState();
    expect(state).not.toBeNull();
    const bucket = state!.rows.get(keys.userPk(email));
    expect(bucket).not.toBeUndefined();
    const row = bucket!.get(keys.mandateSk(ticketId)) as { expires_at?: string } | undefined;
    expect(row).toBeDefined();
    row!.expires_at = "2020-01-01T00:00:00.000Z";

    await expect(generatePain008({ email, ticketId })).rejects.toMatchObject({
      code: "ERR_VALIDATION",
    });
    // Mandate not stamped.
    const after = await db().mandates.get(email, ticketId);
    expect(after!.pain008_built_at).toBeUndefined();
  });

  it("ERR_VALIDATION when the decrypted IBAN fails mod97", async () => {
    // Encrypt a non-mod97-valid (but format-correct) IBAN.
    const badIban = encryptIban("DE00370400440532013000");
    const { email, ticketId } = await seedMandated({ ibanEnc: badIban });

    await expect(generatePain008({ email, ticketId })).rejects.toMatchObject({
      code: "ERR_VALIDATION",
    });
    // Mandate not stamped.
    const after = await db().mandates.get(email, ticketId);
    expect(after!.pain008_built_at).toBeUndefined();
  });

  it("ERR_INTERNAL when a SEPA env var is missing", async () => {
    const { email, ticketId } = await seedMandated();
    // Use vi.stubEnv("","") instead of `delete process.env.X` so the
    // afterEach unstub is guaranteed to restore. pain008.ts treats
    // empty-string as missing (`!v || v.length === 0`).
    vi.stubEnv("RAILBACK_SEPA_GLAEUBIGER_ID", "");

    const p = generatePain008({ email, ticketId });
    await expect(p).rejects.toMatchObject({ code: "ERR_INTERNAL" });
    await expect(p).rejects.toThrow(/missing env var/);
  });

  it("ERR_INTERNAL when iban_enc ciphertext can't be decrypted", async () => {
    const { email, ticketId } = await seedMandated({ ibanEnc: "not-base64-garbage" });

    const p = generatePain008({ email, ticketId });
    await expect(p).rejects.toMatchObject({ code: "ERR_INTERNAL" });
    await expect(p).rejects.toThrow(/could not be decrypted/);
  });

  it("S3 putBytes failure → error propagates, mandate NOT stamped", async () => {
    const { email, ticketId } = await seedMandated();
    const repo = db().blobs;
    const orig = repo.putBytes.bind(repo);
    repo.putBytes = async () => {
      throw new Error("S3 unavailable");
    };
    try {
      await expect(generatePain008({ email, ticketId })).rejects.toThrow(/S3 unavailable/);
    } finally {
      repo.putBytes = orig;
    }
    const after = await db().mandates.get(email, ticketId);
    expect(after!.pain008_built_at).toBeUndefined();
    expect(after!.pain008_batch_id).toBeUndefined();
    expect(after!.pain008_s3_key).toBeUndefined();
  });

  it("ERR_INTERNAL when the ticket vanished but mandate exists (race)", async () => {
    const { email, ticketId } = await seedMandated();
    // Hard-delete the ticket while keeping the mandate. The in-memory repo
    // doesn't expose a direct delete, but we can use the tickets.patch to
    // shove it into INVALID, then anon-sweep. Easier: walk the underlying
    // state via the helper. Simplest: just call the public test path —
    // skip if too involved. The mocks don't expose hard-delete, so we
    // instead null-out by overriding tickets.get with a spy.
    const tRepo = db().tickets;
    const origGet = tRepo.get.bind(tRepo);
    tRepo.get = async () => null;
    try {
      await expect(generatePain008({ email, ticketId })).rejects.toMatchObject({
        code: "ERR_INTERNAL",
      });
    } finally {
      tRepo.get = origGet;
    }
  });

  // --- Regression coverage for adversarial review --------------------------

  it("ERR_VALIDATION when vorabankuendigung_sent_at is missing on the mandate", async () => {
    const { email, ticketId } = await seedMandated({ vorabankuendigungSentAt: null });
    await expect(generatePain008({ email, ticketId })).rejects.toMatchObject({
      code: "ERR_VALIDATION",
    });
    const after = await db().mandates.get(email, ticketId);
    expect(after!.pain008_built_at).toBeUndefined();
  });

  it("ERR_VALIDATION when fee_amount fails SEPA Fractional2DecimalAmount", async () => {
    // Bypass NewMandate type-checking to inject a malformed fee_amount
    // (4dp instead of 2dp). The mandate row will carry "0.7500" — bank
    // XSD would reject; we reject earlier with a structured error.
    const { email, ticketId } = await seedMandated({ fee_amount: "0.7500" });
    await expect(generatePain008({ email, ticketId })).rejects.toMatchObject({
      code: "ERR_VALIDATION",
    });
    const after = await db().mandates.get(email, ticketId);
    expect(after!.pain008_built_at).toBeUndefined();
  });

  it("stampPain008Built is conditional: a second stamp on already-stamped throws ERR_CONFLICT", async () => {
    // Direct exercise of the repo-level idempotency guard (SEPA_PAIN008.md §7).
    // This is the contract the handler's orphan-cleanup relies on.
    const { email, ticketId } = await seedMandated();
    await db().mandates.stampPain008Built(email, ticketId, {
      batchId: "01HFIRSTBATCH00000000000",
      s3Key: "pain008/2026-06/01HFIRSTBATCH00000000000.xml",
      builtAt: "2026-06-15T12:00:00.000Z",
    });
    await expect(
      db().mandates.stampPain008Built(email, ticketId, {
        batchId: "01HSECONDBATCH0000000000",
        s3Key: "pain008/2026-06/01HSECONDBATCH0000000000.xml",
        builtAt: "2026-06-15T13:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "ERR_CONFLICT" });
    const after = await db().mandates.get(email, ticketId);
    // First write wins.
    expect(after!.pain008_batch_id).toBe("01HFIRSTBATCH00000000000");
  });

  it("orphan S3 cleanup runs when stamp loses the race (double-build → first wins, second deletes its own bytes)", async () => {
    // Simulate the double-build race: pre-stamp the mandate by-hand so the
    // handler's TOCTOU pre-check passes (we delete the stamp again right
    // before the actual stamping step), but the conditional stamp inside
    // the handler then loses. The handler must delete the just-written S3
    // object so the 10y audit prefix doesn't accumulate orphans with
    // cleartext debtor data.
    const { email, ticketId } = await seedMandated();

    // Intercept stampPain008Built: on the next call, force an ERR_CONFLICT
    // (simulates "another concurrent invoke already stamped").
    const mRepo = db().mandates;
    const origStamp = mRepo.stampPain008Built.bind(mRepo);
    mRepo.stampPain008Built = async () => {
      const { AppError } = await import("@railback/lib/errors");
      throw new AppError("ERR_CONFLICT", "race", undefined, {
        field: "mandate.pain008_built_at",
      });
    };

    // Capture the S3 key the handler tried to write.
    const blobRepo = db().blobs;
    const origPut = blobRepo.putBytes.bind(blobRepo);
    let writtenKey: string | undefined;
    blobRepo.putBytes = async (key, bytes, contentType, uploadedAt) => {
      writtenKey = key;
      return origPut(key, bytes, contentType, uploadedAt);
    };

    try {
      await expect(generatePain008({ email, ticketId })).rejects.toMatchObject({
        code: "ERR_CONFLICT",
      });
      expect(writtenKey).toBeDefined();
      // The orphan-cleanup path must have deleted the just-written object.
      const blob = await db().blobs.getBytes(writtenKey!);
      expect(blob).toBeNull();
    } finally {
      mRepo.stampPain008Built = origStamp;
      blobRepo.putBytes = origPut;
    }
  });
});
