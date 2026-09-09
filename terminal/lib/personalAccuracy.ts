// Pure personal-accuracy scorer (B-F13-5). No I/O, no fetch, no Supabase.
// Design authority: macro F13 docket §1–§6 (PR #6997). Ceiling: learning_only.

export const BRIER_MIN_PAIRS = 30;
export const HIT_RATE_MIN_EPISODES = 10;

export type ClaimStatus = "open" | "matured" | "resolved" | "void_unscorable" | "withdrawn";
export type SubjectKind = "security" | "macro_series" | "basket";
export type Comparator = ">=" | "<=" | ">" | "<";
export type Stance =
  | "Too early to say"
  | "Mostly landing so far"
  | "Mixed so far"
  | "Not landing yet";

export type ClaimCondition = {
  metric?: string;
  comparator?: string;
  threshold?: number | string;
  owner?: string;
};

export type ClaimResolution = {
  outcome: 0 | 1 | null;
  observed: number | null;
  resolved_at: string;
  resolver: string;
  note: string;
};

export type UserClaim = {
  claim_id: string;
  user_id: string;
  subject: { kind: SubjectKind; id: string };
  stated_at: string;
  resolves_at: string;
  claim_text: string;
  condition: ClaimCondition;
  stated_probability: number | null;
  evidence: unknown[];
  status: ClaimStatus;
  resolution: ClaimResolution | null;
  supersedes: string | null;
};

export type UnscorableReason = "malformed_timestamp";

export type AccuracyClaimRow = {
  claimId: string;
  claimText: string;
  status: ClaimStatus;
  statedAt: string;
  resolvesAt: string;
  statedProbability: number | null;
  subjectId: string;
  subjectKind: SubjectKind;
  carrier: boolean;
  unscorableReason: UnscorableReason | null;
  resolution: {
    outcome: 0 | 1 | null;
    observed: number | null;
    resolvedAt: string;
    resolver: string;
    note: string;
  } | null;
};

export type AccuracyReadout = {
  episodeCount: number;
  resolvedEpisodes: number;
  resolvedHits: number;
  hitRate: number | null;
  brierPairs: number;
  brierMean: number | null;
  claimCount: number;
  unscorableCount: number;
  stance: Stance;
  openEpisodes: number;
  claims: AccuracyClaimRow[];
};

export const ACCURACY_READOUT_KEYS = [
  "episodeCount",
  "resolvedEpisodes",
  "resolvedHits",
  "hitRate",
  "brierPairs",
  "brierMean",
  "claimCount",
  "unscorableCount",
  "stance",
  "openEpisodes",
  "claims",
] as const;

const LIVE: ReadonlySet<ClaimStatus> = new Set(["open", "matured", "resolved"]);
const COMPARATORS: ReadonlySet<string> = new Set([">=", "<=", ">", "<"]);

