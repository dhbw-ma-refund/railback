import { keys } from "@railback/lib";
import type { TicketOwner, TicketOwnerRepo } from "@railback/lib";
import type { TicketOwnerItem } from "@railback/lib";

import { deleteRow, getRow, type MemState, putRow } from "./state.js";

function fromItem(it: TicketOwnerItem): TicketOwner {
  const o: TicketOwner = {
    ticketId: it.ticketId,
    email: it.email,
    created_at: it.created_at,
  };
  if (it.ttl !== undefined) o.ttl = it.ttl;
  return o;
}

export class InMemoryTicketOwnerRepo implements TicketOwnerRepo {
  constructor(private readonly state: MemState) {}

  async get(ticketId: string): Promise<TicketOwner | null> {
    const it = getRow<TicketOwnerItem>(this.state, keys.ticketOwnerPk(ticketId), keys.TICKET_OWNER_SK);
    return it ? fromItem(it) : null;
  }

  async put(ticketId: string, email: string, ttl?: number): Promise<void> {
    const item: TicketOwnerItem = {
      PK: keys.ticketOwnerPk(ticketId),
      SK: keys.TICKET_OWNER_SK,
      email: keys.normaliseEmail(email),
      ticketId,
      created_at: new Date().toISOString(),
    };
    if (ttl !== undefined) item.ttl = ttl;
    putRow(this.state, item.PK, item.SK, item);
  }

  async delete(ticketId: string): Promise<void> {
    deleteRow(this.state, keys.ticketOwnerPk(ticketId), keys.TICKET_OWNER_SK);
  }
}
