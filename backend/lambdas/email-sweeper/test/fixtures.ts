// Shared fixtures for email-sweeper tests. Seeds tickets directly into the
// in-memory backend in the EMAIL_SENDING state with the right
// email_status/email_attempts/email_last_attempt combos for each pass.
//
// We bypass refund-pdf's pipeline entirely — the sweeper's contract is to
// re-send an already-persisted PDF, so the fixture just plants a dummy PDF
// blob + RenderedPdf metadata row at the canonical S3 key.

import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import { db } from "@railback/lib/storage";
import { emailHash } from "@railback/lib/util/hash";
import { ulid } from "@railback/lib/util/ulid";
import { hashPassword } from "@railback/lib/auth/password";

import type { EmailStatus } from "@railback/lib/types/enums";

import { _setSesClient } from "@railback/lib/email/send-email";

export const BOB_EMAIL = "bob@example.com";
export const BOB_PASSWORD = "swordfish-secret";
export const BOB_IBAN = "DE89370400440532013000";
export const BOB_BIC = "COBADEFFXXX";

const FAKE_PDF_BYTES = new Uint8Array(Buffer.from("%PDF-1.4 fake-rendered-pdf\n%%EOF\n"));

interface SesMockState {
  calls: Array<{ to?: string; ticketId?: string }>;
  callCount: number;
}

interface SesMockOpts {
  /**
   * Per-call behaviour. If absent (or array exhausted) the mock returns the
   * default success result. Each entry is one SES call response: either an
   * Ok (MessageId returned) or a throw with `name` (classified by
   * isTransientSesError).
   */
  responses?: Array<
    | { kind: "ok"; messageId: string }
    | { kind: "throw"; name: string; message?: string }
  >;
  /** Default outcome when the responses array runs out. */
  defaultMessageId?: string;
}

/**
 * Install a SES mock client. Returns the state object so tests can read
 * `state.calls` / `state.callCount` after the sweeper runs.
 */
export function installSesMock(opts: SesMockOpts = {}): SesMockState {
  const state: SesMockState = { calls: [], callCount: 0 };
  const responses = opts.responses ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _setSesClient({
    async send(cmd: any) {
      // SESv2 SendEmailCommand exposes input on cmd.input.
      const input = cmd?.input ?? {};
      // Decode the MIME just enough to extract the X-Ticket-Id header for
      // ordering assertions.
      let rawMime = "";
      const data = input?.Content?.Raw?.Data;
      if (data) {
        rawMime = Buffer.from(data).toString("utf8");
      }
      const ticketIdMatch = /^X-Ticket-Id:\s*(.+)$/m.exec(rawMime);
      const to = input?.Destination?.ToAddresses?.[0];
      const call: { to?: string; ticketId?: string } = {};
      if (to !== undefined) call.to = to;
      const ticketId = ticketIdMatch?.[1]?.trim();
      if (ticketId !== undefined) call.ticketId = ticketId;
      state.calls.push(call);
      const idx = state.callCount++;
      const planned = responses[idx];
      if (planned?.kind === "throw") {
        const err: Error & { name?: string } = new Error(planned.message ?? "boom");
        err.name = planned.name;
        throw err;
      }
      if (planned?.kind === "ok") {
        return { MessageId: planned.messageId };
      }
      return { MessageId: opts.defaultMessageId ?? "ses-msg-default" };
    },
  } as any);
  return state;
}

/** Ensure Bob's user row exists exactly once across multiple seed calls. */
async function ensureUserExists(email: string): Promise<void> {
  const existing = await db().users.getByEmail(email);
  if (existing) return;
  const hashed_password = await hashPassword(BOB_PASSWORD);
  await db().users.create({
    email,
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
    iban_enc: encryptIban(BOB_IBAN),
    bic_enc: encryptBic(BOB_BIC),
    datenschutz_einwilligung: true,
    agb_akzeptiert: true,
  });
}

async function persistFakeRenderedPdf(args: {
  email: string;
  ticketId: string;
  bytes?: Uint8Array;
}): Promise<void> {
  const s3_key = `rendered/${emailHash(args.email)}/${args.ticketId}.pdf`;
  const bytes = args.bytes ?? FAKE_PDF_BYTES;
  const now = new Date().toISOString();
  await db().blobs.putBytes(s3_key, bytes, "application/pdf", now);
  await db().blobs.putRenderedPdf(args.email, args.ticketId, {
    s3_bucket: "memory-mock",
    s3_key,
    size_bytes: bytes.byteLength,
    rendered_at: now,
  });
}

