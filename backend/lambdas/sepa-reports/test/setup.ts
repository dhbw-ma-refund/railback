// Test bootstrap for sepa-reports.
//
// - Registers the in-memory backend via mocks-in-memory
// - Stubs env for IBAN-KEK + SES
// - Provides `installSesMock` (SES v2 client stub) analogous to
//   email-sweeper/test/fixtures.ts

import { Buffer } from "node:buffer";

import { db, resetDbCache } from "@railback/lib/storage";
import { registerBackend } from "@railback/lib/storage/registry";
import { resetKekCache } from "@railback/lib/crypto/kek";
import { _setSesClient } from "@railback/lib/email/send-email";
import { buildMemoryDb } from "@railback/mocks-in-memory";
import { vi } from "vitest";

registerBackend("memory", buildMemoryDb);

export const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString("base64");
export const TEST_SES_FROM = "noreply@railback.example";

export function installTestEnv(): ReturnType<typeof db> {
  vi.stubEnv("RAILBACK_STORAGE", "memory");
  vi.stubEnv("RAILBACK_IBAN_KEK", TEST_KEK_B64);
  vi.stubEnv("RAILBACK_AWS_REGION", "eu-central-1");
  vi.stubEnv("RAILBACK_SES_FROM_ADDRESS", TEST_SES_FROM);
  resetKekCache();
  resetDbCache();
  return db();
}

export function teardownTestEnv(): void {
  vi.unstubAllEnvs();
  _setSesClient(null);
  resetKekCache();
  resetDbCache();
}

// -- SES mock --------------------------------------------------------------

export interface SesCall {
  to?: string;
  ticketId?: string;
  rtxAction?: string;
  rtxReason?: string;
  subject?: string;
}

export interface SesMockState {
  calls: SesCall[];
  callCount: number;
}

export interface SesMockOpts {
  /**
   * Per-call behaviour. Absent (or exhausted) → default success. Each entry
   * is one SES call response.
   */
  responses?: Array<
    | { kind: "ok"; messageId: string }
    | { kind: "throw"; name: string; message?: string }
  >;
  /** Default MessageId when responses[] exhausted. */
  defaultMessageId?: string;
}

/**
 * Install a SES mock client that records every send call. Returns the state
 * object so tests can read `state.calls` after the handler runs.
 */
export function installSesMock(opts: SesMockOpts = {}): SesMockState {
  const state: SesMockState = { calls: [], callCount: 0 };
  const responses = opts.responses ?? [];
  const mock = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async send(cmd: any) {
      const input = cmd?.input ?? {};
      let rawMime = "";
      const data = input?.Content?.Raw?.Data;
      if (data) rawMime = Buffer.from(data).toString("utf8");
      const ticketId = /^X-Ticket-Id:\s*(.+)$/m.exec(rawMime)?.[1]?.trim();
      const rtxAction = /^X-Rtx-Action:\s*(.+)$/m.exec(rawMime)?.[1]?.trim();
      const rtxReason = /^X-Rtx-Reason:\s*(.+)$/m.exec(rawMime)?.[1]?.trim();
      const subject = /^Subject:\s*(.+)$/m.exec(rawMime)?.[1]?.trim();
      const to = input?.Destination?.ToAddresses?.[0];
      const call: SesCall = {};
      if (to !== undefined) call.to = to;
      if (ticketId !== undefined) call.ticketId = ticketId;
      if (rtxAction !== undefined) call.rtxAction = rtxAction;
      if (rtxReason !== undefined) call.rtxReason = rtxReason;
      if (subject !== undefined) call.subject = subject;
      state.calls.push(call);
      const idx = state.callCount++;
      const planned = responses[idx];
      if (planned?.kind === "throw") {
        const err: Error & { name?: string } = new Error(planned.message ?? "boom");
        err.name = planned.name;
        throw err;
      }
      if (planned?.kind === "ok") return { MessageId: planned.messageId };
      return { MessageId: opts.defaultMessageId ?? "ses-msg-default" };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _setSesClient(mock as any);
  return state;
}
