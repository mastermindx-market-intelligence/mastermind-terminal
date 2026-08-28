"use client";
// ── Custom-script data layer ────────────────────────────────────────────────────────────────────
// Client module that owns Pine-script CRUD with the app's dual-tier persistence, mirroring how the
// watchlist and named-lists do it:
//   • signed-in users → the `saved_scripts` Supabase table via /api/scripts/{list,save,delete}
//     (save/rename are Pro-gated SERVER-SIDE in /api/scripts/save)
//   • guests          → localStorage ('mm.guestScripts')
// The ENABLE flags + per-script param OVERRIDES are localStorage-only for BOTH tiers (they mirror
// mm.inds / mm.indParams, which are device-local UI state — not account data):
//   • enabled script ids     → 'mm.pineOn'      (string[])
//   • per-script param merge  → 'mm.pineParams'  ({ [scriptId]: { [inputVar]: value } })
//
// A UserScript's `params` is the script's DECLARED input defaults, keyed by the assignment-target
// variable name (e.g. MACD → { fast, slow, signal }). runPine() takes exactly this shape as its
// `params` override map, and IndicatorSettings edits these same keys — so the enable-time override
// merged over `params` is what the chart runs. (The engine's reported `inputs[]` array is keyed by
// input TITLE, which is display-only and does NOT match the override key — do not use it as a key.)

export type UserScript = {
  id: string;
  name: string;
  source: string;
  lang: string;
  params: Record<string, any>;
  updated_at: string;
  locked?: boolean;
};

const GUEST_KEY = "mm.guestScripts";
const ENABLED_KEY = "mm.pineOn";
const PARAMS_KEY = "mm.pineParams";

const readLS = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const writeLS = (key: string, val: any) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

const guid = () => "g_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ── guest store (localStorage) ──────────────────────────────────────────────────────────────────
function readGuest(): UserScript[] { return readLS<UserScript[]>(GUEST_KEY, []); }
function writeGuest(list: UserScript[]) { writeLS(GUEST_KEY, list); }

// ── CRUD (dual-tier) ────────────────────────────────────────────────────────────────────────────
// `loggedIn` is passed by the caller (the shell already knows the auth state via `email`), so this
// module never needs its own Supabase client — it just picks the API vs the localStorage path.

/**
 * The result of reading the personal library. A DISCRIMINATED result, not an array, because the
 * caller has to be able to tell "you have no custom scripts" from "we could not read them":
 * `listScripts` used to answer `[]` for a non-OK response AND for a thrown fetch, so a storage
 * outage rendered as an empty library — the Indicator Library said "No scripts yet", and the
 * /scripts page showed only the built-in flagship, which reads as *your scripts are gone*.
 */
export type ScriptLibrary =
  | { status: "ok"; scripts: UserScript[] }
  | { status: "unavailable" };

export async function listScripts(loggedIn: boolean): Promise<ScriptLibrary> {
  // A guest's library IS localStorage; reading it cannot fail in a way the user can act on.
  if (!loggedIn) return { status: "ok", scripts: readGuest() };
  try {
    const r = await fetch("/api/scripts/list", { headers: { Accept: "application/json" } });
    if (!r.ok) return { status: "unavailable" };
    const d = await r.json();
    // A malformed body is a broken read, not an empty library.
    if (!Array.isArray(d?.scripts)) return { status: "unavailable" };
    return { status: "ok", scripts: d.scripts as UserScript[] };
  } catch { return { status: "unavailable" }; }
}

// Insert (id omitted) or update (id present) name+source+params. Returns the saved id, or null on
// failure (e.g. a guest is fine; a logged-in non-Pro hits the server 403 and gets null).
export async function saveScript(
  loggedIn: boolean,
  s: { id?: string; name: string; source: string; params?: Record<string, any> },
): Promise<string | null> {
  const params = s.params || {};
  if (!loggedIn) {
    const list = readGuest();
    if (s.id) {
      const i = list.findIndex((x) => x.id === s.id);
      if (i >= 0) { list[i] = { ...list[i], name: s.name, source: s.source, params, updated_at: new Date().toISOString() }; writeGuest(list); return s.id; }
    }
    const id = guid();
    list.unshift({ id, name: s.name, source: s.source, lang: "pine", params, updated_at: new Date().toISOString() });
    writeGuest(list);
    return id;
  }
  try {
    const r = await fetch("/api/scripts/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, name: s.name, source: s.source, params }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (d?.id as string) ?? null;
  } catch { return null; }
}

// Rename routes through the same update path (must carry source+params so the update doesn't blank
// them — /api/scripts/save writes all three columns). Caller supplies the current source+params.
export async function renameScript(
  loggedIn: boolean,
  s: { id: string; name: string; source: string; params?: Record<string, any> },
): Promise<boolean> {
  const id = await saveScript(loggedIn, s);
  return id != null;
}

export async function deleteScript(loggedIn: boolean, id: string): Promise<boolean> {
  if (!loggedIn) { writeGuest(readGuest().filter((x) => x.id !== id)); return true; }
  try {
    const r = await fetch(`/api/scripts/delete?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.ok;
  } catch { return false; }
}

// ── enabled-state helpers (localStorage, both tiers) ─────────────────────────────────────────────
export function enabledScriptIds(): string[] { return readLS<string[]>(ENABLED_KEY, []); }
export function setEnabledScriptIds(ids: string[]) { writeLS(ENABLED_KEY, ids); }

// ── per-script param overrides (localStorage, both tiers) ────────────────────────────────────────
// Shape: { [scriptId]: { [inputVar]: value } }. Only the keys the user actually changed are stored;
// the render path merges these OVER the script's declared `params`.
export type PineParamStore = Record<string, Record<string, any>>;
export function pineParamStore(): PineParamStore { return readLS<PineParamStore>(PARAMS_KEY, {}); }
export function setPineParamStore(store: PineParamStore) { writeLS(PARAMS_KEY, store); }

// Merge a script's declared defaults with any stored per-script overrides.
export function mergedParams(script: UserScript, store: PineParamStore): Record<string, any> {
  return { ...(script.params || {}), ...(store[script.id] || {}) };
}
