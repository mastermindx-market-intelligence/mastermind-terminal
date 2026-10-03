/** Existing user-scoped workspace_settings owner; v2 adds meaning-preserving records and recovery. */
import type { DbResult, DbRow, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";
import type { SavedView } from "@/lib/rmsViews";
import { MAX_SAVED_VIEW_NAME, MAX_SAVED_VIEWS } from "@/lib/rmsViews";
import {
  SAVED_VIEW_CONTRACT, asLegacySavedView, exactKeys, normalizeReceipt, normalizeSavedDefinition,
  normalizeSavedId, normalizeSavedViewName, normalizeViewFilter, normalizeWorkspaceSavedView,
  objectRecord, savedRequestFingerprint, validIso,
} from "@/lib/savedViewContract";
import type { SavedViewDefinition, SavedViewLookup, SavedViewReceipt, WorkspaceSavedView } from "@/lib/savedViewContract";
export { MAX_SAVED_VIEWS, MAX_SAVED_VIEW_NAME, normalizeSavedViewName, normalizeViewFilter };

const SETTINGS_KEY = /^rms_saved_view\.[0-9a-f]{32}$/;
export const SAVED_VIEW_KEY_PREFIX = "rms_saved_view.";
export type SavedViewError = "invalid_name" | "invalid_filter" | "invalid_definition" | "invalid_id"
  | "not_found" | "limit_reached" | "request_conflict" | "request_retired" | "view_changed" | "unavailable";
type Failure = { ok: false; status: SavedViewError; error: string };
export type SavedViewsRead = { ok: true; views: SavedView[]; truncated: boolean } | Failure;
export type SavedViewWrite = { ok: true; view: SavedView; receipt?: SavedViewReceipt; replayed?: boolean } | Failure;
export type SavedViewDelete = { ok: true } | Failure;
export type WorkspaceSavedViewsRead = { ok: true; views: WorkspaceSavedView[]; truncated: boolean } | Failure;
export type WorkspaceSavedViewWrite = { ok: true; view: WorkspaceSavedView; receipt: SavedViewReceipt; replayed: boolean } | Failure;
type Entry = { state: "present"; view: WorkspaceSavedView; receipt: SavedViewReceipt | null;
  originalName: string; raw: Record<string, unknown>; legacy: boolean }
  | { state: "deleted"; id: string; receipt: SavedViewReceipt; raw: Record<string, unknown>; legacy: false };
const fail = (status: SavedViewError, error: string = status): Failure => ({ ok: false, status, error });
const rowsOf = (result: DbResult): DbRow[] => Array.isArray(result.data) ? result.data
  : result.data && typeof result.data === "object" ? [result.data] : [];
export function savedViewSettingsKey(id: string): string {
  return `${SAVED_VIEW_KEY_PREFIX}${id.replace(/-/g, "").toLowerCase()}`;
}
function userSettingsQuery(db: WatchlistDb, ownerId: string) {
  return db.from("workspace_settings").select("key,value,updated_at").eq("scope", "user").eq("user_id", ownerId);
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }

/** A v2 marker must NEVER fall back to the lossy legacy parser. Malformed v2 is a read failure. */
async function parseEntry(row: DbRow, ownerId: string): Promise<Entry | null | "invalid"> {
  if (typeof row.key !== "string" || !SETTINGS_KEY.test(row.key)) return null;
  const raw = objectRecord(row.value);
  if (!raw) return null;
  if (raw.schema !== undefined) {
    if (raw.schema !== SAVED_VIEW_CONTRACT) return "invalid";
    const receipt = normalizeReceipt(raw.receipt);
    if (!receipt || savedViewSettingsKey(receipt.requestId) !== row.key) return "invalid";
    if (raw.deletedAt !== undefined) {
      if (!exactKeys(raw, ["schema", "id", "deletedAt", "receipt"]) || !validIso(raw.deletedAt) || raw.id !== receipt.requestId
          || !exactKeys(objectRecord(raw.receipt)!, ["requestId", "fingerprint"])) return "invalid";
      return { state: "deleted", id: receipt.requestId, receipt, raw, legacy: false };
    }
    if (!exactKeys(raw, ["schema", "record", "originalName", "receipt"])) return "invalid";
    const view = normalizeWorkspaceSavedView(raw.record), originalName = normalizeSavedViewName(raw.originalName);
    if (!view || view.revision < 1 || view.id !== receipt.requestId || !originalName) return "invalid";
    if (receipt.fingerprint !== await savedRequestFingerprint(ownerId, view.id, originalName, view.definition)) return "invalid";
    return { state: "present", view, receipt, originalName, raw, legacy: false };
  }
  const id = normalizeSavedId(raw.id), name = normalizeSavedViewName(raw.name);
  const filter = normalizeViewFilter(raw.filter, false);
  if (!id || savedViewSettingsKey(id) !== row.key || !name || !filter || !nonempty(raw.createdAt) || !nonempty(raw.updatedAt)) return null;
  // Revision 0 explicitly means an unversioned legacy record, not an inferred revision 1.
  return { state: "present", view: { id, name, definition: { version: 1, kind: "thesis_filter", filter },
    createdAt: raw.createdAt, updatedAt: raw.updatedAt, revision: 0 }, receipt: null, originalName: name, raw, legacy: true };
}
async function readEntry(db: WatchlistDb, ownerId: string, id: string): Promise<{ ok: true; entry: Entry | null } | Failure> {
  try {
    const result = await userSettingsQuery(db, ownerId).eq("key", savedViewSettingsKey(id));
    if (result.error) return fail("unavailable");
    const rows = rowsOf(result);
    if (rows.length > 1) return fail("unavailable", "duplicate_saved_record");
    if (!rows.length) return { ok: true, entry: null };
    const entry = await parseEntry(rows[0], ownerId);
    return entry === "invalid" || entry === null ? fail("unavailable", "invalid_saved_record") : { ok: true, entry };
  } catch { return fail("unavailable"); }
}

/** Optional paging is part of Supabase's real query builder. Existing small fixture doubles remain valid.
 * Fail closed on a full unpaged response; do not claim it is the complete account population.
 * Exact-ID recovery/rename/delete never relies on this list or its display cap.
 */
async function readEntries(db: WatchlistDb, ownerId: string): Promise<{ ok: true; entries: Entry[] } | Failure> {
  const PAGE = 500, MAX_PAGES = 20;
  const entries: Entry[] = [], seen = new Set<string>();
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = userSettingsQuery(db, ownerId).order("key", { ascending: true });
      const paged = query as WatchlistQuery & { range?: (from: number, to: number) => WatchlistQuery };
      const canPage = typeof paged.range === "function";
      const result = await (canPage ? paged.range!(page * PAGE, (page + 1) * PAGE - 1) : query);
      if (result.error) return fail("unavailable");
      const rows = rowsOf(result);
      if (!canPage && rows.length >= PAGE) return fail("unavailable", "unpaged_saved_views_limit");
      for (const row of rows) {
        if (typeof row.key !== "string" || !SETTINGS_KEY.test(row.key)) continue;
        if (seen.has(row.key)) return fail("unavailable", "saved_views_changed_during_read");
        seen.add(row.key);
        const entry = await parseEntry(row, ownerId);
        if (entry === "invalid") return fail("unavailable", "invalid_saved_record");
        if (entry) entries.push(entry);
      }
      if (!canPage || rows.length < PAGE) return { ok: true, entries };
    }
    return fail("unavailable", "saved_views_scan_limit");
  } catch { return fail("unavailable"); }
}
function orderedViews(entries: Entry[]): WorkspaceSavedView[] {
  return entries.filter((e): e is Extract<Entry, { state: "present" }> => e.state === "present").map(e => e.view)
    .sort((a, b) => a.updatedAt === b.updatedAt ? a.id.localeCompare(b.id) : a.updatedAt > b.updatedAt ? -1 : 1);
}
export async function listSavedViews(db: WatchlistDb, ownerId: string): Promise<SavedViewsRead> {
  const all = await readEntries(db, ownerId);
  if (!all.ok) return all;
  const views = orderedViews(all.entries).map(asLegacySavedView).filter((v): v is SavedView => v !== null);
  return { ok: true, views: views.slice(0, MAX_SAVED_VIEWS), truncated: views.length > MAX_SAVED_VIEWS };
}
export async function listWorkspaceSavedViews(db: WatchlistDb, ownerId: string, kind?: SavedViewDefinition["kind"]): Promise<WorkspaceSavedViewsRead> {
  const all = await readEntries(db, ownerId);
  if (!all.ok) return all;
  const views = orderedViews(all.entries).filter(view => !kind || view.definition.kind === kind);
  return { ok: true, views: views.slice(0, MAX_SAVED_VIEWS), truncated: views.length > MAX_SAVED_VIEWS };
}
export async function lookupWorkspaceSavedView(db: WatchlistDb, ownerId: string, rawId: unknown): Promise<{ ok: true; result: SavedViewLookup } | Failure> {
  const id = normalizeSavedId(rawId);
  if (!id) return fail("invalid_id");
  const found = await readEntry(db, ownerId, id);
  if (!found.ok) return found;
  if (!found.entry) return fail("not_found"); // NOT proof that an in-flight request cannot still commit.
  const entry = found.entry;
  return { ok: true, result: { contract: SAVED_VIEW_CONTRACT, ownerId, state: entry.state,
    view: entry.state === "present" ? entry.view : null, receipt: entry.state === "present" && entry.receipt ? { ...entry.receipt, originalName: entry.originalName } : entry.receipt } };
}
function reconcileCreate(entry: Entry, fingerprint: string): WorkspaceSavedViewWrite {
  if (!entry.receipt || entry.receipt.fingerprint !== fingerprint) return fail("request_conflict");
  if (entry.state === "deleted") return fail("request_retired");
  return { ok: true, view: entry.view, receipt: { ...entry.receipt, originalName: entry.originalName }, replayed: true };
}
export async function createWorkspaceSavedView(
  db: WatchlistDb, ownerId: string, input: { id: unknown; name: unknown; definition: unknown },
): Promise<WorkspaceSavedViewWrite> {
  const id = normalizeSavedId(input.id), name = normalizeSavedViewName(input.name), definition = normalizeSavedDefinition(input.definition);
  if (!id) return fail("invalid_id");
  if (!name) return fail("invalid_name");
  if (!definition) return fail("invalid_definition");
  const fingerprint = await savedRequestFingerprint(ownerId, id, name, definition);
  const previous = await readEntry(db, ownerId, id);
  if (!previous.ok) return previous;
  if (previous.entry) return reconcileCreate(previous.entry, fingerprint);
  const all = await readEntries(db, ownerId);
  if (!all.ok) return all;
  // Existing distinct-ID concurrent-create cap race is not claimed solved without an atomic DB owner operation.
  if (orderedViews(all.entries).length >= MAX_SAVED_VIEWS) return fail("limit_reached");
  const now = new Date().toISOString();
  const view: WorkspaceSavedView = { id, name, definition, createdAt: now, updatedAt: now, revision: 1 };
  const receipt: SavedViewReceipt = { requestId: id, fingerprint };
  let insertAcknowledged = false;
  try {
    const insertion = await db.from("workspace_settings").insert({ scope: "user", user_id: ownerId, key: savedViewSettingsKey(id),
      value: { schema: SAVED_VIEW_CONTRACT, record: view, originalName: name, receipt }, updated_at: now });
    insertAcknowledged = !insertion.error;
  } catch { /* An error can follow commit. Read the same operation; never INSERT again here. */ }
  const confirmed = await readEntry(db, ownerId, id);
  if (!confirmed.ok || !confirmed.entry) return fail("unavailable");
  const result = reconcileCreate(confirmed.entry, fingerprint);
  return result.ok ? { ...result, replayed: !insertAcknowledged } : result;
}
export async function createSavedView(
  db: WatchlistDb, ownerId: string, input: { id?: unknown; name: unknown; filter: unknown },
): Promise<SavedViewWrite> {
  const filter = normalizeViewFilter(input.filter);
  if (!filter) return fail("invalid_filter");
  const id = input.id === undefined ? crypto.randomUUID() : input.id;
  const result = await createWorkspaceSavedView(db, ownerId, { id, name: input.name, definition: { version: 1, kind: "thesis_filter", filter } });
  if (!result.ok) return result;
  const view = asLegacySavedView(result.view);
  return view ? { ...result, view } : fail("unavailable");
}
async function mutateExisting(
  db: WatchlistDb, ownerId: string, rawId: unknown, action: "rename" | "delete", nameValue?: unknown,
): Promise<{ ok: true; entry: Entry | null } | Failure> {
  const id = normalizeSavedId(rawId);
  if (!id) return fail("invalid_id");
  const name = action === "rename" ? normalizeSavedViewName(nameValue) : null;
  if (action === "rename" && !name) return fail("invalid_name");
  const current = await readEntry(db, ownerId, id);
  if (!current.ok) return current;
  if (!current.entry || current.entry.state === "deleted") return fail("not_found");
  const entry = current.entry;
  const now = new Date().toISOString();
  try {
    if (entry.legacy) {
      // Retain old records and consumers. No fabricated creation receipt or retrospective version is added.
      if (action === "delete") {
        const removed = await db.from("workspace_settings").delete().eq("scope", "user").eq("user_id", ownerId).eq("key", savedViewSettingsKey(id));
        if (removed.error) return fail("unavailable");
      } else {
        const updated = { ...entry.raw, name: name!, updatedAt: now };
        const renamed = await db.from("workspace_settings").update({ value: updated, updated_at: now })
          .eq("scope", "user").eq("user_id", ownerId).eq("key", savedViewSettingsKey(id));
        if (renamed.error) return fail("unavailable");
      }
    } else {
      const raw = action === "delete"
        ? { schema: SAVED_VIEW_CONTRACT, id, deletedAt: now, receipt: entry.receipt }
        : { ...entry.raw, record: { ...entry.view, name: name!, updatedAt: now, revision: entry.view.revision + 1 } };
      const written = await db.from("workspace_settings").update({ value: raw, updated_at: now })
        .eq("scope", "user").eq("user_id", ownerId).eq("key", savedViewSettingsKey(id))
        .eq("value->record->>revision", entry.view.revision).select("key,value,updated_at");
      if (written.error) return fail("unavailable");
      if (rowsOf(written).length !== 1) return fail("view_changed");
    }
  } catch { return fail("unavailable"); }
  const after = await readEntry(db, ownerId, id);
  if (!after.ok) return after;
  if (action === "delete") return after.entry === null || after.entry.state === "deleted" ? after : fail("view_changed");
  return after.entry?.state === "present" && after.entry.view.name === name ? after : fail("view_changed");
}
export async function renameSavedView(db: WatchlistDb, ownerId: string, id: string, nameValue: unknown): Promise<SavedViewWrite> {
  // The legacy endpoint cannot mutate a non-thesis view by accidentally guessing its UUID.
  const before = await lookupWorkspaceSavedView(db, ownerId, id);
  if (!before.ok) return before;
  if (before.result.view?.definition.kind !== "thesis_filter") return fail("not_found");
  const result = await mutateExisting(db, ownerId, id, "rename", nameValue);
  if (!result.ok) return result;
  const view = result.entry?.state === "present" ? asLegacySavedView(result.entry.view) : null;
  return view ? { ok: true, view } : fail("unavailable");
}
export async function deleteSavedView(db: WatchlistDb, ownerId: string, id: string): Promise<SavedViewDelete> {
  const before = await lookupWorkspaceSavedView(db, ownerId, id);
  if (!before.ok) return before;
  if (before.result.view?.definition.kind !== "thesis_filter") return fail("not_found");
  const result = await mutateExisting(db, ownerId, id, "delete");
  return result.ok ? { ok: true } : result;
}
export async function renameWorkspaceSavedView(db: WatchlistDb, ownerId: string, id: string, nameValue: unknown) {
  const result = await mutateExisting(db, ownerId, id, "rename", nameValue);
  if (!result.ok) return result;
  return result.entry?.state === "present" ? { ok: true as const, view: result.entry.view, receipt: result.entry.receipt } : fail("unavailable");
}
export async function deleteWorkspaceSavedView(db: WatchlistDb, ownerId: string, id: string): Promise<SavedViewDelete> {
  const result = await mutateExisting(db, ownerId, id, "delete");
  return result.ok ? { ok: true } : result;
}
