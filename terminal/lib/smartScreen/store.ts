/**
 * Account persistence for smart screens — one `workspace_settings` row per screen (E04).
 *
 * Every write is a compare-and-set:
 *   - the caller names the `rev` it last saw; a different stored rev is a 409 `conflict` that
 *     carries the current record, so the second device decides instead of overwriting;
 *   - the UPDATE/DELETE itself is conditional on the row's `updated_at` as read, so two writers
 *     that both passed the rev check cannot both succeed — the loser matches zero rows and is
 *     answered with the re-read current record;
 *   - a create names a client-proposed id, so a retried create whose first attempt did land is
 *     recognised (same id, same content, rev 1) and acknowledged instead of duplicated.
 *
 * Rows are always filtered by `scope = 'user'` and `user_id = <session user>`; RLS enforces the
 * same boundary underneath (migration 0015). A record written by a newer Terminal is never
 * rewritten here — it can only be deleted, under the same rev check.
 */

import type { DbResult, DbRow, WatchlistDb } from "@/lib/watchlists";
import { normalizeDefinition, type NormalizeError } from "./predicate";
import { normalizeReview, reviewableDefinition, type ReviewSnapshot } from "./review";
import {
  isScreenKey,
  MAX_RECORD_BYTES,
  MAX_SCREENS,
  normalizeScreenName,
  parseScreenRecord,
  RECORD_SCHEMA,
  recordBytes,
  SCREEN_ID_RE,
  SCREEN_KEY_PREFIX,
  screenKey,
  type ReadOnlyScreen,
  type ScreenRecord,
} from "./record";

type StoredRow = { key: string; value: unknown; token: string };

const rowsOf = (result: DbResult): DbRow[] => (Array.isArray(result?.data) ? result.data : []);
const toStored = (row: DbRow): StoredRow => ({ key: String(row.key), value: row.value, token: String(row.updated_at ?? "") });

function userRows(db: WatchlistDb, userId: string) {
  return db.from("workspace_settings").select("key,value,updated_at").eq("scope", "user").eq("user_id", userId);
}

async function readAll(db: WatchlistDb, userId: string): Promise<{ ok: true; rows: StoredRow[] } | { ok: false; error: string }> {
  const result = await userRows(db, userId);
  if (result.error) return { ok: false, error: result.error.message ?? "unavailable" };
  return { ok: true, rows: rowsOf(result).filter((row) => isScreenKey(row.key)).map(toStored) };
}

async function readOne(db: WatchlistDb, userId: string, id: string): Promise<{ ok: true; row: StoredRow | null } | { ok: false; error: string }> {
  const result = await userRows(db, userId).eq("key", screenKey(id));
  if (result.error) return { ok: false, error: result.error.message ?? "unavailable" };
  const row = rowsOf(result)[0];
  return { ok: true, row: row ? toStored(row) : null };
}

/** A strictly later token than the one read, even when two writes land in the same ms. */
function nextToken(read: string): string {
  const prior = Date.parse(read);
  return new Date(Math.max(Date.now(), Number.isFinite(prior) ? prior + 1 : 0)).toISOString();
}

export type ListResult =
  | { ok: true; screens: ScreenRecord[]; readOnly: ReadOnlyScreen[]; invalid: number }
  | { ok: false; error: string };

export async function listScreens(db: WatchlistDb, userId: string): Promise<ListResult> {
  const all = await readAll(db, userId);
  if (!all.ok) return all;
  const screens: ScreenRecord[] = [];
  const readOnly: ReadOnlyScreen[] = [];
  let invalid = 0;
  for (const row of all.rows) {
    const parsed = parseScreenRecord(row.value, row.key.slice(SCREEN_KEY_PREFIX.length));
    if (parsed.kind === "ok") screens.push(parsed.record);
    else if (parsed.kind === "newer") readOnly.push(parsed.screen);
    else invalid++;
  }
  const byCreated = (a: { id: string; createdAt?: string }, b: { id: string; createdAt?: string }) =>
    (a.createdAt ?? "") < (b.createdAt ?? "") ? -1 : (a.createdAt ?? "") > (b.createdAt ?? "") ? 1 : a.id.localeCompare(b.id);
  screens.sort(byCreated);
  readOnly.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, screens, readOnly, invalid };
}

