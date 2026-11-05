import { emFrame, type ExposureNode, type MscMoves } from './marketStructure';

/**
 * Deterministic, descriptive geometry over supplied exposure nodes.
 *
 * Scope, stated plainly:
 * - Every output is descriptive arithmetic over already-known rows. There are no
 *   probabilities, no scores, no forecasts, and no trading stance anywhere here.
 * - A row whose netMn is null, NaN or +/-Infinity is UNKNOWN. Unknown rows are
 *   withheld from measured outputs (ranking, nearest rows, ratios) and are never
 *   silently promoted to a measured zero.
 * - intervening is the single pure-geometry output: it places supplied rows by
 *   strike position only and may include rows whose net is unknown. Consumers
 *   must not read an absent netMn as zero.
 * - absoluteNetShare is the covered absolute NET share of the supplied rows:
 *   the largest absolute net over the sum of absolute nets for the SAME fully
 *   known rows. It is NOT a gross share and NOT a whole-market or open-interest
 *   share; it says nothing about any row or venue that was not supplied.
 */

/** Result shape of {@link describeExposure}; inputs are never mutated. */
export interface ExposureDescription {
  /** Known rows sorted by descending absolute net; row objects are shared references. */
  ranked: ExposureNode[];
  /** Nearest known row strictly above a valid spot, else null. */
  above: ExposureNode | null;
  /** Nearest known row strictly below a valid spot, else null. */
  below: ExposureNode | null;
  /** Distance from spot to target in points; both must be finite and positive. */
  distancePoints: number | null;
  /** distancePoints expressed as a percent of spot. */
  distancePercent: number | null;
  /** Supplied rows with a finite strike strictly between spot and target, ordered along the travel direction; endpoints excluded. */
  intervening: ExposureNode[];
  /** Second-largest over largest absolute net, only when every supplied row is fully known. */
  runnerUpRatio: number | null;
  /** True when runnerUpRatio is at least 0.9; null whenever runnerUpRatio is null. */
  contested: boolean | null;
  /** Covered absolute NET share of the largest known row (not gross, not whole-market), else null. */
  absoluteNetShare: number | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A row is measurable when its net is a known finite nonzero number and its strike is finite. */
function isKnownNonzeroNet(node: ExposureNode): node is ExposureNode & { netMn: number } {
  return node.netMn !== null && isFiniteNumber(node.netMn) && node.netMn !== 0;
}

/** Distance gating requires a finite, positive reference level for both endpoints. */
function isPositiveFinite(value: number | null): value is number {
  return isFiniteNumber(value) && value > 0;
}

interface RankedRow {
  node: ExposureNode & { netMn: number };
  magnitude: number;
}

/**
 * Ratios are only confident when EVERY supplied row is fully known: a finite net
 * plus a unique, positive, finite strike. A single unknown or malformed row
 * withholds every ratio rather than producing a confident-looking number.
 */
function isFullyKnown(nodes: readonly ExposureNode[]): boolean {
  if (nodes.length === 0) return false;
  const seenStrikes = new Set<number>();
  for (const node of nodes) {
    if (node.netMn === null || !isFiniteNumber(node.netMn)) return false;
    if (!isFiniteNumber(node.strike) || node.strike <= 0) return false;
    if (seenStrikes.has(node.strike)) return false;
    seenStrikes.add(node.strike);
  }
  return true;
}

/**
 * Describe the exposure ladder deterministically: ranked known rows, the nearest
 * known rows above and below a valid spot, spot-to-target distance, the route of
 * supplied rows between spot and target, and concentration ratios over fully
 * known rows. The input array and its rows are never mutated; returned arrays
 * are fresh while row objects are shared, read-only references.
 */
export function describeExposure(
  nodes: readonly ExposureNode[],
  spot: number | null,
  target: number | null,
): ExposureDescription {
  const placed: RankedRow[] = [];
  for (const node of nodes) {
    if (isPositiveFinite(node.strike) && isKnownNonzeroNet(node)) {
      placed.push({ node, magnitude: Math.abs(node.netMn) });
    }
  }

  const reference = isPositiveFinite(spot) ? spot : null;

  placed.sort((a, b) => {
    if (a.magnitude !== b.magnitude) return b.magnitude - a.magnitude;
    if (reference !== null) {
      const distanceA = Math.abs(a.node.strike - reference);
      const distanceB = Math.abs(b.node.strike - reference);
      if (distanceA !== distanceB) return distanceA - distanceB;
    }
    return a.node.strike - b.node.strike;
  });
  const ranked: ExposureNode[] = placed.map((row) => row.node);

  let above: ExposureNode | null = null;
  let below: ExposureNode | null = null;
  if (reference !== null) {
    for (const row of placed) {
      const strike = row.node.strike;
      if (strike > reference && (above === null || strike < above.strike)) above = row.node;
      if (strike < reference && (below === null || strike > below.strike)) below = row.node;
    }
  }

  let distancePoints: number | null = null;
  let distancePercent: number | null = null;
  if (isPositiveFinite(spot) && isPositiveFinite(target)) {
    distancePoints = target - spot;
    distancePercent = (distancePoints / spot) * 100;
  }

  const intervening: ExposureNode[] = [];
  if (reference !== null && isPositiveFinite(target)) {
    const low = Math.min(reference, target);
    const high = Math.max(reference, target);
    const stops = nodes.filter(
      (node) => isFiniteNumber(node.strike) && node.strike > low && node.strike < high,
    );
    stops.sort((a, b) => (target >= reference ? a.strike - b.strike : b.strike - a.strike));
    for (const stop of stops) intervening.push(stop);
  }

  let runnerUpRatio: number | null = null;
  let contested: boolean | null = null;
  let absoluteNetShare: number | null = null;
  if (isFullyKnown(nodes) && placed.length > 0) {
    let total = 0;
    for (const row of placed) total += row.magnitude;
    absoluteNetShare = Number.isFinite(total) && total > 0 ? placed[0].magnitude / total : null;
    if (placed.length > 1) {
      const ratio = placed[1].magnitude / placed[0].magnitude;
      runnerUpRatio = ratio;
      contested = ratio >= 0.9;
    }
  }

  return {
    ranked,
    above,
    below,
    distancePoints,
    distancePercent,
    intervening,
    runnerUpRatio,
    contested,
    absoluteNetShare,
  };
}

/** Civil source dates must already have occurred in the observer's New York date. */
export function isObservedSession(session: unknown, today: string): session is string {
  if (typeof session !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(session) || session > today) return false;
  const epoch = Date.parse(session);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === session;
}

/** The published moves payload, admitted only for the exact dated reference (root, session, spot). */
export function admittedExposureMoves(raw: unknown, root: string, session: string | null,
  spot: number | null, now: number): (MscMoves & {asof: string}) | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !isPositiveFinite(spot) || !Number.isFinite(now)) return null;
  const p = raw as MscMoves & {schema?: unknown; root?: unknown; asof?: unknown};
  if (p.schema !== 'options_hub.moves/v1' || p.root !== root || typeof p.asof !== 'string'
    || p.asof.slice(0,10) !== session || !isObservedSession(session, new Date(now).toLocaleDateString('en-CA', {timeZone:'America/New_York'}))
    || !Number.isFinite(Date.parse(p.asof)) || Date.parse(p.asof) > now
    || (p.asof.length > 10 && !/(Z|[+-]\d{2}:\d{2})$/.test(p.asof))
    || !isPositiveFinite(p.spot_ref ?? null) || Math.abs(p.spot_ref! - spot) > Math.max(1, spot) * 1e-8
    || !isPositiveFinite(p.expected_move?.horizon_days ?? null)
    || !isPositiveFinite(p.expected_move?.pct ?? null) || !isPositiveFinite(p.expected_move?.band_mult ?? null)) return null;
  return p as MscMoves & {asof: string};
}

/** Reuse the published move owner's scale only for the exact dated reference.
 * This is an implied-volatility distance, never touch odds or a confidence claim. */
export function exposureMoveDistance(raw: unknown, root: string, session: string | null,
  spot: number | null, target: number | null, now: number) {
  const p = admittedExposureMoves(raw, root, session, spot, now);
  if (!p || !isPositiveFinite(target)) return null;
  const frame = emFrame(spot, [{key:'target',price:target}], p);
  const distance = frame.levels[0]?.distEm;
  if (!isFiniteNumber(distance) || distance < 0) return null;
  return { distance, horizonDays:p.expected_move!.horizon_days!, session, asof:p.asof };
}

/** The owner publishes `expected_move.pct` at `band_mult` sigmas; the 1σ move as a percent of spot
 * is `pct / band_mult`. Same admission as the distance: null when the reference is not exact. */
export function exposureMoveSigmaPct(raw: unknown, root: string, session: string | null,
  spot: number | null, now: number): number | null {
  const p = admittedExposureMoves(raw, root, session, spot, now);
  if (!p) return null;
  const sigma = p.expected_move!.pct! / p.expected_move!.band_mult!;
  return Number.isFinite(sigma) && sigma > 0 ? sigma : null;
}
