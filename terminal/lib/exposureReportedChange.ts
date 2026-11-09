/**
 * Pure reported-Gamma vintage comparison.
 *
 * Consumes two coordinator-validated reported Gamma snapshots and produces a
 * matched-cohort change record. The helper is deliberately explicit about what
 * it does NOT do: it never synthesises a counterpart for a member that is
 * absent or reported unqualified on the other vintage, never fills an absent
 * counterpart with 0, and emits no velocity, percentage, point-in-time, flow
 * or economic-terms claim - those stay null at the type level.
 *
 * Membership identity is the canonical member tuple [expiry, strike, right].
 * Reported-set differences (a key present on only one vintage) are counted as
 * reported-set changes, never as economic entry or exit. Qualification flips
 * (finite value to null, or null to finite value on a key present in both) are
 * counted separately and never merged with reported-set changes.
 */

export interface ReportedGammaMember {
  expiry: string;
  strike: number;
  right: "C" | "P";
  valueUsd: number | null;
}

export interface ReportedGammaSnapshot {
  root: string;
  securityId: string;
  sourceSession: string;
  sourceKey: string;
  definitionKey: string;
  scopeKey: string;
  availableAt: string;
  oiReportDate: string;
  oiPositionSession: string | null;
  correctionRef: string | null;
  members: ReportedGammaMember[];
}

export interface ReportedGammaStats {
  contracts: number;
  previousNetUsd: number;
  currentNetUsd: number;
  signedChangeUsd: number;
  netMagnitudeChangeUsd: number;
  previousGrossUsd: number;
  currentGrossUsd: number;
  grossChangeUsd: number;
}

export interface ReportedGammaPopulation {
  previousObserved: number;
  currentObserved: number;
  previousQualified: number;
  currentQualified: number;
  matchedQualified: number;
  previousOnlyReported: number;
  currentOnlyReported: number;
  qualificationLost: number;
  qualificationGained: number;
  unavailableEither: number;
}

export type ReportedGammaChange =
  | {
      state: "data";
      basis: "matched_reported_gamma/v1";
      previousKey: string;
      currentKey: string;
      aggregate: ReportedGammaStats;
      byStrike: ({ strike: number } & ReportedGammaStats)[];
      population: ReportedGammaPopulation;
      velocity: null;
      percentChange: null;
    }
  | {
      state: "unavailable";
      reason:
        | "missing_basis"
        | "identity"
        | "scope"
        | "definition"
        | "time"
        | "malformed"
        | "empty_intersection";
    };

/** Hard cohort bound; a larger snapshot is malformed, never truncated. */
const MAX_MEMBERS = 100000;
/** Largest safe JS time value; beyond it toISOString() would throw. */
const MAX_ORIGIN_MS = 8.64e15;

const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Aware instants only: explicit Z suffix or explicit numeric UTC offset. */
const AWARE_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Exact canonical YYYY-MM-DD; rejects impossible dates such as 2026-02-30. */
function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Aware timestamp only: explicit zone suffix and a parseable instant. */
function isAwareTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !AWARE_INSTANT_PATTERN.test(value)) return false;
  return isCanonicalDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

/** Canonical member identity: [expiry, strike, right]. */
function memberKey(member: ReportedGammaMember): string {
  return `${member.expiry}|${member.strike}|${member.right}`;
}

/**
 * Validates one snapshot and flattens its members into a keyed value map.
 * Returns null on any structural violation. Never mutates the input.
 */
