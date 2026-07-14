// Phase-3b unit tests for the UserRepo write-path adapter methods.
// Covers: create, updateProfile, listAdminView, scheduleDeletion,
// scanDeletionScheduledExpired, deleteByEmail (strict), scanOrphanUserPks,
// getByEmailForAuth (single-read shape).

import { makeBackend, makeDb } from "./helpers.js";

const backend = makeBackend();
const raw = makeDb();

const NS = "u3b";
const NOW = "2026-01-01T00:00:00.000Z";

function em(suffix: string) { return `${NS}.${suffix}@it.de`; }

async function cleanupUser(email: string) {
  await raw.user._delete(`USER#${email}`, "PROFILE");
}

const baseNewUser = (email: string) => ({
  email,
  vorname: "Vor",
  nachname: "Nach",
  telefon: "+49123",
  adresse: { strasse: "S", hausnr: "1", plz: "10000", ort: "Berlin", land: "DE" },
  hashed_password: "hash",
  iban_enc: "IBAN_ENC",
  bic_enc: "BIC_ENC",
  datenschutz_einwilligung: true,
  agb_akzeptiert: true,
});

describe("UserRepo.create", () => {
  test("creates a new user and returns full DTO", async () => {
    const e = em("create.ok");
    const u = await backend.users.create(baseNewUser(e));
    expect(u.email).toBe(e);
    expect(u.user_state).toBe("ACTIVE");
    expect(u.adresse.strasse).toBe("S");
    expect(u.adresse.plz).toBe("10000");
    expect(u.created_at).toBeTruthy();
    // Verify actually persisted.
    const g = await backend.users.getByEmail(e);
    expect(g).not.toBeNull();
    expect(g!.email).toBe(e);
    expect(g!.adresse.plz).toBe("10000");
    await cleanupUser(e);
  });

  test("conflict on duplicate create → AdapterError ERR_CONFLICT", async () => {
    const e = em("create.dup");
    await backend.users.create(baseNewUser(e));
    await expect(backend.users.create(baseNewUser(e))).rejects.toMatchObject({
      code: "ERR_CONFLICT",
    });
    await cleanupUser(e);
  });

  test("persists adresse subfields under snake_case keys", async () => {
    const e = em("create.addr");
    await backend.users.create(baseNewUser(e));
    const row = (await raw.user.get(e)).unwrap()!;
    expect(row["adresse_strasse"]).toBe("S");
    expect(row["adresse_hausnr"]).toBe("1");
    expect(row["adresse_plz"]).toBe("10000");
    expect(row["adresse_ort"]).toBe("Berlin");
    expect(row["adresse_land"]).toBe("DE");
    await cleanupUser(e);
  });
});

describe("UserRepo.updateProfile", () => {
  test("SET on individual fields", async () => {
    const e = em("upd.set");
    await backend.users.create(baseNewUser(e));
    const u = await backend.users.updateProfile(e, {
      vorname: "NewVor",
      telefon: "+49999",
    });
    expect(u.vorname).toBe("NewVor");
    expect(u.telefon).toBe("+49999");
    expect(u.nachname).toBe("Nach"); // preserved
    await cleanupUser(e);
  });

  test("adresse patch splits into subfields", async () => {
    const e = em("upd.addr");
    await backend.users.create(baseNewUser(e));
    const u = await backend.users.updateProfile(e, {
      adresse: { strasse: "New St", hausnr: "9", plz: "22222", ort: "HH", land: "DE" },
    });
    expect(u.adresse.strasse).toBe("New St");
    expect(u.adresse.plz).toBe("22222");
    const row = (await raw.user.get(e)).unwrap()!;
    expect(row["adresse_ort"]).toBe("HH");
    await cleanupUser(e);
  });

  test("patch.clear REMOVES fields", async () => {
    const e = em("upd.clear");
    await backend.users.create(baseNewUser(e));
    // Seed suspended_at + suspended_reason first.
    await backend.users.updateProfile(e, {
      user_state: "SUSPENDED",
      suspended_at: NOW,
      suspended_reason: "test",
    });
    const u = await backend.users.updateProfile(e, {
      user_state: "ACTIVE",
      clear: ["suspended_at", "suspended_reason"],
    });
    expect(u.user_state).toBe("ACTIVE");
    expect(u.suspended_at).toBeUndefined();
    expect(u.suspended_reason).toBeUndefined();
    await cleanupUser(e);
  });

  test("throws ERR_NOT_FOUND when target does not exist", async () => {
    const e = em("upd.ghost");
    await expect(
      backend.users.updateProfile(e, { vorname: "X" }),
    ).rejects.toMatchObject({ code: "ERR_NOT_FOUND" });
  });

  test("empty patch is a no-op returning current state", async () => {
    const e = em("upd.noop");
    const created = await backend.users.create(baseNewUser(e));
    const u = await backend.users.updateProfile(e, {});
    expect(u.email).toBe(e);
    expect(u.vorname).toBe(created.vorname);
    await cleanupUser(e);
  });
});

