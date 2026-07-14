// Phase-3a smoke tests — happy-path only, one per newly-wired repo. Covers
// routeTemplates / ticketOwners / blobs (metadata half) / delays / sepaReports
// plus the two root-level cascade delegators (deleteUser/deleteTicket).
// The full Phase-1/2 adapter suite lives in adapter.test.ts.

import { makeBackend, makeDb } from "./helpers.js";

const backend = makeBackend();
const raw = makeDb();

const NOW = "2026-01-01T00:00:00.000Z";
const NS = "adp3a";

const PHYSICAL = ["pk", "sk", "gsi1_pk", "gsi1_sk", "gsi2_pk", "gsi2_sk",
  "gsi3_pk", "gsi3_sk",
  "gsi_email_pending_pk", "gsi_email_pending_sk"];

function assertNoPhysicalKeys(obj: Record<string, unknown>) {
  for (const k of PHYSICAL) {
    expect(obj).not.toHaveProperty(k);
  }
}

// ---------------------------------------------------------------------------
// routeTemplates
// ---------------------------------------------------------------------------

describe("DdbBackend.routeTemplates", () => {
  const e = `${NS}.rt@it.de`;

  test("create + get + list + patch + delete round-trip", async () => {
    const tpl = await backend.routeTemplates.create(e, {
      templateId: `RT_${NS}_A`,
      label: "Home → Office",
      from_station: "Hbf",
      from_eva: 8000105,
      to_station: "Ost",
      to_eva: 8000261,
      fahrkartenpreis: "12.34",
    });
    expect(tpl.templateId).toBe(`RT_${NS}_A`);
    expect(tpl.email).toBe(e);
    expect(tpl.fahrkartenpreis).toBe("12.34");
    assertNoPhysicalKeys(tpl as unknown as Record<string, unknown>);

    const got = await backend.routeTemplates.get(e, `RT_${NS}_A`);
    expect(got).not.toBeNull();
    expect(got!.label).toBe("Home → Office");
    assertNoPhysicalKeys(got as unknown as Record<string, unknown>);

    const list = await backend.routeTemplates.list(e);
    expect(list.some((t) => t.templateId === `RT_${NS}_A`)).toBe(true);

    const patched = await backend.routeTemplates.patch(e, `RT_${NS}_A`, {
      label: "New Label",
    });
    expect(patched.label).toBe("New Label");
    expect(patched.updated_at).not.toBe(tpl.updated_at);

    await backend.routeTemplates.delete(e, `RT_${NS}_A`);
    expect(await backend.routeTemplates.get(e, `RT_${NS}_A`)).toBeNull();
  });

  test("create rejects duplicate templateId with ERR_CONFLICT", async () => {
    const tid = `RT_${NS}_DUP`;
    await backend.routeTemplates.create(e, {
      templateId: tid, label: "A", from_station: "X", from_eva: 1, to_station: "Y", to_eva: 2,
    });
    await expect(
      backend.routeTemplates.create(e, {
        templateId: tid, label: "B", from_station: "X", from_eva: 1, to_station: "Y", to_eva: 2,
      }),
    ).rejects.toThrow(/already exists|ERR_CONFLICT/);
    await backend.routeTemplates.delete(e, tid);
  });
});

// ---------------------------------------------------------------------------
// ticketOwners
// ---------------------------------------------------------------------------

