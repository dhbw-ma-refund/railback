// In-memory UserRepo. Uses keys.userPk / USER_PROFILE_SK exclusively.

import { AppError } from "@railback/lib";
import { keys } from "@railback/lib";
import type {
  NewUser,
  Page,
  ProfilePatch,
  User,
  UserAuthLookup,
  UserListQuery,
  UserRepo,
} from "@railback/lib";
import type { UserProfileItem } from "@railback/lib";

import { deleteRow, getRow, type MemState, paginate, putRow } from "./state.js";

const SECONDS_PER_DAY = 24 * 60 * 60;

function toItem(u: User, hashedPassword: string): UserProfileItem {
  const email = keys.normaliseEmail(u.email);
  const item: UserProfileItem = {
    PK: keys.userPk(email),
    SK: keys.USER_PROFILE_SK,
    GSI1_PK: "USER",
    GSI1_SK: `EMAIL#${email}`,
    email,
    vorname: u.vorname,
    nachname: u.nachname,
    telefon: u.telefon,
    adresse_strasse: u.adresse.strasse,
    adresse_hausnr: u.adresse.hausnr,
    adresse_plz: u.adresse.plz,
    adresse_ort: u.adresse.ort,
    adresse_land: u.adresse.land,
    hashed_password: hashedPassword,
    user_state: u.user_state,
    created_at: u.created_at,
    datenschutz_einwilligung: u.datenschutz_einwilligung,
    agb_akzeptiert: u.agb_akzeptiert,
  };
  if (u.suspended_at !== undefined) item.suspended_at = u.suspended_at;
  if (u.suspended_reason !== undefined) item.suspended_reason = u.suspended_reason;
  if (u.iban_enc !== undefined) item.iban_enc = u.iban_enc;
  if (u.bic_enc !== undefined) item.bic_enc = u.bic_enc;
  if (u.ttl !== undefined) item.ttl = u.ttl;
  return item;
}

function fromItem(it: UserProfileItem): User {
  const u: User = {
    email: it.email,
    vorname: it.vorname,
    nachname: it.nachname,
    telefon: it.telefon,
    adresse: {
      strasse: it.adresse_strasse,
      hausnr: it.adresse_hausnr,
      plz: it.adresse_plz,
      ort: it.adresse_ort,
      land: it.adresse_land,
    },
    user_state: it.user_state,
    created_at: it.created_at,
    datenschutz_einwilligung: it.datenschutz_einwilligung,
    agb_akzeptiert: it.agb_akzeptiert,
  };
  if (it.suspended_at !== undefined) u.suspended_at = it.suspended_at;
  if (it.suspended_reason !== undefined) u.suspended_reason = it.suspended_reason;
  if (it.iban_enc !== undefined) u.iban_enc = it.iban_enc;
  if (it.bic_enc !== undefined) u.bic_enc = it.bic_enc;
  if (it.ttl !== undefined) u.ttl = it.ttl;
  return u;
}

export class InMemoryUserRepo implements UserRepo {
  constructor(private readonly state: MemState) {}

  async getByEmail(email: string): Promise<User | null> {
    const item = getRow<UserProfileItem>(this.state, keys.userPk(email), keys.USER_PROFILE_SK);
    return item ? fromItem(item) : null;
  }

  async getByEmailForAuth(email: string): Promise<UserAuthLookup | null> {
    const item = getRow<UserProfileItem>(this.state, keys.userPk(email), keys.USER_PROFILE_SK);
    if (!item) return null;
    const out: UserAuthLookup = {
      kind: "user",
      email: item.email,
      vorname: item.vorname,
      nachname: item.nachname,
      hashed_password: item.hashed_password,
      user_state: item.user_state,
    };
    if (item.suspended_reason !== undefined) out.suspended_reason = item.suspended_reason;
    return out;
  }

