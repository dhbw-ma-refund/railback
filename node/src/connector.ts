import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BaseConnector, ConflictError, Ok, Result, createClient } from "./base.js";

const ADMIN_STRIPPED = new Set(["iban_enc", "bic_enc"]);

function isPlainTicketSk(sk: string): boolean {
  return sk.startsWith("TICKET#") && !sk.slice("TICKET#".length).includes("#");
}

// ---------------------------------------------------------------------------
// User  —  pk=USER#{email}  sk=PROFILE
// ---------------------------------------------------------------------------

export class UserConnector extends BaseConnector {
  get(email: string) { return this._get(`USER#${email}`, "PROFILE"); }
  getForAdmin(email: string): Promise<Result<Record<string, unknown> | null>> {
    return this._get(`USER#${email}`, "PROFILE").then((r) => {
      if (r.isErr() || r.value === null) return r;
      const stripped = Object.fromEntries(
        Object.entries(r.value).filter(([k]) => !ADMIN_STRIPPED.has(k))
      );
      return new Ok(stripped);
    });
  }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, updates: Record<string, unknown>) {
    return this._updateFields(`USER#${email}`, "PROFILE", updates);
  }
  listAll() {
    return this._query({ IndexName: "gsi1", KeyConditionExpression: "gsi1_pk = :v", ExpressionAttributeValues: { ":v": "USER" } });
  }
}

// ---------------------------------------------------------------------------
// Admin  —  pk=ADMIN#{email}  sk=PROFILE
// ---------------------------------------------------------------------------

export class AdminConnector extends BaseConnector {
  get(email: string) { return this._get(`ADMIN#${email}`, "PROFILE"); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, updates: Record<string, unknown>) {
    return this._updateFields(`ADMIN#${email}`, "PROFILE", updates);
  }
  listAll() {
    return this._query({ IndexName: "gsi1", KeyConditionExpression: "gsi1_pk = :v", ExpressionAttributeValues: { ":v": "ADMIN" } });
  }
}

// ---------------------------------------------------------------------------
// Ticket  —  pk=USER#{email}  sk=TICKET#{id}
// ---------------------------------------------------------------------------

export class TicketConnector extends BaseConnector {
  get(email: string, ticketId: string) { return this._get(`USER#${email}`, `TICKET#${ticketId}`); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, ticketId: string, updates: Record<string, unknown>) {
    return this._updateFields(`USER#${email}`, `TICKET#${ticketId}`, updates);
  }
  async listForUser(email: string): Promise<Result<Record<string, unknown>[]>> {
    const r = await this._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `USER#${email}`, ":prefix": "TICKET#" },
    });
    if (r.isErr()) return r;
    return new Ok(r.value.filter((i) => isPlainTicketSk(i["sk"] as string)));
  }
  getByTrain(trainNr: string, date: string) {
    return this._query({ IndexName: "gsi1", KeyConditionExpression: "gsi1_pk = :v", ExpressionAttributeValues: { ":v": `TRAIN#${trainNr}#${date}` } });
  }
  async checkBarcodeDuplicate(barcodeUid: string): Promise<Result<Record<string, unknown> | null>> {
    const r = await this._query({
      IndexName: "gsi2",
      KeyConditionExpression: "gsi2_pk = :pk AND gsi2_sk = :sk",
      ExpressionAttributeValues: { ":pk": "BARCODE", ":sk": barcodeUid },
      Limit: 1,
    });
    if (r.isErr()) return r;
    return new Ok(r.value[0] ?? null);
  }
  listEmailPending(limit: number) {
    return this._query({
      IndexName: "gsi_email_pending",
      KeyConditionExpression: "gsi_email_pending_pk = :v",
      ExpressionAttributeValues: { ":v": "EMAIL_PENDING" },
      ScanIndexForward: true,
      Limit: limit,
    });
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
  get(email: string, ticketId: string) { return this._get(`USER#${email}`, `RAW#${ticketId}`); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, ticketId: string, updates: Record<string, unknown>) {
    return this._updateFields(`USER#${email}`, `RAW#${ticketId}`, updates);
  }
}

// ---------------------------------------------------------------------------
// RenderedPdf  —  pk=USER#{email}  sk=RENDERED#{id}
// ---------------------------------------------------------------------------

export class RenderedPdfConnector extends BaseConnector {
  get(email: string, ticketId: string) { return this._get(`USER#${email}`, `RENDERED#${ticketId}`); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, ticketId: string, updates: Record<string, unknown>) {
    return this._updateFields(`USER#${email}`, `RENDERED#${ticketId}`, updates);
  }
}

// ---------------------------------------------------------------------------
// OriginalReceipt  —  pk=USER#{email}  sk=TICKET#{id}#BELEG#{id}
// ---------------------------------------------------------------------------

export class OriginalReceiptConnector extends BaseConnector {
  get(email: string, ticketId: string, belegId: string) {
    return this._get(`USER#${email}`, `TICKET#${ticketId}#BELEG#${belegId}`);
  }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, ticketId: string, belegId: string, updates: Record<string, unknown>) {
    return this._updateFields(`USER#${email}`, `TICKET#${ticketId}#BELEG#${belegId}`, updates);
  }
  listForTicket(email: string, ticketId: string) {
    return this._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `USER#${email}`, ":prefix": `TICKET#${ticketId}#BELEG#` },
    });
  }
}

