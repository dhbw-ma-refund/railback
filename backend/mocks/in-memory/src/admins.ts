import { keys } from "@railback/lib";
import type { Admin, AdminAuthLookup, AdminRepo } from "@railback/lib";
import type { AdminProfileItem } from "@railback/lib";

import { getRow, type MemState, putRow } from "./state.js";

function fromItem(it: AdminProfileItem): Admin {
  return { email: it.email, created_at: it.created_at };
}

export class InMemoryAdminRepo implements AdminRepo {
  constructor(private readonly state: MemState) {}

  async getByEmail(email: string): Promise<Admin | null> {
    const it = getRow<AdminProfileItem>(this.state, keys.adminPk(email), keys.ADMIN_PROFILE_SK);
    return it ? fromItem(it) : null;
  }

  async getByEmailForAuth(email: string): Promise<AdminAuthLookup | null> {
    const it = getRow<AdminProfileItem>(this.state, keys.adminPk(email), keys.ADMIN_PROFILE_SK);
    if (!it) return null;
    return {
      kind: "admin",
      email: it.email,
      hashed_password: it.hashed_password,
    };
  }
}

// Test helper — admins are provisioned out-of-band in production, so the
// repo interface has no create method.
export function seedAdmin(state: MemState, email: string, hashedPassword: string): void {
  const norm = keys.normaliseEmail(email);
  const item: AdminProfileItem = {
    PK: keys.adminPk(norm),
    SK: keys.ADMIN_PROFILE_SK,
    GSI1_PK: "ADMIN",
    GSI1_SK: `EMAIL#${norm}`,
    email: norm,
    hashed_password: hashedPassword,
    created_at: new Date().toISOString(),
  };
  putRow(state, item.PK, item.SK, item);
}
