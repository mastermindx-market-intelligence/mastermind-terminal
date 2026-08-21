// ── PROPRIETARY MODEL — SERVER ONLY, ENFORCED ──────────────────────────────────────────────────
// This marker is the enforcement, not a convention. Next.js resolves `server-only` to a throwing
// module under any non-`react-server` condition, so importing this file from a Client Component is
// a BUILD ERROR rather than a silent leak of the weights below into the browser bundle.
//
// It lives HERE, in the implementation, rather than in `lib/flowSource.ts` which consumes it.
// flowSource carried a "SERVER-ONLY" comment, but a comment binds only the file it is written in:
// nothing stopped a future client component from importing `@/lib/flowScore` directly and pulling
// the whole weight table across the wire. The guarantee has to sit on the asset being protected.
//
// Client components receive the RESULT (`ev.flowScore`: score, tier, component labels) attached by
// `attachFlowScores` — never this module. See SECURITY.md.
//
// vitest runs in Node without the `react-server` condition, so `vitest.config.ts` aliases this
// specifier to a no-op; the fence that matters at build time is unaffected.
import "server-only";

/**
 * flowScore.ts — transparent flow_score_v1
 *
 * Scores a single FlowEvent on magnitude, structure, and positioning signals.
 * Direction (side) is the LOWEST-weight component because our tick-rule
 * recovery is 0.41 (coin-flip-plus) without NBBO — magnitude and OI/freshness
 * are the reliable reads (RELIABLE family).
 *
 * Positive weights sum to 0.95; a direction-reliability penalty (weight 0.05) can subtract up to 5 points,
 * making the achievable range 0–94 (ELITE ≥90 is reachable; 95–100 is not).
 *
 * Weight breakdown (documented here and reflected in each ScoreComponent):
 *   premiumMagnitude    0.30  — log ramp $50k → $5M; largest reliable signal
 *   unusualness         0.20  — z-score vs 252d session baseline (when present)
 *   dteRelevance        0.15  — peak 1–45d; 0DTE penalised for noise, >90d tapers
 *   freshPositioning    0.12  — vol > OI flag (new open interest, not roll)
 *   moneynessProximity  0.10  — ATM/near-OTM premium carries more gamma signal
 *   repeatCluster       0.08  — repeated or multi-print cluster lifts conviction
 *   directionReliability -0.05 — PENALTY when side is "mixed" or signing is floor-only
 *                                (soft signal without NBBO; never drives the score positive)
 *
 * Total budget: 0.30+0.20+0.15+0.12+0.10+0.08 = 0.95 upside, minus 0–0.05 penalty.
 * Normalised to 0–100 after summing raw weighted contributions.
 */

// ─── Types mirrored from OptionsHubView.tsx feed contract ───────────────────

type DteBucket = "0d" | "1_7d" | "8_30d" | "31_90d" | "90p";
type MnyBucket = "itm" | "atm" | "near_otm" | "far_otm";
type Side = "~buy" | "~sell" | "mixed";

/** Subset of FlowEvent fields consumed by the scorer. */
export interface ScorerInput {
  /** Gross premium in dollars (e.g. 1_200_000). Required. */
  premium: number;
  /** z-score vs 252-session baseline; null when baseline <30 sessions warm. */
  premium_z: number | null;
  /** DTE bucket string from feed contract. */
  dte_bucket: DteBucket;
  /** Exact days to expiry (may be 0 for 0DTE). */
  dte: number;
  /** Moneyness bucket. */
  mny_bucket: MnyBucket;
  /** Vol > OI flag: true = fresh open interest / new positioning. null = unknown. */
  vol_gt_oi: boolean | null;
  /** Whether this print is part of a cluster / previously repeated root. */
  repeated: boolean;
  /** Number of prints aggregated into this event. */
  n_prints: number;
  /** Tick-rule derived lean; "mixed" when conviction is absent. */
  side: Side;
  /**
   * Source of the side label:
   *   "tape"  — tick-rule heuristic (still soft — recovery 0.41)
   *   "floor" — floor-quote assumption only (softer)
   */
  signing_source: string;
  /** Whether this is a zero-DTE event (belt-and-suspenders beyond dte===0). */
  zerodte: boolean;
}