// ---------------------------------------------------------------------------
// SepaMandate  —  pk=USER#{email}  sk=TICKET#{id}#MANDATE
// ---------------------------------------------------------------------------

export class SepaMandateConnector extends BaseConnector {
  get(email: string, ticketId: string) {
    return this._get(`USER#${email}`, `TICKET#${ticketId}#MANDATE`);
  }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, ticketId: string, updates: Record<string, unknown>) {
    return this._updateFields(`USER#${email}`, `TICKET#${ticketId}#MANDATE`, updates);
  }
  stampPain008Built(email: string, ticketId: string, batchId: string, s3Key: string, builtAt: string) {
    return this._updateConditional(
      `USER#${email}`, `TICKET#${ticketId}#MANDATE`,
      { pain008_built_at: builtAt, pain008_batch_id: batchId, pain008_s3_key: s3Key },
      "attribute_not_exists(pain008_built_at)",
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
  listByDate(date: string) {
    return this._query({ KeyConditionExpression: "pk = :v", ExpressionAttributeValues: { ":v": `SEPA#REPORT#${date}` } });
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
  listForTrain(trainNr: string, date: string) {
    return this._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `TRAIN#${trainNr}#${date}`, ":prefix": "SEG#" },
    });
  }
  routeLookup(originEva: number, date: string, fromTime: string, toTime: string) {
    return this._query({
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1_pk = :pk AND gsi1_sk BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": `STATION#${originEva}#${date}`, ":from": fromTime, ":to": toTime + "~" },
    });
  }
}

// ---------------------------------------------------------------------------
// RouteTemplate  —  pk=USER#{email}  sk=TEMPLATE#{id}
// ---------------------------------------------------------------------------

export class RouteTemplateConnector extends BaseConnector {
  get(email: string, templateId: string) { return this._get(`USER#${email}`, `TEMPLATE#${templateId}`); }
  put(item: Record<string, unknown>) { return this._put(item); }
  update(email: string, templateId: string, updates: Record<string, unknown>) {
    return this._updateFields(`USER#${email}`, `TEMPLATE#${templateId}`, updates);
  }
  listForUser(email: string) {
    return this._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `USER#${email}`, ":prefix": "TEMPLATE#" },
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

  constructor(client?: DynamoDBDocumentClient) {
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
  }

  async deleteUser(email: string): Promise<Result<null>> {
    const r = await this.user._query({ KeyConditionExpression: "pk = :v", ExpressionAttributeValues: { ":v": `USER#${email}` } });
    if (r.isErr()) return r;
    const keys: { pk: string; sk: string }[] = r.value.map((i) => ({ pk: i["pk"] as string, sk: i["sk"] as string }));
    r.value.forEach((i) => {
      const sk = i["sk"] as string;
      if (sk.startsWith("TICKET#") && sk.split("#").length === 2) {
        keys.push({ pk: `TICKET#${sk.slice("TICKET#".length)}`, sk: "OWNER" });
      }
    });
    return this.user._batchDelete(keys);
  }

  async deleteTicket(email: string, ticketId: string): Promise<Result<null>> {
    const r = await this.ticket._query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `USER#${email}`, ":prefix": `TICKET#${ticketId}#` },
    });
    if (r.isErr()) return r;
    const keys: { pk: string; sk: string }[] = r.value.map((i) => ({ pk: i["pk"] as string, sk: i["sk"] as string }));
    keys.push(
      { pk: `USER#${email}`, sk: `TICKET#${ticketId}` },
      { pk: `TICKET#${ticketId}`, sk: "OWNER" },
      { pk: `USER#${email}`, sk: `RAW#${ticketId}` },
      { pk: `USER#${email}`, sk: `RENDERED#${ticketId}` },
    );
    return this.ticket._batchDelete(keys);
  }

  deleteAdmin(email: string) { return this.admin._delete(`ADMIN#${email}`, "PROFILE"); }
  deleteTicketOwner(ticketId: string) { return this.ticketOwner._delete(`TICKET#${ticketId}`, "OWNER"); }
  deleteRawUpload(email: string, ticketId: string) { return this.rawUpload._delete(`USER#${email}`, `RAW#${ticketId}`); }
  deleteRenderedPdf(email: string, ticketId: string) { return this.renderedPdf._delete(`USER#${email}`, `RENDERED#${ticketId}`); }
  deleteReceipt(email: string, ticketId: string, belegId: string) { return this.receipt._delete(`USER#${email}`, `TICKET#${ticketId}#BELEG#${belegId}`); }
  deleteMandate(email: string, ticketId: string) { return this.mandate._delete(`USER#${email}`, `TICKET#${ticketId}#MANDATE`); }
  deleteSepaReport(date: string, reportId: string) { return this.sepaReport._delete(`SEPA#REPORT#${date}`, `REPORT#${reportId}`); }
  deleteTrainDelay(trainNr: string, date: string, segId: string) { return this.trainDelay._delete(`TRAIN#${trainNr}#${date}`, `SEG#${segId}`); }
  deleteRouteTemplate(email: string, templateId: string) { return this.routeTemplate._delete(`USER#${email}`, `TEMPLATE#${templateId}`); }
}

export { ConflictError };