function buildMemberIndex(snapshot: unknown): Map<string, number | null> | null {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const candidate = snapshot as Partial<ReportedGammaSnapshot>;
  if (typeof candidate.root !== "string" || candidate.root.length === 0) return null;
  if (typeof candidate.securityId !== "string" || candidate.securityId.length === 0) return null;
  if (typeof candidate.sourceKey !== "string" || candidate.sourceKey.length === 0) return null;
  if (typeof candidate.definitionKey !== "string" || candidate.definitionKey.length === 0) return null;
  if (typeof candidate.scopeKey !== "string" || candidate.scopeKey.length === 0) return null;
  if (!isCanonicalDate(candidate.sourceSession)) return null;
  if (!isCanonicalDate(candidate.oiReportDate)) return null;
  if (!isAwareTimestamp(candidate.availableAt)) return null;
  if (candidate.oiPositionSession !== null && typeof candidate.oiPositionSession !== "string") return null;
  if (candidate.correctionRef !== null && typeof candidate.correctionRef !== "string") return null;

  const rawMembers = candidate.members;
  if (!Array.isArray(rawMembers) || rawMembers.length > MAX_MEMBERS) return null;

  const sourceSession = candidate.sourceSession as string;
  const index = new Map<string, number | null>();
  for (const raw of rawMembers) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const member = raw as Partial<ReportedGammaMember>;
    if (!isCanonicalDate(member.expiry)) return null;
    // A contract may not expire before the session that reported it.
    if (member.expiry < sourceSession) return null;
    if (typeof member.strike !== "number" || !Number.isFinite(member.strike) || member.strike <= 0) return null;
    if (member.right !== "C" && member.right !== "P") return null;
    if (member.valueUsd !== null) {
      if (typeof member.valueUsd !== "number" || !Number.isFinite(member.valueUsd)) return null;
    }
    const key = memberKey(member as ReportedGammaMember);
    if (index.has(key)) return null; // duplicate member identity
    index.set(key, member.valueUsd as number | null);
  }
  return index;
}

interface CohortAccumulator {
  contracts: number;
  previousNetUsd: number;
  currentNetUsd: number;
  previousGrossUsd: number;
  currentGrossUsd: number;
}

function emptyCohort(): CohortAccumulator {
  return { contracts: 0, previousNetUsd: 0, currentNetUsd: 0, previousGrossUsd: 0, currentGrossUsd: 0 };
}

function accumulate(target: CohortAccumulator, previousValue: number, currentValue: number): void {
  target.contracts += 1;
  target.previousNetUsd += previousValue;
  target.currentNetUsd += currentValue;
  target.previousGrossUsd += Math.abs(previousValue);
  target.currentGrossUsd += Math.abs(currentValue);
}

function toStats(cohort: CohortAccumulator): ReportedGammaStats {
  return {
    contracts: cohort.contracts,
    previousNetUsd: cohort.previousNetUsd,
    currentNetUsd: cohort.currentNetUsd,
    signedChangeUsd: cohort.currentNetUsd - cohort.previousNetUsd,
    netMagnitudeChangeUsd: Math.abs(cohort.currentNetUsd) - Math.abs(cohort.previousNetUsd),
    previousGrossUsd: cohort.previousGrossUsd,
    currentGrossUsd: cohort.currentGrossUsd,
    grossChangeUsd: cohort.currentGrossUsd - cohort.previousGrossUsd,
  };
}

function hasNonFiniteStats(stats: ReportedGammaStats): boolean {
  return (
    !Number.isFinite(stats.contracts) ||
    !Number.isFinite(stats.previousNetUsd) ||
    !Number.isFinite(stats.currentNetUsd) ||
    !Number.isFinite(stats.signedChangeUsd) ||
    !Number.isFinite(stats.netMagnitudeChangeUsd) ||
    !Number.isFinite(stats.previousGrossUsd) ||
    !Number.isFinite(stats.currentGrossUsd) ||
    !Number.isFinite(stats.grossChangeUsd)
  );
}

