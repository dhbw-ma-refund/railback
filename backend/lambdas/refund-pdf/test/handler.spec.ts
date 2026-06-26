// handler.spec.ts — end-to-end renderAndSend pipeline against the in-memory
// backend with a mocked SES client. Covers the four SES outcomes + the
// rendered-PDF lands-in-S3 + the no-op skip paths.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Buffer } from "node:buffer";

import { renderAndSend } from "../src/handler.js";
import { _setSesClient } from "../src/send-email.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import { seedSubmittedTicket, seedBeleg } from "./fixtures.js";
import { db } from "@railback/lib/storage";
import { emailHash } from "@railback/lib/util/hash";

const PNG_1x1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

function makeMockClient(opts: {
  result?: { MessageId: string };
  throwName?: string;
  throwMessage?: string;
}): { calls: number } {
  const state = { calls: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _setSesClient({
    async send() {
      state.calls++;
      if (opts.throwName) {
        const err: Error & { name?: string } = new Error(opts.throwMessage ?? "boom");
        err.name = opts.throwName;
        throw err;
      }
      return opts.result ?? { MessageId: "ses-msg-id-default" };
    },
  } as any);
  return state;
}

describe("renderAndSend", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    _setSesClient(null);
    teardownTestEnv();
  });

  it("happy path: SES success → ticket email_status=SENT, attempts=1, provider_id set", async () => {
    const { email, ticketId } = await seedSubmittedTicket();
    makeMockClient({ result: { MessageId: "msg-happy" } });

    await renderAndSend({ email, ticketId });

    const after = await db().tickets.get(email, ticketId);
    expect(after).not.toBeNull();
    expect(after!.ticket_state).toBe("EMAIL_SENDING"); // unchanged — awaits SNS delivery
    expect(after!.email_status).toBe("SENT");
    expect(after!.email_attempts).toBe(1);
    expect(after!.email_provider_id).toBe("msg-happy");

    // Merged PDF landed in S3 at the canonical key.
    const expectedKey = `rendered/${emailHash(email)}/${ticketId}.pdf`;
    const blob = await db().blobs.getBytes(expectedKey);
    expect(blob).not.toBeNull();
    expect(blob!.bytes.byteLength).toBeGreaterThan(1000);
    expect(blob!.contentType).toBe("application/pdf");
  });

  it("transient SES failure → email_status=FAILED_TRANSIENT, attempts=1, ticket stays EMAIL_SENDING", async () => {
    const { email, ticketId } = await seedSubmittedTicket();
    makeMockClient({ throwName: "TimeoutError", throwMessage: "socket hang up" });

    await renderAndSend({ email, ticketId });

    const after = await db().tickets.get(email, ticketId);
    expect(after).not.toBeNull();
    expect(after!.ticket_state).toBe("EMAIL_SENDING");
    expect(after!.email_status).toBe("FAILED_TRANSIENT");
    expect(after!.email_attempts).toBe(1);
    // DB_SCHEMA.md constrains email_failed_reason to terminal EMAIL_FAILED.
    // On FAILED_TRANSIENT we must NOT set a freeform error string.
    expect(after!.email_failed_reason).toBeUndefined();
  });

  it("permanent SES failure → ticket_state=EMAIL_FAILED, email_status=FAILED, reason=max_retries", async () => {
    const { email, ticketId } = await seedSubmittedTicket();
    makeMockClient({ throwName: "MessageRejected", throwMessage: "Sender not verified" });

    await renderAndSend({ email, ticketId });

    const after = await db().tickets.get(email, ticketId);
    expect(after).not.toBeNull();
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("FAILED");
    expect(after!.email_attempts).toBe(1);
    // Categorical value per DB_SCHEMA.md — the raw SES error name is logged
    // for ops via ses.send.fail, not persisted on the ticket.
    expect(after!.email_failed_reason).toBe("max_retries");
  });

  it("transient SES failure at attempts=2 escalates to EMAIL_FAILED on the 3rd send", async () => {
    const { email, ticketId } = await seedSubmittedTicket({
      ticketPatch: { email_status: "FAILED_TRANSIENT", email_attempts: 2 },
    });
    makeMockClient({ throwName: "TimeoutError", throwMessage: "socket hang up" });

    await renderAndSend({ email, ticketId });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("FAILED");
    expect(after!.email_attempts).toBe(3);
    expect(after!.email_failed_reason).toBe("max_retries");
  });

  it("attempts already at cap (3) → flips to EMAIL_FAILED without invoking SES", async () => {
    const { email, ticketId } = await seedSubmittedTicket({
      ticketPatch: { email_status: "FAILED_TRANSIENT", email_attempts: 3 },
    });
    const state = makeMockClient({ result: { MessageId: "should-not-happen" } });

    await renderAndSend({ email, ticketId });
    expect(state.calls).toBe(0);

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("FAILED");
    expect(after!.email_failed_reason).toBe("max_retries");
  });

  it("retry after FAILED_TRANSIENT clears the (never-set) reason and lands at SENT", async () => {
    const { email, ticketId } = await seedSubmittedTicket({
      ticketPatch: {
        email_status: "FAILED_TRANSIENT",
        email_attempts: 1,
        // simulate stale reason from older (buggy) code path to assert clearance
        email_failed_reason: "TimeoutError: leftover",
      },
    });
    makeMockClient({ result: { MessageId: "msg-retry-ok" } });

    await renderAndSend({ email, ticketId });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_status).toBe("SENT");
    expect(after!.email_attempts).toBe(2);
    expect(after!.email_provider_id).toBe("msg-retry-ok");
    // Must be cleared — SENT tickets are not allowed to carry a failed_reason.
    expect(after!.email_failed_reason).toBeUndefined();
  });

  it("idempotency: ticket already has email_provider_id → no re-send even if status=SENDING", async () => {
    const { email, ticketId } = await seedSubmittedTicket({
      ticketPatch: { email_status: "SENDING", email_provider_id: "ses-prev" },
    });
    const state = makeMockClient({ result: { MessageId: "should-not-happen" } });

    await renderAndSend({ email, ticketId });
    expect(state.calls).toBe(0);

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_provider_id).toBe("ses-prev");
  });

  it("with one PNG beleg: merge runs and merged PDF is retrievable", async () => {
    const { email, ticketId } = await seedSubmittedTicket();
    const pngBytes = new Uint8Array(Buffer.from(PNG_1x1_B64, "base64"));
    await seedBeleg({
      email,
      ticketId,
      contentType: "image/png",
      bytes: pngBytes,
      filename: "scan.png",
    });

    makeMockClient({ result: { MessageId: "msg-beleg" } });

    await renderAndSend({ email, ticketId });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_status).toBe("SENT");

    const blob = await db().blobs.getBytes(`rendered/${emailHash(email)}/${ticketId}.pdf`);
    expect(blob).not.toBeNull();
    // The merged PDF should be at least slightly bigger than a no-beleg
    // render (sanity that the beleg actually got embedded as a page).
    expect(blob!.bytes.byteLength).toBeGreaterThan(1000);
  });

  it("ticket not found → throws ERR_NOT_FOUND", async () => {
    await expect(renderAndSend({ email: "nope@example.com", ticketId: "nope-id" }))
      .rejects.toThrow(/not found/);
  });

  it("ticket not in EMAIL_SENDING → bails silently (no SES call)", async () => {
    const { email, ticketId } = await seedSubmittedTicket({
      ticketPatch: { ticket_state: "PENDING_DB_PAYMENT" },
    });
    const state = makeMockClient({ result: { MessageId: "should-not-happen" } });

    await renderAndSend({ email, ticketId });
    expect(state.calls).toBe(0);

    // Ticket should be unchanged on the patch front.
    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("PENDING_DB_PAYMENT");
  });

  it("ticket already in email_status=SENT → no double-send", async () => {
    const { email, ticketId } = await seedSubmittedTicket({
      ticketPatch: { email_status: "SENT", email_provider_id: "ses-existing" },
    });
    const state = makeMockClient({ result: { MessageId: "should-not-happen" } });

    await renderAndSend({ email, ticketId });
    expect(state.calls).toBe(0);

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_provider_id).toBe("ses-existing");
  });

  it("zero-fee path (no mandate row) falls back to user iban_enc/bic_enc", async () => {
    const { email, ticketId } = await seedSubmittedTicket({ noMandate: true });
    makeMockClient({ result: { MessageId: "msg-no-mandate" } });

    await renderAndSend({ email, ticketId });

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_status).toBe("SENT");
  });

  it("render failure rolls the ticket back to READY (sweeper can't re-render — user must resubmit)", async () => {
    const { email, ticketId } = await seedSubmittedTicket();
    // Force a render-time failure via vi.spyOn on the BlobRepo. The render
    // path calls listReceipts before fillEuForm flattens — making it throw
    // surfaces an unrecoverable render-side error.
    const spy = vi
      .spyOn(db().blobs, "listReceipts")
      .mockRejectedValue(new Error("render-blowup"));
    makeMockClient({ result: { MessageId: "should-not-happen" } });

    await expect(renderAndSend({ email, ticketId })).rejects.toThrow(/render-blowup/);
    spy.mockRestore();

    const after = await db().tickets.get(email, ticketId);
    // The ticket is rolled back so the user can resubmit. Submit-time fields
    // are cleared; form-data fields (antragsart, fahrt_*, computed amounts)
    // stay as prefill.
    expect(after!.ticket_state).toBe("READY");
    expect(after!.email_status).toBeUndefined();
    expect(after!.email_attempts).toBeUndefined();
    expect(after!.email_last_attempt).toBeUndefined();
    expect(after!.email_provider_id).toBeUndefined();
    expect(after!.submitted_at).toBeUndefined();
    expect(after!.email_failed_reason).toBeUndefined();
    // Form-data prefill stays.
    expect(after!.antragsart).toBeDefined();
    expect(after!.erwartete_erstattung).toBeDefined();
  });

  it("render failure with prior FAILED_TRANSIENT attempts also rolls back to READY (no escalation)", async () => {
    // Even if a prior SES attempt left FAILED_TRANSIENT/attempts=2, a
    // render-side failure on the retry must roll back — the sweeper can't
    // recover a no-PDF ticket, so escalating to EMAIL_FAILED would just
    // hide the bug. The render error itself surfaces as 5xx so the user
    // can resubmit cleanly.
    const { email, ticketId } = await seedSubmittedTicket({
      ticketPatch: { email_status: "FAILED_TRANSIENT", email_attempts: 2 },
    });
    const spy = vi
      .spyOn(db().blobs, "listReceipts")
      .mockRejectedValue(new Error("render-blowup"));

    await expect(renderAndSend({ email, ticketId })).rejects.toThrow(/render-blowup/);
    spy.mockRestore();

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("READY");
    expect(after!.email_status).toBeUndefined();
    expect(after!.email_attempts).toBeUndefined();
  });
});
