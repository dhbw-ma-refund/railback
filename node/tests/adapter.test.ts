import { makeBackend, makeBadBackend, makeDb } from "./helpers.js";
import { ConflictError } from "../src/adapter.js";

const backend = makeBackend();
const badBackend = makeBadBackend();
const raw = makeDb(); // used only for test data cleanup via _delete

const NOW = "2026-01-01T00:00:00.000Z";
const NS = "adp001ts";

// Physical keys that must never appear in a DTO
const PHYSICAL = ["pk", "sk", "gsi1_pk", "gsi1_sk", "gsi2_pk", "gsi2_sk",
  "gsi_email_pending_pk", "gsi_email_pending_sk"];

function assertNoPhysicalKeys(obj: Record<string, unknown>) {
  for (const k of PHYSICAL) {
    expect(obj).not.toHaveProperty(k);
  }
}

// ---------------------------------------------------------------------------
// Item factories — physical DDB shape, same as connector tests
// ---------------------------------------------------------------------------

function userEmail(suffix = "") { return `${NS}${suffix}@it.de`; }

function userItem(e: string, extra: Record<string, unknown> = {}) {
  return {
    pk: `USER#${e}`, sk: "PROFILE",
    gsi1_pk: "USER", gsi1_sk: `EMAIL#${e}`,
    user_state: "ACTIVE", hashed_password: "hashed_pw",
    vorname: "Test", nachname: "User",
    created_at: NOW,
    ...extra,
  };
}

function ticketItem(e: string, tid: string, extra: Record<string, unknown> = {}) {
  return {
    pk: `USER#${e}`, sk: `TICKET#${tid}`,
    gsi1_pk: `TRAIN#IC 1#2026-09-01`, gsi1_sk: `TICKET#${tid}`,
    gsi2_pk: "BARCODE", gsi2_sk: `bc_${tid}`,
    ticket_state: "READY",
    uploaded_at: NOW, updated_at: NOW,
    ...extra,
  };
}

function mandateItem(e: string, tid: string, extra: Record<string, unknown> = {}) {
  return {
    pk: `USER#${e}`, sk: `TICKET#${tid}#MANDATE`,
    mandate_state: "ISSUED",
    fee_amount: "5.00", issued_at: NOW,
    ...extra,
  };
}

function adminItem(e: string) {
  return { pk: `ADMIN#${e}`, sk: "PROFILE", gsi1_pk: "ADMIN", gsi1_sk: e, admin_state: "ACTIVE" };
}

// ---------------------------------------------------------------------------
// UserRepo
// ---------------------------------------------------------------------------

