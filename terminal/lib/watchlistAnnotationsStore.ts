// E05 — server half of cross-device watchlist notes/flags: the store port, the Supabase adapter,
// and the batch applier the route calls.
//
// Ownership is enforced twice, the way every owner-scoped table in this estate is: RLS on
// `public.watchlist_annotations` (0033) restricts each row to `auth.uid()`, and every query below
// is ALSO filtered on the caller's user id. The second filter is what the e2e fixture store proves
// (two actors over one physical row set), so the code path cannot lean on RLS alone.
//
// Writes are field-level compare-and-set. `update … where <field>_revision = base` either moves
// that one field forward or matches nothing; nothing ever overwrites a field whose revision moved
// since the writer last read it. A zero-row update is resolved by reading the current field:
//   * the server already holds the requested value → `ok` at the existing revision (this is how a
//     retry of a write whose response was lost is recognised as already applied, AC-E05-04);
//   * otherwise → `conflict`, carrying the current text so the client can show both (AC-E05-03).

import {
  ANNOTATION_READ_LIMIT,
  recordField,
  type AnnotationField,
  type AnnotationRecord,
  type AnnotationWrite,
  type AnnotationWriteResult,
} from "@/lib/watchlistAnnotations";

export const ANNOTATIONS_TABLE = "watchlist_annotations";
const COLUMNS = "symbol,note,note_revision,note_updated_at,flag,flag_revision,flag_updated_at";

export type AnnotationListResult =
  | { ok: true; records: AnnotationRecord[]; complete: boolean }
  | { ok: false; reason: "unavailable" | "error"; error: string };

export type StoreWriteResult = AnnotationWriteResult | { status: "unavailable"; error: string };

/** Everything the route needs from a backing store. Both adapters satisfy it. */
export interface AnnotationStore {
  list(userId: string): Promise<AnnotationListResult>;
  write(userId: string, write: AnnotationWrite, now: string): Promise<StoreWriteResult>;
}

type DbError = { message?: string; code?: string } | null | undefined;
type DbResult = { data?: unknown; error?: DbError };
type Query = PromiseLike<DbResult> & {
  select: (columns?: string) => Query;
  eq: (column: string, value: unknown) => Query;
  order: (column: string, options?: { ascending?: boolean }) => Query;
  limit: (count: number) => Query;
  insert: (values: Record<string, unknown>) => Query;
  update: (values: Record<string, unknown>) => Query;
  maybeSingle: () => PromiseLike<DbResult>;
};
/** Structural subset of the Supabase client this adapter calls (unit tests supply a stand-in). */
export type AnnotationDb = { from: (table: string) => Query };

