// DdbBackend — full 9-repo adapter surface. Methods that Phase 0 already
// wired continue to dispatch to the underlying RailBackConnector via
// Result-unwrap; every other method throws NotImplementedError so Phase-3
// wiring is falsifiable at runtime. The backend adapter-boundary maps
// NotImplementedError / ConflictError / AdapterError → AppError.

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { RailBackConnector, ConflictError } from "./connector.js";
import { AdapterError, NotImplementedError, emailHash, normaliseEmail, ulid, withConflictAsAdapterError } from "./base.js";
import type {
  AdminAuthLookup,
  AdminTicketQuery,
  NewMandate,
  NewRouteTemplate,
  NewRouteTicket,
  NewSepaReport,
  NewTicket,
  NewUser,
  Page,
  PresignedPost,
  ProfilePatch,
  RawUpload,
  RawUploadInput,
  Receipt,
  ReceiptInput,
  RenderedPdf,
  RenderedPdfInput,
  RouteTemplate,
  RouteTemplatePatch,
  SegmentDelay,
  SepaReport,
  Ticket,
  TicketOwner,
  TicketPatch,
  User,
  UserAdminView,
  UserAuthLookup,
  UserListQuery,
  Admin,
  SepaMandate,
} from "./dtos/index.js";
import type {
  UserRepo, AdminRepo, TicketRepo, MandateRepo,
  RouteTemplateRepo, BlobRepo, SepaReportRepo, DelayRepo, TicketOwnerRepo,
  Db,
} from "./types.js";
import type { UserState } from "./dtos/enums.js";

// Physical attribute names that must never leak past the adapter.
// Semantic identifiers (email, ticketId) are extracted from the composite
// keys before these are stripped.
const PHYSICAL_KEYS = new Set([
  "pk", "sk",
  "gsi1_pk", "gsi1_sk",
  "gsi2_pk", "gsi2_sk",
  "gsi3_pk", "gsi3_sk",
  "gsi_email_pending_pk", "gsi_email_pending_sk",
]);

function domainAttrs(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !PHYSICAL_KEYS.has(k)));
}

// S3 upload caps + presign TTL — mirror @railback/lib/storage/s3/presigned-post.ts
// (CLAUDE.md "File uploads": 10 MB raw, 5 MB beleg, 5 min TTL).
const RAW_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const BELEG_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const PRESIGN_TTL_SEC = 300;

/** Derive a file extension from filename first, then content-type. */
function extOf(contentType: string, filename: string): string {
  const fromName = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return "bin";
}

function mapUser(raw: Record<string, unknown>): User {
  const email = (raw["pk"] as string).slice("USER#".length);
  const attrs = domainAttrs(raw);
  // Reconstruct the nested {adresse: {...}} shape from the flat DDB
  // subfields (adresse_strasse / adresse_hausnr / ...). Mirrors the
  // in-memory fromItem() reconstruction.
  const adresse = {
    strasse: (attrs["adresse_strasse"] as string) ?? "",
    hausnr: (attrs["adresse_hausnr"] as string) ?? "",
    plz: (attrs["adresse_plz"] as string) ?? "",
    ort: (attrs["adresse_ort"] as string) ?? "",
    land: (attrs["adresse_land"] as string) ?? "",
  };
  delete attrs["adresse_strasse"];
  delete attrs["adresse_hausnr"];
  delete attrs["adresse_plz"];
  delete attrs["adresse_ort"];
  delete attrs["adresse_land"];
  // hashed_password is an on-item authentication artefact — never exposed
  // via the User DTO. Auth-only lookups go through getByEmailForAuth.
  delete attrs["hashed_password"];
  return { ...attrs, email, adresse } as unknown as User;
}

function mapUserAdminView(raw: Record<string, unknown>): UserAdminView {
  // 2026-07-07 reversal (DECISIONS.md): admin views carry `iban_enc` and
  // `bic_enc` verbatim; decryption to plaintext lives in admin-handler
  // (backend layer), NOT here. The adapter's job is now purely: return the
  // stored row, minus the DDB internal `ttl` attribute (never a domain
  // concept). Encryption-at-rest still applies — this method does not
  // decrypt; it just stops stripping.
  const stripped: Record<string, unknown> = { ...raw };
  delete stripped["ttl"];
  return mapUser(stripped) as unknown as UserAdminView;
}

function mapAdmin(raw: Record<string, unknown>): Admin {
  const email = (raw["pk"] as string).slice("ADMIN#".length);
  return { ...domainAttrs(raw), email } as unknown as Admin;
}

function mapTicket(raw: Record<string, unknown>): Ticket {
  const email = (raw["pk"] as string).slice("USER#".length);
  const ticketId = (raw["sk"] as string).slice("TICKET#".length);
  const barcodeUid = raw["gsi2_sk"] as string | undefined;
  const attrs = domainAttrs(raw);
  if (barcodeUid !== undefined) attrs["barcode_uid"] = barcodeUid;
  return { ...attrs, email, ticketId } as unknown as Ticket;
}

