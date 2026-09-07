// The non-market half of the account preference contract: everything else that lives in Supabase
// `user_metadata` and must survive a device change.
//
// Two blobs, two owners:
//   • `terminal: { start_tf, updown }` — Terminal-only chart prefs. We own this field outright;
//     the macro dashboard neither reads nor writes it.
//   • `prefs: { theme, themeAuto, lang }` — the macro dashboard's theme/language sync blob
//     (theme.js applies it on sign-in). We must MERGE into it, never replace it, or a Terminal
//     language change would wipe the user's macro theme.
//
// Deliberately free of React, Supabase and i18n imports so it stays a pure contract module that
// can be unit-tested without a DOM harness. The store (lib/useMarketPrefs.ts) owns the network
// and React sides; this file owns "what does a valid value look like" and the two DOM writes
// (`data-updown`) that are the local application of a saved value.

import { TF_CANONICAL_ORDER, DEFAULT_START_TF } from "@/lib/startTf";

export type LangId = "en" | "zh";
export type ThemeId = "light" | "dark";
export type UpDown = "east" | "west";

export const UPDOWN_KEY = "mm.updown";
export const LANG_KEY = "mm.lang";
export const DEFAULT_UPDOWN: UpDown = "west";

export const isLangId = (v: unknown): v is LangId => v === "en" || v === "zh";
export const isThemeId = (v: unknown): v is ThemeId => v === "light" || v === "dark";
export const isUpDown = (v: unknown): v is UpDown => v === "east" || v === "west";
export const isStartTf = (v: unknown): v is string => typeof v === "string" && TF_CANONICAL_ORDER.includes(v);

/** `user_metadata.terminal`, sanitized. Absent keys stay absent — an absent value means "this
 *  account has never expressed one", which is NOT the same as "this account wants the default". */
export type TerminalMeta = { start_tf?: string; updown?: UpDown };

/** The macro dashboard's `user_metadata.prefs` blob, sanitized. `themeAuto` is a "1"/"0" STRING
 *  on their side — kept verbatim rather than coerced to a boolean, because they read it back. */
export type MetaPrefs = { theme?: ThemeId; themeAuto?: "1" | "0"; lang?: LangId };

/** The *effective* local values the UI renders. Distinct from TerminalMeta: this is never
 *  partial — it is what the chart is actually doing right now. */
export type TerminalPrefs = { startTf: string; updown: UpDown };

export const DEFAULT_TERMINAL_PREFS: TerminalPrefs = { startTf: DEFAULT_START_TF, updown: DEFAULT_UPDOWN };

/** A shallow copy of `meta[key]` when it is a plain object, else {}. The copy matters: the store
 *  keeps this around to spread into the next write, and Supabase's `updateUser` REPLACES nested
 *  objects wholesale — a write that forgets a sibling key deletes it. */
export function metaObject(meta: unknown, key: string): Record<string, unknown> {
  if (!meta || typeof meta !== "object") return {};
  const v = (meta as Record<string, unknown>)[key];
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return { ...(v as Record<string, unknown>) };
}

export function readTerminalMeta(blob: unknown): TerminalMeta {
  const o = (blob && typeof blob === "object" && !Array.isArray(blob) ? blob : {}) as Record<string, unknown>;
  const out: TerminalMeta = {};
  if (isStartTf(o.start_tf)) out.start_tf = o.start_tf;
  if (isUpDown(o.updown)) out.updown = o.updown;
  return out;
}

export function readMetaPrefs(blob: unknown): MetaPrefs {
  const o = (blob && typeof blob === "object" && !Array.isArray(blob) ? blob : {}) as Record<string, unknown>;
  const out: MetaPrefs = {};
  if (isThemeId(o.theme)) out.theme = o.theme;
  if (o.themeAuto === "1" || o.themeAuto === "0") out.themeAuto = o.themeAuto;
  if (isLangId(o.lang)) out.lang = o.lang;
  return out;
}

