// E07 — account study templates: one `workspace_settings` row per template (scope 'user').
//
// No DDL: the 0015 table already gives a per-owner unique key, RLS on `user_id = auth.uid()`, a
// key grammar check and an `updated_at` column. Each row's `value` is one v2 record (see
// studyTemplateSchema.ts). The row count per owner is capped (`templatesMax`) and every body is
// size-bounded, so the table is never treated as an unbounded store.
//
// Concurrency: every change is a compare-and-swap on the row's `updated_at`, which each accepted
// write strictly advances. A second device editing the same template therefore gets an explicit
// `conflict` carrying the current record — never a silent last-writer-wins overwrite. A record a
// newer build wrote is never rewritten by this one (`newer_version`); it may still be deleted.
import type { DbResult, DbRow, WatchlistDb } from "@/lib/watchlists";
import {
  STUDY_TEMPLATE_KEY_RE,
  STUDY_TEMPLATE_LIMITS,
  buildStudyTemplateRecord,
  normalizeStudyTemplateRecord,
  sameTemplateName,
  studyTemplateBodyOf,
  studyTemplateSettingsKey,
  validateStudyTemplateWrite,
  type StudyTemplateRecord,
  type StudyTemplateWriteProblem,
} from "@/lib/studyTemplateSchema";

export type AccountStudyTemplate = StudyTemplateRecord & { newer: boolean };

type Row = { key: string; value: unknown; updatedAt: string };
type Stored = { row: Row; template: AccountStudyTemplate | null };

const rows = (result: DbResult): DbRow[] => (Array.isArray(result?.data) ? result.data : []);

const failure = (result: DbResult) => result.error?.message ?? "unavailable";

function readRow(raw: DbRow): Row | null {
  if (typeof raw.key !== "string" || !STUDY_TEMPLATE_KEY_RE.test(raw.key)) return null;
  return { key: raw.key, value: raw.value, updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : "" };
}

function parseStored(row: Row): Stored {
  const id = STUDY_TEMPLATE_KEY_RE.exec(row.key)?.[1] ?? "";
  const read = normalizeStudyTemplateRecord(row.value, { scope: "account", expectedId: id });
  return { row, template: read ? { ...read.record, newer: read.newer } : null };
}

