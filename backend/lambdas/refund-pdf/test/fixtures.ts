// Shared fixtures for refund-pdf tests. Seeds a user + ticket pair already
// in EMAIL_SENDING (i.e. user-handler post-refund just finished), plus a
// matching SepaMandate row with snapshotted IBAN/BIC.

import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import { db } from "@railback/lib/storage";
import { ulid } from "@railback/lib/util/ulid";
import { hashPassword } from "@railback/lib/auth/password";

export const BOB_EMAIL = "bob@example.com";
export const BOB_PASSWORD = "swordfish-secret";
export const BOB_IBAN = "DE89370400440532013000";
export const BOB_BIC = "COBADEFFXXX";

export interface SeedOptions {
  /** Overrides; pass through to the ticket patch. */
  ticketPatch?: Parameters<ReturnType<typeof db>["tickets"]["patch"]>[2];
  /** Omit the SepaMandate row (zero-fee waiver flow). */
  noMandate?: boolean;
  /** Skip storing IBAN/BIC on the user row (force mandate-snapshot path). */
  noUserBank?: boolean;
}

export interface SeededTicket {
  email: string;
  ticketId: string;
}

/**
 * Seed a user + EMAIL_SENDING ticket + (optional) SepaMandate. Returns the
 * ticketId so tests can call renderAndSend({ email, ticketId }).
 */
export async function seedSubmittedTicket(opts: SeedOptions = {}): Promise<SeededTicket> {
  const ticketId = ulid();
  const hashed_password = await hashPassword(BOB_PASSWORD);
  const ibanEnc = encryptIban(BOB_IBAN);
  const bicEnc = encryptBic(BOB_BIC);

  await db().users.create({
    email: BOB_EMAIL,
    vorname: "Bob",
    nachname: "Schmidt",
    telefon: "+49 151 9999999",
    adresse: {
      strasse: "Hauptstr.",
      hausnr: "1",
      plz: "60311",
      ort: "Frankfurt",
      land: "DE",
    },
    hashed_password,
    iban_enc: opts.noUserBank ? "" : ibanEnc,
    bic_enc: opts.noUserBank ? "" : bicEnc,
    datenschutz_einwilligung: true,
    agb_akzeptiert: true,
  });

  // Create the ticket via the MANUAL_ROUTE path so it starts in READY,
  // then patch it into EMAIL_SENDING with the fields refund-pdf needs.
  const now = new Date().toISOString();
  await db().tickets.createFromRoute({
    email: BOB_EMAIL,
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

  await db().tickets.patch(BOB_EMAIL, ticketId, {
    ticket_state: "EMAIL_SENDING",
    antragsart: "ENTSCHAEDIGUNG_120_PLUS",
    antragsgrund: ["VERSPAETUNG"],
    erwartete_erstattung: "60.00",
    service_fee_betrag: "0.75",
    delayMinutes: 130,
    submitted_at: now,
    email_status: "SENDING",
    email_attempts: 0,
    email_last_attempt: now,
    ...(opts.ticketPatch ?? {}),
  });

  if (!opts.noMandate) {
    await db().mandates.issue(BOB_EMAIL, ticketId, {
      ticketId,
      fee_amount: "0.75",
      iban_enc: ibanEnc,
      bic_enc: bicEnc,
      kontoinhaber_snapshot: "Bob Schmidt",
      user_consent_at: now,
    });
  }

  return { email: BOB_EMAIL, ticketId };
}

/**
 * Seed a beleg blob (bytes + Receipt metadata row). Reuses the public
 * putReceipt API and also pre-populates the bytes at the configured s3_key
 * via the BlobRepo's getBytes/putBytes seam.
 */
export async function seedBeleg(args: {
  email: string;
  ticketId: string;
  belegId?: string;
  filename?: string;
  contentType: string;
  bytes: Uint8Array;
  amount?: string;
}): Promise<{ s3_key: string; belegId: string }> {
  const belegId = args.belegId ?? ulid();
  const ext = args.contentType === "application/pdf" ? "pdf"
    : args.contentType === "image/png" ? "png"
    : "jpg";
  // Mirror in-memory BlobRepo's `belege/<hash>/<ticketId>/<belegId>.<ext>`
  // pattern. The exact path doesn't matter — we put bytes + receipt under
  // the same key, and the merger fetches via getBytes(s3_key).
  const s3_key = `belege/test/${args.ticketId}/${belegId}.${ext}`;
  const now = new Date().toISOString();

  await db().blobs.putBytes(s3_key, args.bytes, args.contentType, now);
  await db().blobs.putReceipt(args.email, args.ticketId, {
    belegId,
    filename: args.filename ?? `beleg.${ext}`,
    s3_bucket: "memory-mock",
    s3_key,
    content_type: args.contentType,
    size_bytes: args.bytes.byteLength,
    typ: "SONSTIGES",
    amount: args.amount ?? "10.00",
    uploaded_at: now,
  });
  return { s3_key, belegId };
}
