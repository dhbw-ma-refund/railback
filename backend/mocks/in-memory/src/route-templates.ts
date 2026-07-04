import { AppError } from "@railback/lib";
import { keys } from "@railback/lib";
import type {
  NewRouteTemplate,
  RouteTemplate,
  RouteTemplatePatch,
  RouteTemplateRepo,
} from "@railback/lib";
import type { RouteTemplateItem } from "@railback/lib";

import { deleteRow, getRow, listSk, type MemState, putRow } from "./state.js";

function toItem(email: string, t: RouteTemplate): RouteTemplateItem {
  const norm = keys.normaliseEmail(email);
  const item: RouteTemplateItem = {
    PK: keys.userPk(norm),
    SK: keys.templateSk(t.templateId),
    templateId: t.templateId,
    label: t.label,
    from_station: t.from_station,
    from_eva: t.from_eva,
    to_station: t.to_station,
    to_eva: t.to_eva,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
  if (t.fahrkartennummer !== undefined) item.fahrkartennummer = t.fahrkartennummer;
  if (t.fahrkartenpreis !== undefined) item.fahrkartenpreis = t.fahrkartenpreis;
  if (t.zugkategorie_pref !== undefined) item.zugkategorie_pref = t.zugkategorie_pref;
  return item;
}

function fromItem(it: RouteTemplateItem): RouteTemplate {
  const email = keys.parseUserPk(it.PK);
  if (!email) throw new AppError("ERR_INTERNAL", `bad PK ${it.PK}`);
  const t: RouteTemplate = {
    email,
    templateId: it.templateId,
    label: it.label,
    from_station: it.from_station,
    from_eva: it.from_eva,
    to_station: it.to_station,
    to_eva: it.to_eva,
    created_at: it.created_at,
    updated_at: it.updated_at,
  };
  if (it.fahrkartennummer !== undefined) t.fahrkartennummer = it.fahrkartennummer;
  if (it.fahrkartenpreis !== undefined) t.fahrkartenpreis = it.fahrkartenpreis;
  if (it.zugkategorie_pref !== undefined) t.zugkategorie_pref = it.zugkategorie_pref;
  return t;
}

export class InMemoryRouteTemplateRepo implements RouteTemplateRepo {
  constructor(private readonly state: MemState) {}

  async list(email: string): Promise<RouteTemplate[]> {
    const items = listSk<RouteTemplateItem>(this.state, keys.userPk(email), "TEMPLATE#");
    return items.map(fromItem).sort((a, b) => a.templateId.localeCompare(b.templateId));
  }

  async get(email: string, id: string): Promise<RouteTemplate | null> {
    const it = getRow<RouteTemplateItem>(this.state, keys.userPk(email), keys.templateSk(id));
    return it ? fromItem(it) : null;
  }

  async create(email: string, tpl: NewRouteTemplate): Promise<RouteTemplate> {
    // templateId is frontend-allocated (POST body carries it) — reject
    // duplicate writes with ERR_CONFLICT, mirroring the contract error
    // for "templateId already exists for this user".
    const existing = getRow<RouteTemplateItem>(
      this.state,
      keys.userPk(email),
      keys.templateSk(tpl.templateId),
    );
    if (existing) {
      throw new AppError(
        "ERR_CONFLICT",
        `Template ${tpl.templateId} already exists for this user`,
      );
    }
    const now = new Date().toISOString();
    const t: RouteTemplate = {
      email: keys.normaliseEmail(email),
      templateId: tpl.templateId,
      label: tpl.label,
      from_station: tpl.from_station,
      from_eva: tpl.from_eva,
      to_station: tpl.to_station,
      to_eva: tpl.to_eva,
      created_at: now,
      updated_at: now,
    };
    if (tpl.fahrkartennummer !== undefined) t.fahrkartennummer = tpl.fahrkartennummer;
    if (tpl.fahrkartenpreis !== undefined) t.fahrkartenpreis = tpl.fahrkartenpreis;
    if (tpl.zugkategorie_pref !== undefined) t.zugkategorie_pref = tpl.zugkategorie_pref;
    const item = toItem(email, t);
    putRow(this.state, item.PK, item.SK, item);
    return t;
  }

  async patch(email: string, id: string, patch: RouteTemplatePatch): Promise<RouteTemplate> {
    const it = getRow<RouteTemplateItem>(this.state, keys.userPk(email), keys.templateSk(id));
    if (!it) throw new AppError("ERR_NOT_FOUND", `Template ${id} not found`);
    const now = new Date().toISOString();
    const merged: RouteTemplate = {
      ...fromItem(it),
      ...patch,
      updated_at: now,
    };
    const next = toItem(email, merged);
    putRow(this.state, next.PK, next.SK, next);
    return merged;
  }

  async delete(email: string, id: string): Promise<void> {
    deleteRow(this.state, keys.userPk(email), keys.templateSk(id));
  }

  async deleteAllForUser(email: string): Promise<number> {
    // Linear scan over TEMPLATE# SKs under USER#<email>. Templates have
    // no S3 blobs (label + station metadata only) so DDB-row delete is
    // the entire cascade.
    const norm = keys.normaliseEmail(email);
    const livePk = keys.userPk(norm);
    const bucket = this.state.rows.get(livePk);
    if (!bucket) return 0;
    const sks: string[] = [];
    for (const [sk] of bucket) {
      if (sk.startsWith("TEMPLATE#")) sks.push(sk);
    }
    for (const sk of sks) {
      deleteRow(this.state, livePk, sk);
    }
    return sks.length;
  }
}
