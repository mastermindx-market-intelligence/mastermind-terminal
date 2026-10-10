/**
 * eodContext.ts — pure model for the Terminal's EOD context belt (OEU T-E).
 *
 * The Terminal's options suite is a LIVE surface. The macro estate settles its options
 * structure at the close and publishes it nightly. This module is the seam: it reads the
 * settled artifacts and turns them into display descriptors, so the components stay thin
 * and every honesty branch is unit-testable without a DOM.
 *
 * WHAT THIS MODULE IS ALLOWED TO DO
 *   Select, format, and label values that the payloads already carry. Nothing here derives
 *   a new number from market data — the one classification it performs (the dark-pool lean)
 *   is a VERBATIM port of the macro darkpool page's own published rule, thresholds and
 *   plain words included, because the mirrored artifact ships the inputs but not the label
 *   (see darkPoolLean below). Adding a second, differently-tuned rule would be exactly the
 *   estate divergence this lane exists to close.
 *
 * CADENCE IS THE PRODUCT
 *   Every value the belt shows is settled-close data sitting next to live tape. The vintage
 *   is not decoration — it is what makes the number honest. So every accessor here returns
 *   its own `asof`, per source, and callers must stamp it. Two stores can disagree about
 *   the session (gex_state and options_hub/gex run on different builders); the belt shows
 *   each one's own date rather than picking a winner.
 *
 * ABSENT IS A STATE, NOT AN ERROR
 *   Every builder returns nulls rather than throwing or substituting. A root that macro does
 *   not cover, a key that 404s before the first nightly runs, a plan with no contract — all
 *   render as an explicit "not covered" rather than an empty box or a zero.
 */

import type { Lang } from "@/lib/i18n";

// ─── Dark pool (schema darkpool_eod.v1 → R2 darkpool/eod.json) ────────────────

/** One name's settled off-exchange row. Every metric is independently nullable. */
export interface DarkPoolRow {
  ticker: string;
  asof?: string | null;
  /** Share of FINRA-reported volume marked short (level). */
  short_ratio?: number | null;
  short_ratio_recent?: number | null;
  short_ratio_baseline?: number | null;
  /** Short-marking CHANGE, recent vs baseline, in percentage points. */
  trend_pp?: number | null;
  /** Short-ratio z vs the name's own norm. */
  ratio_z?: number | null;
  n_days?: number | null;
  finra_total_vol?: number | null;
  /** Off-exchange share of volume, 0..1. */
  oe_share?: number | null;
  oe_share_5d?: number | null;
  oe_share_40d?: number | null;
  oe_trend_pp?: number | null;
  /** Off-exchange share z vs the name's own norm. */
  oe_z?: number | null;
  spark20?: number[] | null;
  ats_shares?: number | null;
  ats_top_venue?: string | null;
  ats_venues_n?: number | null;
  ats_share_pct?: number | null;
}

export interface DarkPoolEodPayload {
  schema?: string;
  tier?: string;
  source?: string;
  asof?: string | null;
  panel_dates?: number | null;
  below_floor?: boolean;
  n_with_oe?: number | null;
  n_with_ats?: number | null;
  universe?: DarkPoolRow[];
}

/**
 * Lean thresholds — copied verbatim from macro `engine/darkpool_context.py`.
 *
 * The mirrored artifact (darkpool_eod.v1) carries the INPUTS (oe_z, oe_share, trend_pp,
 * ratio_z) but not the lean tag: the tag is computed in the macro page builder, which does
 * not publish through this key. Rather than invent a Terminal-flavoured rule — two estates
 * disagreeing about whether NVDA is "accumulation" is worse than no label at all — the
 * published rule is reproduced here exactly, constants and precedence included. If macro
 * ever adds a `lean` field to the payload, prefer it and delete this block.
 */
export const DP_STANDOUT_Z = 1.5;    // oe_z ≥ → off-exchange share unusually high vs own norm
export const DP_STANDOUT_OE = 0.40;  // …and ≥ 40% of the day's volume printed off-exchange
export const DP_ACC_TREND = -2.0;    // short-marking fading ≥ 2pp vs baseline
export const DP_ACC_RZ = -0.75;      // …or short ratio ≥ 0.75σ below the name's own norm
export const DP_DIS_TREND = 4.0;     // short-marking building ≥ 4pp vs baseline
export const DP_DIS_RZ = 1.0;        // …or short ratio ≥ 1σ above the name's own norm

