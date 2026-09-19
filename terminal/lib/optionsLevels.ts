/**
 * optionsLevels.ts — pure derivation for the chart's Options Levels overlay (R3.1).
 *
 * Turns `options_hub.gex/v1`, `options_structure.gex_state/v1`, and
 * `options_hub.moves/v1` payloads into the price-line set ChartPanel draws on the price
 * pane: call wall, put wall, gamma flip,
 * absolute-gamma strike and the published expected-move band. Pure functions only —
 * ChartPanel owns the fetch (lib/flowClientCache) and the createPriceLine lifecycle.
 *
 * Program of record: docs/MARKET_STRUCTURE_CORE_MASTERPLAN_2026-08-01.md §R3.1.
 *
 * ─── HONESTY (masterplan §4.1) ────────────────────────────────────────────────────────
 * These are dealer-POSITIONING landmarks, not support/resistance calls: the live Level
 * Report Card measures single-name P(hold | touched) at ≈ coin flip for every role
 * (call wall 49.0% [47.1–50.9] n=2,599 on first run), so no surface may frame a wall as
 * a hold claim. Walls/flip inherit the payload's dealer-sign convention (Tier B — the
 * legend row carries the "signed estimate" disclosure); the EM band is Tier A arithmetic
 * on quoted prices. Flip preference: `profile.crossings` nearest spot — the re-priced
 * curve and the scalar come from one evaluation upstream, but the crossing generalises
 * to multi-root books; the scalar is the fallback for pre-profile payloads.
 */

import { topology, type MscMoves, type MscStrikeRow } from "./marketStructure";

export type OptLevelKey =
  | "call_wall"
  | "put_wall"
  | "gamma_flip"
  | "abs_gamma"
  | "em_hi"
  | "em_lo";

export interface OptLevel {
  key: OptLevelKey;
  price: number;
}

export interface OptLevelsResult {
  /** "ok" = at least one drawable level; "empty" = no options coverage for this root. */
  status: "ok" | "empty";
  levels: OptLevel[];
  /** Oldest contributing session date, or null when any contributing lane is undated. */
  asofDate: string | null;
  /**
   * True when a dealer-SIGNED level (wall or flip) is drawn — the legend's Tier-B
   * "signed estimate" disclosure rides this. An EM-only or abs-gamma-only set is Tier A
   * arithmetic and must NOT carry the disclosure (masterplan §4.1: disclose at the tier
   * of what is actually shown, never a blanket label).
   */
  signed: boolean;
  spot: number | null;
  netGexBn: number | null;
}

/** Structural subset of `options_hub.gex/v1` this module reads. */
interface GexSubset {
  root?: unknown;
  asof?: unknown;
  spot_ref?: unknown;
  net_gex_bn?: unknown;
  gamma_flip?: unknown;
  call_wall?: unknown;
  put_wall?: unknown;
  by_strike?: unknown;
  profile?: { grid?: unknown; gamma_bn?: unknown; crossings?: unknown } | null;
}

/** Structural subset of the current `options_structure.gex_state/v1` fallback lane. */
interface GexStateSubset {
  root?: unknown;
  asof?: unknown;
  spot?: unknown;
  net_gex_bn?: unknown;
  gamma_flip?: unknown;
  call_wall?: unknown;
  put_wall?: unknown;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const posNum = (v: unknown): number | null => (isNum(v) && v > 0 ? v : null);

/**
 * Unwrap a root-keyed envelope ({SPY: {...}}) or a bare payload; reject another root's
 * data — never another ticker's structure wearing this ticker's header. Mirrors the
 * Positioning tab's pickRoot (components/msc/PositioningView.tsx).
 */
export function pickRootPayload<T extends { root?: unknown }>(
  data: unknown,
  root: string,
): T | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  const inner = (rec[root] as T | undefined) ?? (rec as unknown as T);
  if (!inner || typeof inner !== "object") return null;
  if (typeof inner.root === "string" && inner.root.toUpperCase() !== root) return null;
  return inner;
}

/**
 * ET weekday sessions elapsed since `asofDate` (YYYY-MM-DD). Calendar weekdays stand in
 * for trading sessions (a holiday reads one high — fine for a staleness tone, never shown
 * as a precise trading-day count). Mirrors the options tabs' sessionsOld; `todayEt` is
 * injectable for tests.
 */
export function sessionsOldEt(asofDate: string, todayEt?: string): number {
  const start = Date.parse(`${asofDate}T00:00:00Z`);
  if (!Number.isFinite(start)) return 0;
  const today =
    todayEt ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end) || end <= start) return 0;
  let n = 0;
  const cur = new Date(start);
  for (let guard = 0; guard < 800; guard++) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (cur.getTime() > end) break;
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/**
 * The profile grid spans ±25% of spot — a "flip" further than ±30% cannot have come from
 * that evaluation and is either a stale pre-repair scalar (the retired cumulative
 * estimator printed SPY 275 against spot 742) or garbage. Better no line than a wrong one.
 */
export const FLIP_MAX_DIST_PCT = 0.30;

const flipInBand = (value: number, spot: number | null): boolean =>
  spot == null || Math.abs(value / spot - 1) <= FLIP_MAX_DIST_PCT;