function mapMandate(raw: Record<string, unknown>): SepaMandate {
  const email = (raw["pk"] as string).slice("USER#".length);
  const ticketId = (raw["sk"] as string).slice("TICKET#".length).replace(/#MANDATE$/, "");
  return { ...domainAttrs(raw), email, ticketId } as unknown as SepaMandate;
}

function mapRouteTemplate(raw: Record<string, unknown>): RouteTemplate {
  const email = (raw["pk"] as string).slice("USER#".length);
  const templateId = (raw["sk"] as string).slice("TEMPLATE#".length);
  return { ...domainAttrs(raw), email, templateId } as unknown as RouteTemplate;
}

function mapTicketOwner(raw: Record<string, unknown>): TicketOwner {
  const ticketId = (raw["pk"] as string).slice("TICKET#".length);
  return { ...domainAttrs(raw), ticketId } as unknown as TicketOwner;
}

function mapRawUpload(email: string, id: string, raw: Record<string, unknown>): RawUpload {
  return { ...domainAttrs(raw), email, ticketId: id } as unknown as RawUpload;
}

function mapRenderedPdf(email: string, id: string, raw: Record<string, unknown>): RenderedPdf {
  return { ...domainAttrs(raw), email, ticketId: id } as unknown as RenderedPdf;
}

function mapReceipt(email: string, id: string, raw: Record<string, unknown>): Receipt {
  // SK = TICKET#<id>#BELEG#<belegId>
  const sk = raw["sk"] as string;
  const marker = "#BELEG#";
  const idx = sk.indexOf(marker);
  const belegId = idx >= 0 ? sk.slice(idx + marker.length) : "";
  return { ...domainAttrs(raw), email, ticketId: id, belegId } as unknown as Receipt;
}

// The ingest-delays poller stores the four time fields as full ISO
// `YYYY-MM-DDTHH:MM`, not the bare `HH:MM` the DB_SCHEMA "Export contract"
// and the SegmentDelay DTO (`// HH:MM`) promise. The `date` is already
// carried by pk / gsi3_pk, so the date-prefix on the time attrs is
// redundant. Normalize it away here — the DB adapter owns the wire format,
// so the route-lookup lib, /delays + /admin train-delays routes, and the
// refund-pdf field-map all keep seeing HH:MM unchanged.
const TIME_ATTRS = [
  "planned_departure",
  "actual_departure",
  "planned_arrival",
  "actual_arrival",
] as const;

/** `2026-06-12T00:11` → `00:11`; already-`HH:MM` and null/undefined pass through. */
function isoToHhmm(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.indexOf("T");
  // ISO datetime → take the time part; bare HH:MM (no 'T') is returned as-is.
  return t >= 0 ? v.slice(t + 1) : v;
}

function normalizeSegmentTimes(attrs: Record<string, unknown>): Record<string, unknown> {
  for (const k of TIME_ATTRS) {
    if (k in attrs) attrs[k] = isoToHhmm(attrs[k]);
  }
  return attrs;
}

function mapSegmentDelay(raw: Record<string, unknown>): SegmentDelay {
  // PK = TRAIN#<nr>#<date>, SK = SEG#<segId>
  const pkBody = (raw["pk"] as string).slice("TRAIN#".length);
  const hash = pkBody.indexOf("#");
  const trainNr = pkBody.slice(0, hash);
  const date = pkBody.slice(hash + 1);
  const segId = (raw["sk"] as string).slice("SEG#".length);
  const attrs = normalizeSegmentTimes(domainAttrs(raw));
  return { ...attrs, trainNr, date, segId } as unknown as SegmentDelay;
}

function mapSepaReport(raw: Record<string, unknown>): SepaReport {
  // PK = SEPA#REPORT#<date>, SK = REPORT#<reportId>
  const date = (raw["pk"] as string).slice("SEPA#REPORT#".length);
  const reportId = (raw["sk"] as string).slice("REPORT#".length);
  return { ...domainAttrs(raw), date, reportId } as unknown as SepaReport;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Compute the sparse-GSI membership keys for a Ticket domain object. Used
 * by tickets.create* (SET-only) and tickets.patch (SET+REMOVE) so the rule
 * lives in exactly one place. Mirrors the in-memory toItem() function.
 *
 * Rules:
 *  - gsi1: SET when fahrt_zugnummer_plan AND fahrt_abreisedatum both present.
 *  - gsi2: SET when barcode_uid present.
 *  - gsi_email_pending: SET when
 *      email_status IN {SENDING, FAILED_TRANSIENT}
 *      AND (email_attempts ?? 0) < 3
 *      AND email_last_attempt truthy
 *      AND ticket_state === "EMAIL_SENDING"
 */
function deriveTicketGsiKeys(t: Ticket): {
  sets: Record<string, unknown>;
  removeKeys: string[];
} {
  const sets: Record<string, unknown> = {};
  const removeKeys: string[] = [];

  if (t.fahrt_zugnummer_plan && t.fahrt_abreisedatum) {
    sets["gsi1_pk"] = `TRAIN#${t.fahrt_zugnummer_plan}#${t.fahrt_abreisedatum}`;
    sets["gsi1_sk"] = `TICKET#${t.ticketId}`;
  } else {
    removeKeys.push("gsi1_pk", "gsi1_sk");
  }

  if (t.barcode_uid) {
    sets["gsi2_pk"] = "BARCODE";
    sets["gsi2_sk"] = t.barcode_uid;
  } else {
    removeKeys.push("gsi2_pk", "gsi2_sk");
  }

  const emailPending =
    (t.email_status === "SENDING" || t.email_status === "FAILED_TRANSIENT") &&
    t.ticket_state === "EMAIL_SENDING" &&
    (t.email_attempts ?? 0) < 3 &&
    Boolean(t.email_last_attempt);
  if (emailPending) {
    sets["gsi_email_pending_pk"] = "EMAIL_PENDING";
    sets["gsi_email_pending_sk"] = t.email_last_attempt as string;
  } else {
    removeKeys.push("gsi_email_pending_pk", "gsi_email_pending_sk");
  }

  return { sets, removeKeys };
}

/**
 * Serialise a Ticket DTO to a complete DDB item (all fields present that
 * were set on the DTO, plus computed PK/SK and sparse-GSI keys). Used by
 * tickets.create + tickets.createFromRoute where we want a Put (not an
 * update-with-remove), so REMOVE clauses don't matter — we simply omit
 * absent keys.
 */
function ticketToItem(t: Ticket): Record<string, unknown> {
  const item: Record<string, unknown> = {
    pk: `USER#${normaliseEmail(t.email)}`,
    sk: `TICKET#${t.ticketId}`,
    ticketId: t.ticketId,
    ticket_state: t.ticket_state,
    state_timeline: t.state_timeline,
    extraction_status: t.extraction_status,
    extraction_method: t.extraction_method,
    extraction_confidence: t.extraction_confidence,
    updated_at: t.updated_at,
  };
  const { sets } = deriveTicketGsiKeys(t);
  Object.assign(item, sets);

  const optionalCopy: Array<keyof Ticket> = [
    "barcode_uid",
    "vorname_aus_ticket", "nachname_aus_ticket", "fahrt_abreisedatum",
    "fahrt_abreisebahnhof", "fahrt_zielbahnhof", "fahrt_abfahrtszeit_plan",
    "fahrt_ankunftszeit_plan", "fahrt_zugnummer_plan", "fahrt_zugkategorie_plan",
    "fahrt_fahrkartennummer", "fahrt_fahrkartenpreis",
    "tatsaechlich_ankunftsdatum", "tatsaechlich_abfahrtszeit",
    "tatsaechlich_ankunftszeit", "tatsaechlich_zugnummer",
    "tatsaechlich_verpasster_anschluss_bahnhof",
    "antragsgrund", "antragsart", "is_zeitkarte", "antragstellung_ort",
    "antragstellung_datum", "zusaetzliche_angaben", "datenschutz_einwilligung",
    "wahrheitserklaerung", "delayMinutes", "erwartete_erstattung",
    "service_fee_betrag", "db_paid_at", "admin_note", "service_fee_state",
    "email_status", "email_attempts", "email_last_attempt",
    "email_provider_id", "email_failed_reason", "uploaded_at", "submitted_at",
    "ttl", "archive_ttl", "belege_count",
  ];
  for (const k of optionalCopy) {
    const v = t[k];
    if (v !== undefined) (item as Record<string, unknown>)[k] = v;
  }
  return item;
}

// ---------------------------------------------------------------------------
// UserRepo
// ---------------------------------------------------------------------------

class UserRepoImpl implements UserRepo {
  constructor(private readonly c: RailBackConnector) {}

  async getByEmail(email: string): Promise<User | null> {
    const raw = (await this.c.user.get(email)).unwrap();
    return raw === null ? null : mapUser(raw);
  }

  async getByEmailForAuth(email: string): Promise<UserAuthLookup | null> {
    // Single read on (USER#<email>, PROFILE) — project down to the auth-only
    // fields. Distinct from getByEmail, which routes through mapUser and
    // strips hashed_password.
    const raw = (await this.c.user.get(email)).unwrap();
    if (raw === null) return null;
    const out: UserAuthLookup = {
      kind: "user",
      email: (raw["pk"] as string).slice("USER#".length),
      vorname: (raw["vorname"] as string | undefined) ?? "",
      nachname: (raw["nachname"] as string | undefined) ?? "",
      hashed_password: raw["hashed_password"] as string,
      user_state: raw["user_state"] as UserState,
    };
    if (raw["suspended_reason"] !== undefined) {
      out.suspended_reason = raw["suspended_reason"] as string;
    }
    return out;
  }

  async getByEmailAdminView(email: string): Promise<UserAdminView | null> {
    const raw = (await this.c.user.getForAdmin(email)).unwrap();
    return raw === null ? null : mapUserAdminView(raw);
  }

  async create(user: NewUser): Promise<User> {
    const email = normaliseEmail(user.email);
    const now = new Date().toISOString();
    const item: Record<string, unknown> = {
      pk: `USER#${normaliseEmail(email)}`,
      sk: "PROFILE",
      gsi1_pk: "USER",
      gsi1_sk: `EMAIL#${email}`,
      email,
      vorname: user.vorname,
      nachname: user.nachname,
      telefon: user.telefon,
      adresse_strasse: user.adresse.strasse,
      adresse_hausnr: user.adresse.hausnr,
      adresse_plz: user.adresse.plz,
      adresse_ort: user.adresse.ort,
      adresse_land: user.adresse.land,
      hashed_password: user.hashed_password,
      user_state: "ACTIVE",
      created_at: now,
      iban_enc: user.iban_enc,
      bic_enc: user.bic_enc,
      datenschutz_einwilligung: user.datenschutz_einwilligung,
      agb_akzeptiert: user.agb_akzeptiert,
    };
    await withConflictAsAdapterError(async () => {
      const r = await this.c.user._updateIf(
        `USER#${normaliseEmail(email)}`,
        "PROFILE",
        // Every non-key attribute goes through _updateIf as a SET — this
        // gives us the `attribute_not_exists(pk)` conditional in one round-trip.
        Object.fromEntries(
          Object.entries(item).filter(([k]) => k !== "pk" && k !== "sk"),
        ),
        "attribute_not_exists(pk)",
      );
      r.unwrap();
    });
    const created: User = {
      email,
      vorname: user.vorname,
      nachname: user.nachname,
      telefon: user.telefon,
      adresse: user.adresse,
      user_state: "ACTIVE",
      created_at: now,
      iban_enc: user.iban_enc,
      bic_enc: user.bic_enc,
      datenschutz_einwilligung: user.datenschutz_einwilligung,
      agb_akzeptiert: user.agb_akzeptiert,
    };
    return created;
  }

  async updateProfile(email: string, patch: ProfilePatch): Promise<User> {
    const norm = normaliseEmail(email);
    const existing = (await this.c.user.get(norm)).unwrap();
    if (existing === null) {
      throw new AdapterError("ERR_NOT_FOUND", `User ${norm} not found`);
    }
    const sets: Record<string, unknown> = {};
    const removes = new Set<string>();
    if (patch.vorname !== undefined) sets["vorname"] = patch.vorname;
    if (patch.nachname !== undefined) sets["nachname"] = patch.nachname;
    if (patch.telefon !== undefined) sets["telefon"] = patch.telefon;
    if (patch.adresse !== undefined) {
      sets["adresse_strasse"] = patch.adresse.strasse;
      sets["adresse_hausnr"] = patch.adresse.hausnr;
      sets["adresse_plz"] = patch.adresse.plz;
      sets["adresse_ort"] = patch.adresse.ort;
      sets["adresse_land"] = patch.adresse.land;
    }
    if (patch.iban_enc !== undefined) sets["iban_enc"] = patch.iban_enc;
    if (patch.bic_enc !== undefined) sets["bic_enc"] = patch.bic_enc;
    if (patch.user_state !== undefined) sets["user_state"] = patch.user_state;
    if (patch.suspended_at !== undefined) sets["suspended_at"] = patch.suspended_at;
    if (patch.suspended_reason !== undefined) sets["suspended_reason"] = patch.suspended_reason;
    if (patch.ttl !== undefined) sets["ttl"] = patch.ttl;
    if (patch.clear) {
      for (const k of patch.clear) removes.add(k);
    }
    if (Object.keys(sets).length === 0 && removes.size === 0) {
      // No-op — return the currently-persisted state.
      return mapUser(existing);
    }
    (await this.c.user._updateWithRemove(
      `USER#${norm}`, "PROFILE", sets, [...removes],
    )).unwrap();
    const merged = (await this.c.user.get(norm)).unwrap();
    if (merged === null) {
      throw new AdapterError("ERR_INTERNAL", `User ${norm} disappeared mid-update`);
    }
    return mapUser(merged);
  }

  async listAdminView(query: UserListQuery): Promise<Page<UserAdminView>> {
    const skPrefix = query.emailPrefix
      ? `EMAIL#${normaliseEmail(query.emailPrefix)}`
      : "EMAIL#";
    const params: Record<string, unknown> = {
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1_pk = :pk AND begins_with(gsi1_sk, :sk)",
      ExpressionAttributeValues: { ":pk": "USER", ":sk": skPrefix },
      Limit: query.limit,
    };
    if (query.cursor) {
      const decoded = Buffer.from(query.cursor, "base64").toString("utf8");
      params["ExclusiveStartKey"] = JSON.parse(decoded);
    }
    // Query with pagination — one page at a time. Post-filter on user_state
    // if requested; note this can leave the page "short" (fewer than limit
    // matches). Callers must tolerate that (documented on UserListQuery).
    const rows = (await this.c.user._query(params)).unwrap();
    const filtered = query.state
      ? rows.filter((r) => r["user_state"] === query.state)
      : rows;
    const items = filtered.map(mapUserAdminView);
    const out: Page<UserAdminView> = { items };
    // Detect "there's more" — if we hit the Limit and _query returned exactly
    // that count, encode the last gsi1_sk as the next cursor.
    if (rows.length >= query.limit && rows.length > 0) {
      const last = rows[rows.length - 1]!;
      const cursorKey = {
        pk: last["pk"],
        sk: last["sk"],
        gsi1_pk: last["gsi1_pk"],
        gsi1_sk: last["gsi1_sk"],
      };
      out.nextCursor = Buffer.from(JSON.stringify(cursorKey)).toString("base64");
    }
    return out;
  }

  async scheduleDeletion(email: string): Promise<void> {
    const norm = normaliseEmail(email);
    const existing = (await this.c.user.get(norm)).unwrap();
    if (existing === null) {
      throw new AdapterError("ERR_NOT_FOUND", `User ${norm} not found`);
    }
    const ttl = Math.floor(Date.now() / 1000) + 30 * SECONDS_PER_DAY;
    (await this.c.user._updateWithRemove(
      `USER#${norm}`, "PROFILE",
      { user_state: "DELETION_SCHEDULED", ttl },
    )).unwrap();
  }

  async scanDeletionScheduledExpired(nowEpochSec: number): Promise<User[]> {
    const out: User[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const params: Parameters<typeof this.c.user._scan>[0] = {
        FilterExpression:
          "sk = :sk AND #us = :st AND attribute_exists(#ttl) AND #ttl < :now",
        ExpressionAttributeNames: { "#us": "user_state", "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":sk": "PROFILE",
          ":st": "DELETION_SCHEDULED",
          ":now": nowEpochSec,
        },
      };
      if (lastKey !== undefined) params.ExclusiveStartKey = lastKey;
      const r = (await this.c.user._scan(params)).unwrap();
      for (const row of r.items) out.push(mapUser(row));
      lastKey = r.lastEvaluatedKey;
    } while (lastKey !== undefined);
    return out;
  }

  /**
   * STRICT single-row hard-delete — see the JSDoc block above the interface
   * declaration for the anonymisation-sweeper contract. Refuses to delete
   * if the partition still carries child rows (tickets, mandates, blobs).
   */
  async deleteByEmail(email: string): Promise<void> {
    const norm = normaliseEmail(email);
    const rows = (await this.c.user._query({
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `USER#${norm}` },
    })).unwrap();
    const nonProfile = rows.filter((r) => r["sk"] !== "PROFILE");
    if (nonProfile.length > 0) {
      throw new AdapterError(
        "ERR_CONFLICT",
        `user ${norm} still has ${nonProfile.length} child row(s)`,
      );
    }
    (await this.c.user._delete(`USER#${norm}`, "PROFILE")).unwrap();
  }

  async scanOrphanUserPks(): Promise<string[]> {
    // Full scan collecting every distinct pk starting with USER# (skip
    // anonymised sha256 partitions). For each pk, check if a PROFILE row
    // exists — if not, and the partition has children, emit the email.
    const byPk = new Map<string, { hasProfile: boolean; childCount: number }>();
    let lastKey: Record<string, unknown> | undefined;
    do {
      const params: Parameters<typeof this.c.user._scan>[0] = {
        ProjectionExpression: "pk, sk",
      };
      if (lastKey !== undefined) params.ExclusiveStartKey = lastKey;
      const r = (await this.c.user._scan(params)).unwrap();
      for (const row of r.items) {
        const pk = row["pk"] as string;
        if (!pk.startsWith("USER#")) continue;
        if (pk.startsWith("USER#sha256:")) continue;
        const entry = byPk.get(pk) ?? { hasProfile: false, childCount: 0 };
        if (row["sk"] === "PROFILE") entry.hasProfile = true;
        else entry.childCount++;
        byPk.set(pk, entry);
      }
      lastKey = r.lastEvaluatedKey;
    } while (lastKey !== undefined);
    const out: string[] = [];
    for (const [pk, v] of byPk) {
      if (!v.hasProfile && v.childCount > 0) {
        out.push(pk.slice("USER#".length));
      }
    }
    return out;
  }

  /**
   * STRICT single-row hard-delete of the PROFILE row under `USER#<email>`.
   *
   * Contract (locked Phase 3b — implementation lands in Phase 3b task #2):
   *   1. Query `pk = USER#<email>` and enumerate every sibling row.
   *   2. If ANY row exists other than the PROFILE row (`sk = PROFILE`),
   *      throw `AdapterError("ERR_CONFLICT", "user still has child rows")`.
   *   3. Otherwise `_delete(USER#<email>, PROFILE)`.
   *
   * Why strict? The anonymisation-sweeper (see CLAUDE.md § "DSGVO / TTL")
   * runs a two-pass cascade for GDPR-erasure:
   *   Pass A — anonymise every child row of `USER#<email>` in place:
   *            rewrite `pk` → `USER#sha256:<hash-of-email>`, strip PII_FIELDS
   *            + EMAIL_PIPELINE_FIELDS on tickets, strip PII_FIELDS on
   *            mandates. Children thus MIGRATE off the live partition to the
   *            anonymised partition.
   *   Pass B — call `users.deleteByEmail(email)` on the now-childless
   *            partition. This is a single-row hard-delete, cheap and
   *            audit-clean.
   *
   * If Pass A is skipped or partially failed, Pass B's strict check refuses
   * to orphan tickets/mandates under an email whose PROFILE row is gone.
   * The refusal surfaces as `ERR_CONFLICT` and the sweeper aborts + retries
   * on the next cron tick, guaranteeing eventual consistency without ever
   * leaving dangling children.
   *
   * Distinct from `deleteAllForUser` (below), which is the cascade
   * convenience helper used by `DdbBackend.deleteUser` for admin-triggered
   * hard-deletes that DO want to wipe children in one shot.
   */

  // (implementation of `deleteByEmail` and `scanOrphanUserPks` lives above,
  // co-located with the other write-path methods.)

  /**
   * Cascade-delete every row under `USER#<email>` plus the paired
   * `TICKET#<id>` OWNER rows for each ticket the user owned. Idempotent.
   *
   * This is the repo-scoped home of what used to live at
   * `RailBackConnector.deleteUser`. The connector method still exists as
   * the underlying implementation (batch-delete of raw DDB rows), but
   * every adapter caller — including `DdbBackend.deleteUser` — now goes
   * through this method so the cascade contract lives in one place at
   * the repo layer.
   *
   * NOTE: distinct from the interface's `deleteByEmail`, which is a
   * single-row hard-delete used by the anonymisation-sweeper at the end
   * of Pass A and comes online in Phase 3b.
   */
  async deleteAllForUser(email: string): Promise<void> {
    (await this.c.deleteUser(email)).unwrap();
  }
}

// ---------------------------------------------------------------------------
// AdminRepo
// ---------------------------------------------------------------------------

class AdminRepoImpl implements AdminRepo {
  constructor(private readonly c: RailBackConnector) {}

  async getByEmail(email: string): Promise<Admin | null> {
    const raw = (await this.c.admin.get(email)).unwrap();
    return raw === null ? null : mapAdmin(raw);
  }

  async getByEmailForAuth(email: string): Promise<AdminAuthLookup | null> {
    // No dedicated getForAuth on the AdminConnector yet; reuse plain get and
    // project. Phase 3 lifts this to a purpose-built projection like the
    // user side.
    const raw = (await this.c.admin.get(email)).unwrap();
    if (raw === null) return null;
    return {
      kind: "admin",
      email: (raw["pk"] as string).slice("ADMIN#".length),
      hashed_password: raw["hashed_password"] as string,
    };
  }
}

// ---------------------------------------------------------------------------
// TicketRepo
// ---------------------------------------------------------------------------

class TicketRepoImpl implements TicketRepo {
  constructor(private readonly c: RailBackConnector) {}

  async get(email: string, id: string): Promise<Ticket | null> {
    const raw = (await this.c.ticket.get(email, id)).unwrap();
    return raw === null ? null : mapTicket(raw);
  }

  async listForUser(email: string): Promise<Ticket[]> {
    return (await this.c.ticket.listForUser(email)).unwrap().map(mapTicket);
  }

  async create(ticket: NewTicket): Promise<Ticket> {
    const now = ticket.uploadedAt;
    const email = normaliseEmail(ticket.email);
    const t: Ticket = {
      email,
      ticketId: ticket.ticketId,
      ticket_state: "VALIDATING",
      state_timeline: [{ state: "VALIDATING", at: now }],
      extraction_status: "PROCESSING",
      extraction_method: "BARCODE",
      extraction_confidence: 0,
      uploaded_at: now,
      updated_at: now,
    };
    const ticketItem = ticketToItem(t);
    const ownerItem: Record<string, unknown> = {
      pk: `TICKET#${ticket.ticketId}`,
      sk: "OWNER",
      email,
      ticketId: ticket.ticketId,
      created_at: now,
    };
    // F6 (2026-07-08): the RAW# sibling row is NOT written here anymore.
    // Previously we wrote it with `s3_bucket: ""` as a placeholder, expecting
    // `upload-confirm` to fill in the real bucket name later. But
    // `upload-confirm` is idempotent — if the RAW# row already exists it
    // returns early, so the empty `s3_bucket` was never patched up. The
    // in-memory backend has always deferred RAW# creation to `upload-confirm`;
    // this brings the DDB adapter in line. The blob-metadata fields on
    // NewTicket (filename, s3_key, contentType, sizeBytes, mimeType) are
    // still on the DTO for call-site symmetry with the presign flow but are
    // ignored here — upload-confirm is the sole writer of RAW# rows.

    // Atomicity: ticket + owner in one transaction. Both condition on
    // attribute_not_exists(pk) — the TicketOwner row is the client-visible
    // "ticket exists" gate.
    const txItems: Array<Record<string, unknown>> = [
      {
        Put: {
          TableName: process.env["RAILBACK_DDB_TABLE"] ?? "RailBack",
          Item: ticketItem,
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
      {
        Put: {
          TableName: process.env["RAILBACK_DDB_TABLE"] ?? "RailBack",
          Item: ownerItem,
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
    ];
    await withConflictAsAdapterError(async () => {
      (await this.c.ticket._transactWrite(txItems)).unwrap();
    });
    return t;
  }

  async createFromRoute(input: NewRouteTicket): Promise<Ticket> {
    const now = new Date().toISOString();
    const email = normaliseEmail(input.email);
    const t: Ticket = {
      email,
      ticketId: input.ticketId,
      ticket_state: "READY",
      state_timeline: [{ state: "READY", at: now }],
      extraction_status: "DONE",
      extraction_method: "MANUAL_ROUTE",
      extraction_confidence: 0,
      fahrt_abreisedatum: input.date,
      fahrt_abreisebahnhof: input.fromStation,
      fahrt_zielbahnhof: input.toStation,
      fahrt_abfahrtszeit_plan: input.abfahrtszeit_plan,
      fahrt_ankunftszeit_plan: input.ankunftszeit_plan,
      fahrt_zugnummer_plan: input.trainNr,
      fahrt_fahrkartennummer: input.fahrkartennummer,
      fahrt_fahrkartenpreis: input.fahrkartenpreis,
      is_zeitkarte: input.is_zeitkarte,
      updated_at: now,
    };
    const ticketItem = ticketToItem(t);
    const ownerItem: Record<string, unknown> = {
      pk: `TICKET#${input.ticketId}`,
      sk: "OWNER",
      email,
      ticketId: input.ticketId,
      created_at: now,
    };
    const table = process.env["RAILBACK_DDB_TABLE"] ?? "RailBack";
    await withConflictAsAdapterError(async () => {
      (await this.c.ticket._transactWrite([
        { Put: { TableName: table, Item: ticketItem, ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: table, Item: ownerItem, ConditionExpression: "attribute_not_exists(pk)" } },
      ])).unwrap();
    });
    return t;
  }

  async patch(email: string, id: string, patch: TicketPatch): Promise<Ticket> {
    const raw = (await this.c.ticket.get(email, id)).unwrap();
    if (raw === null) {
      throw new AdapterError("ERR_NOT_FOUND", `Ticket ${id} not found`);
    }
    const prev = mapTicket(raw);
    const now = new Date().toISOString();
    const stateChanged =
      patch.ticket_state !== undefined && patch.ticket_state !== prev.ticket_state;

    // Merge patch onto prev. Split off `clear` (explicit remove list) and
    // any null values (implicit remove).
    const { clear, ...rest } = patch;
    const clearedFromNulls: string[] = [];
    const merged: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(rest)) {
      if (v === null) {
        delete merged[k];
        clearedFromNulls.push(k);
      } else if (v !== undefined) {
        merged[k] = v;
      }
    }
    if (clear) {
      for (const k of clear) delete merged[k];
    }
    if (stateChanged) {
      const timeline = [
        ...prev.state_timeline,
        { state: patch.ticket_state!, at: now },
      ];
      merged["state_timeline"] = timeline;
    }
    merged["updated_at"] = now;

    // Reconstruct the merged Ticket for GSI derivation.
    const mergedTicket = merged as unknown as Ticket;
    const { sets: gsiSets, removeKeys: gsiRemoves } = deriveTicketGsiKeys(mergedTicket);

    // Build the SET clause from every domain field the merged Ticket carries
    // that differs from PK/SK-derived semantics. Simplest correct approach:
    // rewrite the entire optional-field surface. That way the update
    // matches ticketToItem output on next get.
    const sets: Record<string, unknown> = {
      ticket_state: mergedTicket.ticket_state,
      state_timeline: mergedTicket.state_timeline,
      extraction_status: mergedTicket.extraction_status,
      extraction_method: mergedTicket.extraction_method,
      extraction_confidence: mergedTicket.extraction_confidence,
      updated_at: now,
      ...gsiSets,
    };
    const optionalFields: Array<keyof Ticket> = [
      "barcode_uid",
      "vorname_aus_ticket", "nachname_aus_ticket", "fahrt_abreisedatum",
      "fahrt_abreisebahnhof", "fahrt_zielbahnhof", "fahrt_abfahrtszeit_plan",
      "fahrt_ankunftszeit_plan", "fahrt_zugnummer_plan", "fahrt_zugkategorie_plan",
      "fahrt_fahrkartennummer", "fahrt_fahrkartenpreis",
      "tatsaechlich_ankunftsdatum", "tatsaechlich_abfahrtszeit",
      "tatsaechlich_ankunftszeit", "tatsaechlich_zugnummer",
      "tatsaechlich_verpasster_anschluss_bahnhof",
      "antragsgrund", "antragsart", "is_zeitkarte", "antragstellung_ort",
      "antragstellung_datum", "zusaetzliche_angaben", "datenschutz_einwilligung",
      "wahrheitserklaerung", "delayMinutes", "erwartete_erstattung",
      "service_fee_betrag", "db_paid_at", "admin_note", "service_fee_state",
      "email_status", "email_attempts", "email_last_attempt",
      "email_provider_id", "email_failed_reason", "uploaded_at", "submitted_at",
      "ttl", "archive_ttl", "belege_count",
    ];
    const removes = new Set<string>(gsiRemoves);
    for (const k of optionalFields) {
      const v = mergedTicket[k];
      if (v !== undefined) sets[k as string] = v;
      else removes.add(k as string);
    }
    // Explicit clears from patch.clear + null-in-patch — safe to add,
    // set() dedupes.
    for (const k of clearedFromNulls) removes.add(k);
    if (clear) for (const k of clear) removes.add(k);

    (await this.c.ticket._updateWithRemove(
      `USER#${normaliseEmail(email)}`, `TICKET#${id}`,
      sets, [...removes],
    )).unwrap();
    const after = (await this.c.ticket.get(email, id)).unwrap();
    if (after === null) {
      throw new AdapterError("ERR_INTERNAL", `Ticket ${id} disappeared mid-patch`);
    }
    return mapTicket(after);
  }

  async delete(email: string, id: string): Promise<void> {
    (await this.c.ticket._delete(`USER#${normaliseEmail(email)}`, `TICKET#${id}`)).unwrap();
  }

  async adminList(query: AdminTicketQuery): Promise<Page<Ticket>> {
    const decodeCursor = (): Record<string, unknown> | undefined => {
      if (!query.cursor) return undefined;
      return JSON.parse(Buffer.from(query.cursor, "base64").toString("utf8"));
    };

    // Route 1: trainNr + date → gsi1 query.
    if (query.trainNr && query.date) {
      const params: Record<string, unknown> = {
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1_pk = :pk",
        ExpressionAttributeValues: { ":pk": `TRAIN#${query.trainNr}#${query.date}` },
        Limit: query.limit,
      };
      const cursor = decodeCursor();
      if (cursor !== undefined) params["ExclusiveStartKey"] = cursor;
      const filters: string[] = [];
      const eav: Record<string, unknown> = { ":pk": `TRAIN#${query.trainNr}#${query.date}` };
      const ean: Record<string, string> = {};
      if (query.state) {
        filters.push("#ts = :st");
        ean["#ts"] = "ticket_state";
        eav[":st"] = query.state;
      }
      if (query.email) {
        filters.push("pk = :userpk");
        eav[":userpk"] = `USER#${normaliseEmail(query.email)}`;
      }
      if (filters.length > 0) {
        params["FilterExpression"] = filters.join(" AND ");
        params["ExpressionAttributeValues"] = eav;
        if (Object.keys(ean).length > 0) params["ExpressionAttributeNames"] = ean;
      }
      const rows = (await this.c.ticket._query(params)).unwrap();
      const items = rows.map(mapTicket);
      const out: Page<Ticket> = { items };
      if (rows.length >= query.limit && rows.length > 0) {
        const last = rows[rows.length - 1]!;
        out.nextCursor = Buffer.from(JSON.stringify({
          pk: last["pk"], sk: last["sk"],
          gsi1_pk: last["gsi1_pk"], gsi1_sk: last["gsi1_sk"],
        })).toString("base64");
      }
      return out;
    }

    // Route 2: email set (no trainNr+date) → pk query with TICKET# prefix.
    if (query.email) {
      const params: Record<string, unknown> = {
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `USER#${normaliseEmail(query.email)}`, ":prefix": "TICKET#" },
        Limit: query.limit,
      };
      const cursor = decodeCursor();
      if (cursor !== undefined) params["ExclusiveStartKey"] = cursor;
      const filters: string[] = [];
      const eav = params["ExpressionAttributeValues"] as Record<string, unknown>;
      const ean: Record<string, string> = {};
      if (query.state) {
        filters.push("#ts = :st");
        ean["#ts"] = "ticket_state";
        eav[":st"] = query.state;
      }
      if (query.fromDate) { filters.push("fahrt_abreisedatum >= :from"); eav[":from"] = query.fromDate; }
      if (query.toDate) { filters.push("fahrt_abreisedatum <= :to"); eav[":to"] = query.toDate; }
      if (filters.length > 0) {
        params["FilterExpression"] = filters.join(" AND ");
        if (Object.keys(ean).length > 0) params["ExpressionAttributeNames"] = ean;
      }
      const rows = (await this.c.ticket._query(params)).unwrap();
      // Filter out ticket sub-rows (MANDATE/BELEG) same way listForUser does.
      const plain = rows.filter((r) => {
        const sk = r["sk"] as string;
        const tail = sk.slice("TICKET#".length);
        return tail !== "" && !tail.includes("#");
      });
      const items = plain.map(mapTicket);
      const out: Page<Ticket> = { items };
      if (rows.length >= query.limit && rows.length > 0) {
        const last = rows[rows.length - 1]!;
        out.nextCursor = Buffer.from(JSON.stringify({
          pk: last["pk"], sk: last["sk"],
        })).toString("base64");
      }
      return out;
    }

    // Route 3: neither trainNr+date nor email → full scan with FilterExpression.
    const filters: string[] = ["begins_with(sk, :sk_prefix)"];
    const eav: Record<string, unknown> = { ":sk_prefix": "TICKET#" };
    const ean: Record<string, string> = {};
    if (query.state) {
      filters.push("#ts = :st");
      ean["#ts"] = "ticket_state";
      eav[":st"] = query.state;
    }
    if (query.trainNr) { filters.push("fahrt_zugnummer_plan = :tn"); eav[":tn"] = query.trainNr; }
    if (query.date) { filters.push("fahrt_abreisedatum = :date"); eav[":date"] = query.date; }
    if (query.fromDate) { filters.push("fahrt_abreisedatum >= :from"); eav[":from"] = query.fromDate; }
    if (query.toDate) { filters.push("fahrt_abreisedatum <= :to"); eav[":to"] = query.toDate; }

    const baseScanParams: Parameters<typeof this.c.ticket._scan>[0] = {
      FilterExpression: filters.join(" AND "),
      ExpressionAttributeValues: eav,
    };
    if (Object.keys(ean).length > 0) baseScanParams.ExpressionAttributeNames = ean;

    // DynamoDB applies `Limit` to items EXAMINED before the FilterExpression
    // runs, not to items returned — and this single-table design mixes
    // TrainSegmentDelay (`SEG#…`) rows in with tickets. A one-shot scan of
    // `Limit` items therefore routinely reads a page that is entirely
    // segment rows, filters all of them out, and hands back `items: []`
    // with a `LastEvaluatedKey` pointing INTO segment territory
    // (`TRAIN#…#SEG#…`). That was the reported bug: empty pages + a
    // segment-shaped nextCursor, page after page, and stats stuck at 0.
    //
    // Fix: drive the scan ourselves, accumulating matching plain-ticket rows
    // across DDB pages until we have `query.limit` of them or the table is
    // exhausted. The cursor we expose is the LastEvaluatedKey of the last
    // DDB page we actually read, so resumption is correct even when a page
    // yielded zero matches. A page-count guard bounds worst-case cost on a
    // table dominated by segment rows (admin-tooling scale — acceptable).
    const isPlainTicketRow = (row: Record<string, unknown>): boolean => {
      const sk = row["sk"] as string;
      if (!sk.startsWith("TICKET#")) return false;
      const tail = sk.slice("TICKET#".length);
      return tail !== "" && !tail.includes("#");
    };

    const decoded = decodeCursor();
    let startKey: Record<string, unknown> | undefined = decoded;
    const collected: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    const MAX_PAGES = 50; // ~50 * 1 MB scanned worst case before we yield.
    let pages = 0;

    do {
      const params: Parameters<typeof this.c.ticket._scan>[0] = { ...baseScanParams };
      if (startKey !== undefined) params.ExclusiveStartKey = startKey;
      const r = (await this.c.ticket._scan(params)).unwrap();
      for (const row of r.items) {
        if (isPlainTicketRow(row)) collected.push(row);
      }
      lastEvaluatedKey = r.lastEvaluatedKey;
      startKey = r.lastEvaluatedKey;
      pages++;
    } while (
      startKey !== undefined &&
      collected.length < query.limit &&
      pages < MAX_PAGES
    );

    const items = collected.slice(0, query.limit).map(mapTicket);
    const out: Page<Ticket> = { items };
    // A cursor is meaningful iff the table isn't exhausted. When we hit the
    // page guard mid-table we still surface the cursor so the caller can
    // resume — otherwise tickets beyond the guard would be invisible.
    if (lastEvaluatedKey !== undefined) {
      out.nextCursor = Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64");
    }
    return out;
  }

  async findByBarcodeUid(uid: string): Promise<Ticket | null> {
    const raw = (await this.c.ticket.checkBarcodeDuplicate(uid)).unwrap();
    return raw === null ? null : mapTicket(raw);
  }

  async queryEmailPending(limit: number): Promise<Ticket[]> {
    return (await this.c.ticket.listEmailPending(limit)).unwrap().map(mapTicket);
  }

  async scanEmailWatchdog(cutoffIso: string): Promise<Ticket[]> {
    const out: Ticket[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const params: Parameters<typeof this.c.ticket._scan>[0] = {
        FilterExpression:
          "begins_with(sk, :skp) AND #ts = :st AND #es = :se " +
          "AND attribute_exists(email_last_attempt) AND email_last_attempt < :cut",
        ExpressionAttributeNames: { "#ts": "ticket_state", "#es": "email_status" },
        ExpressionAttributeValues: {
          ":skp": "TICKET#",
          ":st": "EMAIL_SENDING",
          ":se": "SENT",
          ":cut": cutoffIso,
        },
      };
      if (lastKey !== undefined) params.ExclusiveStartKey = lastKey;
      const r = (await this.c.ticket._scan(params)).unwrap();
      for (const row of r.items) {
        const sk = row["sk"] as string;
        const tail = sk.slice("TICKET#".length);
        if (tail === "" || tail.includes("#")) continue;
        out.push(mapTicket(row));
      }
      lastKey = r.lastEvaluatedKey;
    } while (lastKey !== undefined);
    return out;
  }

  async anonymiseUserTickets(
    email: string,
    anonPk: string,
    nowIso: string,
  ): Promise<{ ticketIds: string[] }> {
    // PII strip-list mirrors in-memory anonymiseUserTickets.
    const PII_FIELDS = [
      "vorname_aus_ticket",
      "nachname_aus_ticket",
      "fahrt_fahrkartennummer",
      "antragstellung_ort",
      "antragstellung_datum",
      "zusaetzliche_angaben",
    ];
    const EMAIL_PIPELINE_FIELDS = [
      "gsi_email_pending_pk",
      "gsi_email_pending_sk",
      "email_status",
      "email_attempts",
      "email_last_attempt",
    ];

    const rows = (await this.c.ticket._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `USER#${normaliseEmail(email)}`, ":prefix": "TICKET#" },
    })).unwrap();
    const targets = rows.filter((r) => {
      const sk = r["sk"] as string;
      const tail = sk.slice("TICKET#".length);
      return tail !== "" && !tail.includes("#");
    });

    const ticketIds: string[] = [];
    const anonymised: Array<Record<string, unknown>> = [];
    for (const row of targets) {
      const next: Record<string, unknown> = { ...row };
      next["pk"] = anonPk;
      next["updated_at"] = nowIso;
      for (const k of PII_FIELDS) delete next[k];
      for (const k of EMAIL_PIPELINE_FIELDS) delete next[k];
      ticketIds.push(row["ticketId"] as string);
      anonymised.push(next);
    }

    // Chunk: each anonymised ticket = 1 delete + 1 put = 2 tx items.
    // DDB tx cap = 25, so 12 tickets fit safely (24 items).
    const table = process.env["RAILBACK_DDB_TABLE"] ?? "RailBack";
    const chunks = chunk(targets.map((row, i) => ({ row, next: anonymised[i]! })), 12);
    for (const c of chunks) {
      const txItems: Array<Record<string, unknown>> = [];
      for (const { row, next } of c) {
        txItems.push({
          Delete: { TableName: table, Key: { pk: row["pk"], sk: row["sk"] } },
        });
        txItems.push({ Put: { TableName: table, Item: next } });
      }
      (await this.c.ticket._transactWrite(txItems)).unwrap();
    }
    return { ticketIds };
  }

  async enumerateAllTicketIdsForUser(email: string): Promise<string[]> {
    const rows = (await this.c.ticket._query({
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `USER#${normaliseEmail(email)}` },
      ProjectionExpression: "sk",
    })).unwrap();
    const out = new Set<string>();
    for (const row of rows) {
      const sk = row["sk"] as string;
      if (sk.startsWith("TICKET#")) {
        const rest = sk.slice("TICKET#".length);
        const hashIdx = rest.indexOf("#");
        const id = hashIdx === -1 ? rest : rest.slice(0, hashIdx);
        if (id.length > 0) out.add(id);
      } else if (sk.startsWith("RAW#")) {
        const id = sk.slice("RAW#".length);
        if (id.length > 0) out.add(id);
      } else if (sk.startsWith("RENDERED#")) {
        const id = sk.slice("RENDERED#".length);
        if (id.length > 0) out.add(id);
      }
    }
    return [...out].sort();
  }

  /**
   * Cascade-delete a single ticket and every sub-row (RAW/RENDERED/BELEG/
   * MANDATE) plus the paired `TICKET#<id>` OWNER row. Idempotent.
   *
   * Repo-scoped home of what used to live at
   * `RailBackConnector.deleteTicket`. `DdbBackend.deleteTicket` now
   * delegates here so the cascade contract lives at the repo layer.
   *
   * NOTE: distinct from the interface's `delete`, which is a single-row
   * hard-delete of just the `TICKET#<id>` row (matches the memory
   * backend's shape). Full cascade wires into `delete` in Phase 3b.
   */
  async deleteWithCascade(email: string, id: string): Promise<void> {
    (await this.c.deleteTicket(email, id)).unwrap();
  }
}

