// In-memory TicketRepo. State-timeline appended on every state transition,
// barcode_uid duplicate-check via GSI2 emulation (linear scan — fine for tests).

import { AppError } from "@railback/lib";
import { keys } from "@railback/lib";
import type {
  AdminTicketQuery,
  NewRouteTicket,
  NewTicket,
  Page,
  Ticket,
  TicketPatch,
  TicketRepo,
} from "@railback/lib";
import type { StateTimelineEntry, TicketOwnerItem, UserTicketItem } from "@railback/lib";

import { deleteRow, getRow, listSk, type MemState, paginate, putRow } from "./state.js";

function appendTimeline(prev: StateTimelineEntry[] | undefined, state: Ticket["ticket_state"], at: string): StateTimelineEntry[] {
  return [...(prev ?? []), { state, at }];
}

function toItem(email: string, t: Ticket): UserTicketItem {
  const norm = keys.normaliseEmail(email);
  const item: UserTicketItem = {
    PK: keys.userPk(norm),
    SK: keys.ticketSk(t.ticketId),
    ticketId: t.ticketId,
    ticket_state: t.ticket_state,
    state_timeline: t.state_timeline,
    extraction_status: t.extraction_status,
    extraction_method: t.extraction_method,
    extraction_confidence: t.extraction_confidence,
    updated_at: t.updated_at,
  };
  // GSI1 if zugnummer + datum known.
  if (t.fahrt_zugnummer_plan && t.fahrt_abreisedatum) {
    item.GSI1_PK = keys.trainGsi1Pk(t.fahrt_zugnummer_plan, t.fahrt_abreisedatum);
    item.GSI1_SK = keys.ticketGsi1Sk(t.ticketId);
  }
  if (t.barcode_uid) {
    item.GSI2_PK = keys.BARCODE_GSI2_PK;
    item.GSI2_SK = keys.barcodeGsi2Sk(t.barcode_uid);
    item.barcode_uid = t.barcode_uid;
  }
  if (
    (t.email_status === "SENDING" || t.email_status === "FAILED_TRANSIENT") &&
    t.ticket_state === "EMAIL_SENDING"
  ) {
    if ((t.email_attempts ?? 0) < 3 && t.email_last_attempt) {
      item.GSI_EMAIL_PENDING_PK = keys.EMAIL_PENDING_GSI_PK;
      item.GSI_EMAIL_PENDING_SK = keys.emailPendingGsiSk(t.email_last_attempt);
    }
  }
  // optional payload
  const opt: Array<keyof Ticket & keyof UserTicketItem> = [
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
    "ttl", "archive_ttl", "barcode_uid", "belege_count",
  ];
  for (const k of opt) {
    const v = t[k];
    if (v !== undefined) (item as unknown as Record<string, unknown>)[k] = v;
  }
  return item;
}

function fromItem(it: UserTicketItem): Ticket {
  const email = keys.parseUserPk(it.PK);
  if (!email) throw new AppError("ERR_INTERNAL", `bad PK ${it.PK}`);
  const t: Ticket = {
    email,
    ticketId: it.ticketId,
    ticket_state: it.ticket_state,
    state_timeline: it.state_timeline,
    extraction_status: it.extraction_status,
    extraction_method: it.extraction_method,
    extraction_confidence: it.extraction_confidence,
    updated_at: it.updated_at,
  };
  // copy any optional fields straight back across
  const optKeys = [
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
    "ttl", "archive_ttl", "barcode_uid", "belege_count",
  ] as const;
  for (const k of optKeys) {
    const v = (it as unknown as Record<string, unknown>)[k];
    if (v !== undefined) (t as unknown as Record<string, unknown>)[k] = v;
  }
  return t;
}

export class InMemoryTicketRepo implements TicketRepo {
  constructor(private readonly state: MemState) {}

  async get(email: string, id: string): Promise<Ticket | null> {
    const item = getRow<UserTicketItem>(this.state, keys.userPk(email), keys.ticketSk(id));
    return item ? fromItem(item) : null;
  }

  async listForUser(email: string): Promise<Ticket[]> {
    const items = listSk<UserTicketItem>(this.state, keys.userPk(email), "TICKET#");
    // Filter to plain-ticket SKs (reject MANDATE / BELEG sub-rows with extra #).
    const tickets: Ticket[] = [];
    for (const it of items) {
      const tid = keys.parseTicketSk(it.SK);
      if (!tid) continue;
      tickets.push(fromItem(it));
    }
    tickets.sort((a, b) => a.ticketId.localeCompare(b.ticketId));
    return tickets;
  }

