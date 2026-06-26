// Repo-layer privacy boundary: getByEmailAdminView() / listAdminView()
// MUST strip `iban_enc`, `bic_enc`, `ttl` before handing the row to
// admin-handler. This is the defense-in-depth layer underneath the
// admin-handler projection — if the projection ever regresses, the
// ciphertext still doesn't reach the Lambda.
//
// CLAUDE.md "Privacy / admin visibility"; DB_SCHEMA.md "Encryption
// layout"; IMPLEMENTATION_PLAN.md Phase 2.4 admin-handler note.

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

describe("UserRepo admin-view: iban_enc / bic_enc / ttl never leak", () => {
  it("getByEmailAdminView() drops bank ciphertext + ttl", async () => {
    const db = buildMemoryDb();
    await db.users.create(ALICE);
    // also seed a TTL (simulates DELETION_SCHEDULED user mid-flight)
    await db.users.updateProfile(ALICE.email, {
      user_state: "DELETION_SCHEDULED",
      ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    });

    const view = await db.users.getByEmailAdminView(ALICE.email);
    expect(view).not.toBeNull();
    // Bank ciphertext + TTL must be absent from the view.
    expect(view).not.toHaveProperty("iban_enc");
    expect(view).not.toHaveProperty("bic_enc");
    expect(view).not.toHaveProperty("ttl");
    // Same row, regular accessor still carries them.
    const full = await db.users.getByEmail(ALICE.email);
    expect(full?.iban_enc).toBe("BANK_CIPHERTEXT_SECRET");
    expect(full?.bic_enc).toBe("BIC_CIPHERTEXT_SECRET");
    expect(typeof full?.ttl).toBe("number");
  });

  it("listAdminView() drops bank ciphertext + ttl on every row", async () => {
    const db = buildMemoryDb();
    await db.users.create(ALICE);
    await db.users.create({ ...ALICE, email: "bob@example.com", vorname: "Bob" });

    const page = await db.users.listAdminView({ limit: 50 });
    expect(page.items).toHaveLength(2);
    for (const v of page.items) {
      expect(v).not.toHaveProperty("iban_enc");
      expect(v).not.toHaveProperty("bic_enc");
      expect(v).not.toHaveProperty("ttl");
    }
  });

  it("getByEmailAdminView() returns null for missing user (parity with getByEmail)", async () => {
    const db = buildMemoryDb();
    const view = await db.users.getByEmailAdminView("ghost@example.com");
    expect(view).toBeNull();
  });
});