// ---------------------------------------------------------------------------
// RouteTemplateRepo
// ---------------------------------------------------------------------------

class RouteTemplateRepoImpl implements RouteTemplateRepo {
  constructor(private readonly c: RailBackConnector) {}

  async list(email: string): Promise<RouteTemplate[]> {
    const rows = (await this.c.routeTemplate.listForUser(email)).unwrap();
    return rows.map(mapRouteTemplate)
      .sort((a, b) => a.templateId.localeCompare(b.templateId));
  }

  async get(email: string, id: string): Promise<RouteTemplate | null> {
    const raw = (await this.c.routeTemplate.get(email, id)).unwrap();
    return raw === null ? null : mapRouteTemplate(raw);
  }

  async create(email: string, tpl: NewRouteTemplate): Promise<RouteTemplate> {
    // Guard against duplicate templateId — mirrors the InMemory contract.
    // Conditional-write via _put + ConditionExpression would be cheaper but
    // the connector doesn't expose _putIf yet (Phase 3b); a read-then-write
    // is fine at route-template volume.
    const existing = (await this.c.routeTemplate.get(email, tpl.templateId)).unwrap();
    if (existing !== null) {
      throw new AdapterError(
        "ERR_CONFLICT",
        `Template ${tpl.templateId} already exists for this user`,
      );
    }
    const now = new Date().toISOString();
    const t: RouteTemplate = {
      email,
      templateId: tpl.templateId,
      label: tpl.label,
      from_station: tpl.from_station,
      from_eva: tpl.from_eva,
      to_station: tpl.to_station,
      to_eva: tpl.to_eva,
      created_at: now,
      updated_at: now,
    };
    if (tpl.fahrkartennummer !== undefined) t.fahrkartennummer = tpl.fahrkartennummer;
    if (tpl.fahrkartenpreis !== undefined) t.fahrkartenpreis = tpl.fahrkartenpreis;
    if (tpl.zugkategorie_pref !== undefined) t.zugkategorie_pref = tpl.zugkategorie_pref;

    const item: Record<string, unknown> = {
      pk: `USER#${normaliseEmail(email)}`,
      sk: `TEMPLATE#${tpl.templateId}`,
      templateId: tpl.templateId,
      label: t.label,
      from_station: t.from_station,
      from_eva: t.from_eva,
      to_station: t.to_station,
      to_eva: t.to_eva,
      created_at: t.created_at,
      updated_at: t.updated_at,
    };
    if (t.fahrkartennummer !== undefined) item["fahrkartennummer"] = t.fahrkartennummer;
    if (t.fahrkartenpreis !== undefined) item["fahrkartenpreis"] = t.fahrkartenpreis;
    if (t.zugkategorie_pref !== undefined) item["zugkategorie_pref"] = t.zugkategorie_pref;
    (await this.c.routeTemplate.put(item)).unwrap();
    return t;
  }