function parseTs(iso: string): number | null {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

function hasValidWindow(claim: UserClaim): boolean {
  return parseTs(claim.stated_at) !== null && parseTs(claim.resolves_at) !== null;
}

function ts(iso: string): number {
  const n = parseTs(iso);
  if (n === null) {
    throw new Error("malformed timestamp reached the scorer window");
  }
  return n;
}

export function conditionIsComplete(condition: ClaimCondition | null | undefined): boolean {
  if (!condition) return false;
  const { metric, comparator, threshold, owner } = condition;
  if (!metric || !comparator || !owner) return false;
  if (threshold === undefined || threshold === null || threshold === "") return false;
  return COMPARATORS.has(comparator);
}

export function isStillLive(claim: UserClaim): boolean {
  return LIVE.has(claim.status) && conditionIsComplete(claim.condition) && hasValidWindow(claim);
}

function episodeKey(claim: UserClaim): string {
  const c = claim.condition || {};
  return [
    claim.user_id,
    claim.subject?.id ?? "",
    c.metric ?? "",
    c.comparator ?? "",
    String(c.threshold ?? ""),
  ].join("\0");
}

function binaryOutcome(resolution: ClaimResolution | null): 0 | 1 | null {
  if (!resolution) return null;
  return resolution.outcome === 0 || resolution.outcome === 1 ? resolution.outcome : null;
}

function stanceFor(resolvedEpisodes: number, hitRate: number | null): Stance {
  if (resolvedEpisodes < HIT_RATE_MIN_EPISODES || hitRate === null) return "Too early to say";
  if (hitRate >= 0.6) return "Mostly landing so far";
  if (hitRate >= 0.4) return "Mixed so far";
  return "Not landing yet";
}

function toRow(
  claim: UserClaim,
  carrierId: string | null,
  reason: UnscorableReason | null,
): AccuracyClaimRow {
  const voided = reason !== null || !conditionIsComplete(claim.condition);
  return {
    claimId: claim.claim_id,
    claimText: claim.claim_text,
    status: voided ? "void_unscorable" : claim.status,
    statedAt: claim.stated_at,
    resolvesAt: claim.resolves_at,
    statedProbability: claim.stated_probability,
    subjectId: claim.subject?.id ?? "",
    subjectKind: claim.subject?.kind ?? "security",
    carrier: carrierId !== null && claim.claim_id === carrierId,
    unscorableReason: reason,
    resolution: claim.resolution
      ? {
          outcome: claim.resolution.outcome,
          observed: claim.resolution.observed,
          resolvedAt: claim.resolution.resolved_at,
          resolver: claim.resolution.resolver,
          note: claim.resolution.note,
        }
      : null,
  };
}

function pickCarrier(members: UserClaim[]): UserClaim | null {
  const live = members.filter(isStillLive);
  if (live.length === 0) return null;
  live.sort((a, b) => {
    const dt = ts(a.stated_at) - ts(b.stated_at);
    if (dt !== 0) return dt;
    return a.claim_id < b.claim_id ? -1 : a.claim_id > b.claim_id ? 1 : 0;
  });
  return live[0];
}

function collapseGroup(members: UserClaim[]): UserClaim[][] {
  const sorted = [...members].sort((a, b) => {
    const dt = ts(a.stated_at) - ts(b.stated_at);
    if (dt !== 0) return dt;
    return a.claim_id < b.claim_id ? -1 : a.claim_id > b.claim_id ? 1 : 0;
  });
  const episodes: UserClaim[][] = [];
  let current: UserClaim[] = [];
  let maxResolves = Number.NEGATIVE_INFINITY;
  for (const claim of sorted) {
    const start = ts(claim.stated_at);
    if (current.length === 0 || start <= maxResolves) {
      current.push(claim);
      maxResolves = Math.max(maxResolves, ts(claim.resolves_at));
    } else {
      episodes.push(current);
      current = [claim];
      maxResolves = ts(claim.resolves_at);
    }
  }
  if (current.length) episodes.push(current);
  return episodes;
}

export function compareObserved(comparator: string, observed: number, threshold: number): 0 | 1 | null {
  switch (comparator) {
    case ">=": return observed >= threshold ? 1 : 0;
    case "<=": return observed <= threshold ? 1 : 0;
    case ">": return observed > threshold ? 1 : 0;
    case "<": return observed < threshold ? 1 : 0;
    default: return null;
  }
}

export function scorePersonalAccuracy(claims: UserClaim[]): AccuracyReadout {
  const usable: UserClaim[] = [];
  const malformedIds = new Set<string>();
  for (const claim of claims) {
    if (hasValidWindow(claim)) usable.push(claim);
    else malformedIds.add(claim.claim_id);
  }

  const groups = new Map<string, UserClaim[]>();
  for (const claim of usable) {
    const key = episodeKey(claim);
    const list = groups.get(key);
    if (list) list.push(claim);
    else groups.set(key, [claim]);
  }

  let episodeCount = 0;
  let resolvedEpisodes = 0;
  let resolvedHits = 0;
  let brierPairs = 0;
  let brierSum = 0;
  let unscorableCount = 0;
  let openEpisodes = 0;
  const carrierIds = new Set<string>();

  episodeCount += malformedIds.size;
  unscorableCount += malformedIds.size;

  for (const members of groups.values()) {
    for (const episode of collapseGroup(members)) {
      episodeCount += 1;
      const carrier = pickCarrier(episode);
      if (!carrier) {
        unscorableCount += 1;
        continue;
      }
      carrierIds.add(carrier.claim_id);
      const outcome = binaryOutcome(carrier.resolution);
      if (carrier.status === "open") {
        openEpisodes += 1;
        continue;
      }
      if ((carrier.status === "matured" || carrier.status === "resolved") && outcome === null) {
        unscorableCount += 1;
        continue;
      }
      if (carrier.status === "resolved" && (outcome === 0 || outcome === 1)) {
        resolvedEpisodes += 1;
        if (outcome === 1) resolvedHits += 1;
      }
      if (carrier.stated_probability !== null && (outcome === 0 || outcome === 1)) {
        const p = carrier.stated_probability;
        brierPairs += 1;
        brierSum += (p - outcome) ** 2;
      }
    }
  }

  const hitRate = resolvedEpisodes >= HIT_RATE_MIN_EPISODES
    ? resolvedHits / resolvedEpisodes
    : null;
  const brierMean = brierPairs >= BRIER_MIN_PAIRS ? brierSum / brierPairs : null;

  return {
    episodeCount,
    resolvedEpisodes,
    resolvedHits,
    hitRate,
    brierPairs,
    brierMean,
    claimCount: claims.length,
    unscorableCount,
    stance: stanceFor(resolvedEpisodes, hitRate),
    openEpisodes,
    claims: claims.map((c) =>
      toRow(
        c,
        carrierIds.has(c.claim_id) ? c.claim_id : null,
        malformedIds.has(c.claim_id) ? "malformed_timestamp" : null,
      ),
    ),
  };
}

export function emptyAccuracyReadout(): AccuracyReadout {
  return scorePersonalAccuracy([]);
}
