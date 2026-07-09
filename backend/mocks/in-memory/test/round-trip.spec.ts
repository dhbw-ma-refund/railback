// Per-repo round-trip coverage of the in-memory implementations.

import { describe, expect, it } from "vitest";
import type { NewMandate, NewRouteTicket, NewTicket, NewUser } from "@railback/lib";

import { buildMemoryDb, InMemoryDb, seedAdmin, seedSegment } from "../src/index.js";

function newUser(email = "ada@example.com"): NewUser {
  return {
    email,
    vorname: "Ada",
    nachname: "Lovelace",
    telefon: "+49 30 0000",
    adresse: { strasse: "Demo", hausnr: "1", plz: "12345", ort: "Berlin", land: "DE" },
    hashed_password: "x",
    iban_enc: "enc-iban",
    bic_enc: "enc-bic",
    datenschutz_einwilligung: true,
    agb_akzeptiert: true,
  };
}

function newTicket(email = "ada@example.com", id = "TKT_A"): NewTicket {
  return {
    email,
    ticketId: id,
    filename: "ticket.pdf",
    s3_key: `raw/x/${id}.pdf`,
    mimeType: "application/pdf",
    contentType: "application/pdf",
    sizeBytes: 12345,
    uploadedAt: "2026-06-20T10:00:00Z",
  };
}

