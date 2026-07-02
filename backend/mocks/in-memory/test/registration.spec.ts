// Importing @railback/mocks-in-memory must register the "memory" backend such
// that db() resolves without explicit wiring.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@railback/lib/storage";
import { clearRegistry, registerBackend } from "@railback/lib/storage/registry";

import { buildMemoryDb } from "../src/index.js";

const ORIGINAL_ENV = process.env.RAILBACK_STORAGE;

describe("@railback/mocks-in-memory registration", () => {
  beforeEach(() => {
    // ensure the side-effect registration is the only one we observe
    clearRegistry();
    registerBackend("memory", () => buildMemoryDb());
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.RAILBACK_STORAGE;
    else process.env.RAILBACK_STORAGE = ORIGINAL_ENV;
  });

  it("db() returns a fresh in-memory Db when RAILBACK_STORAGE=memory", () => {
    process.env.RAILBACK_STORAGE = "memory";
    const got = db();
    expect(typeof got.users.create).toBe("function");
    expect(typeof got.blobs.presignRawUploadPost).toBe("function");
  });

  it("the package side-effect alone wires the backend (no explicit register)", async () => {
    // simulate fresh import by clearing the registry, then dynamically importing
    clearRegistry();
    await import("../src/index.js");
    process.env.RAILBACK_STORAGE = "memory";
    const got = db();
    expect(got).toBeTruthy();
    // round-trip a row to prove it's a real wired instance
    const u = await got.users.create({
      email: "side-effect@x.de",
      vorname: "S",
      nachname: "E",
      telefon: "+49",
      adresse: { strasse: "x", hausnr: "1", plz: "1", ort: "B", land: "DE" },
      hashed_password: "h",
      iban_enc: "enc-iban",
      bic_enc: "enc-bic",
      datenschutz_einwilligung: true,
      agb_akzeptiert: true,
    });
    expect(u.email).toBe("side-effect@x.de");
  });
});
