import { createSignal } from 'solid-js';
import type { Ticket, User } from '../types';
import { seedTickets, seedUsers } from '../data/seed';

// In-memory store using Solid signals. Stand-in for a real API client.

const initialUsers = seedUsers();
const initialTickets = seedTickets(initialUsers);

const [users, setUsers] = createSignal<User[]>(initialUsers);
const [tickets, setTickets] = createSignal<Ticket[]>(initialTickets);

export const usersStore = {
  list: users,
  get: (id: string) => users().find(u => u.id === id),
  update: (id: string, patch: Partial<User>) => {
    setUsers(prev => prev.map(u => (u.id === id ? { ...u, ...patch } : u)));
  },
};

export const ticketsStore = {
  list: tickets,
  get: (id: string) => tickets().find(t => t.id === id),
  update: (id: string, patch: Partial<Ticket>) => {
    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
  },
  /**
   * Returns true if a refund was triggered.
   * Refund is triggered when status transitions to 'cancelled' or 'refunded'
   * from a paid state (booked / pending / used).
   */
  applyEditWithRefundLogic: (
    id: string,
    patch: Partial<Ticket>
  ): { refunded: boolean } => {
    const current = tickets().find(t => t.id === id);
    if (!current) return { refunded: false };
    const triggersRefund =
      patch.status !== undefined &&
      patch.status !== current.status &&
      (patch.status === 'cancelled' || patch.status === 'refunded') &&
      ['booked', 'pending', 'used'].includes(current.status);

    const finalPatch: Partial<Ticket> = { ...patch };
    if (triggersRefund) {
      // Refund processed -> mark as refunded regardless of which terminal status
      // the admin chose; update the user's totalRefunds aggregate.
      finalPatch.status = 'refunded';
    }

    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...finalPatch } : t)));

    if (triggersRefund) {
      const passengerId = current.passengerId;
      const refundAmount = current.price;
      setUsers(prev =>
        prev.map(u =>
          u.id === passengerId
            ? { ...u, totalRefunds: u.totalRefunds + refundAmount }
            : u
        )
      );
    }
    return { refunded: triggersRefund };
  },
};
