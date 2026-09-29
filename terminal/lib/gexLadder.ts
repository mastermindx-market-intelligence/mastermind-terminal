import { isoSession } from "./dte";
/**
 * gexLadder.ts — pure transforms behind the GEX desk's strike ladder (OEU T-A).
 *
 * Two jobs, both DOM-free so lib/__tests__/gexLadder.test.ts can assert them:
 *
 * 1. THE EXPIRY LENS. The ladder's expiry dropdown used to be a dead control — it set
 *    state nobody read, and the ladder stayed on the all-expiry aggregate. It stayed
 *    dead because the two stores carry DIFFERENT cuts of the same chain:
 *
 *      gex:{ROOT}     `by_strike[]`  per-STRIKE, every expiry summed   ($mn)
 *                     `by_expiry[]`  per-EXPIRY, every strike summed   ($mn)
 *      matrix:{ROOT}  `cells[]`      per (STRIKE × EXPIRY)             (whole dollars)
 *
 *    Neither store alone can answer "show me only 0DTE, by strike" — the CROSS of the
 *    two axes lives only in the matrix. So: the All lens reads `by_strike` (canonical,
 *    carries all four greeks); every narrower lens is computed from the matrix cells and
 *    converted to $mn so both sources share one unit and one formatter.
 *
 *    Honesty rules baked in here, not left to the view:
 *      - The matrix is gamma-only. Under DEX/VEX/CHEX there is no per-expiry cut, so the
 *        lens reports itself unavailable rather than filtering a greek it cannot filter.
 *      - A strike the matrix does not cover returns `null`, NOT 0 and NOT the aggregate.
 *        `null` renders as an em dash. A strike the matrix DOES cover but which carries
 *        no cell for the selected expiry remains unresolved, not inferred zero.
 *      - An expiry is only offered when the matrix actually holds cells for it at strikes
 *        the ladder shows. Two stores built by two nightly jobs drift (the live matrix ran
 *        two weeks behind the gex payload while this was written) — when they disagree the
 *        control goes dark with a reason instead of quietly lying.
 *      - "0DTE" is always relative to the MATRIX's own session (`matrix.asof`), never the
 *        gex payload's — the matrix's cells were computed as of its own snapshot, so a
 *        drifted matrix must not borrow "today" from the newer payload and relabel a
 *        14-DTE leg "0DTE". `matrixSessionsAgree` gates this: when the two stores disagree
 *        by more than a routine cadence gap, every narrow lens (zero / ex-zero / one) goes
 *        dark rather than summing — or mislabeling — across two different sessions. A cell
 *        for an expiry strictly before the matrix's own anchor day is dropped outright: it
 *        was already expired from the matrix's own vantage point and can be neither "0DTE"
 *        nor "what survives tonight".
 *
 * 2. THE BAR SCALE (bug B1). PEAK used to divide per-strike bars ($mn, per strike) by
 *    `max |history[].net_gex_bn|` — the SESSION's aggregate net in BILLIONS. Two different
 *    quantities, three orders of magnitude apart: on fixture data every bar collapsed to
 *    the 2px floor, on live data every bar saturated at full width. It is replaced by two
 *    bases that are the same quantity as the bars themselves.
 */

// ─── Source shapes (structural mirrors — no dependency on the client components) ────

/** One `matrix:{ROOT}` cell. `gex` is net gamma exposure in WHOLE DOLLARS. */
export interface GexMatrixCell {
  strike: number;
  expiry: string;
  gex: number | null;
}

/** The slice of `options_structure.matrix/v1` the ladder needs. */
export interface GexMatrix {
  asof?: string; // build clock, not the source session
  _build_meta?: { asof_date?: string | null } | null;
  spot?: number | null;
  expiries?: string[];
  strikes?: number[];
  cells?: GexMatrixCell[];
}

/** matrix `gex` is whole dollars; `by_strike` is $mn. One unit wins: $mn. */
const DOLLARS_PER_MN = 1e6;

// ─── Lens ───────────────────────────────────────────────────────────────────────────

/**
 * - `all`     every expiry (from `by_strike`)
 * - `zero`    the session's 0DTE expiry only
 * - `ex-zero` everything EXCEPT 0DTE ("what survives tonight")
 * - `one`     one named expiry
 */
export type ExpiryLensKind = "all" | "zero" | "ex-zero" | "one";

export interface ExpiryLens {
  kind: ExpiryLensKind;
  /** Set only when kind === "one". */
  exp?: string;
}

export const LENS_ALL: ExpiryLens = { kind: "all" };