  async patch(
    email: string, id: string, patch: RouteTemplatePatch,
  ): Promise<RouteTemplate> {
    const raw = (await this.c.routeTemplate.get(email, id)).unwrap();
    if (raw === null) {
      throw new AdapterError("ERR_NOT_FOUND", `Template ${id} not found`);
    }
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { ...patch, updated_at: now };
    (await this.c.routeTemplate.update(email, id, updates)).unwrap();
    const merged: RouteTemplate = {
      ...mapRouteTemplate(raw),
      ...patch,
      updated_at: now,
    };
    return merged;
  }

  async delete(email: string, id: string): Promise<void> {
    (await this.c.routeTemplate._delete(`USER#${normaliseEmail(email)}`, `TEMPLATE#${id}`)).unwrap();
  }

  async deleteAllForUser(email: string): Promise<number> {
    const rows = (await this.c.routeTemplate.listForUser(email)).unwrap();
    for (const r of rows) {
      (await this.c.routeTemplate._delete(
        r["pk"] as string, r["sk"] as string,
      )).unwrap();
    }
    return rows.length;
  }
}

// ---------------------------------------------------------------------------
// BlobRepo
// ---------------------------------------------------------------------------

class BlobRepoImpl implements BlobRepo {
  constructor(private readonly c: RailBackConnector) {}