// ─── Output types ────────────────────────────────────────────────────────────

export type ScoreTier = "ELITE" | "STRONG" | "HIGH" | "MEDIUM" | "LOW";

export interface ScoreComponent {
  key: string;
  /** Human-readable English label. */
  label: string;
  /** Raw contribution to the 0–100 score (already weight-applied). */
  value: number;
  /** Documented weight for this component (0–1). */
  weight: number;
}

export interface FlowScoreResult {
  /** Final composite score 0–100 (integer). */
  score: number;
  /** Tier bucket derived from score. ELITE≥90, STRONG 80–89, HIGH 70–79, MEDIUM 60–69, LOW<60. */
  tier: ScoreTier;
  /** Ordered component breakdown for UI rendering. */
  components: ScoreComponent[];
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Log ramp: maps premium dollars to a 0–1 factor.
 *   ≤$50k   → 0.00
 *   $5M+    → 1.00
 *   linear in log space between the anchors.
 */
function premiumFactor(premiumDollars: number): number {
  const LO = Math.log(50_000);   // $50k lower anchor
  const HI = Math.log(5_000_000); // $5M upper anchor
  if (premiumDollars <= 50_000) return 0;
  if (premiumDollars >= 5_000_000) return 1;
  return (Math.log(premiumDollars) - LO) / (HI - LO);
}

/**
 * Unusualness factor from z-score.
 *   z ≤ 0   → 0.00
 *   z ≥ 4   → 1.00
 *   z = 2   → 0.50 (linear)
 */
function unusualnessFactor(z: number | null): number {
  if (z === null) return 0;
  if (z <= 0) return 0;
  if (z >= 4) return 1;
  return z / 4;
}

/**
 * DTE relevance factor.
 * Peak window: 1–45d (factor = 1.0).
 * 0DTE: 0.20 (high noise, very short theta exposure).
 * 46–90d: tapers linearly from 1.0 → 0.50.
 * >90d (bucket "90p"): 0.30 (far OTM / LEAPS roll, lower urgency).
 */
function dteFactor(dte: number, bucket: DteBucket): number {
  if (bucket === "0d" || dte === 0) return 0.20;
  if (dte >= 1 && dte <= 45) return 1.0;
  if (dte <= 90) {
    // Linear taper 45→90d: 1.0 → 0.5
    return 1.0 - ((dte - 45) / 45) * 0.5;
  }
  // >90d
  return 0.30;
}

/**
 * Moneyness proximity factor.
 * ATM carries the strongest gamma / directional signal.
 * ITM less informative (hedging, conversion arb).
 */
function moneynessFactor(bucket: MnyBucket): number {
  switch (bucket) {
    case "atm":      return 1.00;
    case "near_otm": return 0.85;
    case "itm":      return 0.50;
    case "far_otm":  return 0.30;
  }
}

/**
 * Fresh positioning factor: 1.0 when vol > OI (new open interest),
 * 0.40 when not (could be a close/roll), 0.60 when unknown.
 */
function freshFactor(volGtOi: boolean | null): number {
  if (volGtOi === true) return 1.0;
  if (volGtOi === null) return 0.60;
  return 0.40;
}

/**
 * Repeat/cluster factor.
 * Boosts when repeated root (accumulation pattern) or multi-print cluster.
 * n_prints > 1 adds a log bonus capped at 1.0.
 */
function clusterFactor(repeated: boolean, n_prints: number): number {
  let base = repeated ? 0.60 : 0.20;
  // Each additional print beyond 1 adds ~10pp (log-dampened)
  const printBonus = Math.min(0.40, Math.log1p(n_prints - 1) * 0.18);
  return Math.min(1.0, base + printBonus);
}

/**
 * Direction reliability penalty.
 * Returns a negative value (0 to −1) indicating how much to penalise the score
 * for directional unreliability. Applied with weight 0.05 so the maximum penalty
 * is 5 score points.
 *
 * Penalty is LARGEST when:
 *   - side === "mixed" (no dominant direction) AND
 *   - signing_source === "floor" (weakest evidence)
 *
 * Even "tape" signing is still tick-rule (0.41 recovery) so gets a mild penalty.
 */
function directionPenalty(side: Side, signingSource: string): number {
  const isMixed = side === "mixed";
  const isFloor = signingSource === "floor";
  if (isMixed && isFloor) return -1.0;  // worst: no direction AND weak signing
  if (isMixed) return -0.75;             // mixed but tape-signed
  if (isFloor) return -0.40;             // floor only, not mixed
  return -0.20;                          // tape-signed directional — still soft
}

/**
 * Derive score tier from a 0–100 composite score.
 */
function toTier(score: number): ScoreTier {
  if (score >= 90) return "ELITE";
  if (score >= 80) return "STRONG";
  if (score >= 70) return "HIGH";
  if (score >= 60) return "MEDIUM";
  return "LOW";
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Compute a transparent flow conviction score for a single FlowEvent.
 *
 * @param ev - A FlowEvent (or the ScorerInput subset) from the live feed.
 * @returns FlowScoreResult with score (0–100), tier, and per-component breakdown.
 *
 * Deterministic: no fetch, no randomness, no side effects.
 */
export function computeFlowScore(ev: ScorerInput): FlowScoreResult {
  // ── Component weights ──────────────────────────────────────────────────────
  const W_PREM     = 0.30;
  const W_UNUSUAL  = 0.20;
  const W_DTE      = 0.15;
  const W_FRESH    = 0.12;
  const W_MNY      = 0.10;
  const W_CLUSTER  = 0.08;
  const W_DIR_PEN  = 0.05; // penalty weight (applied to a negative factor)

  // ── Raw factors (0–1, or negative for penalty) ────────────────────────────
  const fPrem    = premiumFactor(ev.premium);
  const fUnusual = unusualnessFactor(ev.premium_z);
  const fDte     = dteFactor(ev.dte, ev.dte_bucket);
  const fFresh   = freshFactor(ev.vol_gt_oi);
  const fMny     = moneynessFactor(ev.mny_bucket);
  const fCluster = clusterFactor(ev.repeated, ev.n_prints);
  const fDirPen  = directionPenalty(ev.side, ev.signing_source); // ≤ 0

  // ── Weighted contributions (each contributes up to its weight × 100 pts) ──
  const cPrem    = fPrem    * W_PREM    * 100;
  const cUnusual = fUnusual * W_UNUSUAL * 100;
  const cDte     = fDte     * W_DTE     * 100;
  const cFresh   = fFresh   * W_FRESH   * 100;
  const cMny     = fMny     * W_MNY     * 100;
  const cCluster = fCluster * W_CLUSTER * 100;
  const cDirPen  = fDirPen  * W_DIR_PEN * 100; // negative

  const rawTotal = cPrem + cUnusual + cDte + cFresh + cMny + cCluster + cDirPen;
  const score    = Math.round(Math.min(100, Math.max(0, rawTotal)));
  const tier     = toTier(score);

  const components: ScoreComponent[] = [
    {
      key: "premiumMagnitude",
      label: "Premium magnitude",
      value: Math.round(cPrem * 10) / 10,
      weight: W_PREM,
    },
    {
      key: "unusualness",
      label: "Activity vs one-year norm",
      value: Math.round(cUnusual * 10) / 10,
      weight: W_UNUSUAL,
    },
    {
      key: "dteRelevance",
      label: "DTE relevance",
      value: Math.round(cDte * 10) / 10,
      weight: W_DTE,
    },
    {
      key: "freshPositioning",
      label: "Fresh positioning (vol>OI)",
      value: Math.round(cFresh * 10) / 10,
      weight: W_FRESH,
    },
    {
      key: "moneynessProximity",
      label: "Moneyness proximity",
      value: Math.round(cMny * 10) / 10,
      weight: W_MNY,
    },
    {
      key: "repeatCluster",
      label: "Repeat / cluster",
      value: Math.round(cCluster * 10) / 10,
      weight: W_CLUSTER,
    },
    {
      key: "directionReliability",
      label: "Direction-reliability penalty",
      value: Math.round(cDirPen * 10) / 10,
      weight: W_DIR_PEN,
    },
  ];

  return { score, tier, components };
}