describe("DdbBackend.ticketOwners", () => {
  const e = `${NS}.own@it.de`;

  test("put + get + delete round-trip", async () => {
    const tid = `T_${NS}_OWN`;
    await backend.ticketOwners.put(tid, e);
    const owner = await backend.ticketOwners.get(tid);
    expect(owner).not.toBeNull();
    expect(owner!.ticketId).toBe(tid);
    expect(owner!.email).toBe(e);
    assertNoPhysicalKeys(owner as unknown as Record<string, unknown>);

    await backend.ticketOwners.delete(tid);
    expect(await backend.ticketOwners.get(tid)).toBeNull();
  });

  test("get returns null on unknown ticketId", async () => {
    expect(await backend.ticketOwners.get(`T_${NS}_GHOST`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// blobs (metadata half — bytes are Phase 3c)
// ---------------------------------------------------------------------------

describe("DdbBackend.blobs", () => {
  const e = `${NS}.blob@it.de`;

  test("raw upload put + get + round-trip", async () => {
    const tid = `T_${NS}_RAW`;
    await backend.blobs.putRawUpload(e, tid, {
      filename: "ticket.pdf",
      s3_bucket: "b",
      s3_key: `raw/${e}/${tid}.pdf`,
      content_type: "application/pdf",
      size_bytes: 12345,
      uploaded_at: NOW,
    });
    const r = await backend.blobs.getRawUpload(e, tid);
    expect(r).not.toBeNull();
    expect(r!.email).toBe(e);
    expect(r!.ticketId).toBe(tid);
    expect(r!.s3_key).toBe(`raw/${e}/${tid}.pdf`);
    expect(r!.size_bytes).toBe(12345);
    assertNoPhysicalKeys(r as unknown as Record<string, unknown>);
    await raw.rawUpload._delete(`USER#${e}`, `RAW#${tid}`);
  });

  test("rendered pdf put + get round-trip", async () => {
    const tid = `T_${NS}_REND`;
    await backend.blobs.putRenderedPdf(e, tid, {
      s3_bucket: "b",
      s3_key: `rendered/${tid}.pdf`,
      size_bytes: 4567,
      rendered_at: NOW,
    });
    const r = await backend.blobs.getRenderedPdf(e, tid);
    expect(r).not.toBeNull();
    expect(r!.s3_key).toBe(`rendered/${tid}.pdf`);
    assertNoPhysicalKeys(r as unknown as Record<string, unknown>);
    await raw.renderedPdf._delete(`USER#${e}`, `RENDERED#${tid}`);
  });

  test("receipts put + list round-trip", async () => {
    const tid = `T_${NS}_BEL`;
    const r1 = await backend.blobs.putReceipt(e, tid, {
      belegId: "B1", filename: "taxi.jpg", s3_bucket: "b",
      s3_key: `belege/${tid}/B1.jpg`, content_type: "image/jpeg",
      size_bytes: 1000, typ: "TAXI", amount: "12.50", uploaded_at: NOW,
    });
    expect(r1.belegId).toBe("B1");
    expect(r1.email).toBe(e);
    const list = await backend.blobs.listReceipts(e, tid);
    expect(list.length).toBeGreaterThanOrEqual(1);
    const b1 = list.find((r) => r.belegId === "B1");
    expect(b1).toBeDefined();
    expect(b1!.amount).toBe("12.50");
    assertNoPhysicalKeys(b1 as unknown as Record<string, unknown>);
    await backend.blobs.deleteReceipt(e, tid, "B1");
    const list2 = await backend.blobs.listReceipts(e, tid);
    expect(list2.find((r) => r.belegId === "B1")).toBeUndefined();
  });

  test("S3-bytes methods are wired in Phase 3c (put/get round-trip + presign key)", async () => {
    // Phase 3c filled these against the S3BlobConnector. They no longer throw
    // NotImplementedError; full S3 behaviour (cascades, caps) is covered by
    // tests/adapter_phase3c_blobs.test.ts. Here we just confirm the happy path.
    const key = `rendered/${NS}/phase3a-bytes.pdf`;
    await backend.blobs.putBytes(key, new TextEncoder().encode("hi"), "application/pdf", NOW);
    const got = await backend.blobs.getBytes(key);
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!.bytes)).toBe("hi");
    await backend.blobs.deleteBytes(key);

    const presigned = await backend.blobs.presignRawUploadPost(e, "T", "application/pdf");
    expect(presigned.key).toMatch(/^raw\/[0-9a-f]{16}\/T\.pdf$/);
    expect(presigned.expiresIn).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// delays
// ---------------------------------------------------------------------------

describe("DdbBackend.delays", () => {
  const DATE = "2026-08-01";
  const TRAIN = `ICE_${NS}`;

  test("segmentsForTrain returns SegmentDelay DTOs sorted by planned_departure", async () => {
    // ingest-delays stores the time fields as full ISO `<date>T<HH:MM>` and
    // gsi3_sk as `<date>T<HH:MM>#<trainNr>`. The adapter normalizes the time
    // fields back to HH:MM on read — these fixtures mirror the stored ISO,
    // the assertions below check the normalized HH:MM output.
    const segs = [
      { sk: "SEG#S1", planned_departure: "10:00", planned_arrival: "10:30" },
      { sk: "SEG#S0", planned_departure: "09:00", planned_arrival: "09:30" },
    ];
    for (const s of segs) {
      await raw.trainDelay.put({
        pk: `TRAIN#${TRAIN}#${DATE}`,
        sk: s.sk,
        gsi3_pk: `STATION#8000105#${DATE}`,
        gsi3_sk: `${DATE}T${s.planned_departure}#${TRAIN}`,
        delayMinutes: 5,
        reason: "signal",
        origin: "Hbf",
        destination: "Ost",
        origin_eva: 8000105,
        destination_eva: 8000261,
        planned_departure: `${DATE}T${s.planned_departure}`,
        planned_arrival: `${DATE}T${s.planned_arrival}`,
        is_cancelled: false,
        source: "iris",
        last_seen_at: NOW,
      });
    }
    const out = await backend.delays.segmentsForTrain(TRAIN, DATE);
    expect(out.length).toBe(2);
    expect(out[0]!.planned_departure).toBe("09:00");
    expect(out[1]!.planned_departure).toBe("10:00");
    expect(out[0]!.planned_arrival).toBe("09:30");
    expect(out[0]!.trainNr).toBe(TRAIN);
    expect(out[0]!.date).toBe(DATE);
    expect(out[0]!.segId).toBe("S0");
    assertNoPhysicalKeys(out[0] as unknown as Record<string, unknown>);

    const deps = await backend.delays.departuresFromStation(
      8000105, DATE, "08:00", "09:30",
    );
    expect(deps.length).toBe(1);
    expect(deps[0]!.planned_departure).toBe("09:00");

    for (const s of segs) {
      await raw.trainDelay._delete(`TRAIN#${TRAIN}#${DATE}`, s.sk);
    }
  });
});

// ---------------------------------------------------------------------------
// sepaReports
// ---------------------------------------------------------------------------

describe("DdbBackend.sepaReports", () => {
  test("put + getByReportId round-trip", async () => {
    const date = "2026-08-01";
    const reportId = `R_${NS}_A`;
    const r = await backend.sepaReports.put({
      date,
      reportId,
      report_type: "PAIN002",
      s3_bucket: "b",
      s3_key: `sepa-reports/${date}/${reportId}.xml`,
      sender: "bank@example.de",
      mandates_correlated: ["M1", "M2"],
      received_at: NOW,
      ttl: 1970000000,
    });
    expect(r.reportId).toBe(reportId);
    expect(r.ingest_source).toBe("MANUAL_UPLOAD");
    expect(r.mandates_correlated).toEqual(["M1", "M2"]);

    const got = await backend.sepaReports.getByReportId(date, reportId);
    expect(got).not.toBeNull();
    expect(got!.report_type).toBe("PAIN002");
    expect(got!.sender).toBe("bank@example.de");
    assertNoPhysicalKeys(got as unknown as Record<string, unknown>);

    await raw.sepaReport._delete(`SEPA#REPORT#${date}`, `REPORT#${reportId}`);
  });

  test("getByReportId returns null for unknown", async () => {
    expect(
      await backend.sepaReports.getByReportId("2099-01-01", "GHOST"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Root-level cascade delegators (moved from RailBackConnector root)
// ---------------------------------------------------------------------------

describe("DdbBackend cascade delegators", () => {
  const e = `${NS}.cascade@it.de`;

  test("deleteUser cascades user + ticket + owner rows", async () => {
    const tid = `T_${NS}_CU`;
    await raw.user.put({
      pk: `USER#${e}`, sk: "PROFILE",
      gsi1_pk: "USER", gsi1_sk: `EMAIL#${e}`,
      user_state: "ACTIVE", hashed_password: "pw",
      vorname: "T", nachname: "U", created_at: NOW,
    });
    await raw.ticket.put({
      pk: `USER#${e}`, sk: `TICKET#${tid}`,
      ticket_state: "READY", updated_at: NOW,
    });
    await raw.ticketOwner.put({
      pk: `TICKET#${tid}`, sk: "OWNER",
      email: e, ticketId: tid, created_at: NOW,
    });
    await backend.deleteUser(e);
    expect(await backend.users.getByEmail(e)).toBeNull();
    expect(await backend.tickets.get(e, tid)).toBeNull();
    expect(await backend.ticketOwners.get(tid)).toBeNull();
  });

  test("deleteTicket cascades ticket + owner + sub-rows", async () => {
    const tid = `T_${NS}_CT`;
    await raw.ticket.put({
      pk: `USER#${e}`, sk: `TICKET#${tid}`,
      ticket_state: "READY", updated_at: NOW,
    });
    await raw.ticketOwner.put({
      pk: `TICKET#${tid}`, sk: "OWNER",
      email: e, ticketId: tid, created_at: NOW,
    });
    await raw.mandate.put({
      pk: `USER#${e}`, sk: `TICKET#${tid}#MANDATE`,
      mandate_state: "ISSUED", fee_amount: "0.75",
      issued_at: NOW,
    });
    await backend.deleteTicket(e, tid);
    expect(await backend.tickets.get(e, tid)).toBeNull();
    expect(await backend.ticketOwners.get(tid)).toBeNull();
    expect(await backend.mandates.get(e, tid)).toBeNull();
  });
});