  async getRawUpload(email: string, id: string): Promise<RawUpload | null> {
    const raw = (await this.c.rawUpload.get(email, id)).unwrap();
    return raw === null ? null : mapRawUpload(email, id, raw);
  }

  async putRawUpload(
    email: string, id: string, input: RawUploadInput,
  ): Promise<void> {
    const item: Record<string, unknown> = {
      pk: `USER#${normaliseEmail(email)}`,
      sk: `RAW#${id}`,
      filename: input.filename,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      uploaded_at: input.uploaded_at,
    };
    if (input.ttl !== undefined) item["ttl"] = input.ttl;
    (await this.c.rawUpload.put(item)).unwrap();
  }

  async getRenderedPdf(email: string, id: string): Promise<RenderedPdf | null> {
    const raw = (await this.c.renderedPdf.get(email, id)).unwrap();
    return raw === null ? null : mapRenderedPdf(email, id, raw);
  }

  async putRenderedPdf(
    email: string, id: string, input: RenderedPdfInput,
  ): Promise<void> {
    const item: Record<string, unknown> = {
      pk: `USER#${normaliseEmail(email)}`,
      sk: `RENDERED#${id}`,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      size_bytes: input.size_bytes,
      rendered_at: input.rendered_at,
    };
    if (input.ttl !== undefined) item["ttl"] = input.ttl;
    (await this.c.renderedPdf.put(item)).unwrap();
  }