describe("UserRepo.listAdminView", () => {
  const e1 = em("list.aaa1");
  const e2 = em("list.aaa2");
  const e3 = em("list.aaa3");

  beforeAll(async () => {
    for (const e of [e1, e2, e3]) await backend.users.create(baseNewUser(e));
  });
  afterAll(async () => {
    for (const e of [e1, e2, e3]) await cleanupUser(e);
  });

  test("filters by emailPrefix and surfaces iban_enc/bic_enc on admin view", async () => {
    // 2026-07-07 reversal (DECISIONS.md): admin sees IBAN/BIC ciphertext
    // verbatim; the adapter no longer strips these fields. Plaintext
    // decryption is admin-handler's responsibility.
    const page = await backend.users.listAdminView({
      emailPrefix: `${NS}.list.aaa`,
      limit: 10,
    });
    expect(page.items.length).toBeGreaterThanOrEqual(3);
    for (const u of page.items) {
      expect((u as unknown as Record<string, unknown>)["iban_enc"]).toBe("IBAN_ENC");
      expect((u as unknown as Record<string, unknown>)["bic_enc"]).toBe("BIC_ENC");
    }
  });

  test("state filter narrows results", async () => {
    await backend.users.updateProfile(e1, { user_state: "SUSPENDED" });
    const page = await backend.users.listAdminView({
      emailPrefix: `${NS}.list.aaa`,
      state: "SUSPENDED",
      limit: 10,
    });
    const found = page.items.find((u) => u.email === e1);
    expect(found).toBeDefined();
    for (const u of page.items) expect(u.user_state).toBe("SUSPENDED");
    // Reset.
    await backend.users.updateProfile(e1, { user_state: "ACTIVE" });
  });

  test("cursor pagination surfaces nextCursor when Limit reached", async () => {
    const page = await backend.users.listAdminView({
      emailPrefix: `${NS}.list.aaa`,
      limit: 2,
    });
    expect(page.items.length).toBe(2);
    expect(page.nextCursor).toBeTruthy();
    const p2 = await backend.users.listAdminView({
      emailPrefix: `${NS}.list.aaa`,
      limit: 2,
      cursor: page.nextCursor,
    });
    // Page 2 must not include any email seen on page 1.
    const p1Emails = new Set(page.items.map((u) => u.email));
    for (const u of p2.items) expect(p1Emails.has(u.email)).toBe(false);
  });
});

describe("UserRepo.scheduleDeletion", () => {
  test("flips state to DELETION_SCHEDULED and stamps ttl", async () => {
    const e = em("sched.ok");
    await backend.users.create(baseNewUser(e));
    await backend.users.scheduleDeletion(e);
    const u = await backend.users.getByEmail(e);
    expect(u!.user_state).toBe("DELETION_SCHEDULED");
    expect(u!.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));
    await cleanupUser(e);
  });

  test("throws ERR_NOT_FOUND for unknown user", async () => {
    await expect(
      backend.users.scheduleDeletion(em("sched.ghost")),
    ).rejects.toMatchObject({ code: "ERR_NOT_FOUND" });
  });
});

describe("UserRepo.scanDeletionScheduledExpired", () => {
  test("returns only DELETION_SCHEDULED users whose ttl < now", async () => {
    const eExp = em("scan.exp");
    const eLive = em("scan.live");
    const eActive = em("scan.active");
    await backend.users.create(baseNewUser(eExp));
    await backend.users.create(baseNewUser(eLive));
    await backend.users.create(baseNewUser(eActive));
    // eExp: DELETION_SCHEDULED with expired ttl (now - 10)
    await raw.user._updateWithRemove(
      `USER#${eExp}`, "PROFILE",
      { user_state: "DELETION_SCHEDULED", ttl: Math.floor(Date.now() / 1000) - 10 },
    );
    // eLive: DELETION_SCHEDULED with future ttl
    await raw.user._updateWithRemove(
      `USER#${eLive}`, "PROFILE",
      { user_state: "DELETION_SCHEDULED", ttl: Math.floor(Date.now() / 1000) + 100000 },
    );
    const now = Math.floor(Date.now() / 1000);
    const expired = await backend.users.scanDeletionScheduledExpired(now);
    const emails = expired.map((u) => u.email);
    expect(emails).toContain(eExp);
    expect(emails).not.toContain(eLive);
    expect(emails).not.toContain(eActive);
    await cleanupUser(eExp);
    await cleanupUser(eLive);
    await cleanupUser(eActive);
  });
});