/** The table (or a column of it) does not exist yet — 0033 is unapplied. Not a transient failure. */
export function isSchemaMissing(error: DbError): boolean {
  const code = error?.code ?? "";
  if (code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204") return true;
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("watchlist_annotations") && (message.includes("does not exist") || message.includes("schema cache"));
}

const FIELD_COLUMNS: Record<AnnotationField, { value: string; revision: string; at: string }> = {
  note: { value: "note", revision: "note_revision", at: "note_updated_at" },
  flag: { value: "flag", revision: "flag_revision", at: "flag_updated_at" },
};

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const revision = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

export function rowToRecord(row: Record<string, unknown>): AnnotationRecord {
  return {
    symbol: String(row.symbol ?? ""),
    note: text(row.note),
    noteRevision: revision(row.note_revision),
    noteUpdatedAt: text(row.note_updated_at),
    flag: text(row.flag),
    flagRevision: revision(row.flag_revision),
    flagUpdatedAt: text(row.flag_updated_at),
  };
}

const rowsOf = (result: DbResult): Record<string, unknown>[] =>
  (Array.isArray(result.data) ? result.data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : []);

function fieldResult(record: AnnotationRecord | null, write: AnnotationWrite, status: "ok" | "conflict"): AnnotationWriteResult {
  const current = recordField(record, write.field);
  return { symbol: write.symbol, field: write.field, status, revision: current.revision, value: current.value, updatedAt: current.updatedAt };
}

function failure(write: AnnotationWrite, error: DbError): StoreWriteResult {
  if (isSchemaMissing(error)) return { status: "unavailable", error: error?.message || "annotations table missing" };
  return { symbol: write.symbol, field: write.field, status: "error", revision: 0, value: null, updatedAt: null };
}

export function supabaseAnnotationStore(db: AnnotationDb): AnnotationStore {
  const casUpdate = (userId: string, write: AnnotationWrite, now: string) => {
    const columns = FIELD_COLUMNS[write.field];
    return db.from(ANNOTATIONS_TABLE)
      .update({ [columns.value]: write.value, [columns.revision]: write.baseRevision + 1, [columns.at]: now, updated_at: now })
      .eq("user_id", userId)
      .eq("symbol", write.symbol)
      .eq(columns.revision, write.baseRevision)
      .select(COLUMNS);
  };

  return {
    async list(userId) {
      let result: DbResult;
      try {
        result = await db.from(ANNOTATIONS_TABLE)
          .select(COLUMNS)
          .eq("user_id", userId)
          .order("symbol", { ascending: true })
          .limit(ANNOTATION_READ_LIMIT);
      } catch (error) {
        // A driver that throws is a failed read, never an empty one.
        return { ok: false, reason: "error", error: error instanceof Error ? error.message : "read threw" };
      }
      if (result.error) {
        return { ok: false, reason: isSchemaMissing(result.error) ? "unavailable" : "error", error: result.error.message || "read failed" };
      }
      const records = rowsOf(result).map(rowToRecord).filter((record) => !!record.symbol);
      return { ok: true, records, complete: records.length < ANNOTATION_READ_LIMIT };
    },

    async write(userId, write, now) {
      try {
        return await writeField(userId, write, now);
      } catch {
        // A thrown driver error leaves the outcome unknown: report `error` so the client keeps the
        // edit pending and retries; a retry that finds its own value already there resolves `ok`.
        return { symbol: write.symbol, field: write.field, status: "error", revision: 0, value: null, updatedAt: null };
      }
    },
  };

  async function writeField(userId: string, write: AnnotationWrite, now: string): Promise<StoreWriteResult> {
    const columns = FIELD_COLUMNS[write.field];
    const first = await casUpdate(userId, write, now);
    if (first.error) return failure(write, first.error);
    const updated = rowsOf(first)[0];
    if (updated) return fieldResult(rowToRecord(updated), write, "ok");

    if (write.baseRevision === 0 && write.value !== null) {
      // Nothing matched at revision 0: either there is no row yet, or the row exists and this
      // field moved. Insert; a unique violation means a row appeared (another device, or the
      // other field), so take the compare-and-set once more against it.
      const inserted = await db.from(ANNOTATIONS_TABLE)
        .insert({ user_id: userId, symbol: write.symbol, [columns.value]: write.value, [columns.revision]: 1, [columns.at]: now, updated_at: now })
        .select(COLUMNS);
      if (!inserted.error) {
        const row = rowsOf(inserted)[0];
        if (row) return fieldResult(rowToRecord(row), write, "ok");
      } else if (inserted.error.code !== "23505") {
        return failure(write, inserted.error);
      }
      const retry = await casUpdate(userId, write, now);
      if (retry.error) return failure(write, retry.error);
      const retried = rowsOf(retry)[0];
      if (retried) return fieldResult(rowToRecord(retried), write, "ok");
    }

    const current = await db.from(ANNOTATIONS_TABLE)
      .select(COLUMNS)
      .eq("user_id", userId)
      .eq("symbol", write.symbol)
      .maybeSingle();
    if (current.error) return failure(write, current.error);
    const record = current.data && typeof current.data === "object" ? rowToRecord(current.data as Record<string, unknown>) : null;
    // The server already holds exactly this value: the write is (or was) applied — a retried
    // request whose first response was lost lands here rather than as a false conflict.
    return fieldResult(record, write, recordField(record, write.field).value === write.value ? "ok" : "conflict");
  }
}

export type ApplyWritesOutcome =
  | { kind: "results"; results: AnnotationWriteResult[] }
  | { kind: "unavailable"; error: string }
  | { kind: "failed"; results: AnnotationWriteResult[] };

/**
 * Apply a normalized batch one write at a time (bounded: ≤ ANNOTATION_WRITE_BATCH_MAX). Order is
 * the client's order; a later write never depends on an earlier one because every symbol+field
 * appears at most once. A missing table stops the batch — nothing after it could land either.
 */
export async function applyAnnotationWrites(
  store: AnnotationStore,
  userId: string,
  writes: AnnotationWrite[],
  invalid: AnnotationWriteResult[],
  now: string,
): Promise<ApplyWritesOutcome> {
  const results: AnnotationWriteResult[] = [...invalid];
  for (const write of writes) {
    const result = await store.write(userId, write, now);
    if (result.status === "unavailable") return { kind: "unavailable", error: result.error };
    results.push(result);
  }
  // Every write failed at the store: that is a failed request, not a 200 full of errors. The
  // client keeps all of them pending either way; the status code keeps logs and probes honest.
  if (writes.length > 0 && results.every((result) => result.status === "error" || result.status === "invalid")
      && results.some((result) => result.status === "error")) {
    return { kind: "failed", results };
  }
  return { kind: "results", results };
}
