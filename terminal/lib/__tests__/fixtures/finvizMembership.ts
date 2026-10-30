// Synthetic contract fixture; never source authority or production proof.
import { TIMEFRAMES } from '../../finvizThemes';
const perf = (daily: number | null) => Object.fromEntries(TIMEFRAMES.map(tf => [tf, tf === '1D' ? daily : null]));
export function finvizMembershipPayload() {
  return {
    source: 'finviz-themes', map_type: 'themes', size_basis: 'count',
    asof: '2026-10-09', generated_utc: '2026-10-10 14:38',
    timeframes: TIMEFRAMES.map(key => ({ key, available: true })),
    sectors: [{ key: 'synthetic', en: 'Synthetic', zh: '合成' }],
    n_tiles: 2, n_members: 3,
    tiles: [
      { t: 'one', name: 'One', sector: 'synthetic', size: 2, perf: perf(0),
        members: [{ t: 'ALFA', perf: perf(1) }, { t: 'BETA', perf: perf(0) }] },
      { t: 'two', name: 'Two', sector: 'synthetic', size: 2, perf: perf(1),
        members: [{ t: 'ALFA', perf: perf(1) }, { t: 'GAMMA', perf: perf(null) }] },
    ],
  };
}
export function finvizMembershipFixture(): Record<string, unknown> {
  return {
    schema: 'finviz.membership_manifest.v1',
    tree_sha256: 'a'.repeat(64),
    counts: { themes: 1, subthemes: 2, appearances: 4, distinct_tickers: 3 },
    reconciliation: { status: 'conserved', reasons: [] },
    coverage: Object.fromEntries(TIMEFRAMES.map(tf => [tf, {
      measured_members: tf === '1D' ? 2 : 0, total_members: 3,
      measured_groups: tf === '1D' ? 2 : 0, total_groups: 2,
    }])),
    unpriced_members: 1,
    unresolved_identity_count: null, source_declared_partial_groups: null,
    source_declared_missing_groups: null, unknown_reason: 'not_provided_by_source',
    membership: { status: 'bound', reason: null, asof: '2026-08-15',
      refreshed_at_utc: '2026-08-15T02:01:34+00:00', parser_version: 'finviz_tree_refresh.v1' },
    corrections: { status: 'snapshot_promoted', scope: 'bound_snapshot_only',
      current_proposal_adjudication: null },
  };
}
