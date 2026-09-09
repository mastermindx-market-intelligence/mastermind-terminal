import type { DbResult, DbRow, WatchlistDb } from "@/lib/watchlists";
import type { SavedView, ViewFilter } from "@/lib/rmsViews";
import { MAX_SAVED_VIEW_NAME, MAX_SAVED_VIEWS } from "@/lib/rmsViews";
import { isUuid } from "@/lib/theses";

export { MAX_SAVED_VIEWS, MAX_SAVED_VIEW_NAME };

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SETTINGS_KEY = /^rms_saved_view\.[0-9a-f]{32}$/;
export const SAVED_VIEW_KEY_PREFIX = "rms_saved_view.";

export type SavedViewsRead =
  /** `truncated` is true when the user owns more rows than MAX_SAVED_VIEWS shows.
   *  Round-2 review (Opus minor 3): the read used to `.slice()` silently, so a row
   *  past the cap was invisible in the UI and undeletable through it, with no signal
   *  anywhere that it existed. */
  | { ok: true; views: SavedView[]; truncated: boolean }
  | { ok: false; status: "unavailable"; error: string };

export type SavedViewWrite =
  | { ok: true; view: SavedView }
  | { ok: false; status: "invalid_name" | "invalid_filter" | "invalid_id" | "not_found" | "limit_reached" | "unavailable"; error: string };

export type SavedViewDelete =
  | { ok: true }
  | { ok: false; status: "invalid_id" | "not_found" | "unavailable"; error: string };

const rowsOf = (result: DbResult): DbRow[] => (Array.isArray(result?.data) ? result.data : []);

/** workspace_settings.key rejects hyphens (`^[a-z][a-z0-9_.]{0,63}$`). The
 *  SavedView.id stays a canonical UUID; the row key stores it without hyphens. */
export function savedViewSettingsKey(id: string): string {
  return `${SAVED_VIEW_KEY_PREFIX}${id.replace(/-/g, "").toLowerCase()}`;
}

export function normalizeSavedViewName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > MAX_SAVED_VIEW_NAME || CONTROL_CHARS.test(name)) return null;
  return name;
}

export function normalizeViewFilter(value: unknown): ViewFilter | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const lifecycle = raw.lifecycle === "any" ? "any" : raw.lifecycle === "active" ? "active" : null;
  if (!lifecycle) return null;
  const filter: ViewFilter = { lifecycle };
  if (raw.staleDays !== undefined) {
    if (typeof raw.staleDays !== "number" || !Number.isFinite(raw.staleDays) || raw.staleDays <= 0) return null;
    filter.staleDays = raw.staleDays;
  }
  if (raw.windowClosed !== undefined) {
    if (typeof raw.windowClosed !== "boolean") return null;
    filter.windowClosed = raw.windowClosed;
  }
  if (raw.subjectGroupKey !== undefined) {
    if (typeof raw.subjectGroupKey !== "string" || !raw.subjectGroupKey || CONTROL_CHARS.test(raw.subjectGroupKey)) return null;
    filter.subjectGroupKey = raw.subjectGroupKey;
  }
  return filter;
}

function parseSavedView(row: DbRow): SavedView | null {
  const key = typeof row.key === "string" ? row.key : "";
  if (!SETTINGS_KEY.test(key)) return null;
  const value = row.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !isUuid(raw.id)) return null;
  if (savedViewSettingsKey(raw.id) !== key) return null;
  const name = normalizeSavedViewName(raw.name);
  const filter = normalizeViewFilter(raw.filter);
  if (!name || !filter) return null;
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
  if (!createdAt || !updatedAt) return null;
  return { id: raw.id, name, filter, createdAt, updatedAt };
}

function userSettingsQuery(db: WatchlistDb, userId: string) {
  return db.from("workspace_settings").select("key,value,updated_at").eq("scope", "user").eq("user_id", userId);
}

/** Every saved view this owner holds, newest first — including the rows past the cap
 *  that `listSavedViews` hides. Round-3 review (Meta-CEO B ruling R4): rename and
 *  delete resolve membership against THIS list, never against the sliced read, so the
 *  51st row — precisely the row the disclosed single-writer race creates — stays
 *  repairable instead of answering not_found forever. */
