// Deterministic in-memory stand-in for the THREE user-state tables, used ONLY when
// `TERMINAL_E2E_FIXTURE=1` (the Playwright dev server). It implements the same structural
// `WatchlistDb` surface `lib/watchlists.ts` and `lib/portfolio.ts` call, so the e2e suite exercises
// the REAL service and route logic — the fixture replaces the transport, never the behaviour under
// test.
//
// Never reachable in production: `app/api/watchlist/route.ts` and `app/api/portfolio/route.ts` read
// the env flag once and fall through to the RLS'd Supabase server client otherwise.
//
// The three responsive browser projects share ONE dev server, so the store is keyed by the
// `mm_e2e_wl` cookie: a spec that wants isolation sets its own key and gets its own account-shaped
// world. Absent cookie -> the shared "default" store, seeded to match `app/terminal/page.tsx`'s
// guest/e2e symbols so specs that never opt in see exactly today's Default list.
//
// W5 added `portfolio_positions` to the SAME store on purpose. The semantic invariants the program
// is gated on (packet section 0 A-D: watchlist ops never move positions, position ops never move
// watchlist rows) are only provable if both tables live behind one account-shaped world — two
// separate fixtures would let a spec "prove" isolation that the product does not actually have.
// The positions table is seeded EMPTY: a new book has nothing in it, and every spec that wants
// rows creates them through the real route.

