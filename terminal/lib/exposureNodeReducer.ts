/** F1 §3 — node reducer v1. Composes, never forks: rows come from
 * `exposureMapProjection.selectedProjectionCells`, strike totals/ties from
 * `marketStructure.exposureNodes`, and ranking/runner-up/share from
 * `exposureWorkspace.describeExposure`. There is no viewport or clipping input
 * anywhere in this module; display clipping happens after reduction. Units are
 * $mn: USD cell values are summed in canonical (strike, expiry) order before
 * being divided by 1e6 once. A refusal is a typed null/unknown, never a zero:
 * an unknown cell stays out of every measured output. */
import { selectedProjectionCells, type ExposureLens, type QualifiedProjection } from "./exposureMapProjection";
import { exposureNodes, type ExposureNodeInput } from "./marketStructure";
import { describeExposure } from "./exposureWorkspace";

export const NODE_REDUCER_VERSION = "exposure-node-reducer/v1";
export const CONTESTED_VERSION = "runner-up-ratio/v1";
export const CONTESTED_THRESHOLD = 0.9;
export const SCANNER_VERSION = "e7-reconstruction/v1";

export type NodeMetric = "gamma" | "delta";
export type NodeScope =
  | { kind: "all_expiries" }
  | { kind: "filtered_expiries"; lens: ExposureLens["kind"]; expiries: readonly string[] };

export interface NodePopulationIdentity {
  reducer: typeof NODE_REDUCER_VERSION;
  root: string;
  kind: QualifiedProjection["kind"];
  populationId: string;
  inputSha256: string;
  sourceSnapshotRef: string;
  metric: NodeMetric;
  unit: string;
  scope: NodeScope;
  /** "all" | "exp:2026-10-21,2026-10-23" — distinct keys never relabel each other. */
  scopeKey: string;
  cellCount: number;
  strikeCount: number;
}

export interface NodeRef { strike: number; net: number; sign: 1 | -1; tieSet: number[] }

export interface ExposureNodeReduction {
  identity: NodePopulationIdentity;
  status: "ok" | "partial" | "empty" | "zero" | "net_cancelled";
  partial: boolean;
  basis: "whole_population" | "known_subset";
  net: number | null;
  gross: number | null;
  /** The covered gross subtotal: equal to `gross` on a whole population, and —
   * on a partial book, where `gross` is null — the sum of the known cells. */
  knownGross: number | null;
  absoluteStrikeNet: number | null;
  dominantNode: NodeRef | null;
  largestPositive: NodeRef | null;
  largestNegative: NodeRef | null;
  concentration: {
    numerator: number; denominator: number; share: number;
    denominatorKind: "absolute_strike_net"; wholePopulationKnown: boolean;
  } | null;
  contested: {
    version: typeof CONTESTED_VERSION; threshold: typeof CONTESTED_THRESHOLD; ratio: number;
    contested: boolean; runnerUp: NodeRef | null; basis: ExposureNodeReduction["basis"];
  } | null;
  center: { strike: number; weights: "absolute_strike_net"; totalWeight: number } | null;
  unknownStrikes: number[];
  coverage: { expected: number | null; received: number; qualified: number; missing: number };
  scannerScore: number | null;
  scanner: ScannerResult;
}

export interface ExpectedMoveInput { points: number; horizon: string; sourceRef: string }

export type ScannerResult =
  | { status: "unavailable"; reasons: string[] }
  | { status: "ok"; version: typeof SCANNER_VERSION; dominance: number; cappedConcentration: number;
      strength: number; distanceEm: number; distanceFit: number; regimeMultiplier: 0.85 | 1;
      score: number; candidateEligible: boolean; candidateScore: number | null;
      direction: "above" | "below" | "at_spot" };

/** Structural subset of the §2.3 `QualifiedDelta` the DEX lane will export:
 * identity fields already validated there; only the covered cell values the
 * reducer reads are declared. Keyed `${expiry}|${strike}`, values in USD. */
export interface NodeDeltaCell {
  net: number | null;
  known_net?: number | null;
  gross?: number | null;
  known_gross?: number | null;
}
export interface NodeDeltaInput {
  unit: string;
  cells: ReadonlyMap<string, NodeDeltaCell>;
}

/** The resolved scope is always explicit: `all`, or a named lens with its
 * actual expiry list. Distinct scopeKeys never relabel each other (P18/P19). */
export function resolveNodeScope(p: QualifiedProjection, lens: ExposureLens, now: number): NodeScope {
  if (lens.kind === "all") return { kind: "all_expiries" };
  const expiries = [...new Set(selectedProjectionCells(p, lens, now).map((c) => c.expiry))].sort();
  return { kind: "filtered_expiries", lens: lens.kind, expiries };
}