/** Normalize an expiry key to its date part ("2026-07-11 00:00:00" → "2026-07-11"). */
export function normExp(exp: string | null | undefined): string {
  return typeof exp === "string" ? exp.slice(0, 10) : "";
}

/** Does this lens read the matrix (rather than the all-expiry `by_strike` aggregate)? */
export function lensNeedsMatrix(lens: ExpiryLens): boolean {
  return lens.kind !== "all";
}

// ─── Matrix coverage ────────────────────────────────────────────────────────────────

/**
 * The strikes the matrix actually covers, as a Set. A ladder strike inside this set with
 * no cell for the selected expiry remains unresolved; a ladder strike OUTSIDE it is
 * unknown — the matrix windowed it away — and must render as a dash.
 *
 * Falls back to the strikes present in `cells` when the payload omits the `strikes` axis.
 */
export function matrixStrikeSet(matrix: GexMatrix | null | undefined): Set<number> {
  const out = new Set<number>();
  if (!matrix) return out;
  if (Array.isArray(matrix.strikes) && matrix.strikes.length > 0) {
    for (const k of matrix.strikes) if (Number.isFinite(k)) out.add(k);
    return out;
  }
  for (const c of matrix.cells ?? []) if (Number.isFinite(c.strike)) out.add(c.strike);
  return out;
}

/**
 * Expiries the matrix can actually answer for THIS ladder: at least one cell whose strike
 * is a strike the ladder renders. Keyed by normalized (date-part) expiry.
 *
 * The strike test is what keeps a mismatched pair honest — a fixture (or a prod store that
 * fell behind) can carry a matrix for a different session whose strike axis does not
 * intersect the ladder at all. Expiry keys alone would look "covered"; every row would
 * then render a dash. Requiring a real overlap turns that into an honest disabled control.
 */
export function matrixExpiryCoverage(
  matrix: GexMatrix | null | undefined,
  ladderStrikes: Iterable<number>,
): Set<string> {
  const out = new Set<string>();
  if (!matrix?.cells?.length) return out;
  const wanted = new Set<number>();
  for (const k of ladderStrikes) wanted.add(k);
  if (wanted.size === 0) return out;
  for (const c of matrix.cells) {
    if (!wanted.has(c.strike)) continue;
    const e = normExp(c.expiry);
    if (e) out.add(e);
  }
  return out;
}

// ─── Per-strike values under a lens ─────────────────────────────────────────────────

/**
 * Calendar-day gap tolerated between the matrix's own session and the gex payload's
 * session before the narrow lenses are treated as untrustworthy. 4 covers a routine
 * long weekend plus a single Monday holiday (Fri close → Tue open); anything wider is
 * the documented drift failure mode ("two weeks behind"), not ordinary cadence.
 */
export const MAX_SESSION_GAP_DAYS = 4;

/**
 * Whether the matrix's own session and the gex payload's session are close enough that
 * summing the matrix under a narrow expiry lens is still honest. Date-part only (no
 * trading-calendar dependency); either side missing/unparseable is treated as disagreeing
 * — we cannot vouch for a session we cannot read.
 */
export function matrixSessionsAgree(
  matrixAsOf: string | null | undefined,
  gexAsOf: string | null | undefined,
): boolean {
  const m = normExp(matrixAsOf);
  const g = normExp(gexAsOf);
  if (!m || !g) return false;
  const mMs = Date.parse(`${m}T00:00:00Z`);
  const gMs = Date.parse(`${g}T00:00:00Z`);
  if (!Number.isFinite(mMs) || !Number.isFinite(gMs)) return false;
  return Math.abs(gMs - mMs) / 86_400_000 <= MAX_SESSION_GAP_DAYS;
}


