export type LiveFlowRootTier = "core" | "rotating";

export interface LiveFlowRootCatalogEntry {
  root: string;
  tier: LiveFlowRootTier;
  scheduledThisCycle: boolean;
  sourceOkThisCycle: boolean;
  lastSourceSuccess: string | null;
  hasSessionData: boolean;
  activityRank: number | null;
}

export interface TickerCandidateRow {
  root: string;
  impact: number | null;
  catalog: LiveFlowRootCatalogEntry | null;
}

interface CandidateArgs {
  catalog: readonly LiveFlowRootCatalogEntry[] | null;
  impacts: ReadonlyMap<string, number>;
  fallbackRoots: readonly string[];
  query: string;
  fallbackLimit?: number;
}

const ROOT_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUtcIso(value: unknown): value is string {
  return typeof value === "string"
    && value.endsWith("Z")
    && Number.isFinite(Date.parse(value));
}

function parseRow(value: unknown): LiveFlowRootCatalogEntry | null {
  if (!isRecord(value)) return null;

  const root = value.root;
  const tier = value.tier;
  const scheduled = value.scheduled_this_cycle;
  const sourceOk = value.source_ok_this_cycle;
  const lastSuccess = value.last_source_success;
  const hasData = value.has_session_data;
  const activityRank = value.activity_rank;

  if (typeof root !== "string"
      || root !== root.trim().toUpperCase()
      || !ROOT_PATTERN.test(root)) return null;
  if (tier !== "core" && tier !== "rotating") return null;
  if (typeof scheduled !== "boolean"
      || typeof sourceOk !== "boolean"
      || typeof hasData !== "boolean") return null;
  if (lastSuccess !== null && !isUtcIso(lastSuccess)) return null;
  if (activityRank !== null
      && (!Number.isInteger(activityRank) || (activityRank as number) <= 0)) return null;

  return {
    root,
    tier,
    scheduledThisCycle: scheduled,
    sourceOkThisCycle: sourceOk,
    lastSourceSuccess: lastSuccess,
    hasSessionData: hasData,
    activityRank: activityRank as number | null,
  };
}

/**
 * Validate the producer-owned live-flow root catalog as one atomic coverage claim.
 * A malformed row rejects the whole catalog so the caller can fall back to the
 * session-derived list without accidentally advertising partial coverage.
 */
export function parseLiveFlowRootCatalog(
  value: unknown,
): LiveFlowRootCatalogEntry[] | null {
  if (!isRecord(value) || value.schema !== "live_flow.meta/v2") return null;
  const rawRows = value.root_catalog;
  if (!Array.isArray(rawRows) || rawRows.length === 0) return null;

  const declaredCount = value.roots_configured;
  if (declaredCount !== undefined
      && (!Number.isInteger(declaredCount) || declaredCount !== rawRows.length)) {
    return null;
  }

  const rows: LiveFlowRootCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const rawRow of rawRows) {
    const row = parseRow(rawRow);
    if (!row || seen.has(row.root)) return null;
    seen.add(row.root);
    rows.push(row);
  }
  return rows;
}

export function normalizeRootQuery(value: string): string {
  const trimmed = value.trim().toUpperCase();
  return trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;
}

/**
 * Root choices shared by the per-root options surfaces. Live-flow coverage leads
 * so active/core/rotating order is preserved; static roots remain as an EOD-only
 * fallback and retain index products that the intraday collector does not poll.
 */
export function buildOptionsRootChoices(
  catalog: readonly LiveFlowRootCatalogEntry[] | null,
  fallbackRoots: readonly string[],
): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  const add = (value: string) => {
    const root = value.trim().toUpperCase();
    if (!ROOT_PATTERN.test(root) || seen.has(root)) return;
    seen.add(root);
    roots.push(root);
  };
  for (const entry of catalog ?? []) add(entry.root);
  for (const root of fallbackRoots) add(root);
  return roots;
}

function normalizeFallbackRoots(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const root = value.trim().toUpperCase();
    if (!ROOT_PATTERN.test(root) || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return roots.sort((a, b) => a.localeCompare(b));
}

function impactFor(root: string, impacts: ReadonlyMap<string, number>): number | null {
  const value = impacts.get(root);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildTickerCandidateRows({
  catalog,
  impacts,
  fallbackRoots,
  query,
  fallbackLimit = 20,
}: CandidateArgs): TickerCandidateRow[] {
  const normalizedQuery = normalizeRootQuery(query);

  if (catalog) {
    return catalog
      .filter((entry) => !normalizedQuery || entry.root.includes(normalizedQuery))
      .map((entry) => ({
        root: entry.root,
        impact: impactFor(entry.root, impacts),
        catalog: entry,
      }));
  }

  const matches = normalizeFallbackRoots(fallbackRoots)
    .filter((root) => !normalizedQuery || root.includes(normalizedQuery));
  const visible = normalizedQuery ? matches : matches.slice(0, Math.max(0, fallbackLimit));
  return visible.map((root) => ({
    root,
    impact: impactFor(root, impacts),
    catalog: null,
  }));
}