  async create(input: NewUser): Promise<User> {
    const email = keys.normaliseEmail(input.email);
    const existing = getRow<UserProfileItem>(this.state, keys.userPk(email), keys.USER_PROFILE_SK);
    if (existing) {
      throw new AppError("ERR_CONFLICT", `User ${email} already exists`);
    }
    const now = new Date().toISOString();
    const user: User = {
      email,
      vorname: input.vorname,
      nachname: input.nachname,
      telefon: input.telefon,
      adresse: input.adresse,
      user_state: "ACTIVE",
      created_at: now,
      iban_enc: input.iban_enc,
      bic_enc: input.bic_enc,
      datenschutz_einwilligung: input.datenschutz_einwilligung,
      agb_akzeptiert: input.agb_akzeptiert,
    };
    const item = toItem(user, input.hashed_password);
    putRow(this.state, item.PK, item.SK, item);
    return user;
  }

  async updateProfile(email: string, patch: ProfilePatch): Promise<User> {
    const norm = keys.normaliseEmail(email);
    const item = getRow<UserProfileItem>(this.state, keys.userPk(norm), keys.USER_PROFILE_SK);
    if (!item) {
      throw new AppError("ERR_NOT_FOUND", `User ${norm} not found`);
    }
    const next: UserProfileItem = { ...item };
    if (patch.vorname !== undefined) next.vorname = patch.vorname;
    if (patch.nachname !== undefined) next.nachname = patch.nachname;
    if (patch.telefon !== undefined) next.telefon = patch.telefon;
    if (patch.adresse !== undefined) {
      next.adresse_strasse = patch.adresse.strasse;
      next.adresse_hausnr = patch.adresse.hausnr;
      next.adresse_plz = patch.adresse.plz;
      next.adresse_ort = patch.adresse.ort;
      next.adresse_land = patch.adresse.land;
    }
    if (patch.iban_enc !== undefined) next.iban_enc = patch.iban_enc;
    if (patch.bic_enc !== undefined) next.bic_enc = patch.bic_enc;
    if (patch.user_state !== undefined) next.user_state = patch.user_state;
    if (patch.suspended_at !== undefined) next.suspended_at = patch.suspended_at;
    if (patch.suspended_reason !== undefined) next.suspended_reason = patch.suspended_reason;
    if (patch.ttl !== undefined) next.ttl = patch.ttl;
    if (patch.clear) {
      for (const k of patch.clear) {
        // exactOptionalPropertyTypes: delete the key rather than assign undefined.
        delete (next as unknown as Record<string, unknown>)[k];
      }
    }
    putRow(this.state, next.PK, next.SK, next);
    return fromItem(next);
  }

  async list(query: UserListQuery): Promise<Page<User>> {
    const all: UserProfileItem[] = [];
    for (const [, bucket] of this.state.rows) {
      const item = bucket.get(keys.USER_PROFILE_SK) as UserProfileItem | undefined;
      if (!item) continue;
      if (item.GSI1_PK !== "USER") continue;
      if (query.emailPrefix && !item.email.startsWith(keys.normaliseEmail(query.emailPrefix))) continue;
      if (query.state && item.user_state !== query.state) continue;
      all.push(item);
    }
    all.sort((a, b) => a.GSI1_SK.localeCompare(b.GSI1_SK));
    const page = paginate(all, query.limit, (it) => it.GSI1_SK, query.cursor);
    const out: Page<User> = { items: page.items.map(fromItem) };
    if (page.nextCursor !== undefined) out.nextCursor = page.nextCursor;
    return out;
  }

  async scheduleDeletion(email: string): Promise<void> {
    const norm = keys.normaliseEmail(email);
    const item = getRow<UserProfileItem>(this.state, keys.userPk(norm), keys.USER_PROFILE_SK);
    if (!item) {
      throw new AppError("ERR_NOT_FOUND", `User ${norm} not found`);
    }
    const next: UserProfileItem = {
      ...item,
      user_state: "DELETION_SCHEDULED",
      ttl: Math.floor(Date.now() / 1000) + 30 * SECONDS_PER_DAY,
    };
    putRow(this.state, next.PK, next.SK, next);
  }
}

// Re-export for tests that need the helpers — keeps the module surface tight.
export { deleteRow };
