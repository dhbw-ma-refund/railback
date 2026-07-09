// Repo-layer admin-view shape. Since the 2026-07-07 reversal (DECISIONS.md
// "IBAN/BIC visible to admin in plaintext"), getByEmailAdminView() /
// listAdminView() CARRY the encrypted `iban_enc` / `bic_enc` through to
// admin-handler, which decrypts them to plaintext. The view still drops the
// DDB-internal `ttl` attribute (never a domain concept). This mirrors the DDB
// adapter's mapUserAdminView — memory + adapter must agree.
//
// CLAUDE.md "Privacy / admin visibility"; DB_SCHEMA.md "Encryption layout".

import { describe, expect, it } from "vitest";

import { buildMemoryDb } from "../src/index.js";

const ALICE = {
  email: "alice@example.com",
  vorname: "Alice",
  nachname: "Müller",
  telefon: "+49 151 1234567",
  adresse: { strasse: "Bahnhofstr.", hausnr: "12", plz: "10115", ort: "Berlin", land: "DE" },
  hashed_password: "$scrypt$N=16384,r=8,p=1$fake",
  iban_enc: "BANK_CIPHERTEXT_SECRET",
  bic_enc: "BIC_CIPHERTEXT_SECRET",
  datenschutz_einwilligung: true,
  agb_akzeptiert: true,
};

describe("UserRepo admin-view: carries iban_enc/bic_enc, drops ttl + hashed_password", () => {
  it("getByEmailAdminView() carries bank ciphertext, drops ttl", async () => {
    const db = buildMemoryDb();
    await db.users.create(ALICE);
    // also seed a TTL (simulates DELETION_SCHEDULED user mid-flight)
    await db.users.updateProfile(ALICE.email, {
      user_state: "DELETION_SCHEDULED",
      ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    });

    const view = await db.users.getByEmailAdminView(ALICE.email);
    expect(view).not.toBeNull();
    // Reversed 2026-07-07: bank ciphertext flows through to admin-handler.
    expect(view?.iban_enc).toBe("BANK_CIPHERTEXT_SECRET");
    expect(view?.bic_enc).toBe("BIC_CIPHERTEXT_SECRET");
    // TTL + auth artefact must NOT appear on the view.
    expect(view).not.toHaveProperty("ttl");
    expect(view).not.toHaveProperty("hashed_password");
    // Same row, regular accessor still carries the ciphertext.
    const full = await db.users.getByEmail(ALICE.email);
    expect(full?.iban_enc).toBe("BANK_CIPHERTEXT_SECRET");
    expect(full?.bic_enc).toBe("BIC_CIPHERTEXT_SECRET");
    expect(typeof full?.ttl).toBe("number");
  });

  it("listAdminView() carries bank ciphertext, drops ttl on every row", async () => {
    const db = buildMemoryDb();
    await db.users.create(ALICE);
    await db.users.create({ ...ALICE, email: "bob@example.com", vorname: "Bob" });

    const page = await db.users.listAdminView({ limit: 50 });
    expect(page.items).toHaveLength(2);
    for (const v of page.items) {
      expect(v.iban_enc).toBe("BANK_CIPHERTEXT_SECRET");
      expect(v.bic_enc).toBe("BIC_CIPHERTEXT_SECRET");
      expect(v).not.toHaveProperty("ttl");
      expect(v).not.toHaveProperty("hashed_password");
    }
  });

  it("getByEmailAdminView() returns null for missing user (parity with getByEmail)", async () => {
    const db = buildMemoryDb();
    const view = await db.users.getByEmailAdminView("ghost@example.com");
    expect(view).toBeNull();
  });
});
