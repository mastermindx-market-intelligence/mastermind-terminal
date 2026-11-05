import { TIMEFRAMES, type ThemePopulation, type Timeframe } from './finvizThemes';

type Counts = { themes: number; subthemes: number; appearances: number; distinct_tickers: number };
type Coverage = { measured_members: number; total_members: number; measured_groups: number; total_groups: number };
type Membership = {
  status: 'bound' | 'unknown';
  reason: string | null;
  asof: string | null;
  refreshed_at_utc: string | null;
  parser_version: 'finviz_tree_refresh.v1' | null;
};
export type FinvizMembershipManifest = {
  schema: 'finviz.membership_manifest.v1';
  counts: Counts;
  tree_sha256: string;
  reconciliation: { status: 'conserved'; reasons: [] };
  coverage: Record<Timeframe, Coverage>;
  unpriced_members: number;
  unresolved_identity_count: null;
  source_declared_partial_groups: null;
  source_declared_missing_groups: null;
  unknown_reason: 'not_provided_by_source';
  membership: Membership;
  corrections: {
    status: 'snapshot_promoted' | 'unknown';
    scope: 'bound_snapshot_only';
    current_proposal_adjudication: null;
  };
};
export type FinvizMembershipRead =
  | { status: 'qualified'; manifest: FinvizMembershipManifest; reason: null }
  | { status: 'absent' | 'invalid'; manifest: null; reason: string };

