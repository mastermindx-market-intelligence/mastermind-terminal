/**
 * Pure context-bound Lab view-model over reported-Gamma vintage comparison.
 *
 * This is a consumer composition only: it fences the Lab's context against the
 * CURRENT reported snapshot, delegates every financial aggregation and
 * eligibility decision to the incumbent compareReportedGamma comparator, and
 * adds an optional pinned-member readout selected by the exact coordinate
 * tuple [root, expiry, strike, right].
 *
 * Deliberately NOT done here: no fetch, store, clock, auth, enrollment or
 * persistence; no source production; no valuation formula; no percentage,
 * rate, velocity or causal attribution; no session inference from build time;
 * no synthesized source identity; no zero fill for absent or unqualified
 * members; no mutation of any input.
 */
import type {
  ReportedGammaChange,
  ReportedGammaMember,
  ReportedGammaSnapshot,
} from "@/lib/exposureReportedChange";
import type { ResearchRow } from "@/components/researchlab/researchLabAdapter";
import { compareReportedGamma } from "@/lib/exposureReportedChange";

/** The incumbent comparator's successful result, passed through verbatim. */
type ReportedGammaDataChange = Extract<ReportedGammaChange, { state: "data" }>;

/** The incumbent comparator's refusal reasons, passed through verbatim. */
type ReportedGammaComparatorRefusal = Extract<
  ReportedGammaChange,
  { state: "unavailable" }
>["reason"];

/** Lab context the view-model is bound to; nothing is inferred on its behalf. */
export interface ReportedGammaViewContext {
  /** Expected root; must equal the CURRENT snapshot's root exactly. */
  root: string;
  /**
   * Matrix source session the Lab was built from, or null when unknown.
   * A null/unknown session withholds the whole view: currency is never
   * inferred from build time or from snapshot availability.
   */
  matrixSession: string | null;
  /** Explicit comparison clock, forwarded to the incumbent comparator. */
  originMs: number;
  /** Optional pinned row; matched by the full coordinate tuple only. */
  selected: ResearchRow | null;
}

export type ReportedGammaPinUnpinnedReason =
  | "no_selection"
  | "foreign_selection"
  | "member_absent"
  | "member_unqualified";

/** Absent, unqualified and unpinned stay distinct; zero is never absence. */
export type ReportedGammaPin =
  | { pin: "unpinned"; reason: ReportedGammaPinUnpinnedReason }
  | {
      pin: "pinned";
      coordinates: { root: string; expiry: string; strike: number; right: "C" | "P" };
      previousValueUsd: number;
      currentValueUsd: number;
      signedChangeUsd: number;
    };

export type ResearchReportedGammaView =
  | {
      state: "withheld";
      reason:
        | "context_session_unknown"
        | "context_root_mismatch"
        | "context_session_mismatch";
    }
  | { state: "unavailable"; reason: ReportedGammaComparatorRefusal }
  | {
      state: "data";
      /** Incumbent comparison result, preserved whole (stats, byStrike, population, sourceKey pair). */
      comparison: ReportedGammaDataChange;
      /** Source sessions taken from the inputs, not generated. */
      previousSession: string;
      currentSession: string;
      pin: ReportedGammaPin;
    };

/** ResearchRow sides map onto reported membership rights one-for-one. */
function rightForSide(side: ResearchRow["side"]): "C" | "P" {
  return side === "call" ? "C" : "P";
}

/**
 * Resolves the optional pinned member against BOTH vintages by exact
 * coordinates. Only when both members are reported and both values are finite
 * does a signed difference exist; every other outcome is an explicit pin
 * state, never a substitution of another row.
 */
function resolvePin(
  current: ReportedGammaSnapshot,
  previous: ReportedGammaSnapshot,
  selected: ResearchRow | null,
): ReportedGammaPin {
  if (selected === null) {
    return { pin: "unpinned", reason: "no_selection" };
  }
  // A row rooted elsewhere, or not a call/put row at all, is foreign context.
  if (selected.root !== current.root || (selected.side !== "call" && selected.side !== "put")) {
    return { pin: "unpinned", reason: "foreign_selection" };
  }
  const right = rightForSide(selected.side);
  const coordinates = {
    root: current.root,
    expiry: selected.expiry,
    strike: selected.strike,
    right,
  };
  const matches = (member: ReportedGammaMember): boolean =>
    member.expiry === coordinates.expiry &&
    member.strike === coordinates.strike &&
    member.right === coordinates.right;
  const currentMember = current.members.find(matches);
  const previousMember = previous.members.find(matches);
  if (currentMember === undefined || previousMember === undefined) {
    return { pin: "unpinned", reason: "member_absent" };
  }
  if (currentMember.valueUsd === null || previousMember.valueUsd === null) {
    return { pin: "unpinned", reason: "member_unqualified" };
  }
  return {
    pin: "pinned",
    coordinates,
    previousValueUsd: previousMember.valueUsd,
    currentValueUsd: currentMember.valueUsd,
    signedChangeUsd: currentMember.valueUsd - previousMember.valueUsd,
  };
}

/**
 * Builds the Lab view of one reported-Gamma vintage comparison.
 *
 * Fence order is explicit and read-only: an unknown matrix session withholds
 * before anything else; missing snapshots are the incumbent's missing_basis;
 * then the expected root and the matrix session must both match the CURRENT
 * snapshot exactly. Only a fenced context reaches the incumbent comparator,
 * with originMs forwarded explicitly. Comparator refusals propagate with their
 * exact reason; nothing is retried, reinterpreted or reclassified.
 */
export function buildResearchReportedGamma(
  current: ReportedGammaSnapshot | null | undefined,
  previous: ReportedGammaSnapshot | null | undefined,
  context: ReportedGammaViewContext,
): ResearchReportedGammaView {
  if (context.matrixSession === null || context.matrixSession === undefined) {
    return { state: "withheld", reason: "context_session_unknown" };
  }
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return { state: "unavailable", reason: "missing_basis" };
  }
  if (context.root !== current.root) {
    return { state: "withheld", reason: "context_root_mismatch" };
  }
  if (context.matrixSession !== current.sourceSession) {
    return { state: "withheld", reason: "context_session_mismatch" };
  }

  const comparison = compareReportedGamma(current, previous, context.originMs);
  if (comparison.state === "unavailable") {
    return { state: "unavailable", reason: comparison.reason };
  }

  return {
    state: "data",
    comparison,
    previousSession: previous.sourceSession,
    currentSession: current.sourceSession,
    pin: resolvePin(current, previous, context.selected),
  };
}