  async listReceipts(email: string, id: string): Promise<Receipt[]> {
    const rows = (await this.c.receipt.listForTicket(email, id)).unwrap();
    return rows.map((r) => mapReceipt(email, id, r));
  }

  async putReceipt(
    email: string, id: string, input: ReceiptInput,
  ): Promise<Receipt> {
    const item: Record<string, unknown> = {
      pk: `USER#${normaliseEmail(email)}`,
      sk: `TICKET#${id}#BELEG#${input.belegId}`,
      filename: input.filename,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      typ: input.typ,
      amount: input.amount,
      uploaded_at: input.uploaded_at,
    };
    if (input.ttl !== undefined) item["ttl"] = input.ttl;
    (await this.c.receipt.put(item)).unwrap();
    const r: Receipt = {
      email,
      ticketId: id,
      belegId: input.belegId,
      filename: input.filename,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      typ: input.typ,
      amount: input.amount,
      uploaded_at: input.uploaded_at,
    };
    if (input.ttl !== undefined) r.ttl = input.ttl;
    return r;
  }

  async deleteReceipt(
    email: string, id: string, belegId: string,
  ): Promise<void> {
    (await this.c.receipt._delete(
      `USER#${normaliseEmail(email)}`, `TICKET#${id}#BELEG#${belegId}`,
    )).unwrap();
  }

  // Phase 3c — generic bytes read from S3.
  async getBytes(
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    return this.c.s3blob.getObject(key);
  }

  // Phase 3c — generic bytes write to S3. `uploadedAt` is caller bookkeeping
  // (lives on the metadata row); S3 stamps its own LastModified, so we don't
  // duplicate it as object metadata.
  async putBytes(
    key: string, bytes: Uint8Array, contentType: string, _uploadedAt: string,
  ): Promise<void> {
    await this.c.s3blob.putObject(key, bytes, contentType);
  }

  // Phase 3c — presigned POST for the raw upload. Key convention mirrors
  // @railback/lib S3BlobRepo: raw/<emailHash>/<ticketId>.<ext>.
  async presignRawUploadPost(
    email: string, id: string, contentType: string,
  ): Promise<PresignedPost> {
    const key = `raw/${emailHash(email)}/${id}.${extOf(contentType, id)}`;
    const { url, fields } = await this.c.s3blob.presignPost(
      key, contentType, 1, RAW_UPLOAD_MAX_BYTES, PRESIGN_TTL_SEC,
    );
    return { url, fields, key, expiresIn: PRESIGN_TTL_SEC };
  }

  // Phase 3c — presigned POST for a beleg. Convention:
  // belege/<emailHash>/<ticketId>/<belegId>.<ext>. belegId is minted here
  // (random UUID) so the caller can persist the same id on the metadata row.
  async presignReceiptPost(
    email: string, id: string, contentType: string,
  ): Promise<PresignedPost> {
    // belegId must be a 26-char ULID: the user-handler belege routes match it
    // against ^[0-9A-HJKMNP-TV-Z]{26}$ both when parsing it out of the key
    // (post-belege.ts) and as a path param (post-belege-confirm.ts). A
    // randomUUID() here produced a UUID that failed that regex → 500.
    const belegId = ulid();
    const key = `belege/${emailHash(email)}/${id}/${belegId}.${extOf(contentType, belegId)}`;
    const { url, fields } = await this.c.s3blob.presignPost(
      key, contentType, 1, BELEG_UPLOAD_MAX_BYTES, PRESIGN_TTL_SEC,
    );
    return { url, fields, key, expiresIn: PRESIGN_TTL_SEC };
  }