function requireCondition(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}
function record(value: unknown, reason: string): Record<string, unknown> {
  requireCondition(typeof value === 'object' && value !== null && !Array.isArray(value), reason);
  return value as Record<string, unknown>;
}
function equalCount(raw: unknown, expected: number, reason: string): number {
  requireCondition(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 && raw === expected, reason);
  return raw;
}
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value;
}
type Instant = { millis: number; subMillis: number };
function instant(value: unknown, generated = false): Instant | null {
  if (typeof value !== 'string') return null;
  const text = generated && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + ':00Z' : value;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!match || !validDay(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return null;
  const zone = match[6];
  if (zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) return null;
  const epoch = Date.parse(text);
  if (!Number.isFinite(epoch)) return null;
  const year = new Date(epoch).getUTCFullYear();
  // Python source clocks preserve microseconds; JS Date truncates to milliseconds.
  const subMillis = Number((match[5] ?? '').padEnd(6, '0').slice(3));
  return year >= 1 && year <= 9999 ? { millis: epoch, subMillis } : null;
}
function membership(raw: unknown, generatedAt: string | null): Membership {
  const value = record(raw, 'membership_invalid');
  if (value.status === 'unknown') {
    requireCondition(value.asof === null && value.refreshed_at_utc === null && value.parser_version === null, 'unknown_membership_has_clock');
    requireCondition(typeof value.reason === 'string' && [
      'receipt_unavailable', 'receipt_identity_or_promotion_mismatch', 'receipt_clock_unqualified',
    ].includes(value.reason), 'unknown_membership_reason_invalid');
    return { status: 'unknown', reason: value.reason, asof: null, refreshed_at_utc: null, parser_version: null };
  }
  requireCondition(value.status === 'bound' && value.reason === null
    && value.parser_version === 'finviz_tree_refresh.v1' && validDay(value.asof), 'membership_binding_invalid');
  const observed = instant(value.refreshed_at_utc);
  const ceiling = instant(generatedAt, true);
  requireCondition(observed !== null && ceiling !== null
    && (observed.millis < ceiling.millis || (observed.millis === ceiling.millis && observed.subMillis <= ceiling.subMillis))
    && value.asof <= new Date(observed.millis).toISOString().slice(0, 10), 'membership_clock_invalid');
  return { status: 'bound', reason: null, asof: value.asof,
    refreshed_at_utc: value.refreshed_at_utc as string, parser_version: 'finviz_tree_refresh.v1' };
}

/**
 * Qualifies and projects the proposed v1 factual metadata against a population
 * already normalized by normalizeFinviz. This checks metadata consistency only:
 * it does not verify the original tree hash, source ownership, release authority,
 * current vendor-universe completeness, or rights.
 */
export function qualifyFinvizMembershipManifest(raw: unknown, population: ThemePopulation): FinvizMembershipRead {
  if (raw === undefined) return { status: 'absent', manifest: null, reason: 'manifest_missing' };
  try {
    const value = record(raw, 'manifest_invalid');
    requireCondition(value.schema === 'finviz.membership_manifest.v1', 'manifest_schema_invalid');
    requireCondition(typeof value.tree_sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.tree_sha256), 'tree_hash_invalid');
    const inputCounts = record(value.counts, 'manifest_counts_invalid');
    const counts: Counts = {
      themes: equalCount(inputCounts.themes, population.counts.themes, 'theme_count_mismatch'),
      subthemes: equalCount(inputCounts.subthemes, population.counts.subthemes, 'subtheme_count_mismatch'),
      appearances: equalCount(inputCounts.appearances, population.counts.appearances, 'appearance_count_mismatch'),
      distinct_tickers: equalCount(inputCounts.distinct_tickers, population.counts.tickers, 'ticker_count_mismatch'),
    };
    const reconciliation = record(value.reconciliation, 'reconciliation_invalid');
    requireCondition(reconciliation.status === 'conserved' && Array.isArray(reconciliation.reasons)
      && reconciliation.reasons.length === 0, 'population_not_conserved');

    // Count unique tickers once, including those appearing in multiple groups.
    const measuredByTicker = new Map<string, Set<Timeframe>>();
    for (const group of population.groups) for (const member of group.members) {
      const measured = measuredByTicker.get(member.ticker) ?? new Set<Timeframe>();
      for (const tf of TIMEFRAMES) if (typeof member.perf[tf] === 'number' && Number.isFinite(member.perf[tf])) measured.add(tf);
      measuredByTicker.set(member.ticker, measured);
    }
    const inputCoverage = record(value.coverage, 'coverage_invalid');
    const coverage = {} as Record<Timeframe, Coverage>;
    for (const tf of TIMEFRAMES) {
      const row = record(inputCoverage[tf], 'coverage_timeframe_invalid');
      const memberCount = [...measuredByTicker.values()].filter(set => set.has(tf)).length;
      const groupCount = population.groups.filter(group => typeof group.perf[tf] === 'number' && Number.isFinite(group.perf[tf])).length;
      coverage[tf] = {
        measured_members: equalCount(row.measured_members, memberCount, 'measured_member_count_mismatch'),
        total_members: equalCount(row.total_members, counts.distinct_tickers, 'coverage_member_total_mismatch'),
        measured_groups: equalCount(row.measured_groups, groupCount, 'measured_group_count_mismatch'),
        total_groups: equalCount(row.total_groups, counts.subthemes, 'coverage_group_total_mismatch'),
      };
    }
    const unpriced = [...measuredByTicker.values()].filter(set => set.size === 0).length;
    equalCount(value.unpriced_members, unpriced, 'unpriced_count_mismatch');
    requireCondition(value.unknown_reason === 'not_provided_by_source'
      && value.unresolved_identity_count === null && value.source_declared_partial_groups === null
      && value.source_declared_missing_groups === null, 'source_unknown_accounting_invalid');
    const binding = membership(value.membership, population.generatedAt);
    const corrections = record(value.corrections, 'corrections_invalid');
    const status = binding.status === 'bound' ? 'snapshot_promoted' : 'unknown';
    requireCondition(corrections.status === status && corrections.scope === 'bound_snapshot_only'
      && corrections.current_proposal_adjudication === null, 'correction_scope_invalid');
    return { status: 'qualified', reason: null, manifest: {
      schema: 'finviz.membership_manifest.v1', counts, tree_sha256: value.tree_sha256,
      reconciliation: { status: 'conserved', reasons: [] }, coverage, unpriced_members: unpriced,
      unresolved_identity_count: null, source_declared_partial_groups: null,
      source_declared_missing_groups: null, unknown_reason: 'not_provided_by_source',
      membership: binding,
      corrections: { status, scope: 'bound_snapshot_only', current_proposal_adjudication: null },
    } };
  } catch (error) {
    return { status: 'invalid', manifest: null,
      reason: error instanceof Error ? error.message : 'manifest_invalid' };
  }
}
