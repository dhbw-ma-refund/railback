/**
 * Shared client-side cache for the user's saved route templates.
 *
 * Everywhere that reads/writes templates — the wizard picker, the
 * FahrtStep save affordance, the LookupStep save affordance, the
 * Profile page — goes through `useRouteTemplates()`. That way ticking
 * "Als Strecke speichern" in the wizard makes the new chip appear in
 * every other picker (including a second wizard tab) without a refetch,
 * and deleting from the Profile page shrinks the wizard picker live.
 *
 * The store is a tiny module-level pub/sub:
 *   - `templates` is the source of truth (or `null` if not yet loaded).
 *   - `loading` / `error` mirror the last fetch attempt.
 *   - Subscribers are React setStates registered by `useRouteTemplates`.
 *
 * A single in-flight fetch is shared across concurrent callers (see
 * `fetchInFlight`) so mounting the picker + the profile section on the
 * same render doesn't trigger two identical GETs.
 *
 * No auth concerns here — the api client already handles 401 → refresh.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { RouteTemplateView } from './api';
import { ulid } from './ulid';

interface StoreState {
  templates: RouteTemplateView[] | null;
  loading: boolean;
  error: string | null;
}

let store: StoreState = { templates: null, loading: false, error: null };
const subscribers = new Set<(s: StoreState) => void>();

function setStore(patch: Partial<StoreState>): void {
  store = { ...store, ...patch };
  for (const cb of subscribers) cb(store);
}

let fetchInFlight: Promise<void> | null = null;

/**
 * Fetch the list from the backend. Idempotent — concurrent calls share
 * the same promise. Sets `loading` / `error` / `templates` on the store.
 */
async function refresh(): Promise<void> {
  if (fetchInFlight) return fetchInFlight;
  setStore({ loading: true, error: null });
  fetchInFlight = (async () => {
    try {
      const res = await api.listRouteTemplates();
      setStore({ templates: res.templates, loading: false, error: null });
    } catch (err) {
      setStore({
        loading: false,
        error: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      fetchInFlight = null;
    }
  })();
  return fetchInFlight;
}

/**
 * Optimistic add — inserts a placeholder into the store immediately,
 * then POSTs. On success, swaps the placeholder for the server row
 * (which may have canonicalized the station names). On failure,
 * removes the placeholder and re-throws so the caller can undo the
 * UI toggle.
 *
 * The templateId is generated client-side (backend requires ULID); we
 * return it so the caller can pin their local "just-saved" pointer to
 * the same id.
 */
async function add(input: {
  label: string;
  fromStation: string;
  toStation: string;
  zugkategorie_pref?: string;
}): Promise<RouteTemplateView> {
  const templateId = ulid();
  const now = new Date().toISOString();
  const optimistic: RouteTemplateView = {
    templateId,
    label: input.label,
    fromStation: input.fromStation,
    fromEva: 0, // filled in by the server response; unused by any UI
    toStation: input.toStation,
    toEva: 0,
    ...(input.zugkategorie_pref !== undefined
      ? { zugkategorie_pref: input.zugkategorie_pref }
      : {}),
    created_at: now,
    updated_at: now,
  };
  setStore({
    templates: [...(store.templates ?? []), optimistic],
  });
  try {
    const created = await api.createRouteTemplate({
      templateId,
      label: input.label,
      fromStation: input.fromStation,
      toStation: input.toStation,
      ...(input.zugkategorie_pref !== undefined
        ? { zugkategorie_pref: input.zugkategorie_pref }
        : {}),
    });
    setStore({
      templates: (store.templates ?? []).map((t) =>
        t.templateId === templateId ? created : t,
      ),
    });
    return created;
  } catch (err) {
    setStore({
      templates: (store.templates ?? []).filter((t) => t.templateId !== templateId),
    });
    throw err;
  }
}

/**
 * Optimistic delete — pulls the row out of the store immediately then
 * DELETEs. On failure, puts it back and re-throws. The re-insertion
 * order follows the templateId lexicographic ordering the backend
 * uses on GET.
 */
async function remove(templateId: string): Promise<void> {
  const prev = store.templates ?? [];
  const target = prev.find((t) => t.templateId === templateId);
  if (!target) return; // nothing to do — no-op
  setStore({
    templates: prev.filter((t) => t.templateId !== templateId),
  });
  try {
    await api.deleteRouteTemplate(templateId);
  } catch (err) {
    setStore({
      templates: [...(store.templates ?? []), target].sort((a, b) =>
        a.templateId < b.templateId ? -1 : 1,
      ),
    });
    throw err;
  }
}

/**
 * Optimistic rename. Sends PATCH with just the changed label — no
 * from/to changes so the backend station resolver isn't re-run.
 */
async function rename(templateId: string, label: string): Promise<void> {
  const prev = store.templates ?? [];
  const target = prev.find((t) => t.templateId === templateId);
  if (!target) return;
  const now = new Date().toISOString();
  setStore({
    templates: prev.map((t) =>
      t.templateId === templateId ? { ...t, label, updated_at: now } : t,
    ),
  });
  try {
    const updated = await api.updateRouteTemplate(templateId, { label });
    setStore({
      templates: (store.templates ?? []).map((t) =>
        t.templateId === templateId ? updated : t,
      ),
    });
  } catch (err) {
    setStore({
      templates: (store.templates ?? []).map((t) =>
        t.templateId === templateId ? target : t,
      ),
    });
    throw err;
  }
}

export interface UseRouteTemplatesResult {
  /** null while first load is in flight, [] once loaded and empty. */
  templates: RouteTemplateView[] | null;
  loading: boolean;
  error: string | null;
  /** Force a refetch — used by the profile page's manual refresh path. */
  refresh: () => Promise<void>;
  /** Save a new template. Rejects on failure (caller shows the error). */
  add: (input: {
    label: string;
    fromStation: string;
    toStation: string;
    zugkategorie_pref?: string;
  }) => Promise<RouteTemplateView>;
  /** Delete a template. Rejects on failure. */
  remove: (templateId: string) => Promise<void>;
  /** Rename a template (label-only PATCH). Rejects on failure. */
  rename: (templateId: string, label: string) => Promise<void>;
}

/**
 * React hook wrapping the shared store. First caller triggers a
 * background fetch; subsequent callers reuse the cached list.
 */
export function useRouteTemplates(): UseRouteTemplatesResult {
  const [snapshot, setSnapshot] = useState<StoreState>(store);

  useEffect(() => {
    subscribers.add(setSnapshot);
    // Kick off the initial fetch only if nobody else already has.
    if (store.templates === null && !store.loading) {
      void refresh();
    }
    return () => {
      subscribers.delete(setSnapshot);
    };
  }, []);

  return {
    templates: snapshot.templates,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh: useCallback(() => refresh(), []),
    add: useCallback(add, []),
    remove: useCallback(remove, []),
    rename: useCallback(rename, []),
  };
}

/**
 * Test/dev helper: wipe the module store so a fresh hook mount refetches.
 * Not used in production paths.
 */
export function __resetRouteTemplatesStore(): void {
  store = { templates: null, loading: false, error: null };
  fetchInFlight = null;
  subscribers.clear();
}
