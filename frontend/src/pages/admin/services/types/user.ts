/**
 * User type mirrored from BACKEND_CONTRACT.md §User management.
 *
 * Money fields are strings (decimals never round-tripped through JS number).
 * `iban` and `bic` are deliberately absent from the type so they can never
 * leak into the DOM by accident.
 */
export type UserState = 'ACTIVE' | 'SUSPENDED' | 'DELETION_SCHEDULED';

export interface UserAddress {
  strasse: string;
  hausnr: string;
  plz: string;
  ort: string;
  land: string;
}

export interface RecentTicket {
  ticketId: string;
  ticket_state: string;
  abreisedatum: string;
  erwartete_erstattung: string;
}

export interface User {
  email: string;
  vorname: string;
  nachname: string;
  telefon: string | null;
  adresse: UserAddress | null;
  user_state: UserState;
  suspended_at: string | null;
  suspended_reason: string | null;
  created_at: string;
  ticket_count: number;
  total_refunded: string;
  recent_tickets?: RecentTicket[];
}

export interface UsersPage {
  items: User[];
  nextCursor?: string;
}
