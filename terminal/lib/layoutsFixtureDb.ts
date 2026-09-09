// Deterministic in-memory stand-in for `chart_layouts`, used ONLY when `TERMINAL_E2E_FIXTURE=1`
// (the Playwright dev server). It implements the structural `LayoutDb` surface `lib/layouts.ts`
// calls, so the browser suite exercises the REAL service and route logic — the fixture replaces the
// transport, never the behaviour under test. Same construction as `lib/watchlistsFixtureDb.ts`.
//
// Two things it models that a naive stub would not, because the packet's proofs depend on them:
//
//  1. THE DATABASE INVARIANT. The store enforces `unique (user_id, name)` itself — an INSERT onto a
//     taken name answers `{code:"23505"}` and `upsert(onConflict:"user_id,name")` updates in place.
//     So "two concurrent saves leave exactly one row" is proved against a store that behaves like
//     the post-`0008` schema, not against UI debouncing. (The fixture therefore always models the
//     APPLIED world; the unapplied-DDL fallback path in lib/layouts.ts is covered by unit tests,
//     which can return 42P10 on demand.)
//
//  2. FAULT INJECTION. Production Supabase must never be broken to prove an error state, so the
//     store fails on request instead: the `mm_e2e_layout_fault` cookie makes the matching operation
//     class answer a transport error, exactly as an outage would.
//
// Never reachable in production: `app/api/layouts/route.ts` reads the env flag once and otherwise
// falls through to the RLS'd Supabase server client.

import type { LayoutDb, LayoutDbResult, LayoutQuery, LayoutRow } from "@/lib/layouts";

/** Per-test store key, so the three parallel viewport projects cannot see each other's writes. */
export const LAYOUT_STORE_COOKIE = "mm_e2e_layouts";
/** Operation class that should fail: `list` | `save` | `delete` | `all`. */
export const LAYOUT_FAULT_COOKIE = "mm_e2e_layout_fault";
/** Renders the workspace as a signed-out visitor (page prop + API auth), for the guest-gate spec. */
export const GUEST_COOKIE = "mm_e2e_guest";
/** Team id this fixture session belongs to. Empty means the session is on no team. */
export const LAYOUT_TEAM_COOKIE = "mm_e2e_layout_team";
/** owner | admin | member. Default member. */
export const LAYOUT_TEAM_ROLE_COOKIE = "mm_e2e_layout_role";

export type LayoutFault = "list" | "save" | "delete" | "all" | "";
export type LayoutTeamRole = "owner" | "admin" | "member";

export type LayoutTeamContext = { teamId: string; role: LayoutTeamRole; teamName?: string };

type Store = { rows: LayoutRow[]; seq: number };

// PROCESS-global for the reason spelled out in watchlistsFixtureDb: Next compiles Route Handlers
// and Server Components into different bundles, so a module-level Map would be instantiated once
// per bundle and the two would silently disagree about the same account's rows.
const GLOBAL_KEY = Symbol.for("mm.e2e.layoutFixtureStores");
const TEAM_GLOBAL_KEY = Symbol.for("mm.e2e.layoutFixtureTeamStores");
type FixtureGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, Store>;
  [TEAM_GLOBAL_KEY]?: Map<string, Store>;
};
const stores: Map<string, Store> = ((globalThis as FixtureGlobal)[GLOBAL_KEY] ??= new Map<string, Store>());
const teamStores: Map<string, Store> = ((globalThis as FixtureGlobal)[TEAM_GLOBAL_KEY] ??= new Map<string, Store>());

/** Stable synthetic owner id per store key — the service still filters on it everywhere. */
export function fixtureLayoutUserId(key: string): string {
  return `e2e-layout-user-${key}`;
}

function storeFor(key: string): Store {
  let store = stores.get(key);
  if (!store) { store = { rows: [], seq: 0 }; stores.set(key, store); }
  return store;
}

const transportFault = (): LayoutDbResult => ({ error: { code: "XX000", message: "fixture transport fault" } });

type Op =
  | { kind: "select" }
  | { kind: "insert"; values: LayoutRow }
  | { kind: "update"; values: LayoutRow }
  | { kind: "upsert"; values: LayoutRow }
  | { kind: "delete" };

/** Which fault class an operation belongs to, so one cookie can target reads or writes. */
const faultClassOf = (op: Op): LayoutFault => (op.kind === "select" ? "list" : op.kind === "delete" ? "delete" : "save");

/** `column` is either a plain row column ("user_id", "name", "id") or a PostgREST JSON-path
 *  reference ("config->>revision"). The `->>` operator always yields TEXT, so a path read is
 *  stringified (never a raw number/boolean) and a missing key or non-object base reads as `null` —
 *  the same "NULL never satisfies eq/neq" semantics real Postgres gives a still-legacy row that has
 *  no `config.schema` key at all (see the `LayoutQuery` doc-comment in `lib/layouts.ts`). */