/** Flip = profile crossing nearest spot when the re-priced curve exists, else the scalar
 *  — both sanity-gated to the grid's own reachable band around spot. */
function flipOf(gp: GexSubset, spot: number | null): number | null {
  const crossings = gp.profile?.crossings;
  if (Array.isArray(crossings) && spot != null) {
    const valid = crossings.filter((c): c is number => posNum(c) != null && flipInBand(c, spot));
    if (valid.length) {
      return valid.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a));
    }
  }
  const scalar = posNum(gp.gamma_flip);
  return scalar != null && flipInBand(scalar, spot) ? scalar : null;
}

const dateOf = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

/**
 * Derive the drawable level set for `root` from raw gex + moves + state payloads (each may
 * be an envelope, bare, or null). Never throws on malformed input — a level that fails
 * validation is dropped, and zero drawable levels reads as "empty" (no coverage).
 */
export function deriveOptLevels(
  gexRaw: unknown,
  movesRaw: unknown,
  root: string,
  stateRaw: unknown = null,
): OptLevelsResult {
  const empty: OptLevelsResult = {
    status: "empty",
    levels: [],
    asofDate: null,
    signed: false,
    spot: null,
    netGexBn: null,
  };
  const gp = pickRootPayload<GexSubset>(gexRaw, root);
  const state = pickRootPayload<GexStateSubset>(stateRaw, root);

  const gexSpot = posNum(gp?.spot_ref);
  const stateSpot = posNum(state?.spot);
  const spot = gexSpot ?? stateSpot;

  // The strike-resolved ladder stays authoritative. gex_state is a current, root-scoped
  // fallback for fields the ladder could not publish (for example INTC's no-OI shell).
  const gexCallWall = posNum(gp?.call_wall);
  const stateCallWall = posNum(state?.call_wall);
  const callWall = gexCallWall ?? stateCallWall;
  const gexPutWall = posNum(gp?.put_wall);
  const statePutWall = posNum(state?.put_wall);
  const putWall = gexPutWall ?? statePutWall;
  const gexFlip = gp ? flipOf(gp, gexSpot) : null;
  const stateFlipScalar = posNum(state?.gamma_flip);
  const stateFlipSpot = stateSpot ?? gexSpot;
  const stateFlip = stateFlipScalar != null && flipInBand(stateFlipScalar, stateFlipSpot)
    ? stateFlipScalar
    : null;
  const flip = gexFlip ?? stateFlip;

  const rows = Array.isArray(gp?.by_strike) ? (gp.by_strike as MscStrikeRow[]) : null;
  const absGamma = posNum(topology(rows).absGammaStrike);

  const levels: OptLevel[] = [];
  if (callWall != null) levels.push({ key: "call_wall", price: callWall });
  if (putWall != null) levels.push({ key: "put_wall", price: putWall });
  if (flip != null) levels.push({ key: "gamma_flip", price: flip });
  // The abs-gamma strike frequently IS a wall — a duplicate line at the same price just
  // doubles the axis label, so the wall keeps the slot and abs-gamma yields.
  if (absGamma != null && absGamma !== callWall && absGamma !== putWall) {
    levels.push({ key: "abs_gamma", price: absGamma });
  }

  // EM band: the published lo/hi at the payload's band_mult — Tier A, and calibrated
  // upstream (moves.calibration). Optional: a missing moves payload drops the band only.
  const mp = pickRootPayload<MscMoves & { root?: unknown; asof?: unknown }>(movesRaw, root);
  const emLo = posNum(mp?.expected_move?.lo);
  const emHi = posNum(mp?.expected_move?.hi);
  const hasExpectedMove = emLo != null && emHi != null && emLo < emHi;
  if (hasExpectedMove) {
    levels.push({ key: "em_lo", price: emLo });
    levels.push({ key: "em_hi", price: emHi });
  }

  if (!levels.length) return empty;

  // One legend date cannot represent a mixed-vintage overlay. Choose the oldest ACTUALLY
  // contributing lane so a fresh gex_state fallback can never make an older EM band look fresh.
  // Unused fallback payloads do not affect provenance.
  const usedGex = gexCallWall != null || gexPutWall != null || gexFlip != null || absGamma != null;
  const usedState = (gexCallWall == null && stateCallWall != null)
    || (gexPutWall == null && statePutWall != null)
    || (gexFlip == null && stateFlip != null);
  const contributors = [
    { used: usedGex, date: dateOf(gp?.asof) },
    { used: usedState, date: dateOf(state?.asof) },
    { used: hasExpectedMove, date: dateOf(mp?.asof) },
  ];
  const hasUndatedContributor = contributors.some((contributor) => contributor.used && contributor.date == null);
  const dates = contributors
    .filter((contributor): contributor is { used: true; date: string } => contributor.used && contributor.date != null)
    .map((contributor) => contributor.date)
    .sort();

  return {
    status: "ok",
    levels,
    asofDate: hasUndatedContributor ? null : dates[0] ?? null,
    signed: levels.some(
      (level) => level.key === "call_wall" || level.key === "put_wall" || level.key === "gamma_flip",
    ),
    spot,
    netGexBn: isNum(gp?.net_gex_bn)
      ? gp.net_gex_bn
      : isNum(state?.net_gex_bn)
        ? state.net_gex_bn
        : null,
  };
}
