/**
 * User type mirrored from BACKEND_CONTRACT.md §User management.
 *
 * Money fields are strings (decimals never round-tripped through JS number).
 *
 * IBAN/BIC visibility to admin was reversed on 2026-07-07: both list and
 * detail projections now return plaintext `iban` / `bic` (decrypted from
 * the encrypted-at-rest columns). Frontend surfaces them read-only — they
 * are still NOT accepted on PATCH.
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
  iban: string | null;
  bic: string | null;
}

export interface UsersPage {
  items: User[];
  nextCursor?: string;
}

/**
 * PATCH /admin/users/{email} payload. Every field is optional but the
 * backend rejects an empty patch with 400 ERR_VALIDATION.
 *
 * `iban` / `bic` are NOT accepted by the endpoint — the type omits them so
 * they can never leak into a request accidentally.
 *
 * `suspended_reason` is required by the backend on `ACTIVE → SUSPENDED`;
 * the dialog enforces it client-side too so admins get a clear error inline
 * instead of round-tripping to a 400.
 */
export interface UserAddressPatch {
  strasse: string;
  hausnr: string;
  plz: string;
  ort: string;
  land: string;
}

export interface UserPatchPayload {
  vorname?: string;
  nachname?: string;
  telefon?: string | null;
  adresse?: UserAddressPatch;
  user_state?: UserState;
  suspended_reason?: string | null;
}
