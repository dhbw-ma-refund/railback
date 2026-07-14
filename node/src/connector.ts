import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BaseConnector, ConflictError, Ok, Result, createClient, normaliseEmail } from "./base.js";
import { S3BlobConnector } from "./connectors/s3.js";

function isPlainTicketSk(sk: string): boolean {
  const tail = sk.slice("TICKET#".length);
  return sk.startsWith("TICKET#") && tail !== "" && !tail.includes("#");
}

// Email → USER# key. Trim + lowercase so mixed-case input maps into the
// same partition. See F7 (2026-07-08) — the backend layer already
// normalises via @railback/lib/storage/ddb/keys#normaliseEmail; without
// this the two systems would split partitions on any mixed-case input.
function userPk(email: string): string {
  return `USER#${normaliseEmail(email)}`;
}

function adminPk(email: string): string {
  return `ADMIN#${normaliseEmail(email)}`;
}

// ---------------------------------------------------------------------------
// User  —  pk=USER#{email}  sk=PROFILE
// ---------------------------------------------------------------------------

export class UserConnector extends BaseConnector {
  get(email: string) { return this._get(userPk(email), "PROFILE"); }
  // 2026-07-07 reversal (DECISIONS.md): admin sees the full row including
  // iban_enc / bic_enc. Decryption to plaintext happens in admin-handler
  // (backend layer) — the adapter just returns the raw row. Encryption at
  // rest is still enforced; admin authority to decrypt is a separate concern.
  getForAdmin(email: string): Promise<Result<Record<string, unknown> | null>> {
    return this._get(userPk(email), "PROFILE").then((r) => {
      if (r.isErr() || r.value === null) return r;
      return new Ok(r.value);
    });
  }
  getForAuth(email: string): Promise<Result<Record<string, unknown> | null>> {
    const norm = normaliseEmail(email);
    return this._get(userPk(norm), "PROFILE").then((r) => {
      if (r.isErr() || r.value === null) return r;
      const { hashed_password, user_state } = r.value;
      return new Ok({ email: norm, hashed_password, user_state });
    });
  }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, updates: Record<string, unknown>) {
    return this._updateFields(userPk(email), "PROFILE", updates);
  }
  listAll(limit?: number) {
    return this._query({ IndexName: "gsi1", KeyConditionExpression: "gsi1_pk = :v", ExpressionAttributeValues: { ":v": "USER" }, ...(limit !== undefined ? { Limit: limit } : {}) });
  }
}

// ---------------------------------------------------------------------------
// Admin  —  pk=ADMIN#{email}  sk=PROFILE
// ---------------------------------------------------------------------------

export class AdminConnector extends BaseConnector {
  get(email: string) { return this._get(adminPk(email), "PROFILE"); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, updates: Record<string, unknown>) {
    return this._updateFields(adminPk(email), "PROFILE", updates);
  }
  listAll(limit?: number) {
    return this._query({ IndexName: "gsi1", KeyConditionExpression: "gsi1_pk = :v", ExpressionAttributeValues: { ":v": "ADMIN" }, ...(limit !== undefined ? { Limit: limit } : {}) });
  }
}

// ---------------------------------------------------------------------------
// Ticket  —  pk=USER#{email}  sk=TICKET#{id}
// ---------------------------------------------------------------------------