export type DarkPoolLean = "accumulation" | "distribution" | "unusual";

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Case-insensitive row lookup. Returns null when macro does not cover the root. */
export function pickDarkPoolRow(
  payload: DarkPoolEodPayload | null | undefined,
  root: string
): DarkPoolRow | null {
  const rows = payload?.universe;
  if (!Array.isArray(rows) || !root) return null;
  const want = root.trim().toUpperCase();
  return rows.find((r) => (r?.ticker ?? "").toUpperCase() === want) ?? null;
}

/**
 * Deterministic lean tag for one row, or null when the name is not a standout.
 *
 * A *standout* has off-exchange share both unusually high vs its own norm (oe_z ≥ 1.5) and
 * materially dark (oe_share ≥ 0.40). Names without enough matched history have no oe_z and
 * are never tagged — honest-null, not forced. Port of macro `darkpool_context.classify`.
 */
export function darkPoolLean(row: DarkPoolRow | null | undefined): DarkPoolLean | null {
  if (!row) return null;
  const oeZ = num(row.oe_z);
  const oe = num(row.oe_share);
  if (oeZ === null || oe === null) return null;
  if (oeZ < DP_STANDOUT_Z || oe < DP_STANDOUT_OE) return null;

  const tpp = num(row.trend_pp);
  const rz = num(row.ratio_z);
  const building = (tpp !== null && tpp >= DP_DIS_TREND) || (rz !== null && rz >= DP_DIS_RZ);
  const fading = (tpp !== null && tpp <= DP_ACC_TREND) || (rz !== null && rz <= DP_ACC_RZ);
  if (building && !fading) return "distribution";
  if (fading && !building) return "accumulation";
  return "unusual";
}

/** "vs its own norm" band from oe_z. Port of macro `_norm_label`. */
export type DarkPoolNorm = "far" | "well" | "above" | "at";

export function darkPoolNorm(row: DarkPoolRow | null | undefined): DarkPoolNorm | null {
  const oeZ = num(row?.oe_z);
  if (oeZ === null) return null;
  if (oeZ >= 2.5) return "far";
  if (oeZ >= 1.5) return "well";
  if (oeZ >= 0.5) return "above";
  return "at";
}

/**
 * Short-marking read — the CHANGE, never the raw level. Port of macro `_short_label`.
 * `pp` is the magnitude to print beside the word (null when the read is level-based).
 */
export type DarkPoolShortKey = "building" | "fading" | "light" | "heavy" | "normal";

export function darkPoolShortRead(
  row: DarkPoolRow | null | undefined
): { key: DarkPoolShortKey; pp: number | null } | null {
  if (!row) return null;
  const tpp = num(row.trend_pp);
  const rz = num(row.ratio_z);
  if (tpp === null && rz === null) return null;
  if (tpp !== null && tpp >= DP_DIS_TREND) return { key: "building", pp: Math.abs(tpp) };
  if (tpp !== null && tpp <= DP_ACC_TREND) return { key: "fading", pp: Math.abs(tpp) };
  if (rz !== null && rz <= DP_ACC_RZ) return { key: "light", pp: null };
  if (rz !== null && rz >= DP_DIS_RZ) return { key: "heavy", pp: null };
  return { key: "normal", pp: null };
}

/** Everything the Dark Pool mini-panel renders for one root, or an honest absent state. */
export interface DarkPoolRead {
  root: string;
  /** null when macro's universe has no row for this root. */
  row: DarkPoolRow | null;
  /** null when the row exists but is not a standout — a real, printable state. */
  lean: DarkPoolLean | null;
  norm: DarkPoolNorm | null;
  short: { key: DarkPoolShortKey; pp: number | null } | null;
  /** Off-exchange share as a percent, or null. */
  oeSharePct: number | null;
  oeZ: number | null;
  /** Panel vintage — the row's own asof, falling back to the payload's. */
  asof: string | null;
  /** Matched trading days behind the z-scores; small n is disclosed, not hidden. */
  nDays: number | null;
}