async function createBaseTicket(args: {
  email: string;
  ticketId: string;
}): Promise<void> {
  await db().tickets.createFromRoute({
    email: args.email,
    ticketId: args.ticketId,
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
}

export interface SeedRetryTicketOpts {
  email?: string;
  ticketId?: string;
  /** Defaults to "FAILED_TRANSIENT". */
  status?: EmailStatus;
  /** Defaults to 1. */
  attempts?: number;
  /** ISO-8601 timestamp; defaults to now. */
  lastAttemptIso?: string;
  /** Skip seeding the rendered-PDF blob (simulate render_missing). */
  noRenderedPdf?: boolean;
  /** Seed the metadata row but NOT the bytes (simulate S3-object gone). */
  noRenderedBytes?: boolean;
}

export interface SeededTicket {
  email: string;
  ticketId: string;
}

/**
 * Seed a ticket already in EMAIL_SENDING with a retry-eligible email_status
 * (default: FAILED_TRANSIENT, attempts=1). The GSI write-side filter in the
 * in-memory toItem() puts this into GSI_EMAIL_PENDING automatically.
 */
export async function seedRetryTicket(opts: SeedRetryTicketOpts = {}): Promise<SeededTicket> {
  const email = opts.email ?? BOB_EMAIL;
  const ticketId = opts.ticketId ?? ulid();
  await ensureUserExists(email);
  await createBaseTicket({ email, ticketId });

  const lastAttemptIso = opts.lastAttemptIso ?? new Date().toISOString();
  await db().tickets.patch(email, ticketId, {
    ticket_state: "EMAIL_SENDING",
    antragsart: "ENTSCHAEDIGUNG_120_PLUS",
    antragsgrund: ["VERSPAETUNG"],
    erwartete_erstattung: "60.00",
    service_fee_betrag: "0.75",
    delayMinutes: 130,
    submitted_at: lastAttemptIso,
    email_status: opts.status ?? "FAILED_TRANSIENT",
    email_attempts: opts.attempts ?? 1,
    email_last_attempt: lastAttemptIso,
  });

  if (!opts.noRenderedPdf) {
    if (opts.noRenderedBytes) {
      // Write the metadata row pointing at a key the blob store doesn't have.
      const s3_key = `rendered/${emailHash(email)}/${ticketId}.pdf`;
      const now = new Date().toISOString();
      await db().blobs.putRenderedPdf(email, ticketId, {
        s3_bucket: "memory-mock",
        s3_key,
        size_bytes: 0,
        rendered_at: now,
      });
    } else {
      await persistFakeRenderedPdf({ email, ticketId });
    }
  }

  return { email, ticketId };
}

export interface SeedWatchdogTicketOpts {
  email?: string;
  ticketId?: string;
  /** ISO timestamp for `email_last_attempt`. Required — the watchdog cares about exactly this value. */
  lastAttemptIso: string;
  /** Override the email_status (defaults to SENT — the watchdog target). */
  status?: EmailStatus;
  /** Override the ticket_state (defaults to EMAIL_SENDING). */
  ticketState?: "EMAIL_SENDING" | "PENDING_DB_PAYMENT" | "EMAIL_FAILED";
  attempts?: number;
}

/**
 * Seed a ticket in EMAIL_SENDING+SENT that is N hours old — i.e. the
 * watchdog target. With ticketState/status overrides, also serves as the
 * negative fixture (untouched tickets).
 */
export async function seedWatchdogTicket(opts: SeedWatchdogTicketOpts): Promise<SeededTicket> {
  const email = opts.email ?? BOB_EMAIL;
  const ticketId = opts.ticketId ?? ulid();
  await ensureUserExists(email);
  await createBaseTicket({ email, ticketId });

  await db().tickets.patch(email, ticketId, {
    ticket_state: opts.ticketState ?? "EMAIL_SENDING",
    antragsart: "ENTSCHAEDIGUNG_120_PLUS",
    antragsgrund: ["VERSPAETUNG"],
    erwartete_erstattung: "60.00",
    service_fee_betrag: "0.75",
    delayMinutes: 130,
    submitted_at: opts.lastAttemptIso,
    email_status: opts.status ?? "SENT",
    email_attempts: opts.attempts ?? 1,
    email_last_attempt: opts.lastAttemptIso,
    email_provider_id: "ses-prev-" + ticketId,
  });

  await persistFakeRenderedPdf({ email, ticketId });
  return { email, ticketId };
}