const scopeKeyOf = (scope: NodeScope) =>
  scope.kind === "all_expiries" ? "all" : `exp:${scope.expiries.join(",")}`;

/** Oracle `distance_fit` (quant_oracles.py, terrashade-quant-oracles/1.0.0): 0
 * at or below 0.1 EM, linear up to 1 at 0.5 EM, 1 through 2.0 EM, linear back
 * to 0 at 4.0 EM, 0 beyond it — the fit decays past 2.0 EM, it is not capped.
 * A negative or non-finite distance is a typed refusal (null), never a throw
 * and never a zero fit. Points: fit(0.04)=0, fit(0.2)=0.25, fit(0.5)=1. */
export function distanceFit(distanceEm: number): number | null {
  if (!Number.isFinite(distanceEm) || distanceEm < 0) return null;
  if (distanceEm <= 0.1) return 0;
  if (distanceEm < 0.5) return (distanceEm - 0.1) / 0.4;
  if (distanceEm <= 2.0) return 1;
  if (distanceEm < 4.0) return (4 - distanceEm) / 2;
  return 0;
}

const unavailable = (reasons: string[]): ScannerResult => ({ status: "unavailable", reasons });

export interface ScannerInput {
  spot: number | null;
  strike: number | null;
  expectedMove: number | null;
  a1: number;
  a2: number;
  absoluteStrikeNet: number;
  regime: "positive" | "negative" | "zero" | null;
  identityComplete: boolean;
  fresh: boolean;
  coverageComplete: boolean;
}

/** Oracle `scanner_score` (quant_oracles.py, terrashade-quant-oracles/1.0.0),
 * the E7 reconstruction: an attention ranking over the dominant gamma node —
 * never a probability. dominance = 1 − a2/a1; concentration =
 * min(1, (a1/absoluteStrikeNet)/0.25); strength = 100·(0.5·dominance +
 * 0.5·concentration); score = (0.55·strength + 45·fit)·penalty, penalty 0.85
 * for a positive regime and 1 otherwise. Gamma only (the caller refuses other
 * metrics); the candidate gate is (0.1, 2.0] in distance EM. Every applicable
 * reason is collected — never short-circuited — and an invalid input stays
 * unavailable with a null score; missing EM is never zero distance. */
export function scannerScore(a: ScannerInput): ScannerResult {
  const reasons: string[] = [];
  if (!a.identityComplete) reasons.push("insufficient_identity");
  if (!a.fresh) reasons.push("insufficient_freshness");
  if (!a.coverageComplete) reasons.push("insufficient_coverage");
  if (a.spot == null || !Number.isFinite(a.spot) || a.spot <= 0) reasons.push("invalid_spot");
  if (a.strike == null || !Number.isFinite(a.strike) || a.strike <= 0) reasons.push("invalid_node_strike");
  if (a.expectedMove == null) reasons.push("missing_expected_move");
  else if (!Number.isFinite(a.expectedMove) || a.expectedMove <= 0) reasons.push("invalid_expected_move");
  if (a.regime !== "positive" && a.regime !== "negative" && a.regime !== "zero") reasons.push("unknown_regime");
  if (![a.a1, a.a2, a.absoluteStrikeNet].every(Number.isFinite)) reasons.push("invalid_concentration");
  else if (a.a1 <= 0 || a.a2 < 0 || a.a2 > a.a1 || a.absoluteStrikeNet <= 0
    || a.absoluteStrikeNet < a.a1 + a.a2) reasons.push("invalid_concentration");
  if (reasons.length) return unavailable(reasons);
  const dominance = 1 - a.a2 / a.a1;
  const cappedConcentration = Math.min(1, a.a1 / a.absoluteStrikeNet / 0.25);
  const strength = 100 * (0.5 * dominance + 0.5 * cappedConcentration);
  const distanceEm = Math.abs(a.strike! - a.spot!) / a.expectedMove!;
  const fit = distanceFit(distanceEm);
  if (fit == null) return unavailable(["invalid_distance"]);
  const regimeMultiplier: 0.85 | 1 = a.regime === "positive" ? 0.85 : 1;
  const score = (0.55 * strength + 45 * fit) * regimeMultiplier;
  const candidateEligible = distanceEm > 0.1 && distanceEm <= 2.0;
  return { status: "ok", version: SCANNER_VERSION, dominance, cappedConcentration, strength,
    distanceEm, distanceFit: fit, regimeMultiplier, score, candidateEligible,
    candidateScore: candidateEligible ? score : null,
    direction: a.strike! < a.spot! ? "below" : a.strike! > a.spot! ? "above" : "at_spot" };
}

type ProjectionCell = QualifiedProjection["cells"][number];
const MN = 1e6;
const isDigest = (v: string) => /^[a-f0-9]{64}$/.test(v);

