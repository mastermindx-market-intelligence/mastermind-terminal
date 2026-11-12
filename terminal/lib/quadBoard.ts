/**
 * quadBoard.ts — Market Structure Core, Wave 3. Delta-space exposure and the
 * cross-root positioning screener.
 *
 * Program of record: docs/VOLLAND_PARITY_PLAN_2026-08-01.md §5 (W3).
 *
 * ─── FLOATING STRIKE ────────────────────────────────────────────────────────────────
 * The same book, indexed by call-equivalent delta instead of by strike. A strike is a
 * fixed price; a delta is a position relative to where the market actually is. As spot
 * travels and time passes, "the 0.25-delta call wing" stays the same object while "the
 * 750 strike" quietly becomes something else. Reading exposure in delta space is what
 * makes today's picture comparable to last week's without re-basing anything by hand.
 *
 * Puts are folded onto the call axis upstream (a −0.30 put lives in the 0.70 bucket) —
 * a presentational fold only; the dealer sign is already in the exposure columns.
 *
 * ─── QUAD SCREENER ──────────────────────────────────────────────────────────────────
 * Volland scatters tickers on two axes each normalised to ±1 *within the current
 * cross-section*, which answers "most extreme compared to what else is on screen".
 * Ours ranks every root against ITS OWN history (see engine/quad_screener.py), so both
 * axes are already 0–100 and comparable without normalisation — and cannot be distorted
 * by which roots happen to be included.
 *
 * The axes are NOT direction and volatility in the price sense. They are dealer *gamma*
 * (does hedging dampen or amplify a move) and dealer *vanna* (does a vol move force
 * hedging), so the four corners are four hedging regimes rather than four market calls.
 *
 * ─── HONESTY (masterplan §4.1) ──────────────────────────────────────────────────────
 * Tier B throughout: both surfaces inherit the payload's dealer-sign convention. The
 * board's percentile framing is the sturdier half, and `n_days` rides with every row so
 * a thin history is visible rather than implied.
 */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// ─── Floating strike (delta-space exposure) ──────────────────────────────────────────

/** One `by_delta` row from `options_hub.gex/v1`. Bounds are call-equivalent delta. */
export interface DeltaBucketRow {
  lo: number;
  hi: number;
  gamma_net?: number | null;
  delta_net?: number | null;
  vanna_net?: number | null;
  charm_net?: number | null;
  n?: number | null;
}

export type BucketGreek = "gamma" | "delta" | "vanna" | "charm";

const BUCKET_FIELD: Record<BucketGreek, keyof DeltaBucketRow> = {
  gamma: "gamma_net",
  delta: "delta_net",
  vanna: "vanna_net",
  charm: "charm_net",
};

export interface FloatingBucket {
  lo: number;
  hi: number;
  /** Bucket midpoint — the natural x for a value-mapped axis. */
  mid: number;
  /** Hedging requirement in $mn: the NEGATIVE of the dealer position, as in W1. */
  hedgeMn: number;
  n: number;
}

export interface FloatingStrike {
  buckets: FloatingBucket[];
  maxAbsMn: number;
  /** Where the mass is: the delta band carrying the largest |requirement|. */
  peak: FloatingBucket | null;
  /** Σ across every bucket, $mn — the whole book under this greek. */
  totalMn: number;
}

const EMPTY_FLOATING: FloatingStrike = { buckets: [], maxAbsMn: 0, peak: null, totalMn: 0 };

/**
 * Turn published `by_delta` rows into the hedging-requirement view.
 *
 * Sign follows the W1 reframing exactly: a dealer holding positive gamma must SELL into
 * strength, so the requirement is the negative of the position. Keeping that identical
 * to `hedgeProfile` in marketStructure.ts matters — the two charts sit on one tab and a
 * sign that flipped between them would be read as a fact about the book.
 */
export function floatingStrike(
  rows: readonly DeltaBucketRow[] | null | undefined,
  greek: BucketGreek,
): FloatingStrike {
  if (!Array.isArray(rows) || rows.length === 0) return EMPTY_FLOATING;
  const field = BUCKET_FIELD[greek];

  const buckets: FloatingBucket[] = [];
  for (const r of rows) {
    if (!isNum(r?.lo) || !isNum(r?.hi)) continue;
    const v = r[field];
    if (!isNum(v)) continue;
    // −0 would render as "−0.0"; normalise at the source, not in the formatter.
    buckets.push({
      lo: r.lo,
      hi: r.hi,
      mid: (r.lo + r.hi) / 2,
      hedgeMn: v === 0 ? 0 : -v,
      n: isNum(r.n) ? r.n : 0,
    });
  }
  if (buckets.length === 0) return EMPTY_FLOATING;
  buckets.sort((a, b) => a.lo - b.lo);

  let maxAbsMn = 0;
  let peak: FloatingBucket | null = null;
  let totalMn = 0;
  for (const b of buckets) {
    totalMn += b.hedgeMn;
    const a = Math.abs(b.hedgeMn);
    if (a > maxAbsMn) {
      maxAbsMn = a;
      peak = b;
    }
  }
  return { buckets, maxAbsMn, peak, totalMn };
}

/** "C 70–75Δ" — the label Volland writes as C-70-75. */
export function bucketLabel(b: { lo: number; hi: number }): string {
  return `${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}Δ`;
}

// ─── Quad screener ───────────────────────────────────────────────────────────────────