// ── shared preferences v2 — independently mergeable atomics (E6) ──────────────────────────
//
// `user_metadata.prefs` is a NESTED object, and `auth.updateUser` REPLACES a nested object
// wholesale. Both products write it, so serializing one product's own writes cannot make it
// safe — the race is between the two products:
//
//   1. Terminal reads  { theme: dark, lang: en }
//   2. Macro changes theme → Light, writing the whole object
//   3. Terminal, still holding its snapshot, changes language → Chinese
//   4. Terminal sends { theme: dark, lang: zh }
//   5. Macro's newer Light choice is GONE.
//
// A fresh-read-before-write does not fix this: read and write are not atomic, and the window
// only shrinks. What fixes it is removing the shared mutable container. Each field becomes its
// own TOP-LEVEL key, and `updateUser` MERGES top-level keys — so a writer that touches only the
// field it changed cannot clobber a sibling it never looked at.
//
//     prefs.theme     → theme
//     prefs.themeAuto → theme_auto
//     prefs.lang      → lang
//
// `theme` and `lang` are NOT new names: they are the top-level keys the macro API's own
// preference writer already treats as canonical (`lib/user_prefs.py` there — "the ONE
// reader/writer for a signed-in user\'s stored preferences", with the same closed value sets).
// Minting a parallel `ui_*` namespace would have made three representations of one preference
// instead of one; the browsers now join the representation that already exists. `theme_auto` is
// the one field with no existing home — it is a browser-side presentation flag (macro computes
// the theme from local time when it is set) and no server route writes it.
//
// Readers prefer the v2 ATOMIC value and fall back to the legacy nested sibling PER FIELD (not
// per blob), so an account that has only ever had `prefs` still reads correctly, and one where a
// single field has been migrated reads that field from wherever it was last written.
//
// FLIP CONDITION (read this before changing the priority back): macro's own writer has ALREADY
// migrated — this is not a future condition. `templates/theme.js` on macro `origin/main` (landed
// PR #6170, commit `d048a261`; re-verified present at `27145b01` and current `origin/main`)
// writes ONLY the top-level atomics (`_savePrefToServer`, theme.js:4017-4034 — builds its patch
// from `theme`/`theme_auto`/`lang` and never touches `prefs`) and reads atomic-first with the
// nested blob as a read-only fallback (`_sharedPref`, theme.js:3987-3991 — "v2 atomic if valid,
// else the legacy nested sibling. Per FIELD."). The nested `prefs` blob is therefore a **read-only
// legacy fallback** on both sides now, kept alive only for whatever account still has a
// never-migrated value sitting in it. Terminal mirrors macro's own priority exactly: atomic wins,
// legacy fills in only where the atomic is absent or invalid. Terminal still DUAL-WRITES every
// change to both places (`sharedPrefsPatch` for the atomics, `legacyPrefsPatch` for the nested
// blob) — harmless, and it keeps any remaining legacy-only reader fed — but the `prefs` write is
// queued one-shot (see `persistMetaPrefs` in `lib/useMarketPrefs.ts`) so it never rides along on
// an unrelated later write once acknowledged. `lib/user_prefs.py`'s *server* route may still be
// legacy-only; that does not change this file's read priority, because the account's stored
// value is the same JSON regardless of which macro code path wrote the atomic.

/** Top-level, independently mergeable. Written by BOTH products; read-priority winner. */
export const SHARED_THEME_KEY = "theme";
export const SHARED_THEME_AUTO_KEY = "theme_auto";
export const SHARED_LANG_KEY = "lang";

/**
 * The effective shared preferences: the v2 atomic `meta.*` value where present and valid, else
 * the legacy `prefs.*` sibling. Resolved field by field — a half-migrated account is the normal
 * state during the cross-product rollout, not an edge case. Mirrors macro's own `_sharedPref`
 * (`templates/theme.js:3987-3991`) exactly. See the FLIP CONDITION note above: macro has already
 * migrated, so the atomic is preferred, not the legacy blob.
 */
