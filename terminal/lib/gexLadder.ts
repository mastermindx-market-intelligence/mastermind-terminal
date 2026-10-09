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
 *        no cell for the selected expiry is UNRESOLVED, not an inferred zero; one
 *        unresolved cell makes the strike row and the selected total unknown. A measured
 *        zero cell stays a zero.
 *      - An expiry is only offered when the matrix actually holds cells for it at strikes
 *        the ladder shows. Two stores built by two nightly jobs drift (the live matrix ran
 *        two weeks behind the gex payload while this was written) — when they disagree the
 *        control goes dark with a reason instead of quietly lying.
 *      - "0DTE" is always relative to the MATRIX's own source session
 *        (`_build_meta.asof_date`), never its build clock (`matrix.asof`, which crosses UTC
 *        midnight on late builds) and never the gex payload's — a drifted matrix must not
 *        borrow "today" from the newer payload and relabel a 14-DTE leg "0DTE".
 *        `matrixDescribedSessionsMatch` gates this: unless both stores describe the same
 *        session, every narrow lens (zero / ex-zero / one) goes dark rather than summing —
 *        or mislabeling — across two different sessions. A cell
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
  /** The build clock — NOT the source session. */
  asof?: string;
  /** `asof_date` is the source session the cells describe. */
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
 * no cell for the selected expiry is unresolved; a ladder strike OUTSIDE it is
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
 * One strike's row inside the selected grid. These counts describe the display grid
 * (matrix strikes × selected expiries), never provider or contract completeness.
 */
export interface LensStrikeDetail {
  /** Σ of the known cells for this strike, $mn; null when none of its cells is known. */
  knownMn: number | null;
  knownCells: number;
  unresolvedCells: number;
}

/** Why a narrow lens produced no grid at all (null when it did). */
export type LensUnavailableReason =
  | "source_session_unavailable"
  | "different_source_session"
  | "invalid_axis"
  | "invalid_cell_identity"
  | "duplicate_cell_identity"
  | "unsupported_scope"
  | "numeric_overflow";

export interface LensStrikeValues {
  /** strike → net gamma exposure in $mn, set ONLY for strikes whose every selected cell is known. */
  byStrike: Map<number, number>;
  /** The strike axis the lens was judged over — the same set for every narrow lens. */
  covered: Set<number>;
  /** Σ over the whole selected grid, $mn — null unless every selected cell is known. */
  totalMn: number | null;
  /** Σ of the known cells only, $mn — a disclosed subtotal, never a stand-in for the total. */
  knownTotalMn: number | null;
  /** Known cells that fed the subtotal. */
  cellCount: number;
  /** The matrix's own source session (`_build_meta.asof_date`), never its build clock. */
  sourceSession: string | null;
  /** The expiries the lens selected, ascending. */
  requestedExpiries: string[];
  /** One entry per covered strike, including strikes with no known cell. */
  byStrikeDetail: Map<number, LensStrikeDetail>;
  /** Selected (strike, expiry) pairs that are absent, null or non-finite. */
  unresolvedPairCount: number;
  /** Selected-grid arithmetic only; never a claim about source quality or the full book. */
  complete: boolean;
  reason: LensUnavailableReason | null;
}