/** These counts describe an explicit display grid, never provider/contract completeness. */
export interface LensStrikeDetail {
  knownMn: number | null;
  knownCells: number;
  unresolvedCells: number;
}
export interface LensStrikeValues {
  byStrike: Map<number, number>;
  covered: Set<number>;
  totalMn: number | null;
  knownTotalMn: number | null;
  cellCount: number;
  sourceSession: string | null;
  requestedExpiries: string[];
  byStrikeDetail: Map<number, LensStrikeDetail>;
  unresolvedPairCount: number;
  /** Selected-grid arithmetic only; never source quality or full-book validity. */
  complete: boolean;
  reason: "source_session_unavailable" | "different_source_session" | "invalid_axis" |
    "invalid_cell_identity" | "duplicate_cell_identity" | "unsupported_scope" |
    "numeric_overflow" | null;
}
export function isRealSessionDate(value: unknown): value is string { return isoSession(value)!==null; }
function describedGexDay(value: unknown): string | null {
  const bare=isoSession(value);
  if(bare) return bare;
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return isoSession(value.slice(0,10));
}
export function matrixSourceSession(matrix: GexMatrix | null | undefined): string | null {
  return isoSession(matrix?._build_meta?.asof_date);
}
/** Necessary only for the embedded same-snapshot composition; not a history or source-local display rule. */
export function matrixDescribedSessionsMatch(matrixSession: string | null | undefined, gexAsOf: string | null | undefined): boolean {
  const m=isoSession(matrixSession), g=describedGexDay(gexAsOf);
  return m!==null && g!==null && m===g;
}
export function matrixLensByStrike(
  matrix: GexMatrix | null | undefined, lens: ExpiryLens,
  gexAsOf: string | null | undefined,
  operation: "coupled-view" | "source-local" = "coupled-view",
): LensStrikeValues {
  const sourceSession=matrixSourceSession(matrix);
  const empty: LensStrikeValues={byStrike:new Map(),covered:new Set(),totalMn:null,knownTotalMn:null,
    cellCount:0,sourceSession,requestedExpiries:[],byStrikeDetail:new Map(),unresolvedPairCount:0,complete:false,reason:null};
  if(lens.kind==="all") return empty;
  if(!sourceSession) return {...empty,reason:"source_session_unavailable"};
  if(operation!=="source-local" && !matrixDescribedSessionsMatch(sourceSession,gexAsOf)) return {...empty,reason:"different_source_session"};
  if(!Array.isArray(matrix?.cells)||matrix.cells.length===0||matrix.cells.length>100000) return {...empty,reason:"unsupported_scope"};
  const seen=new Set<string>();
  for(const c of matrix.cells) {
    if(!c||typeof c!=="object"||!Number.isFinite(c.strike)||c.strike<=0||!isoSession(c.expiry)) return {...empty,reason:"invalid_cell_identity"};
    const key=c.strike+"|"+c.expiry;
    // Match existing companion ingress: reject the whole duplicate payload before scope filtering.
    if(seen.has(key)) return {...empty,reason:"duplicate_cell_identity"};
    seen.add(key);
  }
  if((matrix.strikes!=null&&!Array.isArray(matrix.strikes))||(matrix.expiries!=null&&!Array.isArray(matrix.expiries))) return {...empty,reason:"invalid_axis"};
  const ks=matrix.strikes?.length ? matrix.strikes : [...new Set(matrix.cells.map(c=>c.strike))];
  const es=matrix.expiries?.length ? matrix.expiries : [...new Set(matrix.cells.map(c=>c.expiry))];
  if(!ks.every(k=>Number.isFinite(k)&&k>0)||!es.every(e=>isoSession(e)!==null)) return {...empty,reason:"invalid_axis"};
  const strikes=new Set(ks), expiries=new Set(es);
  if(strikes.size!==ks.length||expiries.size!==es.length||matrix.cells.some(c=>!strikes.has(c.strike)||!expiries.has(c.expiry))) return {...empty,reason:"invalid_axis"};
  let selected=[...expiries].filter(e=>e>=sourceSession).sort();
  if(lens.kind==="zero") selected=selected.filter(e=>e===sourceSession);
  else if(lens.kind==="ex-zero") selected=selected.filter(e=>e!==sourceSession);
  else if(lens.kind==="one") {
    if(!isoSession(lens.exp)) return {...empty,reason:"unsupported_scope"};
    selected=selected.filter(e=>e===lens.exp);
  } else return {...empty,reason:"unsupported_scope"};
  if(!selected.length||strikes.size*selected.length>100000) return {...empty,reason:"unsupported_scope"};
  const out={...empty,covered:strikes,requestedExpiries:selected};
  const wanted=new Set(selected), values=new Map<number,Map<string,number|null>>();
  for(const c of matrix.cells) {
    if(!wanted.has(c.expiry)) continue;
    let row=values.get(c.strike); if(!row) {row=new Map();values.set(c.strike,row);}
    row.set(c.expiry,typeof c.gex==="number"&&Number.isFinite(c.gex)?c.gex/DOLLARS_PER_MN:null);
  }
  let sum=0;
  for(const k of strikes) {
    let knownMn=0, knownCells=0, unresolvedCells=0;
    for(const e of selected) {const v=values.get(k)?.get(e);if(v==null){unresolvedCells++;continue;}knownMn+=v;knownCells++;}
    if(!Number.isFinite(knownMn)) return {...empty,reason:"numeric_overflow"};
    out.byStrikeDetail.set(k,{knownMn:knownCells?knownMn:null,knownCells,unresolvedCells});
    if(knownCells===selected.length) out.byStrike.set(k,knownMn);
    out.cellCount+=knownCells;out.unresolvedPairCount+=unresolvedCells;sum+=knownMn;
  }
  if(!Number.isFinite(sum)) return {...empty,reason:"numeric_overflow"};
  out.knownTotalMn=out.cellCount?sum:null;
  out.complete=out.cellCount>0&&out.unresolvedPairCount===0;
  out.totalMn=out.complete?sum:null;
  return out;
}