describe("InMemoryUserRepo", () => {
  it("create + getByEmail + updateProfile + listAdminView + scheduleDeletion", async () => {
    const db = buildMemoryDb();
    const u = await db.users.create(newUser());
    expect(u.user_state).toBe("ACTIVE");

    const fetched = await db.users.getByEmail("ada@example.com");
    expect(fetched?.email).toBe("ada@example.com");

    const patched = await db.users.updateProfile("ada@example.com", { telefon: "+49 30 9999" });
    expect(patched.telefon).toBe("+49 30 9999");

    await db.users.create(newUser("bob@example.com"));
    const page = await db.users.listAdminView({ emailPrefix: "ada", limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.email).toBe("ada@example.com");

    await db.users.scheduleDeletion("ada@example.com");
    const sched = await db.users.listAdminView({ state: "DELETION_SCHEDULED", limit: 10 });
    expect(sched.items).toHaveLength(1);
    expect(sched.items[0]?.user_state).toBe("DELETION_SCHEDULED");
    // ttl is stripped from UserAdminView; verify persisted state via getByEmail.
    const raw = await db.users.getByEmail("ada@example.com");
    expect(raw?.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("create rejects duplicate email with ERR_CONFLICT", async () => {
    const db = buildMemoryDb();
    await db.users.create(newUser());
    await expect(db.users.create(newUser())).rejects.toMatchObject({ code: "ERR_CONFLICT" });
  });

  it("listAdminView paginates via base64 cursor", async () => {
    const db = buildMemoryDb();
    for (const e of ["a@x.de", "b@x.de", "c@x.de", "d@x.de"]) {
      await db.users.create(newUser(e));
    }
    const p1 = await db.users.listAdminView({ limit: 2 });
    expect(p1.items.map((u) => u.email)).toEqual(["a@x.de", "b@x.de"]);
    expect(p1.nextCursor).toBeDefined();
    const p2 = await db.users.listAdminView({ limit: 2, cursor: p1.nextCursor as string });
    expect(p2.items.map((u) => u.email)).toEqual(["c@x.de", "d@x.de"]);
  });
});

describe("InMemoryTicketRepo", () => {
  it("create → get → patch (state transition) → adminList → delete", async () => {
    const db = buildMemoryDb();
    await db.users.create(newUser());
    const t = await db.tickets.create(newTicket());
    expect(t.ticket_state).toBe("VALIDATING");
    expect(t.state_timeline).toHaveLength(1);

    const got = await db.tickets.get("ada@example.com", "TKT_A");
    expect(got?.ticketId).toBe("TKT_A");

    const patched = await db.tickets.patch("ada@example.com", "TKT_A", { ticket_state: "READY" });
    expect(patched.ticket_state).toBe("READY");
    expect(patched.state_timeline).toHaveLength(2);

    const list = await db.tickets.adminList({ state: "READY", limit: 10 });
    expect(list.items).toHaveLength(1);

    await db.tickets.delete("ada@example.com", "TKT_A");
    expect(await db.tickets.get("ada@example.com", "TKT_A")).toBeNull();
  });

  it("createFromRoute writes a READY ticket without VALIDATING", async () => {
    const db = buildMemoryDb();
    await db.users.create(newUser());
    const route: NewRouteTicket = {
      email: "ada@example.com",
      ticketId: "TKT_R",
      trainNr: "ICE100",
      date: "2026-06-21",
      fromStation: "Berlin Hbf",
      fromEva: 8011160,
      toStation: "Hamburg Hbf",
      toEva: 8002549,
      abfahrtszeit_plan: "08:00",
      ankunftszeit_plan: "09:50",
      fahrkartennummer: "ABC123",
      fahrkartenpreis: "59.90",
      is_zeitkarte: false,
    };
    const t = await db.tickets.createFromRoute(route);
    expect(t.ticket_state).toBe("READY");
    expect(t.extraction_method).toBe("MANUAL_ROUTE");
    expect(t.extraction_status).toBe("DONE");
    expect(t.state_timeline.map((s) => s.state)).toEqual(["READY"]);
    expect(t.is_zeitkarte).toBe(false);
  });

  it("findByBarcodeUid finds matching, returns null otherwise", async () => {
    const db = buildMemoryDb();
    await db.users.create(newUser());
    await db.tickets.create(newTicket());
    await db.tickets.patch("ada@example.com", "TKT_A", { barcode_uid: "UID-XYZ" });
    const found = await db.tickets.findByBarcodeUid("UID-XYZ");
    expect(found?.ticketId).toBe("TKT_A");
    expect(await db.tickets.findByBarcodeUid("nope")).toBeNull();
  });

  it("listForUser returns only ticket-rows, not mandate / beleg sub-rows", async () => {
    const db = buildMemoryDb();
    await db.users.create(newUser());
    await db.tickets.create(newTicket("ada@example.com", "TKT_A"));
    await db.tickets.create(newTicket("ada@example.com", "TKT_B"));
    const mandate: NewMandate = {
      ticketId: "TKT_A",
      fee_amount: "0.99",
      iban_enc: "enc",
      bic_enc: "enc",
      kontoinhaber_snapshot: "Ada",
      user_consent_at: "2026-06-20T10:00:00Z",
    };
    await db.mandates.issue("ada@example.com", "TKT_A", mandate);
    const tickets = await db.tickets.listForUser("ada@example.com");
    expect(tickets.map((t) => t.ticketId).sort()).toEqual(["TKT_A", "TKT_B"]);
  });
});

describe("InMemoryRouteTemplateRepo", () => {
  it("create → list → patch → delete", async () => {
    const db = buildMemoryDb();
    const tpl = await db.routeTemplates.create("ada@example.com", {
      templateId: "01JT1234567890ABCDEFGHJKMN",
      label: "Pendel",
      from_station: "Berlin Hbf",
      from_eva: 8011160,
      to_station: "Hamburg Hbf",
      to_eva: 8002549,
    });
    expect(tpl.label).toBe("Pendel");
    expect(tpl.email).toBe("ada@example.com");
    expect(tpl.templateId).toBe("01JT1234567890ABCDEFGHJKMN");

    const list = await db.routeTemplates.list("ada@example.com");
    expect(list).toHaveLength(1);

    const patched = await db.routeTemplates.patch("ada@example.com", tpl.templateId, { label: "Daily" });
    expect(patched.label).toBe("Daily");

    await db.routeTemplates.delete("ada@example.com", tpl.templateId);
    expect(await db.routeTemplates.list("ada@example.com")).toHaveLength(0);
  });

  it("create with a duplicate templateId throws ERR_CONFLICT", async () => {
    const db = buildMemoryDb();
    const tplInput = {
      templateId: "01JT1234567890ABCDEFGHJKMN",
      label: "Pendel",
      from_station: "Berlin Hbf",
      from_eva: 8011160,
      to_station: "Hamburg Hbf",
      to_eva: 8002549,
    };
    await db.routeTemplates.create("ada@example.com", tplInput);
    try {
      await db.routeTemplates.create("ada@example.com", tplInput);
      throw new Error("expected throw");
    } catch (err) {
      // AppError import would create a cycle here; check by structural shape.
      expect((err as { code?: string }).code).toBe("ERR_CONFLICT");
    }
  });
});

describe("InMemoryMandateRepo", () => {
  const baseMandate: NewMandate = {
    ticketId: "TKT_A",
    fee_amount: "0.99",
    iban_enc: "enc",
    bic_enc: "enc",
    kontoinhaber_snapshot: "Ada Lovelace",
    user_consent_at: "2026-06-20T10:00:00Z",
  };

  it("issue → markSubmitted → markDebited transitions", async () => {
    const db = buildMemoryDb();
    const m = await db.mandates.issue("ada@example.com", "TKT_A", baseMandate);
    expect(m.mandate_state).toBe("ISSUED");
    expect(m.sequence_type).toBe("OOFF");

    await db.mandates.stampPain008Built("ada@example.com", "TKT_A", {
      batchId: "BATCH_1",
      s3Key: "pain008/2026-06-20.xml",
      builtAt: "2026-06-20T11:00:00Z",
    });
    await db.mandates.markSubmitted("ada@example.com", "TKT_A", "2026-06-20T12:00:00Z");
    const sub = await db.mandates.get("ada@example.com", "TKT_A");
    expect(sub?.mandate_state).toBe("SUBMITTED");

    await db.mandates.markDebited("ada@example.com", "TKT_A", "2026-06-22T08:00:00Z");
    const deb = await db.mandates.get("ada@example.com", "TKT_A");
    expect(deb?.mandate_state).toBe("DEBITED");
    expect(deb?.debited_at).toBe("2026-06-22T08:00:00Z");
  });

  it("listExpiringISSUED filters on expires_at < now AND state===ISSUED", async () => {
    const db = new InMemoryDb();
    await db.db.mandates.issue("ada@example.com", "TKT_A", baseMandate);
    // bump expires_at into the past on the row directly
    const pk = `USER#ada@example.com`;
    const sk = "TICKET#TKT_A#MANDATE";
    const it = db.state.rows.get(pk)?.get(sk) as { expires_at: string };
    it.expires_at = "2020-01-01T00:00:00Z";
    const expiring = await db.db.mandates.listExpiringISSUED("2026-06-20T00:00:00Z");
    expect(expiring).toHaveLength(1);
  });

  it("listPendingBatches surfaces only mandates with pain008_built_at", async () => {
    const db = buildMemoryDb();
    await db.mandates.issue("ada@example.com", "TKT_A", baseMandate);
    expect(await db.mandates.listPendingBatches()).toHaveLength(0);
    await db.mandates.stampPain008Built("ada@example.com", "TKT_A", {
      batchId: "B1",
      s3Key: "pain008/x.xml",
      builtAt: "2026-06-20T11:00:00Z",
    });
    expect(await db.mandates.listPendingBatches()).toHaveLength(1);
  });

  it("listPendingBatches excludes SUBMITTED mandates (already handed to bank)", async () => {
    const db = buildMemoryDb();
    await db.mandates.issue("ada@example.com", "TKT_A", baseMandate);
    await db.mandates.stampPain008Built("ada@example.com", "TKT_A", {
      batchId: "B1",
      s3Key: "pain008/x.xml",
      builtAt: "2026-06-20T11:00:00Z",
    });
    // ISSUED + built → pending
    expect(await db.mandates.listPendingBatches()).toHaveLength(1);

    // Admin marks the batch as bank-uploaded → SUBMITTED → no longer pending.
    await db.mandates.markSubmitted(
      "ada@example.com",
      "TKT_A",
      "2026-06-20T12:00:00Z",
    );
    expect(await db.mandates.listPendingBatches()).toHaveLength(0);
  });
});

describe("InMemorySepaReportRepo", () => {
  it("put → getByReportId", async () => {
    const db = buildMemoryDb();
    const r = await db.sepaReports.put({
      date: "2026-06-22",
      reportId: "RID_1",
      report_type: "PAIN002",
      s3_bucket: "railback-storage",
      s3_key: "sepa-reports/2026-06-22/RID_1.xml",
      sender: "Bank",
      mandates_correlated: ["MID_1"],
      received_at: "2026-06-22T10:00:00Z",
      ttl: 2094631200, // 2036-06-22 approximate, 10y post received_at
    });
    expect(r.ingest_source).toBe("MANUAL_UPLOAD");

    const fetched = await db.sepaReports.getByReportId("2026-06-22", "RID_1");
    expect(fetched?.reportId).toBe("RID_1");
    expect(fetched?.ttl).toBe(2094631200);
    expect(await db.sepaReports.getByReportId("2026-06-22", "MISSING")).toBeNull();
  });
});

describe("InMemoryDelayRepo", () => {
  it("departuresFromStation + segmentsForTrain", async () => {
    const db = new InMemoryDb();
    seedSegment(db.state, {
      trainNr: "ICE100", date: "2026-06-21", segId: "S1",
      delayMinutes: 0, reason: "", origin: "Berlin Hbf", destination: "Hamburg Hbf",
      origin_eva: 8011160, destination_eva: 8002549,
      planned_departure: "08:00", planned_arrival: "09:50",
      is_cancelled: false, source: "iris", last_seen_at: "2026-06-21T10:00:00Z",
    });
    seedSegment(db.state, {
      trainNr: "ICE200", date: "2026-06-21", segId: "S1",
      delayMinutes: 12, reason: "personenunfall", origin: "Berlin Hbf", destination: "Köln Hbf",
      origin_eva: 8011160, destination_eva: 8000207,
      planned_departure: "09:30", planned_arrival: "13:50",
      is_cancelled: false, source: "iris", last_seen_at: "2026-06-21T10:00:00Z",
    });

    const departures = await db.db.delays.departuresFromStation(8011160, "2026-06-21", "07:00", "10:00");
    expect(departures.map((d) => d.trainNr)).toEqual(["ICE100", "ICE200"]);

    const seg = await db.db.delays.segmentsForTrain("ICE200", "2026-06-21");
    expect(seg).toHaveLength(1);
    expect(seg[0]?.delayMinutes).toBe(12);
  });
});

describe("InMemoryAdminRepo", () => {
  it("getByEmail returns null for missing, found for seeded", async () => {
    const db = new InMemoryDb();
    expect(await db.db.admins.getByEmail("nobody@example.com")).toBeNull();
    seedAdmin(db.state, "root@railback.de", "hash");
    const a = await db.db.admins.getByEmail("root@railback.de");
    expect(a?.email).toBe("root@railback.de");
  });
});

describe("InMemoryTicketOwnerRepo", () => {
  it("put → get → delete", async () => {
    const db = buildMemoryDb();
    expect(await db.ticketOwners.get("TKT_X")).toBeNull();
    await db.ticketOwners.put("TKT_X", "Ada@Example.com");
    const o = await db.ticketOwners.get("TKT_X");
    expect(o?.email).toBe("ada@example.com"); // normalised
    await db.ticketOwners.delete("TKT_X");
    expect(await db.ticketOwners.get("TKT_X")).toBeNull();
  });
});

describe("InMemoryBlobRepo", () => {
  it("putRawUpload → getRawUpload round-trips metadata", async () => {
    const db = buildMemoryDb();
    await db.blobs.putRawUpload("ada@example.com", "TKT_A", {
      filename: "t.pdf",
      s3_bucket: "memory-mock",
      s3_key: "raw/abc/TKT_A.pdf",
      content_type: "application/pdf",
      size_bytes: 4096,
      uploaded_at: "2026-06-20T10:00:00Z",
    });
    const r = await db.blobs.getRawUpload("ada@example.com", "TKT_A");
    expect(r?.s3_key).toBe("raw/abc/TKT_A.pdf");
    expect(r?.size_bytes).toBe(4096);
  });

  it("putReceipt + listReceipts; rejects beleg #6", async () => {
    const db = buildMemoryDb();
    for (let i = 0; i < 5; i++) {
      await db.blobs.putReceipt("ada@example.com", "TKT_A", {
        belegId: `B${i}`,
        filename: `r${i}.jpg`,
        s3_bucket: "memory-mock",
        s3_key: `belege/x/TKT_A/B${i}.jpg`,
        content_type: "image/jpeg",
        size_bytes: 1024,
        typ: "TAXI",
        amount: "5.00",
        uploaded_at: "2026-06-20T10:00:00Z",
      });
    }
    expect(await db.blobs.listReceipts("ada@example.com", "TKT_A")).toHaveLength(5);
    await expect(
      db.blobs.putReceipt("ada@example.com", "TKT_A", {
        belegId: "B5",
        filename: "r5.jpg",
        s3_bucket: "memory-mock",
        s3_key: "belege/x/TKT_A/B5.jpg",
        content_type: "image/jpeg",
        size_bytes: 1024,
        typ: "TAXI",
        amount: "5.00",
        uploaded_at: "2026-06-20T10:00:00Z",
      })
    ).rejects.toMatchObject({ code: "ERR_CONFLICT" });
  });

  it("presignRawUploadPost shape is deterministic", async () => {
    const db = buildMemoryDb();
    const post = await db.blobs.presignRawUploadPost("ada@example.com", "TKT_A", "application/pdf");
    expect(post.url).toBe("http://memory-mock/post");
    expect(post.expiresIn).toBe(300);
    expect(post.key).toMatch(/^raw\/[0-9a-f]{16}\/TKT_A\.pdf$/);
    expect(post.fields["Content-Type"]).toBe("application/pdf");
    expect(post.fields["x-amz-content-length-range-max"]).toBe("10485760");
    expect(post.fields["key"]).toBe(post.key);
  });

  it("presignReceiptPost allocates a ulid belegId and 5 MB cap", async () => {
    const db = buildMemoryDb();
    const post = await db.blobs.presignReceiptPost("ada@example.com", "TKT_A", "image/jpeg");
    expect(post.key).toMatch(/^belege\/[0-9a-f]{16}\/TKT_A\/[0-9A-HJKMNP-TV-Z]{26}\.jpg$/);
    expect(post.fields["x-amz-content-length-range-max"]).toBe("5242880");
  });
});