  // Phase 3c — idempotent S3 delete by key.
  async deleteBytes(key: string): Promise<void> {
    await this.c.s3blob.deleteObject(key);
  }

  // Phase 3c — cascade: read metadata → delete S3 object → delete DDB row.
  // Returns the s3_key that was deleted (null if no metadata row existed).
  // Idempotent: missing row → no-op returning null.
  async deleteRawUpload(
    email: string, id: string,
  ): Promise<{ s3_key: string | null }> {
    const meta = await this.getRawUpload(email, id);
    if (meta === null) return { s3_key: null };
    await this.c.s3blob.deleteObject(meta.s3_key);
    (await this.c.deleteRawUpload(normaliseEmail(email), id)).unwrap();
    return { s3_key: meta.s3_key };
  }

  // Phase 3c — cascade for the rendered PDF.
  async deleteRenderedPdf(
    email: string, id: string,
  ): Promise<{ s3_key: string | null }> {
    const meta = await this.getRenderedPdf(email, id);
    if (meta === null) return { s3_key: null };
    await this.c.s3blob.deleteObject(meta.s3_key);
    (await this.c.deleteRenderedPdf(normaliseEmail(email), id)).unwrap();
    return { s3_key: meta.s3_key };
  }

  // Phase 3c — cascade for all belege of a ticket. Deletes every S3 object
  // then every metadata row. Returns the keys removed.
  async deleteAllReceipts(
    email: string, id: string,
  ): Promise<{ s3_keys: string[] }> {
    const receipts = await this.listReceipts(email, id);
    const s3_keys: string[] = [];
    for (const r of receipts) {
      await this.c.s3blob.deleteObject(r.s3_key);
      (await this.c.deleteReceipt(normaliseEmail(email), id, r.belegId)).unwrap();
      s3_keys.push(r.s3_key);
    }
    return { s3_keys };
  }
}

// ---------------------------------------------------------------------------
// MandateRepo
// ---------------------------------------------------------------------------

class MandateRepoImpl implements MandateRepo {
  constructor(private readonly c: RailBackConnector) {}

  async get(email: string, id: string): Promise<SepaMandate | null> {
    const raw = (await this.c.mandate.get(email, id)).unwrap();
    return raw === null ? null : mapMandate(raw);
  }

  async getByMandateId(mandateId: string): Promise<SepaMandate | null> {
    // ADR: v1 uses a full-table scan with `mandate_id = :v` filter, skipping
    // anonymised (`USER#sha256:`) partitions. GSI-on-mandate_id is future
    // work (Phase 5); admin-scale traffic tolerates the scan for now.
    let lastKey: Record<string, unknown> | undefined;
    do {
      const params: Parameters<typeof this.c.mandate._scan>[0] = {
        FilterExpression:
          "mandate_id = :m AND NOT begins_with(pk, :anon)",
        ExpressionAttributeValues: { ":m": mandateId, ":anon": "USER#sha256:" },
      };
      if (lastKey !== undefined) params.ExclusiveStartKey = lastKey;
      const r = (await this.c.mandate._scan(params)).unwrap();
      for (const row of r.items) {
        const sk = row["sk"] as string;
        if (!sk.endsWith("#MANDATE")) continue;
        return mapMandate(row);
      }
      lastKey = r.lastEvaluatedKey;
    } while (lastKey !== undefined);
    return null;
  }

  async issue(email: string, id: string, mandate: NewMandate): Promise<SepaMandate> {
    const issuedAt = new Date().toISOString();
    // 36 months TTL — mirrors in-memory MANDATE_TTL_MONTHS.
    const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.parse(issuedAt) + 36 * MS_PER_MONTH).toISOString();
    const m: SepaMandate = {
      email,
      ticketId: id,
      mandate_id: randomUUID(),
      mandate_state: "ISSUED",
      sequence_type: "OOFF",
      fee_amount: mandate.fee_amount,
      iban_enc: mandate.iban_enc,
      bic_enc: mandate.bic_enc,
      kontoinhaber_snapshot: mandate.kontoinhaber_snapshot,
      user_consent_at: mandate.user_consent_at,
      expires_at: expiresAt,
      issued_at: issuedAt,
    };
    if (mandate.user_consent_ip !== undefined) m.user_consent_ip = mandate.user_consent_ip;
    if (mandate.user_consent_user_agent !== undefined) m.user_consent_user_agent = mandate.user_consent_user_agent;
    if (mandate.vorabankuendigung_sent_at !== undefined) m.vorabankuendigung_sent_at = mandate.vorabankuendigung_sent_at;

    const item: Record<string, unknown> = {
      pk: `USER#${normaliseEmail(email)}`,
      sk: `TICKET#${id}#MANDATE`,
      mandate_id: m.mandate_id,
      mandate_state: m.mandate_state,
      sequence_type: m.sequence_type,
      fee_amount: m.fee_amount,
      iban_enc: m.iban_enc,
      bic_enc: m.bic_enc,
      kontoinhaber_snapshot: m.kontoinhaber_snapshot,
      user_consent_at: m.user_consent_at,
      expires_at: m.expires_at,
      issued_at: m.issued_at,
    };
    if (m.user_consent_ip !== undefined) item["user_consent_ip"] = m.user_consent_ip;
    if (m.user_consent_user_agent !== undefined) item["user_consent_user_agent"] = m.user_consent_user_agent;
    if (m.vorabankuendigung_sent_at !== undefined) item["vorabankuendigung_sent_at"] = m.vorabankuendigung_sent_at;

    await withConflictAsAdapterError(async () => {
      const r = await this.c.mandate._updateIf(
        `USER#${normaliseEmail(email)}`, `TICKET#${id}#MANDATE`,
        Object.fromEntries(
          Object.entries(item).filter(([k]) => k !== "pk" && k !== "sk"),
        ),
        "attribute_not_exists(pk)",
      );
      r.unwrap();
    });
    return m;
  }

  async stampPain008Built(
    email: string,
    id: string,
    info: { batchId: string; s3Key: string; builtAt: string },
  ): Promise<void> {
    // Conditional write — translate ConflictError → AdapterError(ERR_CONFLICT)
    // so the backend adapter-boundary re-throws AppError("ERR_CONFLICT").
    await withConflictAsAdapterError(async () => {
      (await this.c.mandate.stampPain008Built(
        email, id, info.batchId, info.s3Key, info.builtAt,
      )).unwrap();
    });
  }

  async markSubmitted(email: string, id: string, submittedAt: string): Promise<void> {
    await withConflictAsAdapterError(async () => {
      const r = await this.c.mandate._updateWithRemove(
        `USER#${normaliseEmail(email)}`, `TICKET#${id}#MANDATE`,
        { mandate_state: "SUBMITTED", pain008_submitted_at: submittedAt },
        [],
        "mandate_state = :prev",
        { ":prev": "ISSUED" },
      );
      r.unwrap();
    });
  }

  async markDebited(email: string, id: string, debitedAt: string): Promise<void> {
    await withConflictAsAdapterError(async () => {
      (await this.c.mandate._updateWithRemove(
        `USER#${normaliseEmail(email)}`, `TICKET#${id}#MANDATE`,
        { mandate_state: "DEBITED", debited_at: debitedAt },
        [],
        "mandate_state = :prev",
        { ":prev": "SUBMITTED" },
      )).unwrap();
    });
  }

  async markReversed(
    email: string, id: string, info: { reversedAt: string; reason: string },
  ): Promise<void> {
    await withConflictAsAdapterError(async () => {
      (await this.c.mandate._updateWithRemove(
        `USER#${normaliseEmail(email)}`, `TICKET#${id}#MANDATE`,
        {
          mandate_state: "REVERSED",
          reversed_at: info.reversedAt,
          reversed_reason: info.reason,
        },
        [],
        "mandate_state = :prev",
        { ":prev": "DEBITED" },
      )).unwrap();
    });
  }

  async markDisputed(
    email: string, id: string, disputeOpenedAt: string,
  ): Promise<void> {
    // Allowed prev states: DEBITED, SUBMITTED, REVERSED (disputes can be
    // opened after any of those). ConditionExpression uses IN via named
    // placeholders on the condition-values side.
    await withConflictAsAdapterError(async () => {
      (await this.c.mandate._updateWithRemove(
        `USER#${normaliseEmail(email)}`, `TICKET#${id}#MANDATE`,
        { mandate_state: "DISPUTED", dispute_opened_at: disputeOpenedAt },
        [],
        "mandate_state IN (:p1, :p2, :p3)",
        { ":p1": "DEBITED", ":p2": "SUBMITTED", ":p3": "REVERSED" },
      )).unwrap();
    });
  }

  async markExpired(email: string, id: string): Promise<void> {
    await withConflictAsAdapterError(async () => {
      (await this.c.mandate._updateWithRemove(
        `USER#${normaliseEmail(email)}`, `TICKET#${id}#MANDATE`,
        { mandate_state: "EXPIRED" },
        [],
        "mandate_state = :prev",
        { ":prev": "ISSUED" },
      )).unwrap();
    });
  }

  async markCancelled(email: string, id: string): Promise<void> {
    await withConflictAsAdapterError(async () => {
      (await this.c.mandate._updateWithRemove(
        `USER#${normaliseEmail(email)}`, `TICKET#${id}#MANDATE`,
        { mandate_state: "CANCELLED" },
        [],
        "mandate_state IN (:p1, :p2)",
        { ":p1": "ISSUED", ":p2": "SUBMITTED" },
      )).unwrap();
    });
  }

  async listPendingBatches(): Promise<SepaMandate[]> {
    return this.mandateScan(
      "mandate_state = :s AND attribute_exists(pain008_built_at) " +
        "AND attribute_not_exists(pain008_submitted_at) " +
        "AND NOT begins_with(pk, :anon)",
      { ":s": "ISSUED", ":anon": "USER#sha256:" },
    );
  }

  async listByBatchId(batchId: string): Promise<SepaMandate[]> {
    return this.mandateScan(
      "pain008_batch_id = :b AND NOT begins_with(pk, :anon)",
      { ":b": batchId, ":anon": "USER#sha256:" },
    );
  }

  async listExpiringISSUED(now: string): Promise<SepaMandate[]> {
    return this.mandateScan(
      "mandate_state = :s AND expires_at < :now AND NOT begins_with(pk, :anon)",
      { ":s": "ISSUED", ":now": now, ":anon": "USER#sha256:" },
    );
  }

  /** Shared paginated scan for list* methods. Filters to MANDATE sub-rows. */
  private async mandateScan(
    filter: string,
    eav: Record<string, unknown>,
    ean?: Record<string, string>,
  ): Promise<SepaMandate[]> {
    const out: SepaMandate[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const params: Parameters<typeof this.c.mandate._scan>[0] = {
        FilterExpression: filter,
        ExpressionAttributeValues: eav,
      };
      if (ean) params.ExpressionAttributeNames = ean;
      if (lastKey !== undefined) params.ExclusiveStartKey = lastKey;
      const r = (await this.c.mandate._scan(params)).unwrap();
      for (const row of r.items) {
        const sk = row["sk"] as string;
        if (!sk.endsWith("#MANDATE")) continue;
        out.push(mapMandate(row));
      }
      lastKey = r.lastEvaluatedKey;
    } while (lastKey !== undefined);
    return out;
  }

  async anonymiseUserMandates(
    email: string, anonPk: string,
  ): Promise<{ count: number }> {
    const PII_FIELDS = [
      "iban_enc",
      "bic_enc",
      "kontoinhaber_snapshot",
      "user_consent_ip",
      "user_consent_user_agent",
    ];
    const rows = (await this.c.mandate._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `USER#${normaliseEmail(email)}`, ":prefix": "TICKET#" },
    })).unwrap();
    const targets = rows.filter((r) => (r["sk"] as string).endsWith("#MANDATE"));
    const table = process.env["RAILBACK_DDB_TABLE"] ?? "RailBack";
    const pairs = targets.map((row) => {
      const next: Record<string, unknown> = { ...row };
      next["pk"] = anonPk;
      for (const k of PII_FIELDS) delete next[k];
      return { row, next };
    });
    for (const c of chunk(pairs, 12)) {
      const txItems: Array<Record<string, unknown>> = [];
      for (const { row, next } of c) {
        txItems.push({
          Delete: { TableName: table, Key: { pk: row["pk"], sk: row["sk"] } },
        });
        txItems.push({ Put: { TableName: table, Item: next } });
      }
      (await this.c.mandate._transactWrite(txItems)).unwrap();
    }
    return { count: targets.length };
  }
}

