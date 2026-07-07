// DTO types for the RailBack domain. Physical DynamoDB attribute names
// (pk, sk, gsi*) never appear here.

export interface User {
  email: string;
  userState?: string;
  ibanEnc?: string;
  bicEnc?: string;
  [key: string]: unknown;
}

export interface UserAuthLookup {
  email: string;
  hashedPassword: string;
  userState: string;
}

export interface UserAdminView {
  email: string;
  userState?: string;
  // ibanEnc and bicEnc are stripped before this type is returned
  [key: string]: unknown;
}

export interface Admin {
  email: string;
  [key: string]: unknown;
}

export interface Ticket {
  ticketId: string;
  userEmail: string;
  ticketState?: string;
  emailStatus?: string;
  emailAttempts?: number;
  emailLastAttempt?: string;
  barcodeUid?: string;
  [key: string]: unknown;
}

export interface SepaMandate {
  userEmail: string;
  ticketId: string;
  mandateState?: string;
  pain008BuiltAt?: string;
  pain008BatchId?: string;
  pain008S3Key?: string;
  [key: string]: unknown;
}

export interface UserRepo {
  getByEmail(email: string): Promise<User | null>;
  getByEmailAdminView(email: string): Promise<UserAdminView | null>;
  put(item: Record<string, unknown>): Promise<void>;
  update(email: string, updates: Record<string, unknown>): Promise<void>;
  listAll(limit?: number): Promise<User[]>;
}

export interface AdminRepo {
  getByEmail(email: string): Promise<Admin | null>;
  put(item: Record<string, unknown>): Promise<void>;
  update(email: string, updates: Record<string, unknown>): Promise<void>;
  listAll(limit?: number): Promise<Admin[]>;
}

export interface TicketRepo {
  get(email: string, ticketId: string): Promise<Ticket | null>;
  put(item: Record<string, unknown>): Promise<void>;
  update(email: string, ticketId: string, updates: Record<string, unknown>): Promise<void>;
  listForUser(email: string, limit?: number): Promise<Ticket[]>;
  getByTrain(trainNr: string, date: string, limit?: number): Promise<Ticket[]>;
  findByBarcodeUid(barcodeUid: string): Promise<Ticket | null>;
  queryEmailPending(limit: number): Promise<Ticket[]>;
}

export interface MandateRepo {
  get(email: string, ticketId: string): Promise<SepaMandate | null>;
  put(item: Record<string, unknown>): Promise<void>;
  update(email: string, ticketId: string, updates: Record<string, unknown>): Promise<void>;
  stampPain008Built(
    email: string,
    ticketId: string,
    info: { batchId: string; s3Key: string; builtAt: string },
  ): Promise<void>;
}

export interface Db {
  users: UserRepo;
  admins: AdminRepo;
  tickets: TicketRepo;
  mandates: MandateRepo;
  deleteUser(email: string): Promise<void>;
  deleteTicket(email: string, ticketId: string): Promise<void>;
}
