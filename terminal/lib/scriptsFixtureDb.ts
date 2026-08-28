// Deterministic stand-in for the `saved_scripts` READ, used ONLY when `TERMINAL_E2E_FIXTURE=1`
// (the Playwright dev server). Same construction as lib/watchlistsFixtureDb.ts and
// lib/layoutsFixtureDb.ts: the fixture replaces the transport, never the behaviour under test.
//
// It exists because the C6 statement cannot be proved in a browser otherwise. The bug is that
// `saved_scripts` grants SELECT on **any** row with `is_public = true`, so "the signed-in user's
// scripts" and "rows this user may read" are different sets — and the seed below contains exactly
// that: a FOREIGN PUBLIC script alongside the owner's own. `visibleTo()` applies the real RLS
// predicate, so a query that forgets `user_id` gets the foreign row handed to it, and the spec's
// assertion is about the application filter rather than about an empty table.
//
// Read-only on purpose. Save/rename/delete keep going to Supabase: this seam exists to prove which
// rows the library SHOWS, and a writable fixture would be a second, divergent implementation of
// entitlement-gated writes for no additional proof.

export type FixtureScript = {
  id: string;
  user_id: string;
  name: string;
  source: string;
  lang: string;
  params: Record<string, unknown>;
  is_public: boolean;
  updated_at: string;
};

/** Per-test store key, so parallel viewport projects cannot see each other's seeds. */
export const SCRIPTS_STORE_COOKIE = "mm_e2e_scripts";
/** Any non-empty value makes the read fail, the way an outage would. */
export const SCRIPTS_FAULT_COOKIE = "mm_e2e_script_fault";

/** The signed-in owner in fixture mode. Mirrors the synthetic identity the other fixtures use. */
export const fixtureScriptUserId = (key: string) => `e2e-script-user-${key}`;
/** A DIFFERENT account, whose public script must never appear in the owner's library. */
export const fixtureOtherUserId = (key: string) => `e2e-script-other-${key}`;

function seed(key: string): FixtureScript[] {
  const base = { source: "//@version=6\nindicator('x')\nplot(close)", lang: "pine", params: {}, is_public: false };
  return [
    { ...base, id: `${key}-mine`, user_id: fixtureScriptUserId(key), name: "My Momentum", updated_at: "2026-08-03T00:00:00Z" },
    // A SECOND script owned by the same user. The editor's state contract (D3/D4) is only
    // observable by leaving a script and coming back to it — a save that looks lost, an unsaved
    // edit discarded without a decision, a ?id= that stops matching the visible script all need
    // somewhere to switch TO. Owned and private, so it changes nothing about the C6 ownership
    // assertion above; it just gives the library two editable rows instead of one.
    { ...base, id: `${key}-second`, user_id: fixtureScriptUserId(key), name: "My Reversion", source: "//@version=6\nindicator('second')\nplot(open)", updated_at: "2026-08-02T00:00:00Z" },
    // Owned by someone else and PUBLIC — readable under RLS, and never part of My Scripts.
    { ...base, id: `${key}-foreign`, user_id: fixtureOtherUserId(key), name: "Someone Else's Public Script", is_public: true, updated_at: "2026-08-04T00:00:00Z" },
  ];
}

// PROCESS-global for the reason spelled out in watchlistsFixtureDb: Route Handlers and Server
// Components are separate bundles, so a module-level Map would be instantiated once per bundle.
const GLOBAL_KEY = Symbol.for("mm.e2e.scriptFixtureStores");
type FixtureGlobal = typeof globalThis & { [GLOBAL_KEY]?: Map<string, FixtureScript[]> };
const stores: Map<string, FixtureScript[]> = ((globalThis as FixtureGlobal)[GLOBAL_KEY] ??= new Map());

function storeFor(key: string): FixtureScript[] {
  let rows = stores.get(key);
  if (!rows) { rows = seed(key); stores.set(key, rows); }
  return rows;
}

/** The REAL RLS predicate for `saved_scripts`: owner OR public. */
export const visibleTo = (rows: FixtureScript[], userId: string) =>
  rows.filter((r) => r.user_id === userId || r.is_public);

export type FixtureScriptRead =
  | { ok: true; scripts: Omit<FixtureScript, "user_id" | "is_public">[] }
  | { ok: false };

/**
 * The owner-scoped read the route performs, against the fixture store. `ownerScoped: false` is what
 * the route USED to do and is what the spec's counterfactual asserts against.
 */
export function readFixtureScripts(key: string, fault: boolean, ownerScoped = true): FixtureScriptRead {
  if (fault) return { ok: false };
  const userId = fixtureScriptUserId(key);
  const visible = visibleTo(storeFor(key), userId);
  const rows = ownerScoped ? visible.filter((r) => r.user_id === userId) : visible;
  return {
    ok: true,
    scripts: rows
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(({ id, name, source, lang, params, updated_at }) => ({ id, name, source, lang, params, updated_at })),
  };
}