/**
 * Calendar-day gap tolerated between the matrix's own session and the gex payload's
 * session by `matrixSessionsAgree`. 4 covers a routine long weekend plus a single Monday
 * holiday (Fri close → Tue open); anything wider is the documented drift failure mode
 * ("two weeks behind"), not ordinary cadence. The coupled desk view now requires the
 * stricter `matrixDescribedSessionsMatch`; this tolerance is kept for existing callers.
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

/** A real calendar date in strict `YYYY-MM-DD` form. */
export function isRealSessionDate(value: unknown): value is string {
  return isoSession(value) !== null;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** The day a gex payload describes: a bare session date, or the date part of a strict ISO instant. */
function describedGexDay(value: unknown): string | null {
  const bare = isoSession(value);
  if (bare) return bare;
  if (typeof value !== "string" || !ISO_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return isoSession(value.slice(0, 10));
}

/**
 * The session the matrix cells describe. `_build_meta.asof_date` is the producer's source
 * session; the top-level `asof` is only the build clock and crosses UTC midnight on late
 * builds, so it is never used as the 0DTE anchor.
 */
export function matrixSourceSession(matrix: GexMatrix | null | undefined): string | null {
  return isoSession(matrix?._build_meta?.asof_date);
}

/**
 * The coupled desk view shows matrix cells beside the gex payload's ladder, so both must
 * describe the SAME session. Exact equality — not a history or source-local display rule.
 */
export function matrixDescribedSessionsMatch(
  matrixSession: string | null | undefined,
  gexAsOf: string | null | undefined,
): boolean {
  const m = isoSession(matrixSession);
  const g = describedGexDay(gexAsOf);
  return m !== null && g !== null && m === g;
}

const MAX_GRID_CELLS = 100_000;

/**
 * Sum the matrix cells selected by `lens` down to one value per strike, in $mn.
 *
 * The selected grid is every matrix strike × every selected expiry on or after the source
 * session (an earlier expiry was already expired at capture time). Every pair in that
 * grid is required:
 *   - a known cell (finite `gex`, including a measured 0) contributes its value;
 *   - an absent pair, or a null / non-finite `gex`, is UNRESOLVED — never an inferred 0.
 * A strike row is set only when all its selected cells are known, and `totalMn` is set only
 * when the whole grid is known. The known part stays available as `knownTotalMn` so the view
 * can disclose it as a subtotal. The strike population (`covered`, `byStrikeDetail`) is the
 * matrix strike axis for every narrow lens, so changing the lens never silently changes it.
 *
 * `operation: "coupled-view"` (the desk) also requires the gex payload to describe the same
 * session (`matrixDescribedSessionsMatch`); `"source-local"` reads the matrix on its own.
 * A malformed document (bad axes, impossible dates, duplicate pairs) yields no grid and a reason.
 */
export function matrixLensByStrike(
  matrix: GexMatrix | null | undefined,
  lens: ExpiryLens,
  gexAsOf: string | null | undefined,
  operation: "coupled-view" | "source-local" = "coupled-view",
): LensStrikeValues {
  const sourceSession = matrixSourceSession(matrix);
  const empty: LensStrikeValues = {
    byStrike: new Map(),
    covered: new Set(),
    totalMn: null,
    knownTotalMn: null,
    cellCount: 0,
    sourceSession,
    requestedExpiries: [],
    byStrikeDetail: new Map(),
    unresolvedPairCount: 0,
    complete: false,
    reason: null,
  };
  const unavailable = (reason: LensUnavailableReason): LensStrikeValues => ({ ...empty, reason });

  if (lens.kind === "all") return empty;
  if (!sourceSession) return unavailable("source_session_unavailable");
  if (operation !== "source-local" && !matrixDescribedSessionsMatch(sourceSession, gexAsOf)) {
    return unavailable("different_source_session");
  }
  const cells = matrix?.cells;
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > MAX_GRID_CELLS) {
    return unavailable("unsupported_scope");
  }

  // Cell identity: a positive strike and a real session date; one cell per pair, document-wide.
  const seen = new Set<string>();
  for (const c of cells) {
    if (!c || typeof c !== "object" || !Number.isFinite(c.strike) || c.strike <= 0 || !isoSession(c.expiry)) {
      return unavailable("invalid_cell_identity");
    }
    const key = `${c.strike}|${c.expiry}`;
    if (seen.has(key)) return unavailable("duplicate_cell_identity");
    seen.add(key);
  }

  // Axes: unique, valid, and containing every cell. Missing axes fall back to the cells' own.
  if ((matrix!.strikes != null && !Array.isArray(matrix!.strikes))
    || (matrix!.expiries != null && !Array.isArray(matrix!.expiries))) {
    return unavailable("invalid_axis");
  }
  const strikeAxis = matrix!.strikes?.length ? matrix!.strikes : [...new Set(cells.map((c) => c.strike))];
  const expiryAxis = matrix!.expiries?.length ? matrix!.expiries : [...new Set(cells.map((c) => c.expiry))];
  if (!strikeAxis.every((k) => Number.isFinite(k) && k > 0) || !expiryAxis.every((e) => isoSession(e) !== null)) {
    return unavailable("invalid_axis");
  }
  const strikes = new Set(strikeAxis);
  const expiries = new Set(expiryAxis);
  if (strikes.size !== strikeAxis.length || expiries.size !== expiryAxis.length
    || cells.some((c) => !strikes.has(c.strike) || !expiries.has(c.expiry))) {
    return unavailable("invalid_axis");
  }

  // Selected expiries: on or after the source session, narrowed by the lens.
  let selected = [...expiries].filter((e) => e >= sourceSession).sort();
  if (lens.kind === "zero") selected = selected.filter((e) => e === sourceSession);
  else if (lens.kind === "ex-zero") selected = selected.filter((e) => e !== sourceSession);
  else if (lens.kind === "one") {
    // The lens key tolerates the ' 00:00:00' store shape; cell identities stay strict.
    const wantExp = isoSession(normExp(lens.exp));
    if (!wantExp) return unavailable("unsupported_scope");
    selected = selected.filter((e) => e === wantExp);
  } else return unavailable("unsupported_scope");
  if (selected.length === 0 || strikes.size * selected.length > MAX_GRID_CELLS) {
    return unavailable("unsupported_scope");
  }

  const wanted = new Set(selected);
  const values = new Map<number, Map<string, number | null>>();
  for (const c of cells) {
    if (!wanted.has(c.expiry)) continue;
    let row = values.get(c.strike);
    if (!row) { row = new Map(); values.set(c.strike, row); }
    row.set(c.expiry, typeof c.gex === "number" && Number.isFinite(c.gex) ? c.gex / DOLLARS_PER_MN : null);
  }

  const out: LensStrikeValues = { ...empty, covered: strikes, requestedExpiries: selected };
  let sum = 0;
  for (const k of strikes) {
    let knownMn = 0;
    let knownCells = 0;
    let unresolvedCells = 0;
    for (const e of selected) {
      const v = values.get(k)?.get(e);
      if (v == null) { unresolvedCells++; continue; }
      knownMn += v;
      knownCells++;
    }
    if (!Number.isFinite(knownMn)) return unavailable("numeric_overflow");
    out.byStrikeDetail.set(k, { knownMn: knownCells ? knownMn : null, knownCells, unresolvedCells });
    if (knownCells === selected.length) out.byStrike.set(k, knownMn);
    out.cellCount += knownCells;
    out.unresolvedPairCount += unresolvedCells;
    sum += knownMn;
  }
  if (!Number.isFinite(sum)) return unavailable("numeric_overflow");
  out.knownTotalMn = out.cellCount ? sum : null;
  out.complete = out.cellCount > 0 && out.unresolvedPairCount === 0;
  out.totalMn = out.complete ? sum : null;
  return out;
}

/**
 * The expiry key that IS the snapshot's session day, or null. Date-part comparison only;
 * the shared strict date validator admits the day, and no session is inferred from the wall clock.
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
 *   - All lens → the caller's aggregate value (from `by_strike`); null when the producer
 *     did not supply that greek for the strike.
 *   - Narrower lens → the complete selected-grid sum for that strike; `null` if any
 *     selected cell is unresolved or the matrix never covered the strike.
 * `null` is the honest dash. It is never silently replaced by the aggregate or by 0.
 */
export function lensValueForStrike(
  strike: number,
  aggregate: number | null,
  lens: ExpiryLens,
  vals: LensStrikeValues,
): number | null {
  if (lens.kind === "all") return aggregate;
  return vals.byStrike.get(strike) ?? null;
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
  // A measured zero is a real, directionless zero — "+0" would imply a positive read where
  // there is none. (An unknown value is `null` upstream and renders an em dash instead; the
  // two states must stay distinguishable.)
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