  async enumerateAllTicketIdsForUser(email: string): Promise<string[]> {
    // Sweep every SK under the user PK, decode the ticketId from each
    // shape (TICKET#/RAW#/RENDERED#/BELEG#/MANDATE#), and return the
    // deduped set. Used by the anonymisation-sweeper to discover
    // stranded blob debris (e.g. from a ticket that was hard-deleted
    // without its sibling rows).
    const bucket = this.state.rows.get(keys.userPk(email));
    if (!bucket) return [];
    const out = new Set<string>();
    for (const sk of bucket.keys()) {
      if (sk.startsWith("TICKET#")) {
        // TICKET#<id>, TICKET#<id>#MANDATE, TICKET#<id>#BELEG#<belegId>
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

  async create(input: NewTicket): Promise<Ticket> {
    const now = input.uploadedAt;
    const t: Ticket = {
      email: keys.normaliseEmail(input.email),
      ticketId: input.ticketId,
      ticket_state: "VALIDATING",
      state_timeline: [{ state: "VALIDATING", at: now }],
      extraction_status: "PROCESSING",
      extraction_method: "BARCODE",
      extraction_confidence: 0,
      uploaded_at: now,
      updated_at: now,
    };
    const item = toItem(input.email, t);
    // Atomicity parity with DDB adapter: both the UserTicket row and the
    // TicketOwner mapping row are written in one shot. attribute_not_exists
    // equivalents: neither may already exist.
    const ownerPk = keys.ticketOwnerPk(input.ticketId);
    const ownerSk = keys.TICKET_OWNER_SK;
    if (getRow(this.state, item.PK, item.SK) !== null) {
      throw new AppError("ERR_CONFLICT", `Ticket ${input.ticketId} already exists`);
    }
    if (getRow(this.state, ownerPk, ownerSk) !== null) {
      throw new AppError("ERR_CONFLICT", `TicketOwner ${input.ticketId} already exists`);
    }
    const owner: TicketOwnerItem = {
      PK: ownerPk,
      SK: ownerSk,
      email: keys.normaliseEmail(input.email),
      ticketId: input.ticketId,
      created_at: now,
    };
    putRow(this.state, item.PK, item.SK, item);
    putRow(this.state, owner.PK, owner.SK, owner);
    return t;
  }

  async createFromRoute(input: NewRouteTicket): Promise<Ticket> {
    const now = new Date().toISOString();
    const t: Ticket = {
      email: keys.normaliseEmail(input.email),
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
    const item = toItem(input.email, t);
    // Same atomicity contract as create(): ticket + owner in one shot, both
    // must not already exist.
    const ownerPk = keys.ticketOwnerPk(input.ticketId);
    const ownerSk = keys.TICKET_OWNER_SK;
    if (getRow(this.state, item.PK, item.SK) !== null) {
      throw new AppError("ERR_CONFLICT", `Ticket ${input.ticketId} already exists`);
    }
    if (getRow(this.state, ownerPk, ownerSk) !== null) {
      throw new AppError("ERR_CONFLICT", `TicketOwner ${input.ticketId} already exists`);
    }
    const owner: TicketOwnerItem = {
      PK: ownerPk,
      SK: ownerSk,
      email: keys.normaliseEmail(input.email),
      ticketId: input.ticketId,
      created_at: now,
    };
    putRow(this.state, item.PK, item.SK, item);
    putRow(this.state, owner.PK, owner.SK, owner);
    return t;
  }

  async patch(email: string, id: string, patch: TicketPatch): Promise<Ticket> {
    const norm = keys.normaliseEmail(email);
    const item = getRow<UserTicketItem>(this.state, keys.userPk(norm), keys.ticketSk(id));
    if (!item) throw new AppError("ERR_NOT_FOUND", `Ticket ${id} not found`);
    const prev = fromItem(item);
    const now = new Date().toISOString();
    const stateChanged = patch.ticket_state !== undefined && patch.ticket_state !== prev.ticket_state;
    // `null` in a patch means "clear" — apply the patch and then delete any
    // keys whose value is null so the resulting Ticket matches its strict
    // (exactOptionalPropertyTypes) type. The clear is also visible to toItem,
    // which only writes !== undefined.
    // `patch.clear` (added 2026-06-25 for the render-fail rollback path)
    // is also field-deletion; we drop it from the merged payload before it
    // could land as a stray attribute.
    const { clear, ...patchRest } = patch;
    const mergedRaw = { ...prev, ...patchRest } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patchRest)) {
      if (v === null) delete mergedRaw[k];
    }
    if (clear) {
      for (const k of clear) delete mergedRaw[k];
    }
    const merged: Ticket = {
      ...(mergedRaw as unknown as Ticket),
      email: prev.email,
      ticketId: prev.ticketId,
      state_timeline: stateChanged
        ? appendTimeline(prev.state_timeline, patch.ticket_state ?? prev.ticket_state, now)
        : prev.state_timeline,
      updated_at: now,
    };
    const next = toItem(norm, merged);
    putRow(this.state, next.PK, next.SK, next);
    return merged;
  }

  async delete(email: string, id: string): Promise<void> {
    deleteRow(this.state, keys.userPk(email), keys.ticketSk(id));
  }

  async adminList(query: AdminTicketQuery): Promise<Page<Ticket>> {
    const all: Ticket[] = [];
    for (const [pk, bucket] of this.state.rows) {
      if (!pk.startsWith("USER#")) continue;
      for (const [sk, item] of bucket) {
        if (!sk.startsWith("TICKET#")) continue;
        const tid = keys.parseTicketSk(sk);
        if (!tid) continue;
        const it = item as UserTicketItem;
        if (query.email && it.PK !== keys.userPk(query.email)) continue;
        if (query.state && it.ticket_state !== query.state) continue;
        if (query.trainNr && query.date) {
          const wantPk = keys.trainGsi1Pk(query.trainNr, query.date);
          if (it.GSI1_PK !== wantPk) continue;
        } else if (query.trainNr && it.fahrt_zugnummer_plan !== query.trainNr) {
          continue;
        } else if (query.date && it.fahrt_abreisedatum !== query.date) {
          continue;
        }
        if (query.fromDate && it.fahrt_abreisedatum && it.fahrt_abreisedatum < query.fromDate) continue;
        if (query.toDate && it.fahrt_abreisedatum && it.fahrt_abreisedatum > query.toDate) continue;
        all.push(fromItem(it));
      }
    }
    all.sort((a, b) => a.ticketId.localeCompare(b.ticketId));
    const page = paginate(all, query.limit, (it) => it.ticketId, query.cursor);
    const out: Page<Ticket> = { items: page.items };
    if (page.nextCursor !== undefined) out.nextCursor = page.nextCursor;
    return out;
  }

  async findByBarcodeUid(uid: string): Promise<Ticket | null> {
    for (const [pk, bucket] of this.state.rows) {
      if (!pk.startsWith("USER#")) continue;
      for (const [sk, item] of bucket) {
        if (!sk.startsWith("TICKET#")) continue;
        if (!keys.parseTicketSk(sk)) continue;
        const it = item as UserTicketItem;
        if (it.barcode_uid === uid) return fromItem(it);
      }
    }
    return null;
  }

  async queryEmailPending(limit: number): Promise<Ticket[]> {
    // toItem only sets GSI_EMAIL_PENDING_PK when email_status ∈
    // (SENDING|FAILED_TRANSIENT) AND email_attempts<3 AND email_last_attempt
    // is set AND ticket_state="EMAIL_SENDING" — DB_SCHEMA.md:59. We can
    // trust the GSI marker alone here (no re-filter).
    const matches: Ticket[] = [];
    for (const [pk, bucket] of this.state.rows) {
      if (!pk.startsWith("USER#")) continue;
      for (const [sk, item] of bucket) {
        if (!sk.startsWith("TICKET#")) continue;
        if (!keys.parseTicketSk(sk)) continue;
        const it = item as UserTicketItem;
        if (it.GSI_EMAIL_PENDING_PK !== keys.EMAIL_PENDING_GSI_PK) continue;
        matches.push(fromItem(it));
      }
    }
    // Oldest email_last_attempt first; tie-break on ticketId for determinism.
    matches.sort((a, b) => {
      const al = a.email_last_attempt ?? "";
      const bl = b.email_last_attempt ?? "";
      if (al !== bl) return al.localeCompare(bl);
      return a.ticketId.localeCompare(b.ticketId);
    });
    return matches.slice(0, Math.max(0, limit));
  }

  async scanEmailWatchdog(cutoffIso: string): Promise<Ticket[]> {
    const matches: Ticket[] = [];
    for (const [pk, bucket] of this.state.rows) {
      if (!pk.startsWith("USER#")) continue;
      for (const [sk, item] of bucket) {
        if (!sk.startsWith("TICKET#")) continue;
        if (!keys.parseTicketSk(sk)) continue;
        const it = item as UserTicketItem;
        if (it.ticket_state !== "EMAIL_SENDING") continue;
        if (it.email_status !== "SENT") continue;
        if (!it.email_last_attempt) continue;
        if (it.email_last_attempt >= cutoffIso) continue;
        matches.push(fromItem(it));
      }
    }
    matches.sort((a, b) => a.ticketId.localeCompare(b.ticketId));
    return matches;
  }

  async anonymiseUserTickets(
    email: string,
    anonPk: string,
    nowIso: string,
  ): Promise<{ ticketIds: string[] }> {
    // PII strip-list per DB_SCHEMA.md §"Cascade on user delete" item 3.
    // We delete the keys outright (rather than setting null) so the
    // anonymised row carries only the columns we explicitly preserve.
    //
    // Deliberate hold-backs (NOT in PII_FIELDS):
    //   - `admin_note`: CLAUDE.md cascade-spec lists this in the keep-set;
    //     it's free-text admin context against the buchungsrelevante record
    //     and is retained on purpose. May reference user details — admins
    //     are coached to keep it operational.
    //   - `email_provider_id`: SES Message-ID. Could correlate the
    //     anonymised row back to SES CloudWatch logs (which carry the
    //     recipient address) for the SES log-retention window. We retain
    //     it because the bounce/complaint debugging value outweighs the
    //     thin correlation surface; SES logs themselves age out within the
    //     SES log-retention TTL well before HGB-retention completes.
    //   - `email_failed_reason`: short enum-shaped reason string; no PII.
    const PII_FIELDS = [
      "vorname_aus_ticket",
      "nachname_aus_ticket",
      "fahrt_fahrkartennummer",
      "antragstellung_ort",
      "antragstellung_datum",
      "zusaetzliche_angaben",
    ] as const;

    // Email-pipeline state fields cleared on anonymisation: the user
    // profile is gone, so any pending send/retry is dead. Leaving these
    // populated would let the email-sweeper / watchdog re-pick the row
    // up on its next tick (cross-Lambda bug — anonymised row with
    // GSI_EMAIL_PENDING_PK still indexed would be re-sent on a
    // now-deleted user).
    const EMAIL_PIPELINE_FIELDS = [
      "GSI_EMAIL_PENDING_PK",
      "GSI_EMAIL_PENDING_SK",
      "email_status",
      "email_attempts",
      "email_last_attempt",
    ] as const;

    const norm = keys.normaliseEmail(email);
    const livePk = keys.userPk(norm);
    const bucket = this.state.rows.get(livePk);
    if (!bucket) return { ticketIds: [] };

    // Snapshot first — we mutate the bucket as we go (deleteRow + putRow at
    // a new PK), and iterating the live Map while removing entries is
    // undefined-behaviour-adjacent.
    const targets: Array<{ sk: string; item: UserTicketItem }> = [];
    for (const [sk, item] of bucket) {
      if (!sk.startsWith("TICKET#")) continue;
      const tid = keys.parseTicketSk(sk);
      if (!tid) continue; // rejects MANDATE/BELEG sub-rows
      targets.push({ sk, item: item as UserTicketItem });
    }

    const ticketIds: string[] = [];
    for (const { sk, item } of targets) {
      const next = { ...(item as unknown as Record<string, unknown>) };
      next.PK = anonPk;
      next.updated_at = nowIso;
      for (const k of PII_FIELDS) delete next[k];
      for (const k of EMAIL_PIPELINE_FIELDS) delete next[k];
      deleteRow(this.state, livePk, sk);
      putRow(this.state, anonPk, sk, next);
      ticketIds.push(item.ticketId);
    }
    return { ticketIds };
  }
}
