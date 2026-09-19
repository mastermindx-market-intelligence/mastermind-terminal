// IndicatorCanvas host — the compute side of the premium suite pipeline.
//
// Responsibilities (see lib/indicator-canvas/README.md "Architecture"):
//   1. resolve SuiteColors from CSS custom properties ONCE per render pass (modules never read CSS);
//   2. convert ChartPanel's bars (string|number time) to SuiteBar[] (numeric epoch seconds) ONCE;
//   3. split the flat "<module>.<field>" params blob per module and merge module defaults under it;
//   4. gate modules by entitlement tier (free < essential < pro) — locked modules are SKIPPED and
//      reported back so the UI can render an upsell row;
//   5. run each enabled module inside try/catch (a broken module must never blank the chart);
//   6. enforce MAX_PRIMS_PER_MODULE / MAX_TOTAL_PRIMS;
//   7. merge tooltips / candlePaint / events into one SuiteRenderBundle, z-sorted;
//   8. memoize the bundle (small LRU) so pan/zoom frames never recompute.
//
// Determinism law: no Date.now(), no Math.random(), no wall-clock branch anywhere in this file.
// The only module-level mutable state is the memo cache and the "already warned" sets — neither
// changes the VALUE of a result, only whether we recompute it or log about it.

import type {
  CandlePaintEntry,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteBar,
  SuiteColors,
  SuiteDef,
  SuiteEvent,
  SuiteModuleDef,
  SuiteRenderBundle,
  SuiteTier,
  TooltipDef,
} from "./types";
import { MAX_PRIMS_PER_MODULE, MAX_TOTAL_PRIMS } from "./types";

// ─────────────────────────────────────────────────────────────────────────────── input & result

/** What ChartPanel hands the host: its own bar rows plus the active chart context. */
export interface SuiteHostInput {
  bars: Array<{ time: string | number; o: number; h: number; l: number; c: number; v: number }>;
  tf: string;
  symbol: string;
  isIntraday: boolean;
  lang: "en" | "zh";
}

/** computeSuite's return shape (alias for the integrator's convenience). */
export type SuiteComputeResult = SuiteRenderBundle & {
  lockedModules: Array<{ key: string; label: string; tier: SuiteTier }>;
};

// ────────────────────────────────────────────────────────────────────────────────────── colors

// Hard fallbacks = the literal v5/v7 token values in app/globals.css. They exist ONLY so that SSR,
// vitest (jsdom returns "" for custom properties) and detached elements never crash or draw
// transparent prims. Runtime always reads the live tokens, which is what makes east-flip work.
const FALLBACK_COLORS: SuiteColors = {
  up: "#26c281",
  down: "#f0566b",
  flowBuy: "#22b8d5",
  flowSell: "#a92cce",
  warn: "#e8a33d",
  brand: "#4d82ff",
  text: "#d6dae3",
  muted: "#717a8e",
  neutral: "#4a5468",
};

/**
 * Resolve the suite color family from CSS custom properties on `el` (default:
 * document.documentElement, which is where the theme + `data-updown` flip live).
 * Cheap enough to call once per render pass; no caching by design so a theme/east flip is picked
 * up on the very next pass.
 */
export function resolveSuiteColors(el?: HTMLElement): SuiteColors {
  let cs: CSSStyleDeclaration | null = null;
  try {
    if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
      return { ...FALLBACK_COLORS };
    }
    const target = el ?? (typeof document !== "undefined" ? document.documentElement : null);
    if (!target) return { ...FALLBACK_COLORS };
    cs = window.getComputedStyle(target);
  } catch {
    return { ...FALLBACK_COLORS };
  }
  if (!cs) return { ...FALLBACK_COLORS };
  const g = (prop: string, fb: string): string => {
    try {
      const raw = cs!.getPropertyValue(prop);
      const v = typeof raw === "string" ? raw.trim() : "";
      return v || fb;
    } catch {
      return fb;
    }
  };
  return {
    up: g("--up", FALLBACK_COLORS.up),
    down: g("--down", FALLBACK_COLORS.down),
    flowBuy: g("--flow-buy", FALLBACK_COLORS.flowBuy),
    flowSell: g("--flow-sell", FALLBACK_COLORS.flowSell),
    warn: g("--warn", FALLBACK_COLORS.warn),
    brand: g("--brand-2", FALLBACK_COLORS.brand),
    text: g("--text", FALLBACK_COLORS.text),
    muted: g("--muted", FALLBACK_COLORS.muted),
    neutral: g("--text-dim", FALLBACK_COLORS.neutral),
  };
}

