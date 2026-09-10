// Owner-scoped claim reads + the v1 resolver registry (last close from the quote owner).
// Maturation/resolution writes are service-role only (the out-of-band worker).

import type { ClaimCondition, ClaimResolution, ClaimStatus, SubjectKind, UnscorableReason, UserClaim } from "@/lib/personalAccuracy";
import { CLAIM_OWNER_LAST_CLOSE, resolveLastClose } from "./dailyCloseResolver";

export type MetricResolver = (claim: UserClaim) => Promise<{ observed: number } | null>;

/** v1: last close from the quote owner. Never guess an outcome. */
export const RESOLVER_REGISTRY = Object.freeze({
  [CLAIM_OWNER_LAST_CLOSE.owner]: resolveLastClose,
});

export const RESOLVER_REGISTRY_NAME = "personalAccuracyStore.RESOLVER_REGISTRY";
export const UNDETERMINED_NOTE = "the data this call named was not available";

type DbResult = { data?: unknown; error?: { message?: string } | null };

export type AccuracyQuery = PromiseLike<DbResult> & {
  select: (cols: string) => AccuracyQuery;
  eq: (column: string, value: unknown) => AccuracyQuery;
  order: (column: string, options?: { ascending?: boolean }) => AccuracyQuery;
};

export type AccuracyDb = { from: (table: string) => AccuracyQuery };

const STATUSES: ReadonlySet<string> = new Set(["open", "matured", "resolved", "void_unscorable", "withdrawn"]);
const KINDS: ReadonlySet<string> = new Set(["security", "macro_series", "basket"]);

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCondition(value: unknown): ClaimCondition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const o = value as Record<string, unknown>;
  return {
    metric: typeof o.metric === "string" ? o.metric : undefined,
    comparator: typeof o.comparator === "string" ? o.comparator : undefined,
    threshold: typeof o.threshold === "number" || typeof o.threshold === "string" ? o.threshold : undefined,
    owner: typeof o.owner === "string" ? o.owner : undefined,
  };
}

function timestampLooksValid(iso: string): boolean {
  if (typeof iso !== "string" || iso.length === 0) return false;
  const n = Date.parse(iso);
  return Number.isFinite(n);
}

function parseResolution(value: unknown): { resolution: ClaimResolution | null; malformedResolvedAt: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { resolution: null, malformedResolvedAt: false };
  }
  const o = value as Record<string, unknown>;
  const outcome = o.outcome === 0 || o.outcome === 1 ? o.outcome : o.outcome === null ? null : null;
  const rawResolvedAt = o.resolved_at;
  const nonStringResolvedAt = rawResolvedAt != null && typeof rawResolvedAt !== "string";
  const resolved_at = typeof rawResolvedAt === "string" ? rawResolvedAt : "";
  return {
    resolution: {
      outcome,
      observed: numOrNull(o.observed),
      resolved_at,
      resolver: text(o.resolver),
      note: text(o.note),
    },
    malformedResolvedAt:
      nonStringResolvedAt || (resolved_at.length > 0 && !timestampLooksValid(resolved_at)),
  };
}

export function parseKind(value: unknown): SubjectKind | null {
  const s = text(value);
  return KINDS.has(s) ? (s as SubjectKind) : null;
}

export function parseStatus(value: unknown): ClaimStatus | null {
  const s = text(value);
  return STATUSES.has(s) ? (s as ClaimStatus) : null;
}

export function parseUserClaim(row: Record<string, unknown>): UserClaim | null {
  const claim_id = text(row.claim_id);
  const user_id = text(row.user_id);
  if (!claim_id || !user_id) return null;
  const subjectRaw = row.subject;
  const subjectObj = subjectRaw && typeof subjectRaw === "object" && !Array.isArray(subjectRaw)
    ? (subjectRaw as Record<string, unknown>)
    : {};
  const probability = row.stated_probability;
  const kind = parseKind(subjectObj.kind);
  const status = parseStatus(row.status);
  const { resolution, malformedResolvedAt } = parseResolution(row.resolution);
  let ingestUnscorable: UnscorableReason | null = null;
  if (kind === null) ingestUnscorable = "unrecognised_kind";
  else if (status === null) ingestUnscorable = "unrecognised_status";
  else if (malformedResolvedAt) ingestUnscorable = "malformed_timestamp";
  return {
    claim_id,
    user_id,
    subject: { kind: kind ?? "security", id: text(subjectObj.id) },
    stated_at: text(row.stated_at),
    resolves_at: text(row.resolves_at),
    claim_text: text(row.claim_text),
    condition: parseCondition(row.condition),
    stated_probability: typeof probability === "number" && Number.isFinite(probability) ? probability : null,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    status: ingestUnscorable ? "void_unscorable" : status as ClaimStatus,
    resolution,
    supersedes: typeof row.supersedes === "string" && row.supersedes ? row.supersedes : null,
    ingestUnscorable,
  };
}

export async function listOwnClaims(
  db: AccuracyDb,
  userId: string,
): Promise<{ ok: true; claims: UserClaim[] } | { ok: false; error: string }> {
  const result = await db
    .from("user_claims")
    .select("claim_id,user_id,subject,stated_at,resolves_at,claim_text,condition,stated_probability,evidence,status,resolution,supersedes")
    .eq("user_id", userId)
    .order("stated_at", { ascending: true });
  if (result.error) return { ok: false, error: result.error.message || "accuracy_store_unavailable" };
  const rows = Array.isArray(result.data) ? result.data : [];
  const claims: UserClaim[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const parsed = parseUserClaim(row as Record<string, unknown>);
    if (parsed && parsed.user_id === userId) claims.push(parsed);
  }
  return { ok: true, claims };
}
