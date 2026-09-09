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

function ts(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

export function conditionIsComplete(condition: ClaimCondition | null | undefined): boolean {
  if (!condition) return false;
  const { metric, comparator, threshold, owner } = condition;
  if (!metric || !comparator || !owner) return false;
  if (threshold === undefined || threshold === null || threshold === "") return false;
  return COMPARATORS.has(comparator);
}

export function isStillLive(claim: UserClaim): boolean {
  return LIVE.has(claim.status) && conditionIsComplete(claim.condition);
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

function toRow(claim: UserClaim, carrierId: string | null): AccuracyClaimRow {
  return {
    claimId: claim.claim_id,
    claimText: claim.claim_text,
    status: conditionIsComplete(claim.condition) ? claim.status : "void_unscorable",
    statedAt: claim.stated_at,
    resolvesAt: claim.resolves_at,
    statedProbability: claim.stated_probability,
    subjectId: claim.subject?.id ?? "",
    subjectKind: claim.subject?.kind ?? "security",
    carrier: carrierId !== null && claim.claim_id === carrierId,
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
  const groups = new Map<string, UserClaim[]>();
  for (const claim of claims) {
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
    claims: claims.map((c) => toRow(c, carrierIds.has(c.claim_id) ? c.claim_id : null)),
  };
}

export function emptyAccuracyReadout(): AccuracyReadout {
  return scorePersonalAccuracy([]);
}

export function populatedAccuracyFixture(): AccuracyReadout {
  const claims: UserClaim[] = [];
  for (let i = 0; i < 10; i++) {
    const hit = i < 7;
    const id = `c${i.toString(16).padStart(15, "0")}`;
    claims.push({
      claim_id: id.slice(0, 16),
      user_id: "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22",
      subject: { kind: "security", id: `N${i}` },
      stated_at: `2026-01-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      resolves_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      claim_text: hit
        ? `Name ${i} finishes at or above the line I wrote down.`
        : `Name ${i} stays at or above the line I wrote down.`,
      condition: { metric: "last_close", comparator: ">=", threshold: 100 + i, owner: "quotes.last_close" },
      stated_probability: 0.65,
      evidence: [],
      status: "resolved",
      resolution: {
        outcome: hit ? 1 : 0,
        observed: hit ? 110 + i : 90,
        resolved_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
        resolver: "quotes.last_close",
        note: "",
      },
      supersedes: null,
    });
  }
  return scorePersonalAccuracy(claims);
}