export class TicketConnector extends BaseConnector {
  get(email: string, ticketId: string) { return this._get(userPk(email), `TICKET#${ticketId}`); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, ticketId: string, updates: Record<string, unknown>) {
    return this._updateFields(userPk(email), `TICKET#${ticketId}`, updates);
  }
  async listForUser(email: string, limit?: number): Promise<Result<Record<string, unknown>[]>> {
    const r = await this._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": userPk(email), ":prefix": "TICKET#" },
    });
    if (r.isErr()) return r;
    const items = r.value.filter((i) => isPlainTicketSk(i["sk"] as string));
    return new Ok(limit !== undefined ? items.slice(0, limit) : items);
  }
  getByTrain(trainNr: string, date: string, limit?: number) {
    return this._query({ IndexName: "gsi1", KeyConditionExpression: "gsi1_pk = :v", ExpressionAttributeValues: { ":v": `TRAIN#${trainNr}#${date}` }, ...(limit !== undefined ? { Limit: limit } : {}) });
  }
  async checkBarcodeDuplicate(barcodeUid: string): Promise<Result<Record<string, unknown> | null>> {
    const r = await this._query({
      IndexName: "gsi2",
      KeyConditionExpression: "gsi2_pk = :pk AND gsi2_sk = :sk",
      ExpressionAttributeValues: { ":pk": "BARCODE", ":sk": barcodeUid },
      Limit: 1,
    });
    if (r.isErr()) return r;
    const hit = r.value[0];
    if (!hit) return new Ok(null);
    // GSI2 is KEYS_ONLY (DB_SCHEMA.md) — the hit carries only pk/sk/gsi2_*.
    // Refetch the full ticket so callers get email/ticket_state/etc.
    return this._get(hit["pk"] as string, hit["sk"] as string);
  }
  async listEmailPending(limit: number): Promise<Result<Record<string, unknown>[]>> {
    const r = await this._query({
      IndexName: "gsi_email_pending",
      KeyConditionExpression: "gsi_email_pending_pk = :v",
      ExpressionAttributeValues: { ":v": "EMAIL_PENDING" },
      ScanIndexForward: true,
      Limit: limit,
    });
    if (r.isErr()) return r;
    // GSI_EMAIL_PENDING is KEYS_ONLY — refetch each hit's full item by pk/sk.
    // Oldest-first order from the index is preserved.
    const full: Record<string, unknown>[] = [];
    for (const hit of r.value) {
      const one = await this._get(hit["pk"] as string, hit["sk"] as string);
      if (one.isErr()) return one as unknown as Result<Record<string, unknown>[]>;
      if (one.value !== null) full.push(one.value);
    }
    return new Ok(full);
  }
}

// ---------------------------------------------------------------------------
// TicketOwner  —  pk=TICKET#{id}  sk=OWNER
// ---------------------------------------------------------------------------