function readPath(row: LayoutRow, column: string): unknown {
  const idx = column.indexOf("->>");
  if (idx === -1) return row[column];
  const base = row[column.slice(0, idx)];
  if (typeof base !== "object" || base === null || Array.isArray(base)) return null;
  const val = (base as Record<string, unknown>)[column.slice(idx + 3)];
  return val === undefined || val === null ? null : String(val);
}

type Filter = { column: string; op: "eq" | "neq" | "is"; value: unknown };

function filterMatches(row: LayoutRow, filter: Filter): boolean {
  const actual = readPath(row, filter.column);
  switch (filter.op) {
    case "eq": return actual !== null && actual === filter.value;
    // SQL `<>` semantics: NULL is never distinct-or-equal to anything under `neq`/`eq` — it simply
    // never satisfies either. Callers that need "no value OR a different value" use `is`+`neq` as
    // two disjoint attempts (see `saveWorkspace`'s migrate-on-write guard).
    case "neq": return actual !== null && actual !== filter.value;
    case "is": return filter.value === null ? actual === null : actual === filter.value;
  }
}

function teamStoreFor(teamId: string): Store {
  let store = teamStores.get(teamId);
  if (!store) { store = { rows: [], seq: 0 }; teamStores.set(teamId, store); }
  return store;
}

export function fixtureTeamName(teamId: string): string {
  return "Desk";
}