// ---------------------------------------------------------------------------
// SepaReportRepo
// ---------------------------------------------------------------------------

class SepaReportRepoImpl implements SepaReportRepo {
  constructor(private readonly c: RailBackConnector) {}

  async put(input: NewSepaReport): Promise<SepaReport> {
    const parsedAt = new Date().toISOString();
    const item: Record<string, unknown> = {
      pk: `SEPA#REPORT#${input.date}`,
      sk: `REPORT#${input.reportId}`,
      report_type: input.report_type,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      sender: input.sender,
      ingest_source: "MANUAL_UPLOAD",
      mandates_correlated: input.mandates_correlated,
      parsed_at: parsedAt,
      received_at: input.received_at,
      ttl: input.ttl,
    };
    (await this.c.sepaReport.put(item)).unwrap();
    const r: SepaReport = {
      date: input.date,
      reportId: input.reportId,
      report_type: input.report_type,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      sender: input.sender,
      ingest_source: "MANUAL_UPLOAD",
      mandates_correlated: input.mandates_correlated,
      parsed_at: parsedAt,
      received_at: input.received_at,
      ttl: input.ttl,
    };
    return r;
  }

  async getByReportId(date: string, reportId: string): Promise<SepaReport | null> {
    const raw = (await this.c.sepaReport.get(date, reportId)).unwrap();
    return raw === null ? null : mapSepaReport(raw);
  }
}

// ---------------------------------------------------------------------------
// DelayRepo
// ---------------------------------------------------------------------------

class DelayRepoImpl implements DelayRepo {
  constructor(private readonly c: RailBackConnector) {}

  async segmentsForTrain(trainNr: string, date: string): Promise<SegmentDelay[]> {
    const rows = (await this.c.trainDelay.listForTrain(trainNr, date)).unwrap();
    return rows.map(mapSegmentDelay)
      .sort((a, b) => a.planned_departure.localeCompare(b.planned_departure));
  }

  async departuresFromStation(
    eva: number, date: string, fromTime: string, toTime: string,
  ): Promise<SegmentDelay[]> {
    const rows = (await this.c.trainDelay.routeLookup(eva, date, fromTime, toTime)).unwrap();
    return rows.map(mapSegmentDelay)
      .sort((a, b) => a.planned_departure.localeCompare(b.planned_departure));
  }
}

// ---------------------------------------------------------------------------
// TicketOwnerRepo
// ---------------------------------------------------------------------------

class TicketOwnerRepoImpl implements TicketOwnerRepo {
  constructor(private readonly c: RailBackConnector) {}

  async get(ticketId: string): Promise<TicketOwner | null> {
    const raw = (await this.c.ticketOwner.get(ticketId)).unwrap();
    return raw === null ? null : mapTicketOwner(raw);
  }

  async put(ticketId: string, email: string, ttl?: number): Promise<void> {
    // Direct write path — the atomic (ticket + owner) TransactWriteItems lives in
    // Phase 3b on TicketRepoImpl.create. This method exists so tests and rare
    // repair scripts can still write an owner row without going through
    // ticket create.
    const item: Record<string, unknown> = {
      pk: `TICKET#${ticketId}`,
      sk: "OWNER",
      email: normaliseEmail(email),
      ticketId,
      created_at: new Date().toISOString(),
    };
    if (ttl !== undefined) item["ttl"] = ttl;
    (await this.c.ticketOwner.put(item)).unwrap();
  }

  async delete(ticketId: string): Promise<void> {
    (await this.c.ticketOwner._delete(`TICKET#${ticketId}`, "OWNER")).unwrap();
  }
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export class DdbBackend implements Db {
  readonly users: UserRepo;
  readonly admins: AdminRepo;
  readonly tickets: TicketRepo;
  readonly mandates: MandateRepo;
  readonly routeTemplates: RouteTemplateRepo;
  readonly blobs: BlobRepo;
  readonly sepaReports: SepaReportRepo;
  readonly delays: DelayRepo;
  readonly ticketOwners: TicketOwnerRepo;

  private readonly connector: RailBackConnector;

  constructor(client?: DynamoDBDocumentClient) {
    this.connector = new RailBackConnector(client);
    this.users = new UserRepoImpl(this.connector);
    this.admins = new AdminRepoImpl(this.connector);
    this.tickets = new TicketRepoImpl(this.connector);
    this.mandates = new MandateRepoImpl(this.connector);
    this.routeTemplates = new RouteTemplateRepoImpl(this.connector);
    this.blobs = new BlobRepoImpl(this.connector);
    this.sepaReports = new SepaReportRepoImpl(this.connector);
    this.delays = new DelayRepoImpl(this.connector);
    this.ticketOwners = new TicketOwnerRepoImpl(this.connector);
  }

  /**
   * Root-level cascade helpers. Preserved for callers (and the
   * adapter.test.ts suite) that used the pre-Phase-3a shape
   * `db.deleteUser(e)` / `db.deleteTicket(e, tid)`. Delegate to the
   * repo-scoped cascade methods (`users.deleteAllForUser`,
   * `tickets.deleteWithCascade`) so the cascade contract lives at
   * the repo layer.
   *
   * Not part of the `Db` interface — memory backend doesn't need them
   * (`route-templates.deleteAllForUser` + `anonymisation-sweeper`
   * cascades cover the equivalent shape there). Marked here as a
   * transitional convenience; new callers should reach for the
   * repo-scoped methods directly.
   */
  deleteUser(email: string): Promise<void> {
    return (this.users as UserRepoImpl).deleteAllForUser(email);
  }

  deleteTicket(email: string, ticketId: string): Promise<void> {
    return (this.tickets as TicketRepoImpl).deleteWithCascade(email, ticketId);
  }
}

export type {
  Db, UserRepo, AdminRepo, TicketRepo, MandateRepo,
  RouteTemplateRepo, BlobRepo, SepaReportRepo, DelayRepo, TicketOwnerRepo,
} from "./types.js";
export type {
  User, UserAdminView, UserAuthLookup, Admin, Ticket, SepaMandate,
} from "./types.js";
export { ConflictError, AdapterError, NotImplementedError, withConflictAsAdapterError };