interface CellView {
  net: number | null; knownNet: number | null; gross: number | null; knownGross: number | null;
  expected: number | null; received: number; qualified: number; missing: number;
}

const emptyCoverage = (): { expected: number | null; received: number; qualified: number; missing: number } =>
  ({ expected: null, received: 0, qualified: 0, missing: 0 });

/** One resolved-scope reduction. The signature deliberately takes no rows and
 * no window: the eligible population is exactly the lens-resolved projection
 * cells, and display clipping cannot feed back into any total here. */
export function reduceExposureNodes(p: QualifiedProjection, o: {
  metric: NodeMetric; lens: ExposureLens; spot: number | null;
  delta?: NodeDeltaInput | null; expectedMove?: ExpectedMoveInput | null; fresh: boolean; now: number;
}): ExposureNodeReduction {
  const scope = resolveNodeScope(p, o.lens, o.now);
  const selected = selectedProjectionCells(p, o.lens, o.now)
    .slice()
    .sort((a, b) => a.strike - b.strike || a.expiry.localeCompare(b.expiry));
  const raw = p as unknown as Record<string, unknown>;
  const inputSha256 = typeof raw.input_sha256 === "string" ? raw.input_sha256 : "";
  const identity: NodePopulationIdentity = {
    reducer: NODE_REDUCER_VERSION, root: p.root, kind: p.kind, populationId: p.population.id,
    inputSha256, sourceSnapshotRef: p.source_snapshot_ref, metric: o.metric,
    unit: o.metric === "delta" ? o.delta?.unit ?? "" : selected[0]?.gamma.unit ?? "",
    scope, scopeKey: scopeKeyOf(scope), cellCount: selected.length,
    strikeCount: new Set(selected.map((c) => c.strike)).size,
  };
  if (!selected.length) {
    return { identity, status: "empty", partial: false, basis: "whole_population", net: null, gross: null,
      knownGross: null, absoluteStrikeNet: null, dominantNode: null, largestPositive: null, largestNegative: null,
      concentration: null, contested: null, center: null, unknownStrikes: [],
      coverage: emptyCoverage(), scannerScore: null, scanner: unavailable(["empty_scope"]) };
  }
  // Per-cell view: the covered value is net ?? known_net (the validator pins
  // known_net === net when net is present), so a partial cell contributes its
  // known subset and an unknown cell contributes nothing — never zero.
  const view = (cell: ProjectionCell): CellView => {
    if (o.metric === "gamma") {
      const m = cell.gamma;
      return { net: m.net, knownNet: m.known_net ?? null, gross: m.gross ?? null, knownGross: m.known_gross ?? null,
        expected: m.expected, received: m.received, qualified: m.qualified, missing: m.missing };
    }
    const d = o.delta?.cells.get(`${cell.expiry}|${cell.strike}`);
    const known = d != null && (d.net != null || d.known_net != null);
    return { net: d?.net ?? null, knownNet: d?.known_net ?? null, gross: d?.gross ?? null, knownGross: d?.known_gross ?? null,
      expected: null, received: d != null ? 1 : 0, qualified: known ? 1 : 0, missing: known ? 0 : 1 };
  };
  const byStrike = new Map<number, ProjectionCell[]>();
  for (const cell of selected) {
    const group = byStrike.get(cell.strike);
    if (group) group.push(cell); else byStrike.set(cell.strike, [cell]);
  }
  const rows: ExposureNodeInput[] = [];
  const unknownStrikes: number[] = [];
  const coverage = emptyCoverage();
  let partial = false;
  let expectedKnown = true;
  let knownGrossUsd = 0, anyKnownGross = false;
  for (const strike of [...byStrike.keys()].sort((a, b) => a - b)) {
    let netUsd = 0, grossUsd = 0, anyNet = false, anyGross = false;
    for (const cell of byStrike.get(strike)!) {
      const m = view(cell);
      if (m.net == null) partial = true;
      if (m.expected == null) expectedKnown = false;
      const value = m.net ?? m.knownNet;
      if (value != null) { netUsd += value; anyNet = true; }
      const g = m.gross ?? m.knownGross;
      if (g != null) { grossUsd += g; anyGross = true; knownGrossUsd += g; anyKnownGross = true; }
      coverage.received += m.received; coverage.qualified += m.qualified; coverage.missing += m.missing;
    }
    if (!anyNet) unknownStrikes.push(strike);
    rows.push({ strike, netMn: anyNet ? netUsd / MN : null, grossMn: anyGross ? grossUsd / MN : null });
  }
  coverage.expected = expectedKnown ? selected.reduce((t, c) => t! + view(c).expected!, 0 as number | null) : null;
  const summary = exposureNodes(rows, o.spot, rows.length, partial ? "covered" : "complete");
  const net = summary.netTotalMn;
  // Freeze §3: gross is null the moment any selected cell lacks gross — the
  // covered subtotal is carried separately as knownGross, never as gross.
  const gross = partial ? null : summary.grossTotalMn;
  const knownGross = partial ? (anyKnownGross ? knownGrossUsd / MN : null) : summary.grossTotalMn;
  const description = describeExposure(summary.nodes.filter((n) => n.netMn != null), o.spot, null);
  const absoluteStrikeNet = rows.reduce((t, r) => r.netMn != null ? t + Math.abs(r.netMn) : t, 0);
  const status: ExposureNodeReduction["status"] = !selected.length ? "empty"
    : partial ? "partial"
    : gross === 0 ? "zero"
    : gross != null && gross > 0 && summary.netKnown > 0 && rows.every((r) => r.netMn == null || r.netMn === 0) ? "net_cancelled"
    : "ok";
  const measurable = status === "ok" || status === "partial";
  const ref = (node: { strike: number; netMn: number }, ties: number[]): NodeRef =>
    ({ strike: node.strike, net: node.netMn, sign: node.netMn < 0 ? -1 : 1, tieSet: ties });
  const head = description.ranked[0] ?? null;
  const headNet = head?.netMn;
  const dominantNode = measurable && head && headNet != null && headNet !== 0
    ? ref({ strike: head.strike, netMn: headNet }, summary.netTies) : null;
  const extreme = (sign: 1 | -1) => {
    const best = rows.reduce((a, r) => r.netMn != null && Math.sign(r.netMn) === sign
      && (a?.netMn == null || Math.abs(r.netMn) > Math.abs(a.netMn)) ? r : a,
      null as ExposureNodeInput | null);
    const bestNet = best?.netMn;
    if (best == null || bestNet == null || bestNet === 0) return null;
    const ties = rows.filter((r) => r.netMn != null && Math.abs(r.netMn) === Math.abs(bestNet)).map((r) => r.strike);
    return ref({ strike: best.strike, netMn: bestNet }, ties);
  };
  const a1 = dominantNode ? Math.abs(dominantNode.net) : 0;
  const concentration = measurable && head != null && description.absoluteNetShare != null && absoluteStrikeNet > 0
    ? { numerator: a1, denominator: absoluteStrikeNet, share: description.absoluteNetShare,
        denominatorKind: "absolute_strike_net" as const, wholePopulationKnown: !partial }
    : null;
  const basis: ExposureNodeReduction["basis"] = partial ? "known_subset" : "whole_population";
  const nonzero = rows.filter((r) => r.netMn != null && r.netMn !== 0);
  let contested: ExposureNodeReduction["contested"] = null;
  if (measurable && nonzero.length === 1) {
    contested = { version: CONTESTED_VERSION, threshold: CONTESTED_THRESHOLD, ratio: 0, contested: false, runnerUp: null, basis };
  } else if (measurable && description.runnerUpRatio != null && description.ranked[1]) {
    const second = description.ranked[1];
    const runnerTies = rows.filter((r) => r.netMn != null && Math.abs(r.netMn) === Math.abs(second.netMn!)).map((r) => r.strike);
    contested = { version: CONTESTED_VERSION, threshold: CONTESTED_THRESHOLD, ratio: description.runnerUpRatio,
      contested: description.runnerUpRatio >= CONTESTED_THRESHOLD,
      runnerUp: ref({ strike: second.strike, netMn: second.netMn! }, runnerTies), basis };
  }
  const center = measurable && absoluteStrikeNet > 0
    ? { strike: rows.reduce((t, r) => r.netMn != null ? t + r.strike * Math.abs(r.netMn) : t, 0) / absoluteStrikeNet,
        weights: "absolute_strike_net" as const, totalWeight: absoluteStrikeNet }
    : null;
  let scanner: ScannerResult;
  if (o.metric === "delta") scanner = unavailable(["metric_not_scanned"]);
  else if (dominantNode == null) scanner = unavailable(["no_dominant_node"]);
  else {
    scanner = scannerScore({ spot: o.spot, strike: dominantNode.strike, expectedMove: o.expectedMove?.points ?? null,
      a1, a2: contested?.runnerUp ? Math.abs(contested.runnerUp.net) : 0, absoluteStrikeNet,
      regime: net == null ? null : net < 0 ? "negative" : net > 0 ? "positive" : "zero",
      identityComplete: isDigest(inputSha256) && !!identity.populationId && !!identity.sourceSnapshotRef,
      fresh: o.fresh, coverageComplete: !partial });
  }
  return { identity, status, partial, basis, net, gross, knownGross, absoluteStrikeNet, dominantNode,
    largestPositive: extreme(1), largestNegative: extreme(-1), concentration, contested, center,
    unknownStrikes, coverage, scannerScore: scanner.status === "ok" ? scanner.score : null, scanner };
}