const newestFirst = (a: AccountStudyTemplate, b: AccountStudyTemplate) =>
  (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.id.localeCompare(b.id);

async function readAll(db: WatchlistDb, userId: string): Promise<{ ok: true; stored: Stored[] } | { ok: false; error: string }> {
  const result = await db.from("workspace_settings").select("key,value,updated_at").eq("scope", "user").eq("user_id", userId);
  if (result.error) return { ok: false, error: failure(result) };
  const stored: Stored[] = [];
  for (const raw of rows(result)) {
    const row = readRow(raw);
    if (row) stored.push(parseStored(row));
  }
  return { ok: true, stored };
}

async function readOne(db: WatchlistDb, userId: string, id: string): Promise<{ ok: true; stored: Stored | null } | { ok: false; error: string }> {
  const result = await db.from("workspace_settings").select("key,value,updated_at")
    .eq("scope", "user").eq("user_id", userId).eq("key", studyTemplateSettingsKey(id)).limit(1);
  if (result.error) return { ok: false, error: failure(result) };
  const raw = rows(result)[0];
  const row = raw ? readRow(raw) : null;
  return { ok: true, stored: row ? parseStored(row) : null };
}

/** Strictly after the row's current stamp, so the next compare-and-swap can always tell writes apart. */
function nextStamp(current: string, now: Date): string {
  const previous = Date.parse(current);
  const at = Number.isFinite(previous) ? Math.max(now.getTime(), previous + 1) : now.getTime();
  return new Date(at).toISOString();
}

export type ListStudyTemplatesResult =
  | { ok: true; templates: AccountStudyTemplate[]; unreadable: number; truncated: boolean }
  | { ok: false; error: string };

/** Every readable template this owner holds, newest first. Unreadable rows are counted, never dropped. */
export async function listStudyTemplates(db: WatchlistDb, userId: string): Promise<ListStudyTemplatesResult> {
  const all = await readAll(db, userId);
  if (!all.ok) return all;
  const templates = all.stored.flatMap((s) => (s.template ? [s.template] : [])).sort(newestFirst);
  const unreadable = all.stored.length - templates.length;
  // The create cap bounds this list; a concurrent create can exceed it by a few, and those rows
  // must stay visible so they can be deleted. Only a pathological count is cut, and said so.
  const max = STUDY_TEMPLATE_LIMITS.templatesMax * 2;
  return { ok: true, templates: templates.slice(0, max), unreadable, truncated: templates.length > max };
}

export type StudyTemplateWriteResult =
  | { ok: true; template: AccountStudyTemplate }
  | { ok: false; status: StudyTemplateWriteProblem }
  | { ok: false; status: "name_taken"; existing: AccountStudyTemplate }
  | { ok: false; status: "limit_reached" | "not_found" | "invalid_id" }
  | { ok: false; status: "newer_version" | "conflict"; current: AccountStudyTemplate }
  | { ok: false; status: "unavailable"; error: string };

const ID_RE = /^[0-9a-f]{32}$/;

function nameClash(stored: Stored[], name: string, exceptId?: string): AccountStudyTemplate | null {
  for (const s of stored) {
    if (s.template && s.template.id !== exceptId && sameTemplateName(s.template.name, name)) return s.template;
  }
  return null;
}

export async function createStudyTemplate(
  db: WatchlistDb,
  userId: string,
  input: { name: unknown; body: unknown },
  options: { now?: Date; mintId?: () => string } = {},
): Promise<StudyTemplateWriteResult> {
  const valid = validateStudyTemplateWrite(input.name, input.body);
  if (!valid.ok) return { ok: false, status: valid.problem };
  const all = await readAll(db, userId);
  if (!all.ok) return { ok: false, status: "unavailable", error: all.error };
  const clash = nameClash(all.stored, valid.name);
  if (clash) return { ok: false, status: "name_taken", existing: clash };
  // Unreadable rows count too: they occupy real rows, and are never deleted behind the user's back.
  if (all.stored.length >= STUDY_TEMPLATE_LIMITS.templatesMax) return { ok: false, status: "limit_reached" };
  const id = (options.mintId ?? (() => crypto.randomUUID().replace(/-/g, "")))();
  if (!ID_RE.test(id)) return { ok: false, status: "invalid_id" };
  const now = (options.now ?? new Date()).toISOString();
  const record = buildStudyTemplateRecord({ id, name: valid.name, body: valid.body, revision: 1, createdAt: now, updatedAt: now });
  const result = await db.from("workspace_settings").insert({
    scope: "user",
    user_id: userId,
    key: studyTemplateSettingsKey(id),
    value: record,
    updated_at: now,
  });
  if (result.error) return { ok: false, status: "unavailable", error: failure(result) };
  return { ok: true, template: { ...record, newer: false } };
}

async function afterMissedSwap(db: WatchlistDb, userId: string, id: string): Promise<StudyTemplateWriteResult> {
  const again = await readOne(db, userId, id);
  if (!again.ok) return { ok: false, status: "unavailable", error: again.error };
  if (!again.stored?.template) return { ok: false, status: "not_found" };
  return { ok: false, status: "conflict", current: again.stored.template };
}

/**
 * Rename and/or replace the studies of one template. `baseRevision` is the revision the caller
 * last read; anything else answers `conflict` with the current record.
 */
export async function updateStudyTemplate(
  db: WatchlistDb,
  userId: string,
  input: { id: unknown; baseRevision: unknown; name?: unknown; body?: unknown },
  options: { now?: Date } = {},
): Promise<StudyTemplateWriteResult> {
  const id = typeof input.id === "string" ? input.id : "";
  if (!ID_RE.test(id)) return { ok: false, status: "invalid_id" };
  const all = await readAll(db, userId);
  if (!all.ok) return { ok: false, status: "unavailable", error: all.error };
  const current = all.stored.find((s) => s.row.key === studyTemplateSettingsKey(id));
  if (!current?.template) return { ok: false, status: "not_found" };
  const template = current.template;
  if (template.newer) return { ok: false, status: "newer_version", current: template };
  if (input.baseRevision !== template.revision) return { ok: false, status: "conflict", current: template };
  const valid = validateStudyTemplateWrite(
    input.name === undefined ? template.name : input.name,
    input.body === undefined ? studyTemplateBodyOf(template) : input.body,
  );
  if (!valid.ok) return { ok: false, status: valid.problem };
  const clash = nameClash(all.stored, valid.name, id);
  if (clash) return { ok: false, status: "name_taken", existing: clash };
  const stamp = nextStamp(current.row.updatedAt, options.now ?? new Date());
  const record = buildStudyTemplateRecord({
    id,
    name: valid.name,
    body: valid.body,
    revision: template.revision + 1,
    createdAt: template.createdAt || stamp,
    updatedAt: stamp,
  });
  const result = await db.from("workspace_settings")
    .update({ value: record, updated_at: stamp })
    .eq("scope", "user").eq("user_id", userId).eq("key", current.row.key).eq("updated_at", current.row.updatedAt)
    .select("key");
  if (result.error) return { ok: false, status: "unavailable", error: failure(result) };
  // No error is not proof of a write: zero matched rows means another writer moved first.
  if (rows(result).length !== 1) return afterMissedSwap(db, userId, id);
  return { ok: true, template: { ...record, newer: false } };
}

export type DeleteStudyTemplateResult =
  | { ok: true }
  | { ok: false; status: "not_found" | "invalid_id" }
  | { ok: false; status: "conflict"; current: AccountStudyTemplate }
  | { ok: false; status: "unavailable"; error: string };

/** Delete one template. With `baseRevision`, a template changed elsewhere since is not deleted. */
export async function deleteStudyTemplate(
  db: WatchlistDb,
  userId: string,
  input: { id: unknown; baseRevision?: unknown },
): Promise<DeleteStudyTemplateResult> {
  const id = typeof input.id === "string" ? input.id : "";
  if (!ID_RE.test(id)) return { ok: false, status: "invalid_id" };
  const one = await readOne(db, userId, id);
  if (!one.ok) return { ok: false, status: "unavailable", error: one.error };
  const stored = one.stored;
  if (!stored) return { ok: false, status: "not_found" };
  if (input.baseRevision !== undefined && stored.template && input.baseRevision !== stored.template.revision) {
    return { ok: false, status: "conflict", current: stored.template };
  }
  const result = await db.from("workspace_settings").delete()
    .eq("scope", "user").eq("user_id", userId).eq("key", stored.row.key).eq("updated_at", stored.row.updatedAt)
    .select("key");
  if (result.error) return { ok: false, status: "unavailable", error: failure(result) };
  if (rows(result).length !== 1) {
    const missed = await afterMissedSwap(db, userId, id);
    if (missed.ok) return { ok: false, status: "not_found" };
    if (missed.status === "conflict") return { ok: false, status: "conflict", current: missed.current };
    if (missed.status === "unavailable") return missed;
    return { ok: false, status: "not_found" };
  }
  return { ok: true };
}