export type WriteFailure =
  | { ok: false; status: 400; error: "invalid_id" | "invalid_name" | "invalid_rev" | "invalid_review"; detail?: string }
  | { ok: false; status: 400; error: "invalid_definition"; detail: NormalizeError; path: string }
  | { ok: false; status: 404; error: "not_found" }
  | { ok: false; status: 409; error: "conflict"; current: ScreenRecord | null; readOnly: ReadOnlyScreen | null }
  | { ok: false; status: 409; error: "newer_schema"; readOnly: ReadOnlyScreen }
  | { ok: false; status: 409; error: "limit_reached" }
  | { ok: false; status: 413; error: "record_too_large" }
  | { ok: false; status: 503; error: "unavailable"; detail: string };
export type SaveResult = { ok: true; status: 200 | 201; record: ScreenRecord; replay: boolean } | WriteFailure;
export type DeleteResult = { ok: true; status: 200; deleted: string; alreadyGone: boolean } | WriteFailure;

type Content = { name: string; hash: string; review: ReviewSnapshot | null };
type Validated = Content & { def: ScreenRecord["def"] };

const sameContent = (record: ScreenRecord, content: Content): boolean =>
  record.name === content.name && record.hash === content.hash
  && JSON.stringify(record.review) === JSON.stringify(content.review);

function validateContent(input: { name: unknown; def: unknown; review: unknown }): { ok: true; value: Validated } | WriteFailure {
  const name = normalizeScreenName(input.name);
  if (!name) return { ok: false, status: 400, error: "invalid_name" };
  const def = normalizeDefinition(input.def);
  if (!def.ok) return { ok: false, status: 400, error: "invalid_definition", detail: def.error, path: def.path };
  let review: ReviewSnapshot | null = null;
  if (input.review !== null && input.review !== undefined) {
    const checked = normalizeReview(input.review, def.hash);
    if (!checked.ok) return { ok: false, status: 400, error: "invalid_review", detail: checked.error };
    if (!reviewableDefinition(def.def)) return { ok: false, status: 400, error: "invalid_review", detail: "fundamental_conditions" };
    review = checked.review;
  }
  return { ok: true, value: { name, def: def.def, hash: def.hash, review } };
}

const isRev = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_000_000_000;

function conflictFrom(row: StoredRow | null): WriteFailure {
  if (!row) return { ok: false, status: 404, error: "not_found" };
  const parsed = parseScreenRecord(row.value, row.key.slice(SCREEN_KEY_PREFIX.length));
  if (parsed.kind === "ok") return { ok: false, status: 409, error: "conflict", current: parsed.record, readOnly: null };
  if (parsed.kind === "newer") return { ok: false, status: 409, error: "conflict", current: null, readOnly: parsed.screen };
  return { ok: false, status: 409, error: "conflict", current: null, readOnly: null };
}

const unavailable = (detail: string): WriteFailure => ({ ok: false, status: 503, error: "unavailable", detail });
const isDuplicate = (message: string | undefined) => /duplicate key|unique constraint/i.test(message ?? "");

export async function createScreen(
  db: WatchlistDb,
  userId: string,
  input: { id: unknown; name: unknown; def: unknown; review?: unknown },
): Promise<SaveResult> {
  if (typeof input.id !== "string" || !SCREEN_ID_RE.test(input.id)) return { ok: false, status: 400, error: "invalid_id" };
  const id = input.id;
  const content = validateContent({ name: input.name, def: input.def, review: input.review });
  if (!content.ok) return content;
  const { value } = content;

  // A retried create whose first attempt landed: same id + same content at rev 1 = success.
  const replayOrConflict = (row: StoredRow): SaveResult => {
    const parsed = parseScreenRecord(row.value, id);
    if (parsed.kind === "ok" && parsed.record.rev === 1 && sameContent(parsed.record, value)) {
      return { ok: true, status: 200, record: parsed.record, replay: true };
    }
    return conflictFrom(row);
  };

  const all = await readAll(db, userId);
  if (!all.ok) return unavailable(all.error);
  const existing = all.rows.find((row) => row.key === screenKey(id));
  if (existing) return replayOrConflict(existing);
  // Every screen row counts toward the cap, including ones this version cannot read.
  if (all.rows.length >= MAX_SCREENS) return { ok: false, status: 409, error: "limit_reached" };

  const now = new Date().toISOString();
  const record: ScreenRecord = {
    schema: RECORD_SCHEMA, id, rev: 1, name: value.name, def: value.def, hash: value.hash,
    createdAt: now, updatedAt: now, review: value.review,
  };
  if (recordBytes(record) > MAX_RECORD_BYTES) return { ok: false, status: 413, error: "record_too_large" };
  const inserted = await db.from("workspace_settings").insert({
    scope: "user",
    user_id: userId,
    key: screenKey(id),
    value: record,
    updated_at: now,
  });
  if (inserted.error) {
    if (!isDuplicate(inserted.error.message)) return unavailable(inserted.error.message ?? "unavailable");
    const raced = await readOne(db, userId, id);
    if (!raced.ok) return unavailable(raced.error);
    return raced.row ? replayOrConflict(raced.row) : unavailable("insert raced a delete");
  }
  return { ok: true, status: 201, record, replay: false };
}