describe("DdbBackend.users", () => {
  test("getByEmail returns User DTO with no physical keys", async () => {
    const e = userEmail("get");
    await raw.user.put(userItem(e));
    const user = await backend.users.getByEmail(e);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(e);
    expect(user!.userState).toBe("ACTIVE");
    expect(user!.vorname).toBe("Test");
    assertNoPhysicalKeys(user as Record<string, unknown>);
    await raw.user._delete(`USER#${e}`, "PROFILE");
  });

  test("getByEmail returns null for unknown user", async () => {
    expect(await backend.users.getByEmail(`ghost.${NS}@it.de`)).toBeNull();
  });

  test("getByEmailForAuth returns UserAuthLookup projection only", async () => {
    const e = userEmail("auth");
    await raw.user.put(userItem(e, { iban_enc: "SENSITIVE" }));
    const auth = await backend.users.getByEmailForAuth(e);
    expect(auth).not.toBeNull();
    expect(auth!.email).toBe(e);
    expect(auth!.hashedPassword).toBe("hashed_pw");
    expect(auth!.userState).toBe("ACTIVE");
    // projection must not include other fields
    expect(Object.keys(auth!)).toEqual(["email", "hashedPassword", "userState"]);
    await raw.user._delete(`USER#${e}`, "PROFILE");
  });

  test("getByEmailForAuth returns null for unknown user", async () => {
    expect(await backend.users.getByEmailForAuth(`ghost.${NS}@it.de`)).toBeNull();
  });

  test("getByEmailAdminView strips iban_enc and bic_enc", async () => {
    const e = userEmail("adminview");
    await raw.user.put(userItem(e, { iban_enc: "ENC_IBAN", bic_enc: "ENC_BIC" }));
    const view = await backend.users.getByEmailAdminView(e);
    expect(view).not.toBeNull();
    expect(view!.email).toBe(e);
    expect(view).not.toHaveProperty("ibanEnc");
    expect(view).not.toHaveProperty("bicEnc");
    expect(view).not.toHaveProperty("iban_enc");
    expect(view).not.toHaveProperty("bic_enc");
    assertNoPhysicalKeys(view as Record<string, unknown>);
    await raw.user._delete(`USER#${e}`, "PROFILE");
  });

  test("getByEmailAdminView returns null for unknown user", async () => {
    expect(await backend.users.getByEmailAdminView(`ghost.${NS}@it.de`)).toBeNull();
  });

  test("put and update round-trip", async () => {
    const e = userEmail("putupd");
    await backend.users.put(userItem(e));
    await backend.users.update(e, { vorname: "Updated" });
    const user = await backend.users.getByEmail(e);
    expect(user!.vorname).toBe("Updated");
    await raw.user._delete(`USER#${e}`, "PROFILE");
  });

  test("listAll returns User DTOs", async () => {
    const e = userEmail("list");
    await raw.user.put(userItem(e));
    const users = await backend.users.listAll();
    expect(users.length).toBeGreaterThan(0);
    const found = users.find((u) => u.email === e);
    expect(found).toBeDefined();
    assertNoPhysicalKeys(found as Record<string, unknown>);
    await raw.user._delete(`USER#${e}`, "PROFILE");
  });

  test("put throws on connection error", async () => {
    await expect(badBackend.users.put(userItem(userEmail("err")))).rejects.toThrow();
  });

  test("getByEmail throws on connection error", async () => {
    await expect(badBackend.users.getByEmail(userEmail("err"))).rejects.toThrow();
  });

  test("getByEmailForAuth throws on connection error", async () => {
    await expect(badBackend.users.getByEmailForAuth(userEmail("err"))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AdminRepo
// ---------------------------------------------------------------------------

describe("DdbBackend.admins", () => {
  const adminMail = `${NS}.admin@it.de`;

  test("put and getByEmail returns Admin DTO", async () => {
    await backend.admins.put(adminItem(adminMail));
    const admin = await backend.admins.getByEmail(adminMail);
    expect(admin).not.toBeNull();
    expect(admin!.email).toBe(adminMail);
    assertNoPhysicalKeys(admin as Record<string, unknown>);
    await raw.admin._delete(`ADMIN#${adminMail}`, "PROFILE");
  });

  test("getByEmail returns null for unknown admin", async () => {
    expect(await backend.admins.getByEmail(`ghost.${NS}.admin@it.de`)).toBeNull();
  });

  test("update admin", async () => {
    await raw.admin.put(adminItem(adminMail));
    await backend.admins.update(adminMail, { role: "SUPER" });
    const admin = await backend.admins.getByEmail(adminMail);
    expect(admin!.role).toBe("SUPER");
    await raw.admin._delete(`ADMIN#${adminMail}`, "PROFILE");
  });

  test("listAll returns Admin DTOs", async () => {
    await raw.admin.put(adminItem(adminMail));
    const admins = await backend.admins.listAll();
    expect(admins.length).toBeGreaterThan(0);
    const found = admins.find((a) => a.email === adminMail);
    expect(found).toBeDefined();
    assertNoPhysicalKeys(found as Record<string, unknown>);
    await raw.admin._delete(`ADMIN#${adminMail}`, "PROFILE");
  });

  test("getByEmail throws on connection error", async () => {
    await expect(badBackend.admins.getByEmail(adminMail)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TicketRepo
// ---------------------------------------------------------------------------

describe("DdbBackend.tickets", () => {
  const e = userEmail(".tkt");

  test("put and get returns Ticket DTO with no physical keys", async () => {
    const tid = "T_ADP_GET";
    await raw.ticket.put(ticketItem(e, tid));
    const t = await backend.tickets.get(e, tid);
    expect(t).not.toBeNull();
    expect(t!.ticketId).toBe(tid);
    expect(t!.userEmail).toBe(e);
    expect(t!.ticketState).toBe("READY");
    expect(t!.barcodeUid).toBe(`bc_${tid}`);
    assertNoPhysicalKeys(t as Record<string, unknown>);
    await raw.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });

  test("get returns null for unknown ticket", async () => {
    expect(await backend.tickets.get(e, "T_ADP_GHOST")).toBeNull();
  });

  test("listForUser returns Ticket DTOs with ticketId and userEmail", async () => {
    const tid = "T_ADP_LFU";
    await raw.ticket.put(ticketItem(e, tid));
    const tickets = await backend.tickets.listForUser(e);
    const found = tickets.find((t) => t.ticketId === tid);
    expect(found).toBeDefined();
    expect(found!.userEmail).toBe(e);
    assertNoPhysicalKeys(found as Record<string, unknown>);
    await raw.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });

  test("listForUser with limit", async () => {
    const tids = ["T_ADP_LFU_L0", "T_ADP_LFU_L1", "T_ADP_LFU_L2"];
    for (const tid of tids) await raw.ticket.put(ticketItem(e, tid));
    const result = await backend.tickets.listForUser(e, 2);
    expect(result.length).toBeLessThanOrEqual(2);
    for (const tid of tids) await raw.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });

  test("getByTrain returns empty array when no match", async () => {
    expect(await backend.tickets.getByTrain("IC 9999", "2099-01-01")).toEqual([]);
  });

  test("getByTrain returns matching Ticket DTOs", async () => {
    const tid = "T_ADP_GBT";
    const i = { ...ticketItem(e, tid), gsi1_pk: "TRAIN#IC 42#2026-11-01" };
    await raw.ticket.put(i);
    const result = await backend.tickets.getByTrain("IC 42", "2026-11-01");
    expect(result.some((t) => t.ticketId === tid)).toBe(true);
    await raw.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });

  test("findByBarcodeUid returns null when not found", async () => {
    expect(await backend.tickets.findByBarcodeUid("ghost_bc_adp_001")).toBeNull();
  });

  test("findByBarcodeUid returns Ticket DTO when found", async () => {
    const tid = "T_ADP_BC";
    const uid = "bc_adp_unique_001";
    await raw.ticket.put({ ...ticketItem(e, tid), gsi2_sk: uid });
    const result = await backend.tickets.findByBarcodeUid(uid);
    expect(result).not.toBeNull();
    expect(result!.ticketId).toBe(tid);
    assertNoPhysicalKeys(result as Record<string, unknown>);
    await raw.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });

  test("queryEmailPending returns pending Ticket DTOs", async () => {
    const tid = "T_ADP_EP";
    await raw.ticket.put({
      ...ticketItem(e, tid),
      gsi_email_pending_pk: "EMAIL_PENDING",
      gsi_email_pending_sk: "2026-01-01T08:00:00.000Z",
      ticket_state: "EMAIL_SENDING",
      email_status: "FAILED_TRANSIENT",
    });
    const result = await backend.tickets.queryEmailPending(25);
    const found = result.find((t) => t.ticketId === tid);
    expect(found).toBeDefined();
    expect(found!.emailStatus).toBe("FAILED_TRANSIENT");
    assertNoPhysicalKeys(found as Record<string, unknown>);
    await raw.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });

  test("update ticket fields", async () => {
    const tid = "T_ADP_UPD";
    await raw.ticket.put(ticketItem(e, tid));
    await backend.tickets.update(e, tid, { ticket_state: "REFUNDED" });
    const t = await backend.tickets.get(e, tid);
    expect(t!.ticketState).toBe("REFUNDED");
    await raw.ticket._delete(`USER#${e}`, `TICKET#${tid}`);
  });

  test("get throws on connection error", async () => {
    await expect(badBackend.tickets.get(e, "T_ERR")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// MandateRepo
// ---------------------------------------------------------------------------

describe("DdbBackend.mandates", () => {
  const e = userEmail(".mnd");

  test("put and get returns SepaMandate DTO", async () => {
    const tid = "T_ADP_MND_GET";
    await raw.mandate.put(mandateItem(e, tid));
    const m = await backend.mandates.get(e, tid);
    expect(m).not.toBeNull();
    expect(m!.userEmail).toBe(e);
    expect(m!.ticketId).toBe(tid);
    expect(m!.mandateState).toBe("ISSUED");
    assertNoPhysicalKeys(m as Record<string, unknown>);
    await raw.mandate._delete(`USER#${e}`, `TICKET#${tid}#MANDATE`);
  });

  test("get returns null for unknown mandate", async () => {
    expect(await backend.mandates.get(e, "T_ADP_MND_GHOST")).toBeNull();
  });

  test("update mandate", async () => {
    const tid = "T_ADP_MND_UPD";
    await raw.mandate.put(mandateItem(e, tid));
    await backend.mandates.update(e, tid, { mandate_state: "SUBMITTED" });
    const m = await backend.mandates.get(e, tid);
    expect(m!.mandateState).toBe("SUBMITTED");
    await raw.mandate._delete(`USER#${e}`, `TICKET#${tid}#MANDATE`);
  });

  test("stampPain008Built succeeds first time and returns void", async () => {
    const tid = "T_ADP_MND_STAMP";
    await raw.mandate.put(mandateItem(e, tid));
    const result = await backend.mandates.stampPain008Built(e, tid, {
      batchId: "BATCH_ADP_001", s3Key: "pain008/adp.xml", builtAt: "2026-07-07T10:00:00.000Z",
    });
    expect(result).toBeUndefined();
    const m = await backend.mandates.get(e, tid);
    expect(m!.pain008BatchId).toBe("BATCH_ADP_001");
    expect(m!.pain008S3Key).toBe("pain008/adp.xml");
    expect(m!.pain008BuiltAt).toBe("2026-07-07T10:00:00.000Z");
    await raw.mandate._delete(`USER#${e}`, `TICKET#${tid}#MANDATE`);
  });

  test("stampPain008Built throws ConflictError on second call", async () => {
    const tid = "T_ADP_MND_CONF";
    await raw.mandate.put(mandateItem(e, tid));
    await backend.mandates.stampPain008Built(e, tid, {
      batchId: "BATCH_A", s3Key: "pain008/a.xml", builtAt: "2026-07-07T10:00:00.000Z",
    });
    await expect(
      backend.mandates.stampPain008Built(e, tid, {
        batchId: "BATCH_B", s3Key: "pain008/b.xml", builtAt: "2026-07-07T11:00:00.000Z",
      })
    ).rejects.toThrow(ConflictError);
    // First stamp must be preserved
    const m = await backend.mandates.get(e, tid);
    expect(m!.pain008BatchId).toBe("BATCH_A");
    await raw.mandate._delete(`USER#${e}`, `TICKET#${tid}#MANDATE`);
  });

  test("stampPain008Built throws ConflictError on ghost mandate", async () => {
    await expect(
      backend.mandates.stampPain008Built(e, "T_ADP_MND_GHOST_STAMP", {
        batchId: "B", s3Key: "s3.xml", builtAt: NOW,
      })
    ).rejects.toThrow(ConflictError);
  });

  test("get throws on connection error", async () => {
    await expect(badBackend.mandates.get(e, "T_ERR")).rejects.toThrow();
  });

  test("stampPain008Built throws on connection error", async () => {
    await expect(
      badBackend.mandates.stampPain008Built(e, "T_ERR", { batchId: "B", s3Key: "s3.xml", builtAt: NOW })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Db-level: deleteUser / deleteTicket
// ---------------------------------------------------------------------------

describe("DdbBackend delete operations", () => {
  const e = userEmail(".del");

  test("deleteUser removes all user rows", async () => {
    const tid = "T_ADP_DEL_U";
    await raw.user.put(userItem(e));
    await raw.ticket.put(ticketItem(e, tid));
    await raw.ticketOwner.put({ pk: `TICKET#${tid}`, sk: "OWNER", email: e });
    await backend.deleteUser(e);
    expect(await backend.users.getByEmail(e)).toBeNull();
    expect(await backend.tickets.get(e, tid)).toBeNull();
    expect((await raw.ticketOwner.get(tid)).unwrap()).toBeNull();
  });

  test("deleteUser is idempotent on ghost user", async () => {
    await expect(backend.deleteUser(`ghost.${NS}.del@it.de`)).resolves.toBeUndefined();
  });

  test("deleteTicket removes ticket and sub-items", async () => {
    const tid = "T_ADP_DEL_T";
    await raw.ticket.put(ticketItem(e, tid));
    await raw.ticketOwner.put({ pk: `TICKET#${tid}`, sk: "OWNER", email: e });
    await raw.receipt.put({ pk: `USER#${e}`, sk: `TICKET#${tid}#BELEG#B1`, typ: "TAXI", uploaded_at: NOW });
    await raw.mandate.put(mandateItem(e, tid));
    await backend.deleteTicket(e, tid);
    expect(await backend.tickets.get(e, tid)).toBeNull();
    expect(await backend.mandates.get(e, tid)).toBeNull();
    expect((await raw.ticketOwner.get(tid)).unwrap()).toBeNull();
    expect((await raw.receipt.get(e, tid, "B1")).unwrap()).toBeNull();
  });

  test("deleteTicket is idempotent", async () => {
    await expect(backend.deleteTicket(`ghost.${NS}@it.de`, "T_ADP_GHOST")).resolves.toBeUndefined();
  });

  test("deleteUser throws on connection error", async () => {
    await expect(badBackend.deleteUser(e)).rejects.toThrow();
  });

  test("deleteTicket throws on connection error", async () => {
    await expect(badBackend.deleteTicket(e, "T_ERR")).rejects.toThrow();
  });
});