export type Quadrant = "amplify_stable" | "amplify_volsens" | "dampen_stable" | "dampen_volsens";

export interface QuadRow {
  root: string;
  /** Observation session for this root; distinct from the index build date. */
  asof?: string;
  gamma_pctile: number;
  vanna_pctile: number;
  quadrant: Quadrant;
  gamma_bn?: number | null;
  vanna_bn?: number | null;
  spot?: number | null;
  atm_iv?: number | null;
  n_days: number;
  since?: string;
  extreme?: boolean;
}

export interface QuadPayload {
  schema?: string;
  asof?: string;
  min_history_days?: number;
  pctile_window_days?: number;
  extreme_pct?: number;
  n_roots?: number;
  n_skipped?: number;
  skipped?: string[];
  rows?: QuadRow[];
}

export interface QuadBoard {
  rows: QuadRow[];
  /** Rows at a historical extreme on either axis — what the board is for. */
  extremes: QuadRow[];
  /** Population of each corner, for the legend. */
  counts: Record<Quadrant, number>;
  asof: string | null;
  /** Roots dropped for thin history. Shown, never silently omitted. */
  skipped: string[];
  minHistoryDays: number | null;
  /**
   * Sessions each percentile was computed over. A percentile without its reference
   * window is not interpretable, so this is rendered rather than assumed.
   */
  pctileWindowDays: number | null;
}

const EMPTY_BOARD: QuadBoard = {
  rows: [],
  extremes: [],
  counts: {
    amplify_stable: 0, amplify_volsens: 0, dampen_stable: 0, dampen_volsens: 0,
  },
  asof: null,
  skipped: [],
  minHistoryDays: null,
  pctileWindowDays: null,
};

const QUADRANTS: Quadrant[] = [
  "amplify_stable", "amplify_volsens", "dampen_stable", "dampen_volsens",
];

function isQuadrant(v: unknown): v is Quadrant {
  return typeof v === "string" && (QUADRANTS as string[]).includes(v);
}

/**
 * Parse and summarise the cross-root board.
 *
 * Rows missing either coordinate are dropped rather than plotted at a default: a point
 * at (0, 0) is a claim that a root sits at both historical floors, which is exactly the
 * corner a reader would act on.
 */
export function quadBoard(payload: QuadPayload | null | undefined): QuadBoard {
  const rows = payload?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      ...EMPTY_BOARD,
      asof: typeof payload?.asof === "string" ? payload.asof : null,
      skipped: Array.isArray(payload?.skipped) ? payload.skipped : [],
      minHistoryDays: isNum(payload?.min_history_days) ? payload.min_history_days : null,
      pctileWindowDays: isNum(payload?.pctile_window_days) ? payload.pctile_window_days : null,
    };
  }

  const clean: QuadRow[] = [];
  for (const r of rows) {
    if (typeof r?.root !== "string" || !r.root) continue;
    if (!isNum(r.gamma_pctile) || !isNum(r.vanna_pctile)) continue;
    if (r.gamma_pctile < 0 || r.gamma_pctile > 100) continue;
    if (r.vanna_pctile < 0 || r.vanna_pctile > 100) continue;
    clean.push({
      ...r,
      quadrant: isQuadrant(r.quadrant) ? r.quadrant : deriveQuadrant(r.gamma_pctile, r.vanna_pctile),
      n_days: isNum(r.n_days) ? r.n_days : 0,
    });
  }

  const counts: Record<Quadrant, number> = {
    amplify_stable: 0, amplify_volsens: 0, dampen_stable: 0, dampen_volsens: 0,
  };
  for (const r of clean) counts[r.quadrant]++;

  // Most extreme first. Primary key is the furthest single axis — that is what makes a
  // root notable at all. Ties on it are common (both SPY and MSFT sat at 49.6 on the
  // real 2026-07-30 board), and resolving them by input order would make the ranking
  // depend on publisher iteration order. The tiebreak is the SUM of both distances, so
  // a root stretched on both axes outranks one stretched on a single axis — which is
  // also the more interesting book.
  const far = (r: QuadRow) =>
    Math.max(Math.abs(r.gamma_pctile - 50), Math.abs(r.vanna_pctile - 50));
  const spread = (r: QuadRow) =>
    Math.abs(r.gamma_pctile - 50) + Math.abs(r.vanna_pctile - 50);
  const extremes = clean
    .filter((r) => r.extreme === true)
    .sort((a, b) => far(b) - far(a) || spread(b) - spread(a) || a.root.localeCompare(b.root));

  return {
    rows: clean.sort((a, b) => a.gamma_pctile - b.gamma_pctile),
    extremes,
    counts,
    asof: typeof payload?.asof === "string" ? payload.asof : null,
    skipped: Array.isArray(payload?.skipped) ? payload.skipped : [],
    minHistoryDays: isNum(payload?.min_history_days) ? payload.min_history_days : null,
    pctileWindowDays: isNum(payload?.pctile_window_days) ? payload.pctile_window_days : null,
  };
}

/** Mirrors engine/quad_screener.quadrant — used only when the payload omits the field. */
export function deriveQuadrant(gammaPctile: number, vannaPctile: number): Quadrant {
  const hiG = gammaPctile >= 50;
  const hiV = vannaPctile >= 50;
  if (hiG && hiV) return "dampen_volsens";
  if (hiG) return "dampen_stable";
  if (hiV) return "amplify_volsens";
  return "amplify_stable";
}
