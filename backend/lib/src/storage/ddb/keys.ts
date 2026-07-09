// Pure key derivation — single source of truth for every PK/SK and GSI value.
// No SDK imports, no I/O. Handlers and repos MUST go through these helpers
// instead of concatenating strings inline.

/** Lowercase + trim — every email-derived key normalises through this. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** UserProfile / UserTicket / RawUpload / Rendered / Beleg / Mandate / RouteTemplate PK. */
export function userPk(email: string): string {
  return `USER#${normaliseEmail(email)}`;
}

export const USER_PROFILE_SK = "PROFILE" as const;

/** AdminProfile PK. */
export function adminPk(email: string): string {
  return `ADMIN#${normaliseEmail(email)}`;
}

export const ADMIN_PROFILE_SK = "PROFILE" as const;

/** UserTicket SK. */
export function ticketSk(ticketId: string): string {
  return `TICKET#${ticketId}`;
}

/** UserTicket GSI1_PK — train+date pivot for admin lookup. */
export function trainGsi1Pk(trainNr: string, date: string): string {
  return `TRAIN#${trainNr}#${date}`;
}

/** UserTicket GSI1_SK — same shape as the SK so writes mirror naturally. */
export function ticketGsi1Sk(ticketId: string): string {
  return `TICKET#${ticketId}`;
}

export const BARCODE_GSI2_PK = "BARCODE" as const;

/** GSI2 SK = barcode UID itself; GetItem on (BARCODE, uid) yields the duplicate. */
export function barcodeGsi2Sk(uid: string): string {
  return uid;
}

export const EMAIL_PENDING_GSI_PK = "EMAIL_PENDING" as const;

/** Sparse-GSI SK — ISO timestamp so retries pop oldest-first via Query+ScanForward. */
export function emailPendingGsiSk(lastAttemptIso: string): string {
  return lastAttemptIso;
}

/** RawUpload SK. */
export function rawSk(ticketId: string): string {
  return `RAW#${ticketId}`;
}

/** RenderedPdf SK. */
export function renderedSk(ticketId: string): string {
  return `RENDERED#${ticketId}`;
}

/** OriginalReceipt SK — multiple belege per ticket via belegId suffix. */
export function belegSk(ticketId: string, belegId: string): string {
  return `TICKET#${ticketId}#BELEG#${belegId}`;
}

/** SepaMandate SK. */
export function mandateSk(ticketId: string): string {
  return `TICKET#${ticketId}#MANDATE`;
}

/** SepaReport PK — one report-batch per ingest day. */
export function sepaReportPk(date: string): string {
  return `SEPA#REPORT#${date}`;
}

/** SepaReport SK. */
export function sepaReportSk(reportId: string): string {
  return `REPORT#${reportId}`;
}

/** RouteTemplate SK. */
export function templateSk(templateId: string): string {
  return `TEMPLATE#${templateId}`;
}

/** TrainSegmentDelay PK. */
export function segPk(trainNr: string, date: string): string {
  return `TRAIN#${trainNr}#${date}`;
}

/** TrainSegmentDelay SK. */
export function segSk(segId: string): string {
  return `SEG#${segId}`;
}

/** TrainSegmentDelay GSI3_PK — origin-station pivot for route-lookup. */
export function stationGsi3Pk(originEva: number, date: string): string {
  return `STATION#${originEva}#${date}`;
}

/** TrainSegmentDelay GSI3_SK — sortable by departure time, train as tiebreaker. */
export function stationGsi3Sk(plannedDeparture: string, trainNr: string): string {
  return `${plannedDeparture}#${trainNr}`;
}

/** TicketOwner PK. */
export function ticketOwnerPk(ticketId: string): string {
  return `TICKET#${ticketId}`;
}

export const TICKET_OWNER_SK = "OWNER" as const;

/** Reverse `userPk`. Returns null on shape mismatch. */
export function parseUserPk(pk: string): string | null {
  if (!pk.startsWith("USER#")) return null;
  const rest = pk.slice("USER#".length);
  return rest.length === 0 ? null : rest;
}

/** Reverse `ticketSk`. Rejects RAW#/RENDERED#/MANDATE/BELEG variants. */
export function parseTicketSk(sk: string): string | null {
  if (!sk.startsWith("TICKET#")) return null;
  const rest = sk.slice("TICKET#".length);
  // Mandate / Beleg SKs share the TICKET# prefix — reject them here.
  if (rest.includes("#")) return null;
  return rest.length === 0 ? null : rest;
}

/** Reverse `templateSk`. */
export function parseTemplateSk(sk: string): string | null {
  if (!sk.startsWith("TEMPLATE#")) return null;
  const rest = sk.slice("TEMPLATE#".length);
  return rest.length === 0 ? null : rest;
}