export function darkPoolRead(
  payload: DarkPoolEodPayload | null | undefined,
  root: string
): DarkPoolRead {
  const row = pickDarkPoolRow(payload, root);
  const oe = num(row?.oe_share);
  return {
    root: (root ?? "").trim().toUpperCase(),
    row,
    lean: darkPoolLean(row),
    norm: darkPoolNorm(row),
    short: darkPoolShortRead(row),
    oeSharePct: oe === null ? null : oe * 100,
    oeZ: num(row?.oe_z),
    asof: (row?.asof ?? payload?.asof ?? null) || null,
    nDays: num(row?.n_days),
  };
}

// ─── Vol regime (schema vol_regime.v1 → R2 vol/regime.json) ───────────────────

interface Bilingual {
  en?: string;
  zh?: string;
}

export interface VolRegimePayload {
  schema?: string;
  asof?: string | null;
  snapshot?: {
    available?: boolean;
    asof?: string | null;
    regime?: string | null;
    vix?: number | null;
    ts_slope_state?: string | null;
    vol_target_scalar?: number | null;
    [k: string]: unknown;
  } | null;
  game_plan?: {
    available?: boolean;
    verdict?: Bilingual | null;
    icon?: string | null;
    /** gp-calm | gp-neutral | gp-warn | gp-jumpy — macro's own tone vocabulary. */
    css?: string | null;
    sub?: Bilingual | null;
    regime?: string | null;
    asof?: string | null;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
}

export type VolTone = "calm" | "neutral" | "warn" | "jumpy";

/** macro `engine/options_desk.py` publishes exactly these four css tokens. */
const VOL_TONE_BY_CSS: Record<string, VolTone> = {
  "gp-calm": "calm",
  "gp-neutral": "neutral",
  "gp-warn": "warn",
  "gp-jumpy": "jumpy",
};

export interface VolRegimeRead {
  /** macro's own verdict wording — never re-phrased here. */
  label: string;
  /** macro's own one-line read (the hover). */
  sub: string;
  tone: VolTone;
  /** Raw regime token, for aria/debug — not shown as glance copy. */
  regime: string | null;
  asof: string | null;
}

/**
 * The chip's content, or null when the artifact is absent/unavailable.
 *
 * Deliberately a pure pass-through of `game_plan`: macro already ships the verdict and its
 * one-line read bilingually and gauntlets that vocabulary. Re-deriving a label from
 * `snapshot.regime` here would fork the vol vocabulary across two estates.
 */
export function volRegimeRead(
  payload: VolRegimePayload | null | undefined,
  lang: Lang
): VolRegimeRead | null {
  const gp = payload?.game_plan;
  if (!gp || gp.available === false) return null;
  const label = (lang === "zh" ? gp.verdict?.zh : gp.verdict?.en) ?? "";
  if (!label) return null;
  const sub = (lang === "zh" ? gp.sub?.zh : gp.sub?.en) ?? "";
  return {
    label,
    sub,
    tone: VOL_TONE_BY_CSS[gp.css ?? ""] ?? "neutral",
    regime: gp.regime ?? payload?.snapshot?.regime ?? null,
    asof: gp.asof ?? payload?.snapshot?.asof ?? payload?.asof ?? null,
  };
}

// ─── Expected move (schema options_hub.moves/v1 → R2 options_hub/moves/{ROOT}.json) ──

export interface MovesPayload {
  schema?: string;
  asof?: string | null;
  root?: string | null;
  spot_ref?: number | null;
  atm_iv?: number | null;
  regime?: string | null;
  expected_move?: {
    band_mult?: number | null;
    horizon_days?: number | null;
    pct?: number | null;
    lo?: number | null;
    hi?: number | null;
  } | null;
  [k: string]: unknown;
}

// ─── Per-root IV context (schema options_hub.vol/v1 → R2 options_hub/vol/{ROOT}.json) ──

export interface VolPayload {
  schema?: string;
  asof?: string | null;
  root?: string | null;
  /** IV rank over the trailing 252 sessions — the strip's "IV percentile". */
  iv_rank_252?: number | null;
  iv_rank_all?: number | null;
  atm_iv?: number | null;
  iv_52w_hi?: number | null;
  iv_52w_lo?: number | null;
  coverage?: { n_days?: number | null; since?: string | null } | null;
  [k: string]: unknown;
}

// ─── OI confirmation (schema options_hub.oi_confirmed/v1) ─────────────────────

export interface OiConfRow {
  root?: string;
  right?: "C" | "P" | string;
  exp?: string;
  strike?: number | null;
  prev_premium?: number | null;
  delta_oi?: number | null;
}

export interface OiConfPayload {
  schema?: string;
  asof?: string | null;
  confirmed?: OiConfRow[];
}

/**
 * The OI-confirmation read for one root: how many of the prior session's big trades were
 * backed by an overnight open-interest build. Selection + a count, not a derivation.
 *
 * `covered:false` means the feed itself is absent (never built / 404) — distinct from a
 * present feed that confirmed nothing for this root, which is a real and useful answer.
 */
export interface OiConfRead {
  covered: boolean;
  count: number;
  /** Largest overnight OI build among this root's confirmed contracts. */
  topDeltaOi: number | null;
  asof: string | null;
}

export function oiConfRead(
  payload: OiConfPayload | OiConfRow[] | null | undefined,
  root: string
): OiConfRead {
  // The fixture ships a bare array; production ships {schema, asof, confirmed:[…]}.
  const isArray = Array.isArray(payload);
  const rows: OiConfRow[] | null = isArray
    ? (payload as OiConfRow[])
    : Array.isArray((payload as OiConfPayload | null)?.confirmed)
      ? (payload as OiConfPayload).confirmed!
      : null;
  if (!rows) return { covered: false, count: 0, topDeltaOi: null, asof: null };
  const want = (root ?? "").trim().toUpperCase();
  const mine = rows.filter((r) => (r?.root ?? "").toUpperCase() === want);
  let top: number | null = null;
  for (const r of mine) {
    const d = num(r.delta_oi);
    if (d !== null && (top === null || d > top)) top = d;
  }
  return {
    covered: true,
    count: mine.length,
    topDeltaOi: top,
    asof: isArray ? null : ((payload as OiConfPayload).asof ?? null),
  };
}

// ─── Structure strip ──────────────────────────────────────────────────────────

/**
 * Minimal STRUCTURAL VIEWS of the two level stores — the strip reads these fields and no
 * others. Deliberately without an index signature: the desk holds concrete payload types
 * (GexStatePayload / GexPayload) that must remain assignable to these views, and an index
 * signature would make every one of them fail structurally.
 */
export interface StructureGexState {
  asof?: string | null;
  call_wall?: number | null;
  put_wall?: number | null;
  gamma_flip?: number | null;
  max_pain?: number | null;
  magnet?: number | null;
  spot?: number | null;
}

export interface StructureGex {
  asof?: string | null;
  call_wall?: number | null;
  put_wall?: number | null;
  gamma_flip?: number | null;
  max_pain?: number | null;
  spot_ref?: number | null;
}

export type StructureCellKey =
  | "callWall"
  | "putWall"
  | "flip"
  | "expMove"
  | "maxPain"
  | "ivPct"
  | "oiConf";

/** Which settled store a cell's number came from — printed on hover, not guessed. */
export type StructureSource = "gexstate" | "gex" | "moves" | "vol" | "oiconf";

/**
 * What one settled read has established so far. Only "absent" (a 404/410) means the store
 * has nothing; "unavailable" is a read that did not land and says nothing about the store.
 */
export type EodReadStatus = "loading" | "data" | "absent" | "unavailable";

/** Why a cell with no value has none: the read failed, it is in flight, or it proved absence. */
export type StructureGap = "failed" | "reading" | "absent";

/** The stores each cell can be answered from. Levels read gex_state first, the ladder second. */
const CELL_SOURCES: Record<StructureCellKey, StructureSource[]> = {
  callWall: ["gexstate", "gex"],
  putWall: ["gexstate", "gex"],
  flip: ["gexstate", "gex"],
  maxPain: ["gexstate", "gex"],
  expMove: ["moves"],
  ivPct: ["vol"],
  oiConf: ["oiconf"],
};

/**
 * The gap behind a valueless cell. A failure on ANY store that could have answered wins:
 * that store might hold the value, so "not published" would be a claim nobody checked.
 */
export function structureCellGap(
  cell: StructureCell,
  reads: Record<StructureSource, EodReadStatus>
): StructureGap | null {
  if (cell.value !== null) return null;
  const statuses = CELL_SOURCES[cell.key].map((s) => reads[s]);
  if (statuses.includes("unavailable")) return "failed";
  if (statuses.includes("loading")) return "reading";
  return "absent";
}

export interface StructureCell {
  key: StructureCellKey;
  /** Preformatted display value, or null → the cell renders its absent state. */
  value: string | null;
  /** Secondary line (range, percentile context). null when not applicable. */
  detail: string | null;
  /** The SOURCE STORE's own as-of. Never the wall clock, never another store's. */
  vintage: string | null;
  source: StructureSource;
}

/**
 * ATM implied vol → percent, tolerating BOTH unit conventions in the wild.
 *
 * `options_hub/vol/{ROOT}.json` ships atm_iv as a PERCENT in production (SPY 15.89, with
 * iv_52w_hi 26.6); the checked-in vol fixture now ships percents too, so dev and prod agree.
 * The fraction branch stays because callers still hand this reader raw fractions. This
 * is not a heuristic invented here: macro's own `lib/options_context.structure_receipt`
 * carries the identical `iv < 5 → ×100` rule for exactly this reason, so a value that is
 * already a percent is never multiplied twice and a fraction is never printed as "0.6%".
 * (A real 500%+ ATM IV would be mis-scaled by this rule — and by macro's — but no listed
 * chain the options_hub universe covers reaches it.)
 */
export function ivPercent(iv: number | null | undefined): number | null {
  const n = num(iv);
  if (n === null || n <= 0) return null;
  return n < 5 ? n * 100 : n;
}

/** Top-level IV-family fields of options_hub.vol/v1 — every one of them a percent-or-fraction. */
const VOL_TOP_IV_KEYS = ["atm_iv", "iv_52w_hi", "iv_52w_lo", "rv20", "vrp"];

/**
 * Normalise an options_hub.vol/v1 payload to PERCENT units.
 *
 * The unit regime is decided ONCE per payload from an anchor field (atm_iv, else
 * iv_52w_hi, else the first term entry) via ivPercent — never per leaf value, so a
 * smile-tail IV below ivPercent's ×100 threshold (e.g. a 4.9 tail put_iv in a percent
 * payload) is never re-scaled. The factor is exactly 1 (already percent — live R2) or
 * 100 (fraction payload — the historical vol fixture).
 *
 * Rank fields (iv_rank_252, iv_rank_all, history[].iv_rank) are 0–100 under BOTH
 * conventions, and strike/close/dte/spot_ref are not vols at all — none are touched.
 */
export function normalizeVolUnits<T extends Record<string, unknown>>(payload: T): T {
  if (payload === null || typeof payload !== "object") return payload;
  const p = payload as Record<string, unknown>;

  const term = Array.isArray(p.term) ? p.term : null;
  const term0 =
    term && term[0] !== null && typeof term[0] === "object"
      ? (term[0] as Record<string, unknown>)
      : null;

  const anchor = [p.atm_iv, p.iv_52w_hi, term0?.atm_iv]
    .map(num)
    .find((n): n is number => n !== null && n > 0);
  if (anchor === undefined) return payload;

  const anchorPct = ivPercent(anchor);
  if (anchorPct === null) return payload;
  const k = anchorPct / anchor;
  if (k === 1) return payload;

  /** Scale a leaf, or hand back exactly what came in when it is not a finite number. */
  const scale = (v: unknown): unknown => {
    const n = num(v);
    return n === null ? v : Math.round(n * k * 1e6) / 1e6;
  };

  /** Copy an object, rescaling the listed keys. Absent keys stay absent — never undefined. */
  const rescaled = (o: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...o };
    for (const key of keys) if (key in o) out[key] = scale(o[key]);
    return out;
  };

