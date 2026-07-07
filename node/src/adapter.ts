import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { RailBackConnector, ConflictError } from "./connector.js";
import type {
  User, UserAdminView, Admin, Ticket, SepaMandate,
  UserRepo, AdminRepo, TicketRepo, MandateRepo, Db,
} from "./types.js";

const PHYSICAL_KEYS = new Set([
  "pk", "sk",
  "gsi1_pk", "gsi1_sk",
  "gsi2_pk", "gsi2_sk",
  "gsi_email_pending_pk", "gsi_email_pending_sk",
]);

function domainAttrs(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !PHYSICAL_KEYS.has(k)));
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function camelAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attrs).map(([k, v]) => [snakeToCamel(k), v]));
}

function mapUser(raw: Record<string, unknown>): User {
  const email = (raw["pk"] as string).slice("USER#".length);
  return { email, ...camelAttrs(domainAttrs(raw)) } as User;
}

function mapUserAdminView(raw: Record<string, unknown>): UserAdminView {
  // UserConnector.getForAdmin already strips iban_enc and bic_enc before this runs
  return mapUser(raw) as UserAdminView;
}

function mapAdmin(raw: Record<string, unknown>): Admin {
  const email = (raw["pk"] as string).slice("ADMIN#".length);
  return { email, ...camelAttrs(domainAttrs(raw)) } as Admin;
}

function mapTicket(raw: Record<string, unknown>): Ticket {
  const userEmail = (raw["pk"] as string).slice("USER#".length);
  const ticketId = (raw["sk"] as string).slice("TICKET#".length);
  const barcodeUid = raw["gsi2_sk"] as string | undefined;
  const attrs = camelAttrs(domainAttrs(raw));
  if (barcodeUid !== undefined) attrs["barcodeUid"] = barcodeUid;
  return { ticketId, userEmail, ...attrs } as Ticket;
}

function mapMandate(raw: Record<string, unknown>): SepaMandate {
  const userEmail = (raw["pk"] as string).slice("USER#".length);
  const ticketId = (raw["sk"] as string).slice("TICKET#".length).replace(/#MANDATE$/, "");
  return { userEmail, ticketId, ...camelAttrs(domainAttrs(raw)) } as SepaMandate;
}

class UserRepoImpl implements UserRepo {
  constructor(private readonly c: RailBackConnector) {}

  async getByEmail(email: string): Promise<User | null> {
    const raw = (await this.c.user.get(email)).unwrap();
    return raw === null ? null : mapUser(raw);
  }

  async getByEmailAdminView(email: string): Promise<UserAdminView | null> {
    const raw = (await this.c.user.getForAdmin(email)).unwrap();
    return raw === null ? null : mapUserAdminView(raw);
  }

  async put(item: Record<string, unknown>): Promise<void> {
    (await this.c.user.put(item)).unwrap();
  }

  async update(email: string, updates: Record<string, unknown>): Promise<void> {
    (await this.c.user.update(email, updates)).unwrap();
  }

  async listAll(limit?: number): Promise<User[]> {
    return (await this.c.user.listAll(limit)).unwrap().map(mapUser);
  }
}

class AdminRepoImpl implements AdminRepo {
  constructor(private readonly c: RailBackConnector) {}

  async getByEmail(email: string): Promise<Admin | null> {
    const raw = (await this.c.admin.get(email)).unwrap();
    return raw === null ? null : mapAdmin(raw);
  }

  async put(item: Record<string, unknown>): Promise<void> {
    (await this.c.admin.put(item)).unwrap();
  }

  async update(email: string, updates: Record<string, unknown>): Promise<void> {
    (await this.c.admin.update(email, updates)).unwrap();
  }

  async listAll(limit?: number): Promise<Admin[]> {
    return (await this.c.admin.listAll(limit)).unwrap().map(mapAdmin);
  }
}

class TicketRepoImpl implements TicketRepo {
  constructor(private readonly c: RailBackConnector) {}

  async get(email: string, ticketId: string): Promise<Ticket | null> {
    const raw = (await this.c.ticket.get(email, ticketId)).unwrap();
    return raw === null ? null : mapTicket(raw);
  }

  async put(item: Record<string, unknown>): Promise<void> {
    (await this.c.ticket.put(item)).unwrap();
  }

  async update(email: string, ticketId: string, updates: Record<string, unknown>): Promise<void> {
    (await this.c.ticket.update(email, ticketId, updates)).unwrap();
  }

  async listForUser(email: string, limit?: number): Promise<Ticket[]> {
    return (await this.c.ticket.listForUser(email, limit)).unwrap().map(mapTicket);
  }

  async getByTrain(trainNr: string, date: string, limit?: number): Promise<Ticket[]> {
    return (await this.c.ticket.getByTrain(trainNr, date, limit)).unwrap().map(mapTicket);
  }

  async findByBarcodeUid(barcodeUid: string): Promise<Ticket | null> {
    const raw = (await this.c.ticket.checkBarcodeDuplicate(barcodeUid)).unwrap();
    return raw === null ? null : mapTicket(raw);
  }

  async queryEmailPending(limit: number): Promise<Ticket[]> {
    return (await this.c.ticket.listEmailPending(limit)).unwrap().map(mapTicket);
  }
}

class MandateRepoImpl implements MandateRepo {
  constructor(private readonly c: RailBackConnector) {}

  async get(email: string, ticketId: string): Promise<SepaMandate | null> {
    const raw = (await this.c.mandate.get(email, ticketId)).unwrap();
    return raw === null ? null : mapMandate(raw);
  }

  async put(item: Record<string, unknown>): Promise<void> {
    (await this.c.mandate.put(item)).unwrap();
  }

  async update(email: string, ticketId: string, updates: Record<string, unknown>): Promise<void> {
    (await this.c.mandate.update(email, ticketId, updates)).unwrap();
  }

  async stampPain008Built(
    email: string,
    ticketId: string,
    info: { batchId: string; s3Key: string; builtAt: string },
  ): Promise<void> {
    (await this.c.mandate.stampPain008Built(
      email, ticketId, info.batchId, info.s3Key, info.builtAt,
    )).unwrap();
  }
}

export class DdbBackend implements Db {
  readonly users: UserRepo;
  readonly admins: AdminRepo;
  readonly tickets: TicketRepo;
  readonly mandates: MandateRepo;

  private readonly connector: RailBackConnector;

  constructor(client?: DynamoDBDocumentClient) {
    this.connector = new RailBackConnector(client);
    this.users = new UserRepoImpl(this.connector);
    this.admins = new AdminRepoImpl(this.connector);
    this.tickets = new TicketRepoImpl(this.connector);
    this.mandates = new MandateRepoImpl(this.connector);
  }

  async deleteUser(email: string): Promise<void> {
    (await this.connector.deleteUser(email)).unwrap();
  }

  async deleteTicket(email: string, ticketId: string): Promise<void> {
    (await this.connector.deleteTicket(email, ticketId)).unwrap();
  }
}

export type { Db, UserRepo, AdminRepo, TicketRepo, MandateRepo } from "./types.js";
export type { User, UserAdminView, UserAuthLookup, Admin, Ticket, SepaMandate } from "./types.js";
export { ConflictError };
