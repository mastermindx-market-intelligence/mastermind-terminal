// E05 — the Playwright fixture transport for `public.watchlist_annotations`.
//
// It emulates exactly the slice of the Supabase query builder `supabaseAnnotationStore` calls, so
// the e2e world runs the SHIPPED adapter — its compare-and-set, its insert/retry and its
// already-applied recognition — rather than a second implementation of them. It deliberately does
// NOT emulate RLS: a query returns every row its `.eq()` filters match. One physical row set
// serves every actor of a database key (`db::alice`, `db::bob`), so an adapter that forgot its
// `user_id` filter would visibly leak one actor's notes to the other (AC-E05-01).
//
// Test-only by construction: the route reaches it only behind `TERMINAL_E2E_FIXTURE=1`.

import type { AnnotationDb } from "@/lib/watchlistAnnotationsStore";

/** `mm_e2e_fault` tokens (comma-separated, read with `fixtureFaults`). */
export const FAULT_ANNOTATIONS_READ = "annotations_read";
/** Every write fails and lands nothing. */
export const FAULT_ANNOTATIONS_WRITE = "annotations_write";
/** Every write that changes a row LANDS, then its response is lost — the "uncertain save" case. */
export const FAULT_ANNOTATIONS_WRITE_UNCERTAIN = "annotations_write_uncertain";
/** The table does not exist yet (0033 unapplied). */
export const FAULT_ANNOTATIONS_UNAVAILABLE = "annotations_unavailable";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string };
type DbResult = { data?: unknown; error?: DbError | null };

const GLOBAL_KEY = Symbol.for("mm.e2e.watchlistAnnotationStores");
type FixtureGlobal = typeof globalThis & { [GLOBAL_KEY]?: Map<string, Row[]> };
// Process-global for the same reason as `watchlistsFixtureDb`: route bundles are separate module
// instances, and the thing modelled is one shared database.
const stores: Map<string, Row[]> = ((globalThis as FixtureGlobal)[GLOBAL_KEY] ??= new Map<string, Row[]>());

const databaseKey = (key: string) => key.split("::", 1)[0];

function rowsFor(key: string): Row[] {
  const db = databaseKey(key);
  let rows = stores.get(db);
  if (!rows) {
    rows = [];
    stores.set(db, rows);
  }
  return rows;
}

/** Only for tests of the fixture transport itself. */
export function resetFixtureAnnotationStores(): void {
  stores.clear();
}

/** Raw rows of one database key (every actor) — unit tests inspect ownership with it. */
export function fixtureAnnotationRows(key: string): Row[] {
  return rowsFor(key).map((row) => ({ ...row }));
}

const MISSING: DbError = { code: "42P01", message: 'relation "public.watchlist_annotations" does not exist' };

type Op = { kind: "select" } | { kind: "update"; values: Row } | { kind: "insert"; values: Row };

class FixtureQuery {
  private op: Op = { kind: "select" };
  private returning = false;
  private filters: [string, unknown][] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;

  constructor(private readonly rows: Row[], private readonly table: string, private readonly faults: Set<string>) {}

  select() { if (this.op.kind !== "select") this.returning = true; return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orderBy = { column, ascending: options?.ascending !== false }; return this; }
  limit(count: number) { this.max = count; return this; }
  insert(values: Row) { this.op = { kind: "insert", values }; return this; }
  update(values: Row) { this.op = { kind: "update", values }; return this; }

  maybeSingle(): PromiseLike<DbResult> {
    return { then: (resolve, reject) => Promise.resolve().then(() => this.run(true)).then(resolve, reject) };
  }

  then<A = DbResult, B = never>(resolve?: ((value: DbResult) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run(false)).then(resolve, reject);
  }

  private matches(row: Row) {
    return this.filters.every(([column, value]) => row[column] === value);
  }

  private run(single: boolean): DbResult {
    if (this.table !== "watchlist_annotations") return { error: { message: `fixture has no table ${this.table}` } };
    if (this.faults.has(FAULT_ANNOTATIONS_UNAVAILABLE)) return { error: MISSING };
    const op = this.op;
    if (op.kind === "select") {
      if (!single && this.faults.has(FAULT_ANNOTATIONS_READ)) return { error: { message: "fixture annotations read fault" } };
      let found = this.rows.filter((row) => this.matches(row)).map((row) => ({ ...row }));
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        found.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
      }
      if (this.max !== null) found = found.slice(0, this.max);
      if (single) return found.length > 1 ? { error: { message: "multiple rows" } } : { data: found[0] ?? null, error: null };
      return { data: found, error: null };
    }
    if (this.faults.has(FAULT_ANNOTATIONS_WRITE)) return { error: { message: "fixture annotations write fault" } };
    let affected: Row[];
    if (op.kind === "insert") {
      const values = op.values;
      if (typeof values.user_id !== "string" || typeof values.symbol !== "string") return { error: { message: "null value in column", code: "23502" } };
      if (this.rows.some((row) => row.user_id === values.user_id && row.symbol === values.symbol)) {
        return { error: { message: "duplicate key value violates unique constraint", code: "23505" } };
      }
      const row: Row = {
        note: null, note_revision: 0, note_updated_at: null,
        flag: null, flag_revision: 0, flag_updated_at: null,
        updated_at: null,
        ...values,
      };
      this.rows.push(row);
      affected = [row];
    } else {
      affected = this.rows.filter((row) => this.matches(row));
      for (const row of affected) Object.assign(row, op.values);
    }
    // The write landed; with this fault the caller never hears so. A statement that changed
    // nothing has nothing to lose, so it answers normally — which is what lets a retry discover
    // that its own earlier write is already there.
    if (this.faults.has(FAULT_ANNOTATIONS_WRITE_UNCERTAIN) && affected.length > 0) return { error: { message: "fixture annotations response lost" } };
    return { data: this.returning ? affected.map((row) => ({ ...row })) : null, error: null };
  }
}

/** A Supabase-shaped client over the fixture row set of `key`'s database. */
export function createFixtureAnnotationDb(key: string, faults: Set<string> = new Set()): AnnotationDb {
  const rows = rowsFor(key);
  return { from: (table: string) => new FixtureQuery(rows, table, faults) as unknown as ReturnType<AnnotationDb["from"]> };
}