import type { DbResult, DbRow, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";

export const FIXTURE_STORE_COOKIE = "mm_e2e_wl";

/**
 * Fault-injection cookie — comma-separated tokens naming a transport failure to simulate.
 *
 * A failure state is only proven if the REAL code path produces it. Mocking `/api/portfolio` from
 * the browser proves the client renders a 503; it does not prove the server page, the canonical
 * read and the route agree about what a broken store is. This flips the transport underneath all
 * three at once, exactly where Supabase would fail.
 *
 * Tokens:
 *   - `positions_read` — every read of `portfolio_positions` answers the supabase-js failure
 *     shape `{data:null, error}`.
 *   - `positions_mutation_noop` — UPDATE/DELETE answers `{data:[], error:null}` and changes no
 *     rows. This is intentionally different from a hard error: it proves that lack of an error is
 *     not accepted as proof of an affected canonical row.
 *
 * Test-only by construction: like the rest of this module it is reachable only from the
 * `TERMINAL_E2E_FIXTURE=1` branches.
 */
export const FIXTURE_FAULT_COOKIE = "mm_e2e_fault";
export const FAULT_POSITIONS_READ = "positions_read";
export const FAULT_POSITIONS_MUTATION_NOOP = "positions_mutation_noop";
export const FAULT_THESES_READ = "theses_read";

export function fixtureFaults(raw: string | undefined | null): Set<string> {
  return new Set((raw || "").split(",").map((token) => token.trim()).filter(Boolean));
}

type Store = {
  lists: DbRow[];
  symbols: DbRow[];
  positions: DbRow[];
  theses: DbRow[];
  thesisVersions: DbRow[];
  seq: number;
};

const SEED_SYMBOLS: [string, string][] = [
  ["Crypto", "BTC-USD"], ["Crypto", "ETH-USD"], ["Equities", "NVDA"],
  ["Equities", "AAPL"], ["Equities", "MSFT"], ["Equities", "QQQ"],
];

// PROCESS-global, not module-global — and the difference is load-bearing.
//
// Next compiles Route Handlers and Server Components into different bundles, so a module-level
// `new Map()` is instantiated ONCE PER BUNDLE: `POST /api/portfolio` wrote into one map while
// `app/(shell)/portfolio/page.tsx` read an empty one in the same process, same request, same cookie
// key. Measured directly (2026-08-12): the route answered `GET /api/portfolio` with the position it
// had just created, and the page rendered `data-position-count="0"` immediately afterwards.
//
// Nothing exposed this before W5 — the watchlist route was the only fixture consumer, and the old
// portfolio page served a hardcoded constant instead of reading a store. Hanging the map off
// `globalThis` makes every bundle share the one store, which is what the thing being modelled (a
// single shared Supabase project) actually is.
//
// Test-only by construction: this file is reachable only from the `TERMINAL_E2E_FIXTURE` branches.
const GLOBAL_KEY = Symbol.for("mm.e2e.watchlistFixtureStores");
type FixtureGlobal = typeof globalThis & { [GLOBAL_KEY]?: Map<string, Store> };
const stores: Map<string, Store> = ((globalThis as FixtureGlobal)[GLOBAL_KEY] ??= new Map<string, Store>());

/** Stable synthetic owner id per actor key — the service still filters on it everywhere. */
export function fixtureUserId(key: string): string {
  return `e2e-user-${key}`;
}

// `database::actor` gives privacy tests two actors over one physical row set. Ordinary fixture
// keys contain no delimiter and therefore retain the historical one-key/one-world behavior.
function fixtureDatabaseKey(key: string): string {
  return key.split("::", 1)[0];
}

function seedStore(key: string): Store {
  const listId = `${key}-wl-default`;
  return {
    lists: [{ id: listId, user_id: fixtureUserId(key), name: "Default", position: 0 }],
    symbols: SEED_SYMBOLS.map(([section, symbol], index) => ({
      id: `${listId}-s${index}`,
      watchlist_id: listId,
      symbol,
      section,
      position: index,
    })),
    positions: [],
    theses: [],
    thesisVersions: [],
    seq: 0,
  };
}

export function fixtureStore(key: string): Store {
  const databaseKey = fixtureDatabaseKey(key);
  let store = stores.get(databaseKey);
  if (!store) {
    store = seedStore(databaseKey);
    stores.set(databaseKey, store);
  }
  return store;
}

/** Only for tests of the fixture transport itself. */
export function resetFixtureStores(): void {
  stores.clear();
}

type Table = "watchlists" | "watchlist_symbols" | "portfolio_positions" | "theses" | "thesis_versions";

export type FixtureDatabaseEvent = {
  source: "table" | "rpc";
  name: string;
  rowCount: number;
};

class FixtureQuery implements WatchlistQuery {
  private predicates: ((row: DbRow) => boolean)[] = [];
  private orderClauses: Array<{ key: string; ascending: boolean }> = [];
  private limitTo: number | null = null;
  private projection: string[] | null = null;
  private mode: "read" | "insert" | "upsert" | "update" | "delete" = "read";
  private payload: DbRow[] = [];
  private ignoreDuplicates = false;

  constructor(
    private store: Store,
    private table: Table,
    private faults: Set<string>,
    private observe?: (event: FixtureDatabaseEvent) => void,
  ) {}

  private get rows(): DbRow[] {
    if (this.table === "watchlists") return this.store.lists;
    if (this.table === "portfolio_positions") return this.store.positions;
    if (this.table === "theses") return this.store.theses;
    if (this.table === "thesis_versions") return this.store.thesisVersions;
    return this.store.symbols;
  }

  private matched(): DbRow[] {
    let matched = this.rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
    if (this.orderClauses.length) {
      matched = [...matched].sort((a, b) => {
        for (const { key, ascending } of this.orderClauses) {
          const left = a[key] as string | number;
          const right = b[key] as string | number;
          const comparison = left > right ? 1 : left < right ? -1 : 0;
          if (comparison) return comparison * (ascending ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.limitTo !== null) matched = matched.slice(0, this.limitTo);
    return matched;
  }

  private project(matched: DbRow[]): DbRow[] {
    const fields = this.projection;
    if (!fields) return matched.map((row) => ({ ...row }));
    return matched.map((row) => Object.fromEntries(fields.map((field) => [field, row[field]])));
  }

  select(fields?: string): WatchlistQuery {
    this.projection = fields && fields !== "*" ? fields.split(",").map((field) => field.trim()) : null;
    return this;
  }

  eq(column: string, value: unknown): WatchlistQuery {
    this.predicates.push((row) => {
      const jsonPath = column.match(/^subject_ref->>(owner|kind|key)$/);
      if (jsonPath) {
        const subject = row.subject_ref;
        return !!subject && typeof subject === "object"
          && (subject as Record<string, unknown>)[jsonPath[1]] === value;
      }
      return row[column] === value;
    });
    return this;
  }

  in(column: string, values: readonly unknown[]): WatchlistQuery {
    const set = new Set(values);
    this.predicates.push((row) => set.has(row[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): WatchlistQuery {
    this.orderClauses.push({ key: column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): WatchlistQuery {
    this.limitTo = count;
    return this;
  }

  insert(values: DbRow | DbRow[]): WatchlistQuery {
    this.mode = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: DbRow | DbRow[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): WatchlistQuery {
    this.mode = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    this.ignoreDuplicates = options?.ignoreDuplicates === true;
    return this;
  }

  update(values: DbRow): WatchlistQuery {
    this.mode = "update";
    this.payload = [values];
    return this;
  }

  delete(): WatchlistQuery {
    this.mode = "delete";
    return this;
  }

  private run(): DbResult {
    // Injected transport failure — the supabase-js shape, at the same place a real read fails.
    if (this.table === "portfolio_positions" && this.mode === "read" && this.faults.has(FAULT_POSITIONS_READ)) {
      return { data: null, error: { message: "fixture: positions store unavailable" } };
    }
    if ((this.table === "theses" || this.table === "thesis_versions")
      && this.mode === "read" && this.faults.has(FAULT_THESES_READ)) {
      return { data: null, error: { message: "fixture: thesis store unavailable" } };
    }
    if (this.table === "portfolio_positions"
      && (this.mode === "update" || this.mode === "delete")
      && this.faults.has(FAULT_POSITIONS_MUTATION_NOOP)) {
      return { data: [], error: null };
    }
    // F11's authenticated transport can read its own rows but can never mutate either table
    // directly. All accepted writes go through the one atomic RPC below, matching the production
    // grant/RLS posture instead of giving browser tests a more privileged database than users.
    if ((this.table === "theses" || this.table === "thesis_versions") && this.mode !== "read") {
      return { data: null, error: { message: `permission denied for table ${this.table}` } };
    }
    if (this.mode === "insert" || this.mode === "upsert") {
      const incoming: DbRow[] = this.payload.map((row) => ({
        id: `${this.table}-${++this.store.seq}`,
        // Server-side column DEFAULTS the writer never supplies (migration 0007): `created_at`
        // is `now()` and `status` is 'open'. Without them a fixture row sorts on `undefined` and
        // reads back with a null created_at, which the real table never does.
        ...(this.table === "portfolio_positions"
          ? { created_at: new Date().toISOString(), status: "open" }
          : {}),
        ...row,
      }));
      // The live schema's unique (user_id,name) is what makes the migration converge under a
      // race instead of duplicating a list — model it rather than accepting anything.
      if (this.table === "watchlists") {
        for (const row of incoming) {
          if (this.store.lists.some((list) => list.user_id === row.user_id && list.name === row.name)) {
            if (this.mode === "upsert" && this.ignoreDuplicates) continue;
            return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          }
        }
      }
      // …and unique (watchlist_id, symbol) since migration 0008. Modelling it here is what lets
      // the browser suite prove that concurrent adds converge on ONE row: without it the fixture
      // would happily hold the duplicates the real table now refuses, and an e2e "proof" of
      // uniqueness would be proving a property the product does not have.
      const accepted: DbRow[] = [];
      for (const row of incoming) {
        if (this.table === "watchlist_symbols") {
          const clash = this.store.symbols.some((existing) =>
            existing.watchlist_id === row.watchlist_id && existing.symbol === row.symbol)
            || accepted.some((queued) => queued.watchlist_id === row.watchlist_id && queued.symbol === row.symbol);
          if (clash) {
            if (this.mode === "upsert" && this.ignoreDuplicates) continue;
            return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          }
        }
        accepted.push(row);
      }
      this.rows.push(...accepted);
      return { data: this.project(accepted), error: null };
    }
    if (this.mode === "update") {
      const targets = this.matched();
      for (const row of targets) Object.assign(row, this.payload[0] ?? {});
      return { data: this.project(targets), error: null };
    }
    if (this.mode === "delete") {
      const matched = this.matched();
      const targets = new Set(matched);
      const kept = this.rows.filter((row) => !targets.has(row));
      if (this.table === "watchlists") {
        const removed = new Set([...targets].map((row) => row.id));
        this.store.lists = kept;
        // FK `on delete cascade` (0001_init.sql) — the symbol rows go with the list.
        this.store.symbols = this.store.symbols.filter((row) => !removed.has(row.watchlist_id));
        // NOTHING else cascades. `portfolio_positions` has no FK to a watchlist and is deliberately
        // untouched here: deleting a list must never delete a position (packet section 0, gate C).
      } else if (this.table === "portfolio_positions") {
        this.store.positions = kept;
      } else {
        this.store.symbols = kept;
      }
      // Supabase returns deleted rows only when the caller chained `.select(...)`; otherwise its
      // ordinary delete response carries `data:null`. The mutation-receipt service deliberately
      // selects the id, so the fixture must model that representation rather than invent success.
      return { data: this.projection ? this.project(matched) : null, error: null };
    }
    const data = this.project(this.matched());
    this.observe?.({ source: "table", name: this.table, rowCount: data.length });
    return { data, error: null };
  }

  async maybeSingle(): Promise<DbResult> {
    const result = this.run();
    const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null;
    return { data, error: result.error ?? null };
  }

  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function thesisRpcResult(row: DbRow): Promise<DbResult> {
  return Promise.resolve({
    data: [{
      status: null,
      thesis_id: null,
      version: null,
      current_version: null,
      lifecycle_state: null,
      replayed: false,
      ...row,
    }],
    error: null,
  });
}

function thesisSubstance(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const substance = { ...value as Record<string, unknown> };
  delete substance.revision_note;
  return substance;
}

/**
 * Account-shaped implementation of `apply_thesis_version_v1` for route and browser tests.
 *
 * There is deliberately no `await` between the read, compare, append and head advance. JavaScript
 * runs this critical section to completion before another caller can enter it, modelling the
 * database row lock/transaction at the transport boundary. The disposable Postgres canary remains
 * the authority for PL/pgSQL behavior; this fixture proves the application consumes that contract
 * without replacing it with two client-side statements.
 */
function applyThesisVersionFixture(store: Store, args: Record<string, unknown>): Promise<DbResult> {
  const userId = typeof args.__fixture_user_id === "string" ? args.__fixture_user_id : "";
  const thesisId = typeof args.p_thesis_id === "string" ? args.p_thesis_id : null;
  const expectedVersion = args.p_expected_version;
  const transition = args.p_transition;
  const subjectRef = args.p_subject_ref;
  const content = args.p_content;
  const requestId = args.p_client_request_id;
  const effectiveAt = typeof args.p_effective_at === "string" ? args.p_effective_at : null;
  if (!userId || typeof expectedVersion !== "number" || typeof transition !== "string"
    || !subjectRef || typeof subjectRef !== "object" || !content || typeof content !== "object"
    || typeof requestId !== "string") {
    return thesisRpcResult({ status: "invalid_transition" });
  }

  const fingerprint = canonical({ thesisId, expectedVersion, transition, subjectRef, content, effectiveAt });
  const prior = store.thesisVersions.find((row) => row.user_id === userId && row.client_request_id === requestId);
  if (prior) {
    if (prior.request_fingerprint !== fingerprint) return thesisRpcResult({ status: "idempotency_conflict" });
    return thesisRpcResult({
      status: "replayed",
      thesis_id: prior.thesis_id,
      version: prior.version,
      current_version: prior.version,
      lifecycle_state: prior.lifecycle_state,
      replayed: true,
    });
  }

  const now = new Date().toISOString();
  if (transition === "create") {
    if (thesisId !== null || expectedVersion !== 0) return thesisRpcResult({ status: "invalid_transition" });
    const id = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const head: DbRow = {
      id,
      user_id: userId,
      current_version: 1,
      lifecycle_state: "active",
      subject_ref: subjectRef,
      subject_digest: canonical(subjectRef),
      created_at: now,
      updated_at: now,
    };
    const version: DbRow = {
      id: versionId,
      thesis_id: id,
      user_id: userId,
      version: 1,
      previous_version: null,
      transition: "create",
      lifecycle_state: "active",
      subject_ref: subjectRef,
      content,
      client_request_id: requestId,
      request_fingerprint: fingerprint,
      system_recorded_at: now,
      effective_at: effectiveAt,
    };
    store.theses.push(head);
    store.thesisVersions.push(version);
    return thesisRpcResult({ status: "created", thesis_id: id, version: 1, current_version: 1, lifecycle_state: "active", replayed: false });
  }

  const head = store.theses.find((row) => row.id === thesisId && row.user_id === userId);
  if (!head) return thesisRpcResult({ status: "not_found" });
  if (head.current_version !== expectedVersion) {
    return thesisRpcResult({
      status: "version_conflict",
      current_version: head.current_version,
      lifecycle_state: head.lifecycle_state,
    });
  }
  if (canonical(head.subject_ref) !== canonical(subjectRef)) return thesisRpcResult({ status: "invalid_transition" });
  const current = store.thesisVersions.find((row) =>
    row.thesis_id === thesisId && row.user_id === userId && row.version === head.current_version);
  if (!current) return thesisRpcResult({ status: "invalid_transition" });
  if (transition !== "revise"
    && canonical(thesisSubstance(current.content)) !== canonical(thesisSubstance(content))) {
    return thesisRpcResult({ status: "invalid_transition" });
  }

  const currentState = head.lifecycle_state;
  let nextState: "active" | "archived" | "invalidated" | null = null;
  if (transition === "revise" && currentState === "active") nextState = "active";
  if (transition === "archive" && currentState === "active") nextState = "archived";
  if (transition === "invalidate" && currentState === "active") nextState = "invalidated";
  if (transition === "reopen" && (currentState === "archived" || currentState === "invalidated")) nextState = "active";
  if (!nextState) return thesisRpcResult({ status: "invalid_transition" });
  const contentRecord = content as Record<string, unknown>;
  if ((transition === "invalidate" || (transition === "reopen" && currentState === "invalidated"))
    && (typeof contentRecord.revision_note !== "string" || !contentRecord.revision_note.trim())) {
    return thesisRpcResult({ status: "invalid_transition" });
  }

  const version = Number(head.current_version) + 1;
  store.thesisVersions.push({
    id: crypto.randomUUID(),
    thesis_id: thesisId,
    user_id: userId,
    version,
    previous_version: head.current_version,
    transition,
    lifecycle_state: nextState,
    subject_ref: subjectRef,
    content,
    client_request_id: requestId,
    request_fingerprint: fingerprint,
    system_recorded_at: now,
    effective_at: effectiveAt,
  });
  head.current_version = version;
  head.lifecycle_state = nextState;
  head.updated_at = now;
  return thesisRpcResult({ status: "advanced", thesis_id: thesisId, version, current_version: version, lifecycle_state: nextState, replayed: false });
}

function readCurrentThesisVersionsFixture(store: Store, args: Record<string, unknown>): Promise<DbResult> {
  const userId = typeof args.__fixture_user_id === "string" ? args.__fixture_user_id : "";
  const thesisIds = args.p_thesis_ids;
  const versions = args.p_versions;
  if (!userId || !Array.isArray(thesisIds) || !Array.isArray(versions)
    || thesisIds.length < 1 || thesisIds.length > 500 || thesisIds.length !== versions.length) {
    return Promise.resolve({ data: [], error: null });
  }
  const data = thesisIds.flatMap((thesisId, index) => {
    const version = versions[index];
    const head = store.theses.find((candidate) => candidate.user_id === userId
      && candidate.id === thesisId && candidate.current_version === version);
    if (!head) return [];
    const row = store.thesisVersions.find((candidate) => candidate.user_id === userId
      && candidate.thesis_id === thesisId && candidate.version === version);
    if (!row || new Date(String(head.updated_at)).getTime() !== new Date(String(row.system_recorded_at)).getTime()) {
      return [];
    }
    const rawTitle = row?.content && typeof row.content === "object"
      ? (row.content as Record<string, unknown>).title
      : null;
    const title = typeof rawTitle === "string" && [...rawTitle].length >= 1 && [...rawTitle].length <= 160
      ? rawTitle
      : null;
    return [{
      id: row.id,
      thesis_id: row.thesis_id,
      version: row.version,
      lifecycle_state: row.lifecycle_state,
      subject_ref: row.subject_ref,
      title,
    }];
  });
  return Promise.resolve({ data, error: null });
}

export type FixtureDb = WatchlistDb & {
  rpc: (name: string, args: Record<string, unknown>) => Promise<DbResult>;
};

export function createFixtureDb(
  key: string,
  faults?: Iterable<string>,
  observe?: (event: FixtureDatabaseEvent) => void,
): FixtureDb {
  const store = fixtureStore(key);
  const faultSet = faults instanceof Set ? faults : new Set(faults ?? []);
  return {
    from: (table: string) => new FixtureQuery(store, table as Table, faultSet, observe),
    rpc: async (name: string, args: Record<string, unknown>) => {
      const fixtureArgs = { ...args, __fixture_user_id: fixtureUserId(key) };
      const result = await (name === "apply_thesis_version_v1"
        ? applyThesisVersionFixture(store, fixtureArgs)
        : name === "read_current_thesis_versions_v1"
          ? readCurrentThesisVersionsFixture(store, fixtureArgs)
          : Promise.resolve({ data: null, error: { message: `fixture: unknown rpc ${name}` } }));
      observe?.({
        source: "rpc",
        name,
        rowCount: Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0,
      });
      return result;
    },
  };
}
