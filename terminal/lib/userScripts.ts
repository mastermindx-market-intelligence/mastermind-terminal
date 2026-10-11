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

import { compareExpectedUpdatedAt, parseExpectedUpdatedAtMs } from "@/lib/savedScriptStamp";

export type UserScript = {
  id: string;
  name: string;
  source: string;
  lang: string;
  params: Record<string, any>;
  updated_at: string;
  locked?: boolean;
};

/** Validated save/rename receipt. Never a client-clock guess. */
export type ScriptWriteReceipt = { id: string; updated_at: string };

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

function parseScriptWriteReceipt(d: unknown, expectedId?: string): ScriptWriteReceipt | null {
  if (d == null || typeof d !== "object") return null;
  const rec = d as { id?: unknown; updated_at?: unknown };
  if (typeof rec.id !== "string" || rec.id.length === 0) return null;
  if (expectedId && rec.id !== expectedId) return null;
  if (typeof rec.updated_at !== "string") return null;
  if (parseExpectedUpdatedAtMs(rec.updated_at) == null) return null;
  return { id: rec.id, updated_at: rec.updated_at };
}

/**
 * Publish a validated save receipt onto the in-memory library.
 * Same id only; never invents a stamp; a late older receipt does not regress a newer
 * accepted token or rewrite name/source/params on any row.
 */
export function applyScriptWriteReceipt(list: UserScript[], receipt: ScriptWriteReceipt): UserScript[] {
  if (!receipt || typeof receipt.id !== "string" || !receipt.id) return list;
  if (parseExpectedUpdatedAtMs(receipt.updated_at) == null) return list;
  let changed = false;
  const next = list.map((row) => {
    if (row.id !== receipt.id) return row;
    const order = compareExpectedUpdatedAt(receipt.updated_at, row.updated_at);
    // Same instant or older (including same-ms microseconds Date.parse drops) keeps the
    // already-accepted exact token. Timezone-equivalent forms do not replace it.
    if (order != null && order <= 0) return row;
    if (row.updated_at === receipt.updated_at) return row;
    changed = true;
    return { ...row, updated_at: receipt.updated_at };
  });
  return changed ? next : list;
}

/** Shell rename `.then` body: rollback name on unverified receipt; else publish the stamp. */
export function publishRenameOutcome(
  list: UserScript[],
  id: string,
  optimisticName: string,
  prevName: string,
  receipt: ScriptWriteReceipt | null,
): UserScript[] {
  if (!receipt || receipt.id !== id) {
    return list.map((x) => (x.id === id && x.name === optimisticName ? { ...x, name: prevName } : x));
  }
  return applyScriptWriteReceipt(list, receipt);
}

// Insert (id omitted) or update (id present) name+source+params. Returns the saved id+stamp, or
// null on failure (e.g. a guest is fine; a logged-in non-Pro hits the server 403 and gets null).
// Logged-in updates must carry the row's observed `updated_at` as `expected_updated_at` — the
// save API CAS-rejects a missing token (400). This helper never invents or pre-reads a stamp.
// HTTP 200 is not success until the body has the same id and a real timestamptz `updated_at`.
export async function saveScript(
  loggedIn: boolean,
  s: { id?: string; name: string; source: string; params?: Record<string, any>; updated_at?: string },
): Promise<ScriptWriteReceipt | null> {
  const params = s.params || {};
  if (!loggedIn) {
    const list = readGuest();
    if (s.id) {
      const i = list.findIndex((x) => x.id === s.id);
      if (i >= 0) {
        const updated_at = new Date().toISOString();
        list[i] = { ...list[i], name: s.name, source: s.source, params, updated_at };
        writeGuest(list);
        return { id: s.id, updated_at };
      }
    }
    const id = guid();
    const updated_at = new Date().toISOString();
    list.unshift({ id, name: s.name, source: s.source, lang: "pine", params, updated_at });
    writeGuest(list);
    return { id, updated_at };
  }
  try {
    const body: Record<string, unknown> = { name: s.name, source: s.source, params };
    if (s.id) {
      body.id = s.id;
      body.expected_updated_at = s.updated_at;
    }
    const r = await fetch("/api/scripts/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    let d: unknown;
    try { d = await r.json(); } catch { return null; }
    return parseScriptWriteReceipt(d, s.id);
  } catch { return null; }
}

// Rename routes through the same update path (must carry source+params so the update doesn't blank
// them — /api/scripts/save writes all three columns). Caller supplies the current source+params
// and the observed `updated_at` token for a logged-in CAS update. Truthy return is a validated
// receipt (same id + timestamptz); callers may still branch on `if (!receipt)`.
export async function renameScript(
  loggedIn: boolean,
  s: { id: string; name: string; source: string; params?: Record<string, any>; updated_at?: string },
): Promise<ScriptWriteReceipt | null> {
  return saveScript(loggedIn, s);
}

/**
 * Sole production rename-click path (TerminalShell.handleRenameScript). Optimistic name,
 * send the row's last observed stamp, publish a validated receipt so the next rename uses
 * that token. No list reread, no retry overwrite. renameScript returns ScriptWriteReceipt | null
 * (not a boolean).
 */
export function runRenameScriptClick(
  loggedIn: boolean,
  s: UserScript | null | undefined,
  name: string,
  setScripts: (updater: (list: UserScript[]) => UserScript[]) => void,
): Promise<void> {
  if (!s || !name.trim() || name.trim() === s.name) return Promise.resolve();
  const nm = name.trim();
  const prev = s.name;
  const id = s.id;
  setScripts((list) => list.map((x) => (x.id === id ? { ...x, name: nm } : x)));
  return renameScript(loggedIn, { id, name: nm, source: s.source, params: s.params, updated_at: s.updated_at }).then((receipt) => {
    setScripts((list) => publishRenameOutcome(list, id, nm, prev, receipt));
  });
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
