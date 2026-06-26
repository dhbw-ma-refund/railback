// Coverage for the email-retry-queue helpers added in Phase 2.6:
//   - TicketRepo.queryEmailPending — drives email-sweeper Pass A
//   - TicketRepo.scanEmailWatchdog — drives email-sweeper Pass B (24h stuck)

import { describe, expect, it } from "vitest";
import type { NewTicket } from "@railback/lib";

import { buildMemoryDb } from "../src/index.js";

function newTicket(email: string, id: string): NewTicket {
  return {
    email,
    ticketId: id,
    filename: "t.pdf",
    s3_key: `raw/x/${id}.pdf`,
    mimeType: "application/pdf",
    contentType: "application/pdf",
    sizeBytes: 1,
    uploadedAt: "2026-06-20T10:00:00Z",
  };
}

async function seedFailedTransient(
  db: ReturnType<typeof buildMemoryDb>,
  opts: { email: string; id: string; attempts: number; lastAttempt: string },
): Promise<void> {
  await db.tickets.create(newTicket(opts.email, opts.id));
  await db.tickets.patch(opts.email, opts.id, {
    ticket_state: "EMAIL_SENDING",
    email_status: "FAILED_TRANSIENT",
    email_attempts: opts.attempts,
    email_last_attempt: opts.lastAttempt,
  });
}

async function seedSent(
  db: ReturnType<typeof buildMemoryDb>,
  opts: { email: string; id: string; lastAttempt: string },
): Promise<void> {
  await db.tickets.create(newTicket(opts.email, opts.id));
  await db.tickets.patch(opts.email, opts.id, {
    ticket_state: "EMAIL_SENDING",
    email_status: "SENT",
    email_attempts: 1,
    email_last_attempt: opts.lastAttempt,
    email_provider_id: "ses-msg-" + opts.id,
  });
}

describe("InMemoryTicketRepo.queryEmailPending", () => {
  it("returns FAILED_TRANSIENT tickets oldest-first, omits SENT/DELIVERED", async () => {
    const db = buildMemoryDb();
    await seedFailedTransient(db, {
      email: "a@x.de", id: "T_NEW", attempts: 1,
      lastAttempt: "2026-06-26T10:00:00Z",
    });
    await seedFailedTransient(db, {
      email: "a@x.de", id: "T_OLD", attempts: 2,
      lastAttempt: "2026-06-26T09:00:00Z",
    });
    await seedSent(db, {
      email: "a@x.de", id: "T_SENT", lastAttempt: "2026-06-26T09:30:00Z",
    });

    const queue = await db.tickets.queryEmailPending(10);
    expect(queue.map((t) => t.ticketId)).toEqual(["T_OLD", "T_NEW"]);
  });

  it("respects the limit argument", async () => {
    const db = buildMemoryDb();
    for (let i = 0; i < 5; i++) {
      await seedFailedTransient(db, {
        email: "a@x.de",
        id: `T${i}`,
        attempts: 1,
        lastAttempt: `2026-06-26T1${i}:00:00Z`,
      });
    }
    const queue = await db.tickets.queryEmailPending(2);
    expect(queue).toHaveLength(2);
    expect(queue.map((t) => t.ticketId)).toEqual(["T0", "T1"]);
  });

  it("omits tickets at attempts >= 3 (GSI write-side gate)", async () => {
    const db = buildMemoryDb();
    await seedFailedTransient(db, {
      email: "a@x.de", id: "T_BURNED", attempts: 3,
      lastAttempt: "2026-06-26T08:00:00Z",
    });
    await seedFailedTransient(db, {
      email: "a@x.de", id: "T_LIVE", attempts: 2,
      lastAttempt: "2026-06-26T10:00:00Z",
    });
    const queue = await db.tickets.queryEmailPending(10);
    expect(queue.map((t) => t.ticketId)).toEqual(["T_LIVE"]);
  });

  it("returns empty when nothing in the retry queue", async () => {
    const db = buildMemoryDb();
    await seedSent(db, { email: "a@x.de", id: "T_SENT", lastAttempt: "2026-06-26T09:30:00Z" });
    const queue = await db.tickets.queryEmailPending(10);
    expect(queue).toEqual([]);
  });

  it("ticket flipped to EMAIL_FAILED while still carrying FAILED_TRANSIENT email_status is excluded (sparse gate honours ticket_state)", async () => {
    // DB_SCHEMA.md:59 requires `ticket_state="EMAIL_SENDING"` in the sparse
    // GSI predicate. A future admin tool / migration could patch
    // ticket_state without resetting email_status, and the sweeper must NOT
    // pick that inconsistent row up.
    const db = buildMemoryDb();
    await seedFailedTransient(db, {
      email: "a@x.de", id: "T_INCONSISTENT", attempts: 1,
      lastAttempt: "2026-06-26T10:00:00Z",
    });
    await db.tickets.patch("a@x.de", "T_INCONSISTENT", {
      ticket_state: "EMAIL_FAILED",
    });
    const queue = await db.tickets.queryEmailPending(10);
    expect(queue).toEqual([]);
  });
});

describe("InMemoryTicketRepo.scanEmailWatchdog", () => {
  it("returns EMAIL_SENDING+SENT tickets older than cutoff", async () => {
    const db = buildMemoryDb();
    // 25h ago — past cutoff
    await seedSent(db, {
      email: "a@x.de", id: "T_STUCK",
      lastAttempt: "2026-06-25T10:00:00Z",
    });
    // 5m ago — fresh
    await seedSent(db, {
      email: "a@x.de", id: "T_FRESH",
      lastAttempt: "2026-06-26T09:55:00Z",
    });

    const cutoff = "2026-06-26T08:00:00Z";
    const stuck = await db.tickets.scanEmailWatchdog(cutoff);
    expect(stuck.map((t) => t.ticketId)).toEqual(["T_STUCK"]);
  });

  it("excludes tickets that already advanced to PENDING_DB_PAYMENT/DELIVERED", async () => {
    const db = buildMemoryDb();
    await seedSent(db, {
      email: "a@x.de", id: "T_DELIVERED",
      lastAttempt: "2026-06-25T10:00:00Z",
    });
    await db.tickets.patch("a@x.de", "T_DELIVERED", {
      ticket_state: "PENDING_DB_PAYMENT",
      email_status: "DELIVERED",
    });
    const stuck = await db.tickets.scanEmailWatchdog("2026-06-26T08:00:00Z");
    expect(stuck).toEqual([]);
  });

  it("excludes FAILED_TRANSIENT tickets (Pass A's domain)", async () => {
    const db = buildMemoryDb();
    await seedFailedTransient(db, {
      email: "a@x.de", id: "T_RETRY", attempts: 1,
      lastAttempt: "2026-06-25T10:00:00Z",
    });
    const stuck = await db.tickets.scanEmailWatchdog("2026-06-26T08:00:00Z");
    expect(stuck).toEqual([]);
  });

  it("excludes already-terminal EMAIL_FAILED tickets", async () => {
    const db = buildMemoryDb();
    await seedSent(db, {
      email: "a@x.de", id: "T_PRIOR_FAIL",
      lastAttempt: "2026-06-25T10:00:00Z",
    });
    await db.tickets.patch("a@x.de", "T_PRIOR_FAIL", {
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
      email_failed_reason: "max_retries",
    });
    const stuck = await db.tickets.scanEmailWatchdog("2026-06-26T08:00:00Z");
    expect(stuck).toEqual([]);
  });
});