export async function updateScreen(
  db: WatchlistDb,
  userId: string,
  input: { id: unknown; expectedRev: unknown; name: unknown; def: unknown; review?: unknown },
): Promise<SaveResult> {
  if (typeof input.id !== "string" || !SCREEN_ID_RE.test(input.id)) return { ok: false, status: 400, error: "invalid_id" };
  if (!isRev(input.expectedRev)) return { ok: false, status: 400, error: "invalid_rev" };
  const id = input.id;
  const content = validateContent({ name: input.name, def: input.def, review: input.review });
  if (!content.ok) return content;
  const { value } = content;

  const read = await readOne(db, userId, id);
  if (!read.ok) return unavailable(read.error);
  if (!read.row) return { ok: false, status: 404, error: "not_found" };
  const parsed = parseScreenRecord(read.row.value, id);
  if (parsed.kind === "newer") return { ok: false, status: 409, error: "newer_schema", readOnly: parsed.screen };
  if (parsed.kind !== "ok") return conflictFrom(read.row);
  const current = parsed.record;
  if (current.rev !== input.expectedRev) return { ok: false, status: 409, error: "conflict", current, readOnly: null };
  if (sameContent(current, value)) return { ok: true, status: 200, record: current, replay: true };

  const token = nextToken(read.row.token);
  const next: ScreenRecord = {
    ...current, rev: current.rev + 1, name: value.name, def: value.def, hash: value.hash, review: value.review, updatedAt: token,
  };
  if (recordBytes(next) > MAX_RECORD_BYTES) return { ok: false, status: 413, error: "record_too_large" };
  const written = await db.from("workspace_settings")
    .update({ value: next, updated_at: token })
    .eq("scope", "user").eq("user_id", userId).eq("key", screenKey(id)).eq("updated_at", read.row.token)
    .select("key,value,updated_at");
  if (written.error) return unavailable(written.error.message ?? "unavailable");
  if (!rowsOf(written).length) {
    // Lost the race between the rev check and the write: answer with what won.
    const after = await readOne(db, userId, id);
    if (!after.ok) return unavailable(after.error);
    return conflictFrom(after.row);
  }
  return { ok: true, status: 200, record: next, replay: false };
}

export async function deleteScreen(
  db: WatchlistDb,
  userId: string,
  input: { id: unknown; expectedRev: unknown },
): Promise<DeleteResult> {
  if (typeof input.id !== "string" || !SCREEN_ID_RE.test(input.id)) return { ok: false, status: 400, error: "invalid_id" };
  if (!isRev(input.expectedRev)) return { ok: false, status: 400, error: "invalid_rev" };
  const id = input.id;
  const read = await readOne(db, userId, id);
  if (!read.ok) return unavailable(read.error);
  // Already gone is the state a delete asks for — acknowledged, and said so.
  if (!read.row) return { ok: true, status: 200, deleted: id, alreadyGone: true };
  const parsed = parseScreenRecord(read.row.value, id);
  const rev = parsed.kind === "ok" ? parsed.record.rev : parsed.kind === "newer" ? parsed.screen.rev : null;
  if (rev !== input.expectedRev) return conflictFrom(read.row) as DeleteResult;
  const removed = await db.from("workspace_settings")
    .delete()
    .eq("scope", "user").eq("user_id", userId).eq("key", screenKey(id)).eq("updated_at", read.row.token)
    .select("key");
  if (removed.error) return unavailable(removed.error.message ?? "unavailable");
  if (!rowsOf(removed).length) {
    const after = await readOne(db, userId, id);
    if (!after.ok) return unavailable(after.error);
    if (!after.row) return { ok: true, status: 200, deleted: id, alreadyGone: true };
    return conflictFrom(after.row) as DeleteResult;
  }
  return { ok: true, status: 200, deleted: id, alreadyGone: false };
}