export function compareReportedGamma(
  current: ReportedGammaSnapshot | null | undefined,
  previous: ReportedGammaSnapshot | null | undefined,
  originMs: number = Date.now(),
): ReportedGammaChange {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return { state: "unavailable", reason: "missing_basis" };
  }

  const previousIndex = buildMemberIndex(previous);
  const currentIndex = buildMemberIndex(current);
  if (previousIndex === null || currentIndex === null) {
    return { state: "unavailable", reason: "malformed" };
  }

  if (previous.root !== current.root || previous.securityId !== current.securityId) {
    return { state: "unavailable", reason: "identity" };
  }
  if (previous.scopeKey !== current.scopeKey) {
    return { state: "unavailable", reason: "scope" };
  }
  if (previous.definitionKey !== current.definitionKey) {
    return { state: "unavailable", reason: "definition" };
  }

  if (typeof originMs !== "number" || !Number.isFinite(originMs) || Math.abs(originMs) > MAX_ORIGIN_MS) {
    return { state: "unavailable", reason: "time" };
  }
  // Sessions must strictly advance; same-session revisions are another slice.
  if (previous.sourceSession >= current.sourceSession) {
    return { state: "unavailable", reason: "time" };
  }
  const originDay = new Date(originMs).toISOString().slice(0, 10);
  if (previous.sourceSession > originDay || current.sourceSession > originDay) {
    return { state: "unavailable", reason: "time" };
  }
  // Both vintages must already be acquired; acquisition ORDER is unconstrained,
  // so a later session acquired earlier stays comparable.
  if (Date.parse(previous.availableAt) > originMs || Date.parse(current.availableAt) > originMs) {
    return { state: "unavailable", reason: "time" };
  }

  let previousQualified = 0;
  for (const value of previousIndex.values()) {
    if (value !== null) previousQualified += 1;
  }
  let currentQualified = 0;
  for (const value of currentIndex.values()) {
    if (value !== null) currentQualified += 1;
  }

  // Matched cohort: keys present on both vintages with BOTH values finite.
  // No counterpart is synthesised and no absent value is replaced with 0.
  const aggregateCohort = emptyCohort();
  const strikeCohorts = new Map<number, CohortAccumulator>();

  let previousOnlyReported = 0;
  let qualificationLost = 0;
  let qualificationGained = 0;
  let unavailableEither = 0;

  for (const [key, previousValue] of previousIndex) {
    if (!currentIndex.has(key)) {
      previousOnlyReported += 1; // reported-set drop, not an economic exit
      continue;
    }
    const currentValue = currentIndex.get(key) as number | null;
    if (previousValue === null || currentValue === null) {
      unavailableEither += 1;
      if (previousValue !== null) qualificationLost += 1; // finite -> null
      else if (currentValue !== null) qualificationGained += 1; // null -> finite
      continue;
    }
    accumulate(aggregateCohort, previousValue, currentValue);
    const strike = Number(key.split("|")[1]);
    let strikeCohort = strikeCohorts.get(strike);
    if (strikeCohort === undefined) {
      strikeCohort = emptyCohort();
      strikeCohorts.set(strike, strikeCohort);
    }
    accumulate(strikeCohort, previousValue, currentValue);
  }

  let currentOnlyReported = 0;
  for (const key of currentIndex.keys()) {
    if (!previousIndex.has(key)) currentOnlyReported += 1; // reported-set addition
  }

  if (aggregateCohort.contracts === 0) {
    return { state: "unavailable", reason: "empty_intersection" };
  }

  // Aggregate is taken over the SAME global matched cohort; the net magnitude
  // change is the absolute of the aggregate, never a sum of per-strike magnitudes.
  const aggregate = toStats(aggregateCohort);
  const byStrike = Array.from(strikeCohorts.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([strike, cohort]) => ({ strike, ...toStats(cohort) }));

  if (hasNonFiniteStats(aggregate) || byStrike.some(hasNonFiniteStats)) {
    return { state: "unavailable", reason: "malformed" };
  }

  return {
    state: "data",
    basis: "matched_reported_gamma/v1",
    previousKey: previous.sourceKey,
    currentKey: current.sourceKey,
    aggregate,
    byStrike,
    population: {
      previousObserved: previousIndex.size,
      currentObserved: currentIndex.size,
      previousQualified,
      currentQualified,
      matchedQualified: aggregateCohort.contracts,
      previousOnlyReported,
      currentOnlyReported,
      qualificationLost,
      qualificationGained,
      unavailableEither,
    },
    velocity: null,
    percentChange: null,
  };
}