  /** Map an array of row objects through `rescaled`, passing non-objects through. */
  const rescaledRows = (rows: unknown[], keys: string[]): unknown[] =>
    rows.map((r) =>
      r !== null && typeof r === "object" ? rescaled(r as Record<string, unknown>, keys) : r
    );

  const out = rescaled(p, VOL_TOP_IV_KEYS);

  if (term) out.term = rescaledRows(term, ["atm_iv"]);

  if (Array.isArray(p.smile)) {
    out.smile = p.smile.map((exp) => {
      if (exp === null || typeof exp !== "object") return exp;
      const e = exp as Record<string, unknown>;
      if (!Array.isArray(e.points)) return e;
      return { ...e, points: rescaledRows(e.points, ["call_iv", "put_iv"]) };
    });
  }

  if (Array.isArray(p.history)) out.history = rescaledRows(p.history, ["atm_iv"]);

  return out as T;
}

/** Level formatter matching GexSummaryBar's, so the two belts agree digit-for-digit. */
export function fmtLevel(v: number | null | undefined): string | null {
  const n = num(v);
  if (n === null) return null;
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

/** ISO stamp → YYYY-MM-DD. The belt stamps a SESSION, never a wall-clock time. */
export function eodDate(asof: string | null | undefined): string | null {
  if (typeof asof !== "string" || !asof) return null;
  const m = asof.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * YYYY-MM-DD → "Jul 23" / "7月23日".
 *
 * Deliberately string arithmetic, not `new Date(iso)`: parsing a bare date string yields
 * UTC midnight, which renders as the PREVIOUS day for any viewer west of Greenwich. A belt
 * whose whole job is stamping the right session must not lose a day to a timezone.
 */
export function fmtEodDay(iso: string | null | undefined, lang: Lang): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  return lang === "zh" ? `${mo}月${d}日` : `${MONTHS_EN[mo - 1]} ${d}`;
}

export interface StructureInputs {
  gexState?: StructureGexState | null;
  gex?: StructureGex | null;
  moves?: MovesPayload | null;
  vol?: VolPayload | null;
  oiConf?: OiConfPayload | OiConfRow[] | null;
  root: string;
}

/**
 * Build the seven EOD-context cells, in belt order.
 *
 * Levels prefer `gex_state` (the structure snapshot, which alone carries max pain) and fall
 * back to the `options_hub/gex` ladder payload. The fallback is NOT silent: the cell reports
 * which store answered and stamps that store's own session, because the two builders can be
 * a day apart and a reader comparing this belt to the ladder above it deserves to see why.
 */
export function buildStructureCells(inp: StructureInputs): StructureCell[] {
  const gs = inp.gexState ?? null;
  const gx = inp.gex ?? null;
  const gsDate = eodDate(gs?.asof);
  const gxDate = eodDate(gx?.asof);

  /** Prefer gex_state; fall back to the ladder payload; report which one answered. */
  const level = (
    key: StructureCellKey,
    pick: (s: StructureGexState) => number | null | undefined,
    fallback: (g: StructureGex) => number | null | undefined
  ): StructureCell => {
    const a = gs ? fmtLevel(pick(gs)) : null;
    if (a !== null) return { key, value: a, detail: null, vintage: gsDate, source: "gexstate" };
    const b = gx ? fmtLevel(fallback(gx)) : null;
    if (b !== null) return { key, value: b, detail: null, vintage: gxDate, source: "gex" };
    return { key, value: null, detail: null, vintage: null, source: "gexstate" };
  };

  const cells: StructureCell[] = [
    level("callWall", (s) => s.call_wall, (g) => g.call_wall),
    level("putWall", (s) => s.put_wall, (g) => g.put_wall),
    level("flip", (s) => s.gamma_flip, (g) => g.gamma_flip),
  ];

  // Expected move — options_hub/moves publishes the band whole (pct + lo/hi + multiplier).
  const em = inp.moves?.expected_move ?? null;
  const emPct = num(em?.pct);
  const lo = fmtLevel(em?.lo);
  const hi = fmtLevel(em?.hi);
  cells.push({
    key: "expMove",
    value: emPct === null ? null : `±${emPct.toFixed(1)}%`,
    detail: lo && hi ? `${lo} – ${hi}` : null,
    vintage: eodDate(inp.moves?.asof),
    source: "moves",
  });

  cells.push(level("maxPain", (s) => s.max_pain, (g) => g.max_pain));

  // IV percentile — options_hub/vol's own 252-session IV rank. Not recomputed.
  const ivr = num(inp.vol?.iv_rank_252);
  const atmIv = ivPercent(inp.vol?.atm_iv);
  cells.push({
    key: "ivPct",
    value: ivr === null ? null : `${Math.round(ivr)}`,
    detail: atmIv === null ? null : `ATM IV ${atmIv.toFixed(1)}%`,
    vintage: eodDate(inp.vol?.asof),
    source: "vol",
  });

  // OI confirmation — a count, with "feed absent" and "nothing confirmed" kept distinct.
  const oc = oiConfRead(inp.oiConf ?? null, inp.root);
  cells.push({
    key: "oiConf",
    value: oc.covered ? String(oc.count) : null,
    detail:
      oc.covered && oc.topDeltaOi !== null
        ? `+${Math.round(oc.topDeltaOi).toLocaleString("en-US")} OI`
        : null,
    vintage: eodDate(oc.asof),
    source: "oiconf",
  });

  return cells;
}

/** True when the strip has nothing at all to say — used to pick the whole-belt empty state. */
export function structureIsEmpty(cells: StructureCell[]): boolean {
  return cells.every((c) => c.value === null);
}

// ─── Prophet contract structure receipt (macro lib/options_context.structure_receipt) ──

/**
 * The receipt macro attaches to each plan's `option_contract.structure`.
 *
 * Every field is independently nullable — a contract with a bid/ask but no OI still gets a
 * receipt. `band_en`/`band_zh` and `note_en`/`note_zh` arrive PRE-TRANSLATED: the plain word
 * and its Tier-2 sentence are macro's, gauntleted there, and are rendered verbatim.
 */
export interface StructureReceipt {
  band?: "liquid" | "workable" | "wide" | "thin" | string | null;
  band_en?: string | null;
  band_zh?: string | null;
  spread_pct?: number | null;
  spread_abs?: number | null;
  open_interest?: number | null;
  oi_vintage?: string | null;
  iv_pct?: number | null;
  iv_rank_pct?: number | null;
  iv_rank_n_obs?: number | null;
  iv_rank_history_days?: number | null;
  iv_rank_young?: boolean | null;
  note_en?: string | null;
  note_zh?: string | null;
  authority_tier?: string | null;
}

/** Compact contract counts: 8,600 → "8.6k". Below 1,000 prints whole. */
export function fmtOiCompact(v: number | null | undefined): string | null {
  const n = num(v);
  if (n === null) return null;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}k`;
  return String(Math.round(abs));
}

/** English ordinal for a percentile — 1st / 2nd / 3rd / 11th / 44th. */
export function ordinal(n: number): string {
  const i = Math.round(n);
  const rem100 = i % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${i}th`;
  switch (i % 10) {
    case 1: return `${i}st`;
    case 2: return `${i}nd`;
    case 3: return `${i}rd`;
    default: return `${i}th`;
  }
}

