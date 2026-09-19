/**
 * matrixDoc.ts — the `matrix:{ROOT}` payload contract, as the Exposure desk reads it.
 *
 * §5.3: the retired PRISM tab declared this shape inside a VIEW component
 * (prism/PrismView.tsx) and its sibling views imported the type from there. The desk
 * reads the same store from three places (expiry lens, matrix view, heat-seeker), so
 * the contract lives in its own module instead.
 *
 * Assignable BOTH ways by construction:
 *   • to `GexMatrix` (lib/gexLadder) — what the expiry lens sums;
 *   • to `StrikeExpiryDoc` (components/shared/StrikeExpiryMatrix) — what the shared
 *     matrix renderer draws.
 * Keep it that way: widening `gex` to optional would silently break the first.
 */

import type { MatrixLevels } from "@/components/shared/StrikeExpiryMatrix";
import type { HeatSeekerPick } from "./HeatSeekerCard";
import type { GexStatePayload } from "./MarketStateCard";

export const MATRIX_DOC_SCHEMA = "options_structure.matrix/v1" as const;

export type MatrixUnusualStatus = "normal" | "unusual";

/**
 * One side's settled-session volume against its own exact-contract history.
 *
 * This is deliberately nested under call/put. A scalar ratio would erase the side
 * identity and could make a quiet put look unusual because its call was busy (or the
 * reverse). Values still cross an explicit runtime guard before the desk renders them.
 */
export interface MatrixUnusualSide {
  ratio?: number | null;
  median_vol_30d?: number | null;
  samples?: number | null;
  status?: MatrixUnusualStatus | string | null;
}

export interface MatrixUnusualSides {
  call?: MatrixUnusualSide | null;
  put?: MatrixUnusualSide | null;
}

/** One matrix cell. `gex` is net gamma exposure in WHOLE DOLLARS. */
export interface MatrixDocCell {
  strike: number;
  expiry: string;
  gex: number | null;
  call_oi?: number | null;
  put_oi?: number | null;
  call_vol?: number | null;
  put_vol?: number | null;
  /** The builder publishes an OBJECT {call, put} (PIT-lagged ΔOI per leg). */
  delta_oi?: { call?: number | null; put?: number | null } | null;
  /**
   * Exact-side EOD volume baseline. `null` means neither side is eligible yet;
   * absence means this older snapshot did not publish the baseline at all.
   */
  unusual?: MatrixUnusualSides | null;
}

export interface MatrixDoc {
  schema?: string;
  asof?: string;
  root?: string;
  spot?: number | null;
  expiries?: string[];
  strikes?: number[];
  cells?: MatrixDocCell[];
  /**
   * Structural levels from the matrix snapshot. Current Macro uses the canonical
   * raw-chain spot-grid flip (or null), not the retired cumulative-strike estimate.
   * This type does not attest the method or freshness of an arbitrary old payload.
   */
  levels?: MatrixLevels | null;
  heat_seeker?: HeatSeekerPick | null;
  authority_tier?: string;
  /** Prod: the SESSION date; the top-level asof is the build timestamp. */
  _build_meta?: { asof_date?: string | null } | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Runtime envelope guard for the root-keyed matrix read.
 *
 * `safeFetch<T>` only narrows TypeScript; it does not validate network bytes. Refusing a
 * wrong schema or root prevents a cached/substituted matrix from wearing the selected
 * ticker's header. Cell-level optional fields remain guarded by their own consumers so
 * one malformed optional annotation cannot discard an otherwise usable heatmap.
 */
export function isMatrixDocForRoot(value: unknown, expectedRoot: string): value is MatrixDoc {
  if (!isRecord(value) || value.schema !== MATRIX_DOC_SCHEMA || !Array.isArray(value.cells)) {
    return false;
  }
  const root = typeof value.root === "string" ? value.root.trim().toUpperCase() : "";
  return root.length > 0 && root === expectedRoot.trim().toUpperCase();
}

/** A plotted price is not a count: missing, non-finite and nonpositive stay null. */
const price = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/** Selected-root state admission; retains source clocks and non-price context. */
export function readGexStateForRoot(value: unknown, expectedRoot: string): GexStatePayload | null {
  if (!isRecord(value) || value.schema !== "options_structure.gex_state/v1") return null;
  const root = typeof value.root === "string" ? value.root.trim().toUpperCase() : "";
  if (!root || root !== expectedRoot.trim().toUpperCase()) return null;
  return {
    ...value, root,
    gamma_flip: price(value.gamma_flip), call_wall: price(value.call_wall),
    put_wall: price(value.put_wall), magnet: price(value.magnet), spot: price(value.spot),
  } as unknown as GexStatePayload;
}

/** The gex_state fields the levels merge reads. */
export interface MatrixStateLevels {
  root?: string;
  call_wall?: number | null;
  put_wall?: number | null;
  gamma_flip?: number | null;
  magnet?: number | null;
  hvl?: number | null;
}

/**
 * ONE level-selection rule for every matrix surface (§5.3).
 *
 * Preserve state-first flip precedence and matrix-first structural levels. Current
 * Macro computes both flips with its raw-chain spot-grid method; the old comment
 * describing every matrix flip as retired was stale (Terminal #591). Refuse invalid
 * price values and an explicitly mismatched state root, without replacing missing
 * data by a synthetic level. Snapshot/method provenance is not inferred here.
 */
export function mergeMatrixLevels(
  matrix: MatrixDoc | null | undefined,
  state: MatrixStateLevels | null | undefined
): MatrixLevels {
  const sameRoot = !matrix?.root || !state?.root ||
    matrix.root.trim().toUpperCase() === state.root.trim().toUpperCase();
  const accepted = sameRoot ? state : null;
  return {
    call_wall: price(matrix?.levels?.call_wall) ?? price(accepted?.call_wall),
    put_support: price(matrix?.levels?.put_support) ?? price(accepted?.put_wall),
    hvl: price(matrix?.levels?.hvl) ?? price(accepted?.hvl) ?? price(accepted?.magnet),
    gamma_flip: price(accepted?.gamma_flip) ?? price(matrix?.levels?.gamma_flip),
    max_pain: price(matrix?.levels?.max_pain),
  };
}