/**
 * The expiry key that IS the snapshot's session day, or null. Date-part comparison only —
 * Uses the shared exact date validator without inferring a session from the wall clock.
 */
export function zeroDteExpiry(
  expiries: Iterable<string>,
  asOf: string | null | undefined,
): string | null {
  const base = describedGexDay(asOf);
  if (!base) return null;
  for (const e of expiries) {
    if (normExp(e) === base) return base;
  }
  return null;
}

/**
 * One ladder row's value under the active lens.
 *   - All lens → the caller's aggregate value (from `by_strike`), always a number.
 *   - Narrower lens → the complete selected-grid sum for that strike; `null` if any
 *     selected cell is unresolved or the matrix never covered the strike.
 * `null` is the honest dash. It is never silently replaced by the aggregate.
 */
export function lensValueForStrike(
  strike: number,
  aggregate: number,
  lens: ExpiryLens,
  vals: LensStrikeValues,
): number | null {
  if (lens.kind === "all") return aggregate;
  const v = vals.byStrike.get(strike);
  if (v != null) return v;
  return null; // Omitted/invalid is not a certified zero.
}

// ─── Bar scale (B1) ─────────────────────────────────────────────────────────────────

export interface ScaleBases {
  /** max |value| across the rows currently ON SCREEN (after the ±% range filter). */
  nowMax: number;
  /** max |value| across EVERY row of the snapshot, so range presets don't rescale bars. */
  ladderMax: number;
}

/** Largest finite magnitude in a list, ignoring nulls. 0 when there is nothing to measure. */
export function maxAbs(values: Iterable<number | null | undefined>): number {
  let m = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    const a = Math.abs(v);
    if (a > m) m = a;
  }
  return m;
}

/**
 * The two honest normalizers for the NOW | LADDER MAX toggle.
 *
 * Both are the SAME QUANTITY as the bars they scale — per-strike exposure under the active
 * greek + expiry lens — which is precisely what the old PEAK base was not. `visible` is the
 * range-filtered slice; `full` is the whole snapshot. A floor keeps a degenerate all-zero
 * ladder from dividing by zero.
 */
export function scaleBases(
  visible: Iterable<number | null | undefined>,
  full: Iterable<number | null | undefined>,
  floor = 0.001,
): ScaleBases {
  const nowMax = Math.max(maxAbs(visible), floor);
  const ladderMax = Math.max(maxAbs(full), nowMax);
  return { nowMax, ladderMax };
}

// ─── Formatters ─────────────────────────────────────────────────────────────────────

/**
 * Format a $mn quantity — `by_strike` / `by_expiry` values and every matrix-derived lens.
 *
 * The desk used to run ONE formatter over both $mn and $bn fields, so a strike carrying
 * $284.5M printed as "+284.50B" against live data (engine/options_hub.py divides those
 * columns by 1e6 and says so; only `net_gex_bn` is billions). Two formatters now, each
 * named for its unit, so the mix-up cannot recur silently.
 */
export function fmtMn(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  // A covered strike with nothing at this expiry is a real, directionless zero — "+0"
  // would imply a positive read where there is none. (An UNCOVERED strike is `null`
  // upstream and renders an em dash instead; the two states must stay distinguishable.)
  if (abs < 0.0005) return "0";
  const sign = v >= 0 ? "+" : "-";
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(2)}B`;
  if (abs >= 1) return `${sign}${abs.toFixed(1)}M`;
  return `${sign}${(abs * 1000).toFixed(0)}K`;
}

/** Format a $bn quantity — `net_gex_bn` and the session history only. */
export function fmtBn(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs < 5e-7) return "0";
  const sign = v >= 0 ? "+" : "-";
  if (abs >= 1) return `${sign}${abs.toFixed(2)}B`;
  if (abs >= 0.001) return `${sign}${(abs * 1000).toFixed(1)}M`;
  return `${sign}${(abs * 1e6).toFixed(0)}K`;
}

/** Unsigned $mn magnitude, for scale captions ("±284.5M"). */
export function fmtMnMag(v: number): string {
  return fmtMn(Math.abs(v)).replace(/^\+/, "");
}