export class TicketOwnerConnector extends BaseConnector {
  get(ticketId: string) { return this._get(`TICKET#${ticketId}`, "OWNER"); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(ticketId: string, updates: Record<string, unknown>) {
    return this._updateFields(`TICKET#${ticketId}`, "OWNER", updates);
  }
}

// ---------------------------------------------------------------------------
// RawUpload  —  pk=USER#{email}  sk=RAW#{id}
// ---------------------------------------------------------------------------

export class RawUploadConnector extends BaseConnector {
  get(email: string, ticketId: string) { return this._get(userPk(email), `RAW#${ticketId}`); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, ticketId: string, updates: Record<string, unknown>) {
    return this._updateFields(userPk(email), `RAW#${ticketId}`, updates);
  }
}

// ---------------------------------------------------------------------------
// RenderedPdf  —  pk=USER#{email}  sk=RENDERED#{id}
// ---------------------------------------------------------------------------

export class RenderedPdfConnector extends BaseConnector {
  get(email: string, ticketId: string) { return this._get(userPk(email), `RENDERED#${ticketId}`); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, ticketId: string, updates: Record<string, unknown>) {
    return this._updateFields(userPk(email), `RENDERED#${ticketId}`, updates);
  }
}

// ---------------------------------------------------------------------------
// OriginalReceipt  —  pk=USER#{email}  sk=TICKET#{id}#BELEG#{id}
// ---------------------------------------------------------------------------

export class OriginalReceiptConnector extends BaseConnector {
  get(email: string, ticketId: string, belegId: string) {
    return this._get(userPk(email), `TICKET#${ticketId}#BELEG#${belegId}`);
  }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, ticketId: string, belegId: string, updates: Record<string, unknown>) {
    return this._updateFields(userPk(email), `TICKET#${ticketId}#BELEG#${belegId}`, updates);
  }
  listForTicket(email: string, ticketId: string, limit?: number) {
    return this._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": userPk(email), ":prefix": `TICKET#${ticketId}#BELEG#` },
      ...(limit !== undefined ? { Limit: limit } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// SepaMandate  —  pk=USER#{email}  sk=TICKET#{id}#MANDATE
// ---------------------------------------------------------------------------

export class SepaMandateConnector extends BaseConnector {
  get(email: string, ticketId: string) {
    return this._get(userPk(email), `TICKET#${ticketId}#MANDATE`);
  }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, ticketId: string, updates: Record<string, unknown>) {
    return this._updateFields(userPk(email), `TICKET#${ticketId}#MANDATE`, updates);
  }
  stampPain008Built(email: string, ticketId: string, batchId: string, s3Key: string, builtAt: string) {
    return this._updateIf(
      userPk(email), `TICKET#${ticketId}#MANDATE`,
      { pain008_built_at: builtAt, pain008_batch_id: batchId, pain008_s3_key: s3Key },
      "attribute_exists(pk) AND attribute_not_exists(pain008_built_at)",
    );
  }
}

// ---------------------------------------------------------------------------
// SepaReport  —  pk=SEPA#REPORT#{date}  sk=REPORT#{id}
// ---------------------------------------------------------------------------

export class SepaReportConnector extends BaseConnector {
  get(date: string, reportId: string) { return this._get(`SEPA#REPORT#${date}`, `REPORT#${reportId}`); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(date: string, reportId: string, updates: Record<string, unknown>) {
    return this._updateFields(`SEPA#REPORT#${date}`, `REPORT#${reportId}`, updates);
  }
  listByDate(date: string, limit?: number) {
    return this._query({ KeyConditionExpression: "pk = :v", ExpressionAttributeValues: { ":v": `SEPA#REPORT#${date}` }, ...(limit !== undefined ? { Limit: limit } : {}) });
  }
}

// ---------------------------------------------------------------------------
// TrainSegmentDelay  —  pk=TRAIN#{nr}#{date}  sk=SEG#{id}
// ---------------------------------------------------------------------------

export class TrainSegmentDelayConnector extends BaseConnector {
  get(trainNr: string, date: string, segId: string) { return this._get(`TRAIN#${trainNr}#${date}`, `SEG#${segId}`); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(trainNr: string, date: string, segId: string, updates: Record<string, unknown>) {
    return this._updateFields(`TRAIN#${trainNr}#${date}`, `SEG#${segId}`, updates);
  }
  listForTrain(trainNr: string, date: string, limit?: number) {
    return this._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `TRAIN#${trainNr}#${date}`, ":prefix": "SEG#" },
      ...(limit !== undefined ? { Limit: limit } : {}),
    });
  }
  routeLookup(originEva: number, date: string, fromTime: string, toTime: string, limit?: number) {
    // Route-lookup rides GSI3 (STATION#<eva>#<date> / <plannedDeparture>#<trainNr>),
    // projection ALL — DB_SCHEMA.md "GSI3". NOT gsi1 (that's the train /
    // admin-enumeration index and never carries STATION# keys).
    //
    // The ingest-delays poller writes gsi3_sk as `<date>T<HH:MM>#<trainNr>`
    // (full ISO planned_departure), not the bare `<HH:MM>#…` the older spec
    // assumed. Callers pass the window as bare HH:MM (API contract), so we
    // date-prefix the bounds to the same `<date>T<HH:MM>` shape — otherwise
    // every HH:MM bound sorts lexically below the ISO keys and BETWEEN
    // matches nothing. `date` is already pinned by gsi3_pk, so prefixing with
    // it keeps the range exact. `￿` on the upper bound sweeps the
    // `#<trainNr>` suffix.
    const from = `${date}T${fromTime}`;
    const to = `${date}T${toTime}`;
    return this._query({
      IndexName: "gsi3",
      KeyConditionExpression: "gsi3_pk = :pk AND gsi3_sk BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": `STATION#${originEva}#${date}`, ":from": from, ":to": to + "￿" },
      ...(limit !== undefined ? { Limit: limit } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// RouteTemplate  —  pk=USER#{email}  sk=TEMPLATE#{id}
// ---------------------------------------------------------------------------

export class RouteTemplateConnector extends BaseConnector {
  get(email: string, templateId: string) { return this._get(userPk(email), `TEMPLATE#${templateId}`); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, templateId: string, updates: Record<string, unknown>) {
    return this._updateFields(userPk(email), `TEMPLATE#${templateId}`, updates);
  }
  listForUser(email: string, limit?: number) {
    return this._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": userPk(email), ":prefix": "TEMPLATE#" },
      ...(limit !== undefined ? { Limit: limit } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// Root connector
// ---------------------------------------------------------------------------

export class RailBackConnector {
  user: UserConnector;
  admin: AdminConnector;
  ticket: TicketConnector;
  ticketOwner: TicketOwnerConnector;
  rawUpload: RawUploadConnector;
  renderedPdf: RenderedPdfConnector;
  receipt: OriginalReceiptConnector;
  mandate: SepaMandateConnector;
  sepaReport: SepaReportConnector;
  trainDelay: TrainSegmentDelayConnector;
  routeTemplate: RouteTemplateConnector;
  s3blob: S3BlobConnector;

  constructor(client?: DynamoDBDocumentClient, opts?: { s3?: S3BlobConnector }) {
    const c = client ?? createClient();
    this.user = new UserConnector(c);
    this.admin = new AdminConnector(c);
    this.ticket = new TicketConnector(c);
    this.ticketOwner = new TicketOwnerConnector(c);
    this.rawUpload = new RawUploadConnector(c);
    this.renderedPdf = new RenderedPdfConnector(c);
    this.receipt = new OriginalReceiptConnector(c);
    this.mandate = new SepaMandateConnector(c);
    this.sepaReport = new SepaReportConnector(c);
    this.trainDelay = new TrainSegmentDelayConnector(c);
    this.routeTemplate = new RouteTemplateConnector(c);
    this.s3blob = opts?.s3 ?? new S3BlobConnector();
  }

  async deleteUser(email: string): Promise<Result<null>> {
    const r = await this.user._query({ KeyConditionExpression: "pk = :v", ExpressionAttributeValues: { ":v": userPk(email) } });
    if (r.isErr()) return r;
    const keys: { pk: string; sk: string }[] = r.value.map((i) => ({ pk: i["pk"] as string, sk: i["sk"] as string }));
    r.value.forEach((i) => {
      const sk = i["sk"] as string;
      if (isPlainTicketSk(sk)) {
        keys.push({ pk: `TICKET#${sk.slice("TICKET#".length)}`, sk: "OWNER" });
      }
    });
    return this.user._batchDelete(keys);
  }

  async deleteTicket(email: string, ticketId: string): Promise<Result<null>> {
    const norm = userPk(email);
    const r = await this.ticket._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": norm, ":prefix": `TICKET#${ticketId}#` },
    });
    if (r.isErr()) return r;
    const keys: { pk: string; sk: string }[] = r.value.map((i) => ({ pk: i["pk"] as string, sk: i["sk"] as string }));
    keys.push(
      { pk: norm, sk: `TICKET#${ticketId}` },
      { pk: `TICKET#${ticketId}`, sk: "OWNER" },
      { pk: norm, sk: `RAW#${ticketId}` },
      { pk: norm, sk: `RENDERED#${ticketId}` },
    );
    return this.ticket._batchDelete(keys);
  }

  deleteAdmin(email: string) { return this.admin._delete(adminPk(email), "PROFILE"); }
  deleteTicketOwner(ticketId: string) { return this.ticketOwner._delete(`TICKET#${ticketId}`, "OWNER"); }
  deleteRawUpload(email: string, ticketId: string) { return this.rawUpload._delete(userPk(email), `RAW#${ticketId}`); }
  deleteRenderedPdf(email: string, ticketId: string) { return this.renderedPdf._delete(userPk(email), `RENDERED#${ticketId}`); }
  deleteReceipt(email: string, ticketId: string, belegId: string) { return this.receipt._delete(userPk(email), `TICKET#${ticketId}#BELEG#${belegId}`); }
  deleteMandate(email: string, ticketId: string) { return this.mandate._delete(userPk(email), `TICKET#${ticketId}#MANDATE`); }
  deleteSepaReport(date: string, reportId: string) { return this.sepaReport._delete(`SEPA#REPORT#${date}`, `REPORT#${reportId}`); }
  deleteTrainDelay(trainNr: string, date: string, segId: string) { return this.trainDelay._delete(`TRAIN#${trainNr}#${date}`, `SEG#${segId}`); }
  deleteRouteTemplate(email: string, templateId: string) { return this.routeTemplate._delete(userPk(email), `TEMPLATE#${templateId}`); }
}

export { ConflictError };
export { S3BlobConnector };