export function createLayoutFixtureDb(key: string, fault: LayoutFault = "", team?: LayoutTeamContext | null): LayoutDb {
  const store = storeFor(key);
  const userId = fixtureLayoutUserId(key);
  const teamId = team?.teamId ?? "";
  const role: LayoutTeamRole = team?.role ?? "member";
  const teamName = team?.teamName || (teamId ? fixtureTeamName(teamId) : "");
  const canWriteTeam = role === "owner" || role === "admin";

  const allLayoutRows = (): LayoutRow[] => {
    const rows = [...store.rows];
    for (const ts of teamStores.values()) rows.push(...ts.rows);
    return rows;
  };

  // Production SELECT is owner-policy OR team-read policy. A foreign shared row must not load
  // on `eq("id")` just because it lives in a process-global team store.
  const visibleOnSelect = (row: LayoutRow): boolean => {
    if (row.visibility === "team" && typeof row.team_id === "string" && row.team_id) {
      if (row.user_id === userId) return true;
      return !!teamId && row.team_id === teamId;
    }
    return true;
  };

  const canTouchTeamRow = (row: LayoutRow): boolean => {
    if (row.visibility !== "team") return true;
    return canWriteTeam && !!teamId && row.team_id === teamId;
  };

  const removeLayoutRow = (row: LayoutRow) => {
    store.rows = store.rows.filter((r) => r !== row);
    for (const ts of teamStores.values()) ts.rows = ts.rows.filter((r) => r !== row);
  };

  const placeLayoutRow = (row: LayoutRow) => {
    removeLayoutRow(row);
    if (row.visibility === "team" && typeof row.team_id === "string" && row.team_id) {
      teamStoreFor(row.team_id).rows.push(row);
    } else {
      store.rows.push(row);
    }
  };

  const build = (table: string): LayoutQuery => {
    let op: Op = { kind: "select" };
    const filters: Filter[] = [];
    let inFilter: { column: string; values: unknown[] } | null = null;
    let sort: { column: string; ascending: boolean } | null = null;

    const matches = (row: LayoutRow) =>
      filters.every((f) => filterMatches(row, f)) &&
      (!inFilter || inFilter.values.includes(row[inFilter.column]));

    const nameCollision = (row: LayoutRow, newName: unknown): boolean =>
      store.rows.some((r) => r !== row && r.user_id === row.user_id && r.name === newName);

    const teamNameCollision = (row: LayoutRow, team: string, newName: unknown): boolean => {
      const ts = teamStores.get(team);
      return !!ts && ts.rows.some((r) => r !== row && r.name === newName && r.visibility === "team");
    };

    const run = (): LayoutDbResult => {
      if (table === "team_members") {
        if (!teamId) return { data: [] };
        const rows: LayoutRow[] = [{ team_id: teamId, user_id: userId, role }];
        return { data: rows.filter(matches).map((r) => ({ ...r })) };
      }
      if (table === "teams") {
        if (!teamId) return { data: [] };
        const rows: LayoutRow[] = [{ id: teamId, name: teamName, created_at: "2026-01-01T00:00:00.000Z" }];
        return { data: rows.filter(matches).map((r) => ({ ...r })) };
      }
      if (fault === "all" || (fault && fault === faultClassOf(op))) return transportFault();
      switch (op.kind) {
        case "select": {
          let rows = allLayoutRows().filter(matches).filter(visibleOnSelect);
          if (sort) {
            const { column, ascending } = sort;
            rows = [...rows].sort((a, b) => String(a[column] ?? "").localeCompare(String(b[column] ?? "")) * (ascending ? 1 : -1));
          }
          return { data: rows.map((r) => ({ ...r })) };
        }
        case "insert": {
          const values: LayoutRow = { visibility: "private", team_id: null, ...op.values };
          if (values.visibility === "team") {
            const tid = typeof values.team_id === "string" ? values.team_id : "";
            if (!canWriteTeam || !tid || tid !== teamId) return { error: { code: "42501", message: "insufficient privilege" } };
            if (tid && teamNameCollision({} as LayoutRow, tid, values.name)) {
              return { error: { code: "23505", message: "duplicate key value violates unique constraint chart_layouts_team_name" } };
            }
          } else if (store.rows.some((r) => r.user_id === values.user_id && r.name === values.name)) {
            return { error: { code: "23505", message: "duplicate key value violates unique constraint chart_layouts_user_name" } };
          }
          const dest = values.visibility === "team" && typeof values.team_id === "string" ? teamStoreFor(values.team_id) : store;
          const row: LayoutRow = { id: `layout-${key}-${++dest.seq}`, created_at: new Date().toISOString(), ...values };
          dest.rows.push(row);
          return { data: [{ ...row }] };
        }
        case "update": {
          const hit = allLayoutRows().filter(matches);
          const updateValues = op.values;
          const becomingTeam = updateValues.visibility === "team";
          if (becomingTeam) {
            const tid = typeof updateValues.team_id === "string" ? updateValues.team_id : "";
            if (!canWriteTeam || !tid || tid !== teamId) return { error: { code: "42501", message: "insufficient privilege" } };
          }
          if (hit.some((r) => r.visibility === "team" && !canTouchTeamRow(r))) {
            return { error: { code: "42501", message: "insufficient privilege" } };
          }
          const newName = updateValues.name;
          if (typeof newName === "string" && hit.some((row) => nameCollision(row, newName))) {
            return { error: { code: "23505", message: "duplicate key value violates unique constraint chart_layouts_user_name" } };
          }
          for (const row of hit) {
            const nextTeam = typeof updateValues.team_id === "string" ? updateValues.team_id : typeof row.team_id === "string" ? row.team_id : "";
            const nextName = typeof newName === "string" ? newName : row.name;
            if ((becomingTeam || row.visibility === "team") && nextTeam && teamNameCollision(row, nextTeam, nextName)) {
              return { error: { code: "23505", message: "duplicate key value violates unique constraint chart_layouts_team_name" } };
            }
          }
          for (const row of hit) {
            Object.assign(row, updateValues);
            placeLayoutRow(row);
          }
          return { data: hit.map((r) => ({ ...r })) };
        }
        case "upsert": {
          const values: LayoutRow = { visibility: "private", team_id: null, ...op.values };
          const existing = store.rows.find((r) => r.user_id === values.user_id && r.name === values.name);
          if (existing) { Object.assign(existing, values); return { data: [{ ...existing }] }; }
          const row: LayoutRow = { id: `layout-${key}-${++store.seq}`, created_at: new Date().toISOString(), ...values };
          store.rows.push(row);
          return { data: [{ ...row }] };
        }
        case "delete": {
          const hit = allLayoutRows().filter(matches);
          if (hit.some((r) => r.visibility === "team" && !canTouchTeamRow(r))) {
            return { error: { code: "42501", message: "insufficient privilege" } };
          }
          for (const row of hit) removeLayoutRow(row);
          return { data: hit.map((r) => ({ ...r })) };
        }
      }
    };

    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push({ column, op: "eq", value }); return query; },
      neq: (column: string, value: unknown) => { filters.push({ column, op: "neq", value }); return query; },
      is: (column: string, value: null | boolean) => { filters.push({ column, op: "is", value }); return query; },
      in: (column: string, values: unknown[]) => { inFilter = { column, values }; return query; },
      order: (column: string, options?: { ascending?: boolean }) => { sort = { column, ascending: options?.ascending !== false }; return query; },
      limit: () => query,
      insert: (values: LayoutRow) => { op = { kind: "insert", values }; return query; },
      update: (values: LayoutRow) => { op = { kind: "update", values }; return query; },
      upsert: (values: LayoutRow) => { op = { kind: "upsert", values }; return query; },
      delete: () => { op = { kind: "delete" }; return query; },
      maybeSingle: async () => { const r = run(); return r.error ? r : { data: (r.data as LayoutRow[])[0] ?? null }; },
      then: (resolve: (value: LayoutDbResult) => unknown) => Promise.resolve(run()).then(resolve),
    } as unknown as LayoutQuery;
    return query;
  };

  return { from: (table?: string) => build(table || "chart_layouts") };
}

/** Direct, synchronous store access for tests that need to simulate a concurrent write landing
 *  BETWEEN a caller's read and its own conditional write (the CAS-refusal proof in
 *  `workspacePersistence.test.ts`) — a real race is not reproducible in single-threaded Node, so the
 *  test manufactures the interleaving explicitly instead. Never used by production code. */
export function pokeLayoutFixtureRow(key: string, userId: string, name: string, patch: LayoutRow): void {
  const store = storeFor(key);
  const row = store.rows.find((r) => r.user_id === userId && r.name === name);
  if (row) Object.assign(row, patch);
}
