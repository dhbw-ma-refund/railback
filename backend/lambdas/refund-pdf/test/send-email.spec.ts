// send-email.spec.ts — inject a mock SESv2 client, assert the returned shape
// + the MIME body we built (X-Ticket-Id header, subject, attachment).

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";
import { vi } from "vitest";

import { sendRefundEmail, _setSesClient } from "../src/send-email.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";

interface CapturedSend {
  input: {
    FromEmailAddress?: string;
    Destination?: { ToAddresses?: string[] };
    Content?: { Raw?: { Data?: Uint8Array | Buffer } };
    ConfigurationSetName?: string;
  };
}

function makeMockClient(opts: {
  result?: { MessageId: string };
  throwName?: string;
  throwMessage?: string;
}): { client: { send: (cmd: { input: unknown }) => Promise<{ MessageId?: string }> }; calls: CapturedSend[] } {
  const calls: CapturedSend[] = [];
  return {
    client: {
      async send(cmd: { input: unknown }) {
        calls.push({ input: cmd.input as CapturedSend["input"] });
        if (opts.throwName) {
          const err: Error & { name?: string } = new Error(opts.throwMessage ?? "boom");
          err.name = opts.throwName;
          throw err;
        }
        return opts.result ?? { MessageId: "ses-msg-id-default" };
      },
    },
    calls,
  };
}

describe("sendRefundEmail", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    _setSesClient(null);
    teardownTestEnv();
  });

  it("returns ok+messageId on SES 2xx, MIME carries X-Ticket-Id + subject + attachment", async () => {
    const mock = makeMockClient({ result: { MessageId: "ses-msg-id-OK" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient(mock.client as any);

    const pdf = new Uint8Array(Buffer.from("%PDF-1.7\nfoo\n%%EOF", "utf8"));
    const result = await sendRefundEmail({
      to: "alice@example.com",
      vorname: "Alice",
      nachname: "Müller",
      ticketId: "TICKET123",
      pdfBytes: pdf,
    });

    expect(result).toEqual({ ok: true, messageId: "ses-msg-id-OK" });

    expect(mock.calls).toHaveLength(1);
    const data = mock.calls[0]!.input.Content?.Raw?.Data;
    expect(data).toBeDefined();
    const raw = Buffer.from(data as Uint8Array).toString("utf8");
    expect(raw).toContain("X-Ticket-Id: TICKET123");
    expect(raw).toMatch(/Subject:.*TICKET123/);
    expect(raw).toContain("Content-Disposition: attachment");
    expect(raw).toContain("multipart/mixed");
  });

  it("returns transient=true on a generic network error", async () => {
    const mock = makeMockClient({ throwName: "TimeoutError", throwMessage: "socket timeout" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient(mock.client as any);

    const result = await sendRefundEmail({
      to: "alice@example.com",
      vorname: "A",
      nachname: "B",
      ticketId: "TICKET-T",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.transient).toBe(true);
    expect(result.error).toContain("TimeoutError");
  });

  it("returns transient=false on SES MessageRejected", async () => {
    const mock = makeMockClient({ throwName: "MessageRejected", throwMessage: "Email address not verified" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient(mock.client as any);

    const result = await sendRefundEmail({
      to: "alice@example.com",
      vorname: "A",
      nachname: "B",
      ticketId: "TICKET-P",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.transient).toBe(false);
    expect(result.error).toContain("MessageRejected");
  });

  it("AccountSendingPausedException is transient (SES auto-unpauses on reputation recovery)", async () => {
    const mock = makeMockClient({ throwName: "AccountSendingPausedException", throwMessage: "sending paused" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient(mock.client as any);

    const result = await sendRefundEmail({
      to: "alice@example.com",
      vorname: "A",
      nachname: "B",
      ticketId: "TICKET-PAUSE",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.transient).toBe(true);
  });

  it("AccessDeniedException is permanent (IAM misconfig won't fix itself between retries)", async () => {
    const mock = makeMockClient({ throwName: "AccessDeniedException", throwMessage: "no perms" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient(mock.client as any);

    const result = await sendRefundEmail({
      to: "alice@example.com",
      vorname: "A",
      nachname: "B",
      ticketId: "TICKET-IAM",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.transient).toBe(false);
  });

  it("ValidationException is permanent (malformed request)", async () => {
    const mock = makeMockClient({ throwName: "ValidationException", throwMessage: "bad input" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient(mock.client as any);

    const result = await sendRefundEmail({
      to: "alice@example.com",
      vorname: "A",
      nachname: "B",
      ticketId: "TICKET-V",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.transient).toBe(false);
  });

  it("ThrottlingException is transient (server-side load)", async () => {
    const mock = makeMockClient({ throwName: "ThrottlingException", throwMessage: "slow down" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient(mock.client as any);

    const result = await sendRefundEmail({
      to: "alice@example.com",
      vorname: "A",
      nachname: "B",
      ticketId: "TICKET-T2",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.transient).toBe(true);
  });

  it("throws ERR_INTERNAL when RAILBACK_SES_FROM_ADDRESS is unset (no poison-pill to SES)", async () => {
    vi.stubEnv("RAILBACK_SES_FROM_ADDRESS", "");

    const mock = makeMockClient({ result: { MessageId: "should-not-be-called" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient(mock.client as any);

    await expect(
      sendRefundEmail({
        to: "alice@example.com",
        vorname: "A",
        nachname: "B",
        ticketId: "TICKET-NO-ENV",
        pdfBytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(/RAILBACK_SES_FROM_ADDRESS/);
    expect(mock.calls).toHaveLength(0);
  });

  it("strips CRLF in vorname/nachname so attacker can't inject extra MIME headers (Bcc-injection)", async () => {
    const mock = makeMockClient({ result: { MessageId: "msg-crlf" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient(mock.client as any);

    const result = await sendRefundEmail({
      to: "victim@example.com",
      vorname: "Bob\r\nBcc: attacker@evil.example",
      nachname: "Schmidt\nX-Header: pwned",
      ticketId: "TICKET-INJ\r\nX-Header: pwned",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.ok).toBe(true);
    const data = mock.calls[0]!.input.Content?.Raw?.Data;
    const raw = Buffer.from(data as Uint8Array).toString("utf8");
    // Header section ends at the first \r\n\r\n; everything before that is
    // headers. None of the attacker-controlled strings should appear as
    // their own header line.
    const headerSection = raw.split("\r\n\r\n")[0]!;
    expect(headerSection.toLowerCase()).not.toContain("\r\nbcc:");
    expect(headerSection.toLowerCase()).not.toContain("\nbcc:");
    expect(headerSection).not.toMatch(/^X-Header: pwned/m);
    // X-Ticket-Id must still exist and not carry the injected extra line.
    expect(raw).toMatch(/X-Ticket-Id: TICKET-INJX-Header: pwned|X-Ticket-Id: TICKET-INJ/);
  });
});