export interface StructureReceiptLine {
  /** Glance tier: plain word + the compact numbers, mid-dot separated. */
  glance: string;
  /** Tier-2 hover: macro's own full sentences, verbatim. Empty string when absent. */
  detail: string;
  /** Worst-first band token, for tone. */
  band: string | null;
  /** True when a short IV history sits behind the percentile — disclosed, never hidden. */
  young: boolean;
}

/**
 * Render the receipt as one glance line + its Tier-2 detail, or null when there is no
 * receipt at all (pre-#3500 plans, or a contract macro could not price).
 *
 * The glance line is assembled from fields, not from prose, so a receipt missing OI or IV
 * degrades to a shorter honest line instead of printing "null" or a placeholder dash.
 */
export function structureReceiptLine(
  r: StructureReceipt | null | undefined,
  lang: Lang
): StructureReceiptLine | null {
  if (!r || typeof r !== "object") return null;
  const zh = lang === "zh";
  const band = (zh ? r.band_zh : r.band_en) ?? null;
  const spread = num(r.spread_pct);
  const oi = fmtOiCompact(r.open_interest);
  const ivRank = num(r.iv_rank_pct);
  const ivPct = num(r.iv_pct);

  const bits: string[] = [];
  if (band) bits.push(zh ? `合约${band}` : `${cap(band)} contract`);
  if (spread !== null) bits.push(zh ? `价差 ${spread}%` : `${spread}% spread`);
  if (oi) bits.push(zh ? `未平仓 ${oi}` : `${oi} OI`);
  if (ivRank !== null) {
    bits.push(
      zh
        ? `IV 处于自身区间第 ${Math.round(ivRank)} 百分位`
        : `IV ${ordinal(ivRank)} pctile of its range`
    );
  } else if (ivPct !== null) {
    bits.push(zh ? `IV ${ivPct}%` : `IV ${ivPct}%`);
  }
  if (!bits.length) return null;

  return {
    glance: bits.join(" · "),
    detail: ((zh ? r.note_zh : r.note_en) ?? "").trim(),
    band: r.band ?? null,
    young: r.iv_rank_young === true,
  };
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
