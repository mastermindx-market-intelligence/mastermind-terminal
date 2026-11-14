import type { DbRow, WatchlistDb } from "@/lib/watchlists";
import { userRows, nextToken } from "./store";
import { DISCOVER_CURRENT_KEY, DISCOVER_VIEW_PREFIX, MAX_DISCOVER_VIEWS, isDiscoverKey, parseDiscoverView, readDiscoverPreferences, sameDiscoverValue } from "@/lib/discoverWorkspace";

export const DISCOVER_SETTINGS_KEY = "discover_workspace_v1";
const MAX_DOCUMENT_BYTES = 64 * 1024;
type Values = Record<string, unknown>;
type Failure = { ok: false; status: number; error: string };
type Read = { ok: true; values: Values; blocked: boolean; row: DbRow | null } | Failure;
const object = (v: unknown): v is Values => !!v && typeof v === "object" && !Array.isArray(v);
const failed = (status: number, error: string): Failure => ({ ok: false, status, error });

/** Same user/RLS table as Smart Screens. One document makes current + named
 * autosave atomic and enforces the view cap without a read/insert race.
 * Per-key preimages preserve unrelated views; row-token CAS closes concurrent
 * read/write races. No auth metadata, service-role client, or new SQL schema.
 */
export async function readDiscoverWorkspace(db: WatchlistDb, userId: string): Promise<Read> {
  const result = await userRows(db, userId).eq("key", DISCOVER_SETTINGS_KEY);
  if (result.error) return failed(503, "unavailable");
  const row = Array.isArray(result.data) ? result.data[0] ?? null : null;
  if (!row) return { ok: true, values: {}, blocked: false, row: null };
  const doc = row.value;
  if (!object(doc) || doc.schema !== 1 || !object(doc.values) || Object.keys(doc).some(key => key !== "schema" && key !== "values")) return { ok: true, values: {}, blocked: true, row };
  const values = doc.values;
  return { ok: true, values, blocked: Object.keys(values).some(key => !isDiscoverKey(key)) || readDiscoverPreferences(values).blocked, row };
}

export async function writeDiscoverWorkspace(db: WatchlistDb, userId: string, patch: unknown, expected: unknown): Promise<
  { ok: true; values: Values; replay: boolean } | Failure
> {
  if (!object(patch) || !object(expected)) return failed(400, "invalid_patch");
  const keys = Object.keys(patch);
  if (!keys.length || keys.length > MAX_DISCOVER_VIEWS + 1 || keys.some(key => !isDiscoverKey(key) || !(key in expected))) return failed(400, "invalid_patch");
  const clean: Values = {};
  for (const key of keys) {
    const value = patch[key] == null ? null : parseDiscoverView(patch[key]);
    if (patch[key] != null && !value || value && key !== DISCOVER_CURRENT_KEY && key !== DISCOVER_VIEW_PREFIX + value.id) return failed(400, "invalid_view");
    if (expected[key] != null && !parseDiscoverView(expected[key])) return failed(400, "invalid_preimage");
    clean[key] = value;
  }
  // A lost row-token race is re-read once; only disjoint changes can merge.
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await readDiscoverWorkspace(db, userId);
    if (!read.ok) return read;
    if (read.blocked) return failed(409, "newer_schema");
    for (const key of keys) {
      if (!sameDiscoverValue(read.values[key], expected[key]) && !sameDiscoverValue(read.values[key], clean[key])) return failed(409, "conflict");
    }
    if (keys.every(key => sameDiscoverValue(read.values[key], clean[key]))) return { ok: true, values: read.values, replay: true };
    const values = { ...read.values };
    for (const key of keys) { if (clean[key] === null) delete values[key]; else values[key] = clean[key]; }
    if (Object.keys(values).filter(key => key.startsWith(DISCOVER_VIEW_PREFIX)).length > MAX_DISCOVER_VIEWS) return failed(409, "limit_reached");
    const value = { schema: 1, values };
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_DOCUMENT_BYTES) return failed(413, "record_too_large");
    const token = nextToken(String(read.row?.updated_at ?? ""));
    if (!read.row) {
      const result = await db.from("workspace_settings").insert({ scope: "user", user_id: userId, key: DISCOVER_SETTINGS_KEY, value, updated_at: token });
      if (!result.error) return { ok: true, values, replay: false };
      if (!/duplicate key|unique constraint/i.test(result.error.message ?? "")) return failed(503, "unavailable");
    } else {
      const result = await db.from("workspace_settings").update({ value, updated_at: token })
        .eq("scope", "user").eq("user_id", userId).eq("key", DISCOVER_SETTINGS_KEY).eq("updated_at", read.row.updated_at).select("key");
      if (result.error) return failed(503, "unavailable");
      if (Array.isArray(result.data) && result.data.length) return { ok: true, values, replay: false };
    }
  }
  return failed(409, "conflict");
}