describe("UserRepo.deleteByEmail (STRICT)", () => {
  test("succeeds when only PROFILE row exists", async () => {
    const e = em("del.ok");
    await backend.users.create(baseNewUser(e));
    await backend.users.deleteByEmail(e);
    expect(await backend.users.getByEmail(e)).toBeNull();
  });

  test("throws ERR_CONFLICT when a child TICKET row still exists", async () => {
    const e = em("del.child");
    await backend.users.create(baseNewUser(e));
    await raw.ticket.put({
      pk: `USER#${e}`, sk: `TICKET#T_${NS}_DEL`,
      ticketId: `T_${NS}_DEL`, ticket_state: "READY", updated_at: NOW,
    });
    await expect(backend.users.deleteByEmail(e)).rejects.toMatchObject({
      code: "ERR_CONFLICT",
    });
    // Cleanup: remove ticket + user.
    await raw.ticket._delete(`USER#${e}`, `TICKET#T_${NS}_DEL`);
    await cleanupUser(e);
  });

  test("idempotent when nothing exists (no PROFILE, no children)", async () => {
    // deleteByEmail on a ghost partition: query returns [], nonProfile is [], _delete is idempotent.
    await expect(backend.users.deleteByEmail(em("del.ghost"))).resolves.toBeUndefined();
  });
});

describe("UserRepo.scanOrphanUserPks", () => {
  test("emits email suffixes for partitions with children but no PROFILE", async () => {
    const orphan = em("orph.a");
    const clean = em("orph.b");
    // orphan: has a ticket row but no PROFILE
    await raw.ticket.put({
      pk: `USER#${orphan}`, sk: `TICKET#T_${NS}_ORPH`,
      ticketId: `T_${NS}_ORPH`, ticket_state: "READY", updated_at: NOW,
    });
    // clean: has a PROFILE + a ticket — should NOT be flagged
    await backend.users.create(baseNewUser(clean));
    await raw.ticket.put({
      pk: `USER#${clean}`, sk: `TICKET#T_${NS}_CLEAN`,
      ticketId: `T_${NS}_CLEAN`, ticket_state: "READY", updated_at: NOW,
    });

    const orphans = await backend.users.scanOrphanUserPks();
    expect(orphans).toContain(orphan);
    expect(orphans).not.toContain(clean);

    // Cleanup.
    await raw.ticket._delete(`USER#${orphan}`, `TICKET#T_${NS}_ORPH`);
    await raw.ticket._delete(`USER#${clean}`, `TICKET#T_${NS}_CLEAN`);
    await cleanupUser(clean);
  });

  test("skips USER#sha256: anonymised partitions", async () => {
    const anonPk = `USER#sha256:${NS}deadbeef`;
    await raw.ticket.put({
      pk: anonPk, sk: `TICKET#T_${NS}_ANON`,
      ticketId: `T_${NS}_ANON`, ticket_state: "COMPLETED", updated_at: NOW,
    });
    const orphans = await backend.users.scanOrphanUserPks();
    // The anon PK slice ("USER#" prefix removed) should not appear.
    expect(orphans).not.toContain(anonPk.slice("USER#".length));
    await raw.ticket._delete(anonPk, `TICKET#T_${NS}_ANON`);
  });
});

describe("UserRepo.getByEmailForAuth (single-read)", () => {
  test("returns UserAuthLookup with hashed_password + user_state", async () => {
    const e = em("auth.ok");
    await backend.users.create(baseNewUser(e));
    const lookup = await backend.users.getByEmailForAuth(e);
    expect(lookup).not.toBeNull();
    expect(lookup!.kind).toBe("user");
    expect(lookup!.email).toBe(e);
    expect(lookup!.hashed_password).toBe("hash");
    expect(lookup!.user_state).toBe("ACTIVE");
    expect(lookup!.suspended_reason).toBeUndefined();
    await cleanupUser(e);
  });

  test("carries suspended_reason when SUSPENDED", async () => {
    const e = em("auth.susp");
    await backend.users.create(baseNewUser(e));
    await backend.users.updateProfile(e, {
      user_state: "SUSPENDED",
      suspended_reason: "audit",
    });
    const lookup = await backend.users.getByEmailForAuth(e);
    expect(lookup!.user_state).toBe("SUSPENDED");
    expect(lookup!.suspended_reason).toBe("audit");
    await cleanupUser(e);
  });

  test("returns null for unknown user", async () => {
    expect(await backend.users.getByEmailForAuth(em("auth.ghost"))).toBeNull();
  });
});
