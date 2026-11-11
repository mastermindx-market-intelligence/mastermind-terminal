import { describe, expect, it } from 'vitest';
import { normalizeFinviz, TIMEFRAMES } from '../finvizThemes';
import { qualifyFinvizMembershipManifest } from '../finvizMembershipManifest';

const perf = (daily: number | null) => Object.fromEntries(TIMEFRAMES.map(tf => [tf, tf === '1D' ? daily : null]));
function population() {
  return normalizeFinviz({
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
  });
}
function manifest(): Record<string, unknown> {
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
function changed(path: string, value: unknown) {
  const m = manifest();
  const keys = path.split('.');
  let row = m;
  for (const key of keys.slice(0, -1)) row = row[key] as Record<string, unknown>;
  row[keys[keys.length - 1]] = value;
  return m;
}

describe('Finviz membership metadata trust boundary', () => {
  it('preserves distinct membership and market clocks and unknown identity counts', () => {
    const pop = population();
    const result = qualifyFinvizMembershipManifest(manifest(), pop);
    expect(result.status).toBe('qualified');
    expect(result.manifest?.membership.asof).toBe('2026-08-15');
    expect(pop.asOf).toBe('2026-10-09');
    expect(result.manifest?.unresolved_identity_count).toBeNull();
    expect(result.manifest?.source_declared_partial_groups).toBeNull();
    expect(result.manifest?.source_declared_missing_groups).toBeNull();
    expect(result.manifest?.unpriced_members).toBe(1);
    expect(result.manifest?.coverage['1D']).toEqual({
      measured_members: 2, total_members: 3, measured_groups: 2, total_groups: 2,
    });
    expect(result.manifest?.corrections.current_proposal_adjudication).toBeNull();
  });

  it('retains legacy absence without inventing source validation', () => {
    expect(qualifyFinvizMembershipManifest(undefined, population())).toEqual({
      status: 'absent', manifest: null, reason: 'manifest_missing',
    });
  });

  it('retains explicit unknown membership without borrowing the market or build date', () => {
    const m = manifest();
    m.membership = { status: 'unknown', reason: 'receipt_unavailable', asof: null,
      refreshed_at_utc: null, parser_version: null };
    m.corrections = { status: 'unknown', scope: 'bound_snapshot_only', current_proposal_adjudication: null };
    const r = qualifyFinvizMembershipManifest(m, population());
    expect(r.status).toBe('qualified');
    expect(r.manifest?.membership.asof).toBeNull();
    expect(r.manifest?.membership.refreshed_at_utc).toBeNull();
  });

  it.each([
    ['schema', 'different'], ['counts.distinct_tickers', 4],
    ['counts.appearances', 3], ['counts.themes', true],
    ['counts.subthemes', 2.5], ['tree_sha256', 'not-a-hash'],
    ['reconciliation.status', 'invalid'], ['reconciliation.reasons', ['invalid_member_identity']],
    ['coverage.1D.measured_members', 3], ['coverage.1D.measured_groups', 1],
    ['coverage.1D.total_members', 4], ['coverage.1D.total_groups', 3],
    ['coverage.1W.measured_members', 1], ['coverage.1Y', null],
    ['unpriced_members', 0], ['unresolved_identity_count', 1],
    ['source_declared_partial_groups', 0], ['source_declared_missing_groups', false],
    ['unknown_reason', 'complete'], ['membership.asof', '2026-02-30'],
    ['membership.refreshed_at_utc', '2026-08-15T02:01:34'],
    ['membership.refreshed_at_utc', '2026-08-15T25:01:34Z'],
    ['membership.refreshed_at_utc', '2026-02-30T02:01:34Z'],
    ['membership.refreshed_at_utc', '2026-10-11T00:00:00Z'],
    ['membership.refreshed_at_utc', '2026-10-10T14:38:00.000001Z'],
    ['membership.asof', '2026-08-16'], ['membership.parser_version', 'other'],
    ['membership.reason', 'receipt_unavailable'],
    ['corrections.status', 'accepted'], ['corrections.scope', 'current_universe'],
    ['corrections.current_proposal_adjudication', 'accepted'],
  ])('rejects contradictory or malformed %s without coercion', (path, value) => {
    const result = qualifyFinvizMembershipManifest(changed(path, value), population());
    expect(result.status).toBe('invalid');
    expect(result.manifest).toBeNull();
  });

  it.each([null, false, 0, '', [], 'metadata'])('rejects a malformed declared envelope %j', value => {
    expect(qualifyFinvizMembershipManifest(value, population()).status).toBe('invalid');
  });

  it('compares receipt instants in UTC, while keeping the source representation', () => {
    const m = changed('membership.refreshed_at_utc', '2026-08-14T22:01:34-04:00');
    const r = qualifyFinvizMembershipManifest(m, population());
    expect(r.status).toBe('qualified');
    expect(r.manifest?.membership.refreshed_at_utc).toBe('2026-08-14T22:01:34-04:00');
  });

  it('refuses a bound observation when no valid generation ceiling exists', () => {
    const pop = population();
    pop.generatedAt = null;
    expect(qualifyFinvizMembershipManifest(manifest(), pop).status).toBe('invalid');
  });

  it('projects only factual metadata and does not mutate or retain the input objects', () => {
    const m = manifest();
    m.vendor_prose = 'untrusted';
    (m.membership as Record<string, unknown>).extra = 'untrusted';
    const before = JSON.stringify(m);
    const r = qualifyFinvizMembershipManifest(m, population());
    expect(r.status).toBe('qualified');
    expect(r.manifest).not.toHaveProperty('vendor_prose');
    expect(r.manifest?.membership).not.toHaveProperty('extra');
    expect(JSON.stringify(m)).toBe(before);
    (m.membership as Record<string, unknown>).asof = '2020-01-01';
    expect(r.manifest?.membership.asof).toBe('2026-08-15');
  });
});
