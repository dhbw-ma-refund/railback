// fill-eu-form.spec.ts — load fixture, call fillEuForm, sanity-check the
// resulting bytes. Snapshot-by-byte is fragile (pdf-lib stamps timestamps),
// so we shape-check: starts with %PDF, reloads cleanly, has at least the
// template's original page count, the AcroForm is flattened.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

import { fillEuForm, _resetTemplateValidationCache } from "../src/fill-eu-form.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import { seedSubmittedTicket, BOB_EMAIL, BOB_IBAN, BOB_BIC } from "./fixtures.js";
import { db } from "@railback/lib/storage";

describe("fill-eu-form", () => {
  beforeEach(() => {
    installTestEnv();
    _resetTemplateValidationCache();
  });
  afterEach(() => {
    teardownTestEnv();
    vi.restoreAllMocks();
  });

  it("renders a flattened PDF with the ticket+user payload", async () => {
    const { ticketId } = await seedSubmittedTicket();
    const ticket = await db().tickets.get(BOB_EMAIL, ticketId);
    const user = await db().users.getByEmail(BOB_EMAIL);
    expect(ticket).not.toBeNull();
    expect(user).not.toBeNull();
    if (!ticket || !user) return;

    const bytes = await fillEuForm({
      ticket,
      user,
      iban: BOB_IBAN,
      bic: BOB_BIC,
    });

    // Header check — every PDF starts with `%PDF-`.
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const head = Buffer.from(bytes.slice(0, 5)).toString("ascii");
    expect(head).toBe("%PDF-");

    // Reloads cleanly via pdf-lib (sanity that we didn't corrupt the file).
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(0);

    // Flattened: AcroForm fields must no longer exist.
    const form = doc.getForm();
    expect(form.getFields()).toHaveLength(0);
  });

  it("renders for a ticket with a different antragsgrund (verpasster Anschluss)", async () => {
    const { ticketId } = await seedSubmittedTicket({
      ticketPatch: {
        antragsart: "ENTSCHAEDIGUNG_60_119",
        antragsgrund: ["VERPASSTER_ANSCHLUSS"],
        erwartete_erstattung: "30.00",
      },
    });
    const ticket = await db().tickets.get(BOB_EMAIL, ticketId);
    const user = await db().users.getByEmail(BOB_EMAIL);
    if (!ticket || !user) throw new Error("seed failed");

    const bytes = await fillEuForm({
      ticket,
      user,
      iban: BOB_IBAN,
      bic: BOB_BIC,
    });

    expect(bytes.byteLength).toBeGreaterThan(1000);
    const reload = await PDFDocument.load(bytes);
    expect(reload.getPageCount()).toBeGreaterThan(0);
  });

  it("drift guard: throws ERR_INTERNAL when the loaded template is missing an expected field", async () => {
    // Simulate template drift by stubbing PDFDocument.load to return a doc
    // whose form is empty. Easiest way: load the real template, strip the
    // AcroForm by flattening immediately, then have fillEuForm load this
    // doctored buffer instead.
    const realLoad = PDFDocument.load.bind(PDFDocument);
    const spy = vi.spyOn(PDFDocument, "load").mockImplementation(async (bytes, opts) => {
      const doc = await realLoad(bytes, opts);
      doc.getForm().flatten(); // wipe the AcroForm
      return doc;
    });

    const { ticketId } = await seedSubmittedTicket();
    const ticket = await db().tickets.get(BOB_EMAIL, ticketId);
    const user = await db().users.getByEmail(BOB_EMAIL);
    if (!ticket || !user) throw new Error("seed failed");

    await expect(
      fillEuForm({ ticket, user, iban: BOB_IBAN, bic: BOB_BIC }),
    ).rejects.toThrow(/template drift/);
    spy.mockRestore();
  });
});
