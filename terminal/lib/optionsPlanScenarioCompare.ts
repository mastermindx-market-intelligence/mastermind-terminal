import type { OptionsPlanDraft } from "./optionsPlanDraft";
import type { ContractIdentity } from "./optionsContractShortlist";
import { preparePlanExpiryRequest, readPlanPayoff, type PlanPayoff } from "./optionsPlanPayoff";

/** Explicitly pinned, in-memory research calculations. Not an account Save,
 * quote, tradable order, persisted scenario, or independent valuation model. */
export type QualifiedPlanScenario = Readonly<{
  draft: OptionsPlanDraft;
  payoff: PlanPayoff;
}>;

export type PlanScenarioComparison =
  | { ok: false; reason: "invalid_result" | "contract_changed" | "reference_changed" | "axis_changed" }
  | { ok: true;
      root: string;
      expiration: string;
      referenceAsOf: string;
      referenceObservedAt: string;
      baselineKnownBy: string;
      candidateKnownBy: string;
      spots: readonly number[];
      baselinePnl: readonly number[];
      candidatePnl: readonly number[];
      deltaPnl: readonly number[];
      anchors: readonly number[];
      sample: { spot: number; baselinePnl: number; candidatePnl: number; deltaPnl: number };
      changes: ReadonlyArray<{
        leg: string;
        identity: ContractIdentity;
        side: { before: "buy" | "sell" | null; after: "buy" | "sell" | null };
        quantity: { before: number | null; after: number | null };
        entry: { before: number | null; after: number | null };
        changed: boolean;
      }>;
    };

/** Compare validated API outputs only on the same exact contracts, actual
 * server-sampled axes and immutable dated reference. Never interpolate P/L
 * or silently normalize altered deliverables or differing source vintages. */
export function comparePlanScenarios(
  baseline: QualifiedPlanScenario,
  candidate: QualifiedPlanScenario,
): PlanScenarioComparison {
  const a = preparePlanExpiryRequest(baseline.draft);
  const b = preparePlanExpiryRequest(candidate.draft);
  if (!a.ok || !b.ok || !readPlanPayoff(baseline.payoff, a.value)
    || !readPlanPayoff(candidate.payoff, b.value)) return { ok: false, reason: "invalid_result" };
  if (a.value.draft.legs.length !== b.value.draft.legs.length
    || a.value.payoff_basis.expiration !== b.value.payoff_basis.expiration
    || a.value.draft.legs.some((leg, i) => {
      const other = b.value.draft.legs[i];
      return leg.snapshot.pinKey !== other.snapshot.pinKey
        || leg.snapshot.identity.key !== other.snapshot.identity.key
        || leg.snapshot.asofRaw !== other.snapshot.asofRaw
        || leg.snapshot.sourceStale !== other.snapshot.sourceStale
        || leg.snapshot.schema !== other.snapshot.schema
        || leg.snapshot.hotView !== other.snapshot.hotView
        || JSON.stringify(leg.snapshot.row) !== JSON.stringify(other.snapshot.row);
    })) return { ok: false, reason: "contract_changed" };
  const sourceA = baseline.payoff.source_boundary;
  const sourceB = candidate.payoff.source_boundary;
  if (sourceA.reference_root !== sourceB.reference_root
    || sourceA.reference_sha256 !== sourceB.reference_sha256
    || sourceA.installed_observation_sha256 !== sourceB.installed_observation_sha256
    || sourceA.reference_as_of !== sourceB.reference_as_of
    || sourceA.reference_observed_at !== sourceB.reference_observed_at
    || sourceA.reference_contract_count !== sourceB.reference_contract_count
    || JSON.stringify(sourceA.reference_expirations) !== JSON.stringify(sourceB.reference_expirations))
    return { ok: false, reason: "reference_changed" };
  const x = baseline.payoff.curve.spots, y = candidate.payoff.curve.spots;
  if (x.length !== y.length || x.some((spot, i) => spot !== y[i]))
    return { ok: false, reason: "axis_changed" };
  const deltaPnl = candidate.payoff.curve.pnl.map((v, i) => v - baseline.payoff.curve.pnl[i]);
  if (!deltaPnl.every(Number.isFinite)) return { ok: false, reason: "invalid_result" };
  const anchor = a.value.draft.legs[0].snapshot.identity.strike;
  let sampleIndex = 0;
  for (let i = 1; i < x.length; i++) {
    if (Math.abs(x[i] - anchor) < Math.abs(x[sampleIndex] - anchor)) sampleIndex = i;
  }
  return {
    ok: true,
    root: sourceA.reference_root,
    expiration: a.value.payoff_basis.expiration,
    referenceAsOf: sourceA.reference_as_of,
    referenceObservedAt: sourceA.reference_observed_at,
    baselineKnownBy: baseline.payoff.known_by,
    candidateKnownBy: candidate.payoff.known_by,
    spots: x,
    baselinePnl: baseline.payoff.curve.pnl,
    candidatePnl: candidate.payoff.curve.pnl,
    deltaPnl,
    anchors: [...a.value.draft.legs.map(l => l.snapshot.identity.strike),
      ...baseline.payoff.curve.breakevens, ...candidate.payoff.curve.breakevens],
    sample: { spot: x[sampleIndex], baselinePnl: baseline.payoff.curve.pnl[sampleIndex],
      candidatePnl: candidate.payoff.curve.pnl[sampleIndex], deltaPnl: deltaPnl[sampleIndex] },
    changes: a.value.draft.legs.map((leg, i) => {
      const next = b.value.draft.legs[i];
      const before = leg.assumptions, after = next.assumptions;
      const beforeEntry = before.entry?.premium_per_unit ?? null, afterEntry = after.entry?.premium_per_unit ?? null;
      return {
        identity: leg.snapshot.identity,
        leg: leg.snapshot.identity.root + " " + leg.snapshot.identity.exp + " " + leg.snapshot.identity.strike + leg.snapshot.identity.right,
        side: { before: before.side, after: after.side },
        quantity: { before: before.quantity, after: after.quantity },
        entry: { before: beforeEntry, after: afterEntry },
        changed: before.side !== after.side || before.quantity !== after.quantity || beforeEntry !== afterEntry,
      };
    }),
  };
}