export function readSharedPrefs(meta: unknown): MetaPrefs {
  const m = (meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {}) as Record<string, unknown>;
  const legacy = readMetaPrefs(m.prefs);
  const out: MetaPrefs = {};
  const theme = (isThemeId(m[SHARED_THEME_KEY]) ? (m[SHARED_THEME_KEY] as ThemeId) : undefined) ?? legacy.theme;
  const themeAuto = (
    m[SHARED_THEME_AUTO_KEY] === "1" || m[SHARED_THEME_AUTO_KEY] === "0"
      ? (m[SHARED_THEME_AUTO_KEY] as "1" | "0")
      : undefined
  ) ?? legacy.themeAuto;
  const lang = (isLangId(m[SHARED_LANG_KEY]) ? (m[SHARED_LANG_KEY] as LangId) : undefined) ?? legacy.lang;
  if (theme) out.theme = theme;
  if (themeAuto) out.themeAuto = themeAuto;
  if (lang) out.lang = lang;
  return out;
}

/**
 * A shared-preference patch, as the ATOMIC top-level keys to write. ONLY the fields the caller
 * actually changed appear — that restraint is the whole point, so a language change cannot carry
 * a stale theme along with it.
 */
export function sharedPrefsPatch(patch: MetaPrefs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.theme !== undefined && isThemeId(patch.theme)) out[SHARED_THEME_KEY] = patch.theme;
  if (patch.themeAuto === "1" || patch.themeAuto === "0") out[SHARED_THEME_AUTO_KEY] = patch.themeAuto;
  if (patch.lang !== undefined && isLangId(patch.lang)) out[SHARED_LANG_KEY] = patch.lang;
  return out;
}

/**
 * The SAME patch, shaped for the legacy nested `prefs` blob instead of the top-level atomics
 * (`themeAuto`, camelCase, matching `readMetaPrefs`) — the DUAL-WRITE half of E6. Only the
 * fields the caller actually changed appear; the caller merges this into the last-known nested
 * blob (`metaObject`'s copy) before sending, exactly as the pre-existing `terminal` blob does,
 * so a partial patch here can never delete a macro-written sibling field.
 */
export function legacyPrefsPatch(patch: MetaPrefs): Partial<MetaPrefs> {
  const out: Partial<MetaPrefs> = {};
  if (patch.theme !== undefined && isThemeId(patch.theme)) out.theme = patch.theme;
  if (patch.themeAuto === "1" || patch.themeAuto === "0") out.themeAuto = patch.themeAuto;
  if (patch.lang !== undefined && isLangId(patch.lang)) out.lang = patch.lang;
  return out;
}

// ── local application ────────────────────────────────────────────────────────────────────
// The <html> attributes are the live source of truth for the current session — the pre-paint
// script in app/layout.tsx has already reconciled localStorage against the browser locale by the
// time any of this runs, so reading the attribute (not localStorage) is what "current" means.

export function readUpDown(): UpDown {
  if (typeof document === "undefined") return DEFAULT_UPDOWN;
  const attr = document.documentElement.getAttribute("data-updown");
  if (isUpDown(attr)) return attr;
  try {
    const raw = localStorage.getItem(UPDOWN_KEY);
    if (isUpDown(raw)) return raw;
  } catch { /* storage blocked */ }
  return DEFAULT_UPDOWN;
}

/** Apply the up/down convention: remember it, repaint it, and tell the charts. The event is what
 *  makes an already-drawn canvas recolor — CSS variables alone don't reach canvas fills. */
export function applyUpDown(v: UpDown) {
  try { localStorage.setItem(UPDOWN_KEY, v); } catch { /* storage blocked */ }
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-updown", v);
  window.dispatchEvent(new CustomEvent("mm:updown"));
}

export function readLang(): LangId {
  if (typeof document === "undefined") return "en";
  const attr = document.documentElement.getAttribute("data-lang");
  return isLangId(attr) ? attr : "en";
}