// ──────────────────────────────────────────────────────────────────────────────────────── bars

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * ChartPanel daily rows carry "YYYY-MM-DD" strings; intraday rows already carry numeric
 * display-epoch seconds (lib/intradayMath.ts). Date.UTC keeps this machine-timezone independent —
 * Date.parse() would not, so it is deliberately not used.
 */
function toEpochSec(t: string | number): number {
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    const d = DAY_RE.exec(t);
    if (d) {
      const base = Date.UTC(+d[1], +d[2] - 1, +d[3]) / 1000;
      const hm = TIME_RE.exec(t);
      if (hm) return base + +hm[1] * 3600 + +hm[2] * 60 + (hm[3] ? +hm[3] : 0);
      return base;
    }
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Index alignment is load-bearing (prims address bars by array index) — never filter/reorder. */
function toSuiteBars(rows: SuiteHostInput["bars"]): SuiteBar[] {
  const out: SuiteBar[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    out[i] = { t: toEpochSec(r.time), o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v };
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────── tier & params

// `insider` is the pre-rename name for `essential` and is still accepted here: a stale cached
// page or a `mm.devTier` written before the rename can hand this side an old string, and the
// renderer fails CLOSED — an unranked tier would silently refuse to draw a paid subscriber's
// modules. Read-tolerance only; nothing writes the old name back.
const TIER_RANK: Record<SuiteTier | "insider", number> = { free: 0, essential: 1, insider: 1, pro: 2 };

function tierRank(t: SuiteTier | undefined): number {
  return TIER_RANK[(t ?? "free") as SuiteTier] ?? 0;
}

/**
 * Module settings, UNPREFIXED, defaults merged. Defaults are re-derived from the passed `def`
 * (never imported from suites/registry) so host.ts stays free of any registry import cycle.
 */
function moduleSettings(m: SuiteModuleDef, flat: Record<string, any> | undefined): Record<string, any> {
  const s: Record<string, any> = { ...(m.defaults || {}) };
  if (!flat) return s;
  const prefix = `${m.key}.`;
  for (const k in flat) {
    if (!Object.prototype.hasOwnProperty.call(flat, k)) continue;
    if (k.length <= prefix.length || k.slice(0, prefix.length) !== prefix) continue;
    const sub = k.slice(prefix.length);
    // "<mod>.on" is the master toggle, not a field — keep it out of ctx.s unless the module
    // genuinely declares a field named "on".
    if (sub === "on" && !Object.prototype.hasOwnProperty.call(s, "on")) continue;
    const v = flat[k];
    if (v !== undefined) s[sub] = v;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────────── warn state

// One warning per (suite, module) per session — a broken module in a rAF loop must not flood.
const warnedCompute = new Set<string>();
const warnedModuleCap = new Set<string>();
const warnedTotalCap = new Set<string>();

function warnOnce(seen: Set<string>, id: string, msg: string, extra?: unknown): void {
  if (seen.has(id)) return;
  seen.add(id);
  try {
    if (extra !== undefined) console.warn(msg, extra);
    else console.warn(msg);
  } catch {
    /* console can be stubbed away in tests */
  }
}

// ─────────────────────────────────────────────────────────────────────────────────── memo cache

const MEMO_MAX = 32;
// A memo hit must describe the same DATA, not merely the same row count and last timestamp.
// Keep a bounded primitive snapshot alongside the existing result; equal payload copies still hit.
// A numeric comparison is cheaper than serializing/hashing the full bar array on every pan frame.
const MEMO = new Map<string, { result: SuiteComputeResult; bars: SuiteHostInput["bars"] }>();
const BAR_FIELDS = ["time", "o", "h", "l", "c", "v"] as const;

/** Stable, order-independent signature of the flat params that belong to THIS suite's modules. */
function paramSignature(def: SuiteDef, flat: Record<string, any> | undefined): string {
  if (!flat) return "";
  const owned = new Set<string>();
  for (const m of def.modules) owned.add(m.key);
  const keys: string[] = [];
  for (const k in flat) {
    if (!Object.prototype.hasOwnProperty.call(flat, k)) continue;
    const dot = k.indexOf(".");
    if (dot <= 0) continue;
    if (!owned.has(k.slice(0, dot))) continue;
    keys.push(k);
  }
  if (!keys.length) return "";
  keys.sort();
  const pairs: Array<[string, any]> = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) pairs[i] = [keys[i], flat[keys[i]]];
  try {
    return JSON.stringify(pairs);
  } catch {
    return keys.join(","); // non-serializable value (should not happen for settings scalars)
  }
}

function memoKey(
  def: SuiteDef,
  input: SuiteHostInput,
  tier: SuiteTier,
  colors: SuiteColors,
  paramSig: string,
): string {
  const n = input.bars.length;
  const lastT = n ? String(input.bars[n - 1].time) : "";
  // Colors + lang ride the key on purpose: prims embed resolved colors and localized text, so an
  // east-flip / theme change / language switch MUST invalidate or the chart repaints stale hues.
  const colorSig =
    colors.up + "," + colors.down + "," + colors.flowBuy + "," + colors.flowSell + "," +
    colors.warn + "," + colors.brand + "," + colors.text + "," + colors.muted + "," + colors.neutral;
  return [
    def.key,
    def.modules.map((module) => module.key).join(","),
    input.symbol,
    input.tf,
    input.isIntraday ? "i" : "d",
    input.lang,
    tier,
    String(n),
    lastT,
    colorSig,
    paramSig,
  ].join("|");
}

function memoGet(key: string, rows: SuiteHostInput["bars"]): SuiteComputeResult | undefined {
  const hit = MEMO.get(key);
  if (!hit || hit.bars.length !== rows.length) return undefined;
  for (let i = 0; i < rows.length; i++) {
    for (const field of BAR_FIELDS) if (!Object.is(hit.bars[i][field], rows[i][field])) return undefined;
  }
  MEMO.delete(key);
  MEMO.set(key, hit);
  return hit.result;
}

function memoSet(key: string, val: SuiteComputeResult, rows: SuiteHostInput["bars"]): void {
  MEMO.delete(key);
  MEMO.set(key, { result: val, bars: rows.map(({ time, o, h, l, c, v }) => ({ time, o, h, l, c, v })) });
  while (MEMO.size > MEMO_MAX) {
    const oldest = MEMO.keys().next();
    if (oldest.done) break;
    MEMO.delete(oldest.value);
  }
}

/** Test/debug hook — drops every memoized bundle. Not used by the render path. */
export function clearSuiteMemo(): void {
  MEMO.clear();
}

// ───────────────────────────────────────────────────────────────────────────────────── compute

/**
 * Run one suite: entitlement gate → per-module compute → caps → merged bundle.
 * The returned object is CACHED and shared between frames — treat it as read-only.
 */
export function computeSuite(
  def: SuiteDef,
  flatParams: Record<string, any> | undefined,
  input: SuiteHostInput,
  tier: SuiteTier,
  colors: SuiteColors,
): SuiteRenderBundle & { lockedModules: Array<{ key: string; label: string; tier: SuiteTier }> } {
  const paramSig = paramSignature(def, flatParams);
  const key = memoKey(def, input, tier, colors, paramSig);
  const cached = memoGet(key, input.bars);
  if (cached) return cached;

  const lockedModules: Array<{ key: string; label: string; tier: SuiteTier }> = [];
  const prims: Prim[] = [];
  const tooltips = new Map<string, TooltipDef>();
  const tablesById = new Map<string, import("./types").TableSpec>();
  const paintByIndex = new Map<number, CandlePaintEntry>();
  const events: SuiteEvent[] = [];

  const bars = toSuiteBars(input.bars);
  const haveTier = tierRank(tier);
  let totalPrims = 0;

  // Full flat blob (module-prefixed, defaults merged for EVERY module) — ctx.suite. Satellites use
  // this to follow their producer's user settings instead of silently re-assuming defaults (W2 review).
  const suiteFlat: Record<string, any> = {};
  for (const mm of def.modules) {
    suiteFlat[`${mm.key}.on`] = flatParams?.[`${mm.key}.on`] ?? mm.defaultOn;
    const ms = moduleSettings(mm, flatParams);
    for (const fk in ms) { if (Object.prototype.hasOwnProperty.call(ms, fk)) suiteFlat[`${mm.key}.${fk}`] = ms[fk]; }
  }

  for (const m of def.modules) {
    if (!m || typeof m.compute !== "function") continue;

    // (a) entitlement gate — locked modules are surfaced for the upsell row and skipped whole,
    //     regardless of their .on toggle (a locked module must never spend compute or draw).
    if (tierRank(m.tier) > haveTier) {
      lockedModules.push({ key: m.key, label: m.label, tier: m.tier });
      continue;
    }

    // (b) master toggle: explicit false disables; anything else (incl. missing) falls back to
    //     the module's own defaultOn.
    const onVal = flatParams ? flatParams[`${m.key}.on`] ?? m.defaultOn : m.defaultOn;
    if (onVal === false) continue;

    // (c) module context — unprefixed settings with defaults merged, shared chrome.
    const ctx: ModuleCtx = {
      bars,
      tf: input.tf,
      symbol: input.symbol,
      isIntraday: input.isIntraday,
      s: moduleSettings(m, flatParams),
      suite: suiteFlat,
      colors,
      lang: input.lang,
    };

    // (d) a throwing module contributes nothing and warns once per session.
    let res: ModuleResult | null = null;
    try {
      res = m.compute(ctx);
    } catch (err) {
      warnOnce(
        warnedCompute,
        `${def.key}:${m.key}`,
        `[suite] ${def.key}.${m.key} compute threw — module skipped this session's logs`,
        err,
      );
      res = null;
    }
    if (!res) continue;

    // (e) caps. Keep the LAST N prims: modules emit oldest→newest, so the tail is the most recent
    //     (and most decision-relevant) structure.
    let mp: Prim[] = Array.isArray(res.prims) ? res.prims : [];
    if (mp.length > MAX_PRIMS_PER_MODULE) {
      warnOnce(
        warnedModuleCap,
        `${def.key}:${m.key}`,
        `[suite] ${def.key}.${m.key} emitted ${mp.length} prims — capped to the last ${MAX_PRIMS_PER_MODULE}`,
      );
      mp = mp.slice(mp.length - MAX_PRIMS_PER_MODULE);
    }
    const room = MAX_TOTAL_PRIMS - totalPrims;
    if (room <= 0) {
      warnOnce(warnedTotalCap, def.key, `[suite] ${def.key} hit MAX_TOTAL_PRIMS (${MAX_TOTAL_PRIMS}) — later modules trimmed`);
      mp = [];
    } else if (mp.length > room) {
      warnOnce(warnedTotalCap, def.key, `[suite] ${def.key} hit MAX_TOTAL_PRIMS (${MAX_TOTAL_PRIMS}) — later modules trimmed`);
      mp = mp.slice(mp.length - room);
    }
    for (const p of mp) if (p) prims.push(p);
    totalPrims += mp.length;

    // (f) merge side-channels. Later modules win on tooltip id and on candle index.
    if (Array.isArray(res.tooltips)) for (const t of res.tooltips) if (t && t.id) tooltips.set(t.id, t);
    if (Array.isArray(res.candlePaint)) {
      for (const cp of res.candlePaint) {
        if (!cp || !Number.isFinite(cp.i)) continue;
        paintByIndex.set(Math.trunc(cp.i), cp);
      }
    }
    if (Array.isArray(res.events)) for (const e of res.events) if (e) events.push(e);
    if (Array.isArray(res.tables)) for (const tb of res.tables) if (tb && tb.id) tablesById.set(tb.id, tb);
  }

  // z-sort is stable (ES2019+ engines): equal-z prims keep module order, so a later module still
  // paints on top of an earlier one at the same z.
  const sorted = prims
    .map((p, i) => ({ p, i, z: typeof p.z === "number" && isFinite(p.z) ? p.z : 0 }))
    .sort((a, b) => (a.z - b.z) || (a.i - b.i))
    .map((x) => x.p);

  const candlePaint: CandlePaintEntry[] = [];
  const idxs = Array.from(paintByIndex.keys()).sort((a, b) => a - b);
  for (const i of idxs) candlePaint.push(paintByIndex.get(i)!);

  const tables = Array.from(tablesById.values()).slice(0, 6); // sanity cap — dashboards are few by design

  const out: SuiteComputeResult = { prims: sorted, tooltips, candlePaint, events, lockedModules, tables };
  memoSet(key, out, input.bars);
  return out;
}
