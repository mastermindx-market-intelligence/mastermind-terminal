// Owner-scoped claim reads + the v1 resolver registry (declared, empty).
// Maturation/resolution writes are service-role only (the out-of-band worker).

import type { ClaimCondition, ClaimResolution, ClaimStatus, SubjectKind, UserClaim } from "@/lib/personalAccuracy";

export type MetricResolver = (claim: UserClaim) => Promise<{ observed: number } | null>;

/** v1: declared and empty. B-F13-7 lands the first resolver. Never guess an outcome. */
export const RESOLVER_REGISTRY: Readonly<Record<string, MetricResolver>> = Object.freeze({});

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

function parseResolution(value: unknown): ClaimResolution | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const outcome = o.outcome === 0 || o.outcome === 1 ? o.outcome : o.outcome === null ? null : null;
  return {
    outcome,
    observed: numOrNull(o.observed),
    resolved_at: text(o.resolved_at),
    resolver: text(o.resolver),
    note: text(o.note),
  };
}

function parseKind(value: unknown): SubjectKind {
  return KINDS.has(text(value)) ? (value as SubjectKind) : "security";
}

function parseStatus(value: unknown): ClaimStatus {
  return STATUSES.has(text(value)) ? (value as ClaimStatus) : "open";
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
  return {
    claim_id,
    user_id,
    subject: { kind: parseKind(subjectObj.kind), id: text(subjectObj.id) },
    stated_at: text(row.stated_at),
    resolves_at: text(row.resolves_at),
    claim_text: text(row.claim_text),
    condition: parseCondition(row.condition),
    stated_probability: typeof probability === "number" && Number.isFinite(probability) ? probability : null,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    status: parseStatus(row.status),
    resolution: parseResolution(row.resolution),
    supersedes: typeof row.supersedes === "string" && row.supersedes ? row.supersedes : null,
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