async function readAllSavedViews(
  db: WatchlistDb,
  userId: string,
): Promise<{ ok: true; views: SavedView[] } | { ok: false; error: string }> {
  const result = await userSettingsQuery(db, userId);
  if (result.error) return { ok: false, error: result.error.message ?? "unavailable" };
  const views = rowsOf(result)
    .map(parseSavedView)
    .filter((view): view is SavedView => !!view)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)));
  return { ok: true, views };
}

export async function listSavedViews(db: WatchlistDb, userId: string): Promise<SavedViewsRead> {
  const all = await readAllSavedViews(db, userId);
  if (!all.ok) return { ok: false, status: "unavailable", error: all.error };
  return { ok: true, views: all.views.slice(0, MAX_SAVED_VIEWS), truncated: all.views.length > MAX_SAVED_VIEWS };
}

export async function createSavedView(
  db: WatchlistDb,
  userId: string,
  input: { id?: string; name: unknown; filter: unknown },
): Promise<SavedViewWrite> {
  const name = normalizeSavedViewName(input.name);
  if (!name) return { ok: false, status: "invalid_name", error: "invalid_name" };
  const filter = normalizeViewFilter(input.filter);
  if (!filter) return { ok: false, status: "invalid_filter", error: "invalid_filter" };
  const id = input.id ?? crypto.randomUUID();
  if (!isUuid(id)) return { ok: false, status: "invalid_id", error: "invalid_id" };

  const existing = await listSavedViews(db, userId);
  if (!existing.ok) return { ok: false, status: "unavailable", error: existing.error };
  if (existing.views.length >= MAX_SAVED_VIEWS) {
    return { ok: false, status: "limit_reached", error: "limit_reached" };
  }

  const now = new Date().toISOString();
  const view: SavedView = { id, name, filter, createdAt: now, updatedAt: now };
  const result = await db.from("workspace_settings").insert({
    scope: "user",
    user_id: userId,
    key: savedViewSettingsKey(id),
    value: view,
    updated_at: now,
  });
  if (result.error) return { ok: false, status: "unavailable", error: result.error.message ?? "unavailable" };
  return { ok: true, view };
}

export async function renameSavedView(
  db: WatchlistDb,
  userId: string,
  id: string,
  nameValue: unknown,
): Promise<SavedViewWrite> {
  if (!isUuid(id)) return { ok: false, status: "invalid_id", error: "invalid_id" };
  const name = normalizeSavedViewName(nameValue);
  if (!name) return { ok: false, status: "invalid_name", error: "invalid_name" };
  // Round-3 review (Meta-CEO B ruling R4): the FULL set, not the capped read — a row
  // past the cap is reported as existing (`truncated`) and must stay repairable.
  const listed = await readAllSavedViews(db, userId);
  if (!listed.ok) return { ok: false, status: "unavailable", error: listed.error };
  const current = listed.views.find((view) => view.id === id);
  if (!current) return { ok: false, status: "not_found", error: "not_found" };
  const now = new Date().toISOString();
  const view: SavedView = { ...current, name, updatedAt: now };
  const result = await db.from("workspace_settings")
    .update({ value: view, updated_at: now })
    .eq("scope", "user")
    .eq("user_id", userId)
    .eq("key", savedViewSettingsKey(id));
  if (result.error) return { ok: false, status: "unavailable", error: result.error.message ?? "unavailable" };
  return { ok: true, view };
}

export async function deleteSavedView(db: WatchlistDb, userId: string, id: string): Promise<SavedViewDelete> {
  if (!isUuid(id)) return { ok: false, status: "invalid_id", error: "invalid_id" };
  // Round-2 review (Opus minor 2): the delete answered { ok: true } whatever the row
  // count was, so the route's 404 branch was unreachable and deleting an id that never
  // existed reported success. Same read-then-write shape `renameSavedView` already
  // uses; the window between the two is the disclosed single-writer race, not a new one.
  // Round-3 review (Meta-CEO B ruling R4): membership against the FULL set — the 51st
  // row could be neither renamed nor deleted while the read that hides it still
  // reported it through `truncated`.
  const listed = await readAllSavedViews(db, userId);
  if (!listed.ok) return { ok: false, status: "unavailable", error: listed.error };
  if (!listed.views.some((view) => view.id === id)) {
    return { ok: false, status: "not_found", error: "not_found" };
  }
  const result = await db.from("workspace_settings")
    .delete()
    .eq("scope", "user")
    .eq("user_id", userId)
    .eq("key", savedViewSettingsKey(id));
  if (result.error) return { ok: false, status: "unavailable", error: result.error.message ?? "unavailable" };
  return { ok: true };
}
