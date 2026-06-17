// Domain types for the BahnTicketApp admin panel.
// The deck doesn't fully specify entity shapes — these are reasonable inferences
// for a German railway ticket app. Adjust freely when the real backend is wired.

export type UserStatus = 'active' | 'blocked';

export interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  phone: string;
  status: UserStatus;
  totalRefunds: number; // EUR
  createdAt: string; // ISO
}

export type TicketStatus =
  | 'booked'
  | 'pending'
  | 'cancelled'
  | 'refunded'
  | 'used';

export type TicketClass = 'first' | 'second';

export interface Ticket {
  id: string;
  source: string;
  destination: string;
  departure: string; // ISO
  price: number; // EUR
  class: TicketClass;
  status: TicketStatus;
  passengerId: string; // -> User.id
  trainNumber: string;
  createdAt: string; // ISO
}

export const TICKET_STATUS_VALUES: TicketStatus[] = [
  'booked',
  'pending',
  'cancelled',
  'refunded',
  'used',
];

export const USER_STATUS_VALUES: UserStatus[] = ['active', 'blocked'];

export const TICKET_CLASS_VALUES: TicketClass[] = ['first', 'second'];

// A single change captured for the confirmation dialog.
export interface FieldChange {
  field: string; // human label
  oldValue: string;
  newValue: string;
}
