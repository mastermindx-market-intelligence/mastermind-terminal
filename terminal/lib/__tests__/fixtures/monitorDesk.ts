// Shared by the existing Monitor unit contracts and authenticated browser
// qualifier. Synthetic account inventory; never a live account or market read.
import golden from './aapl-event-workspace.json';

export function monitorWatchlistsFixture() {
  return [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Core', position: 0,
      symbols: [{symbol: 'AAPL', section: 'Tech', position: 0}, {symbol: 'MSFT', section: 'Tech', position: 1}] },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Watch', position: 1,
      symbols: [{symbol: 'NVDA', section: 'Chips', position: 0}] },
  ];
}

export function monitorAlertsFixture() {
  return [
    {id: 'alert-1', symbol: 'AAPL', active: true, created_at: '2026-01-05T00:00:00.000Z'},
    {id: 'alert-2', symbol: 'MSFT', active: false, created_at: '2026-02-01T00:00:00.000Z',
      condition: {type: 'price', op: 'above', value: 400, triggered: true}},
    {id: 'alert-3', symbol: 'NVDA', active: false, created_at: '2026-03-01T00:00:00.000Z',
      condition: {type: 'price', op: 'below', value: 90}},
  ];
}

export function monitorRetainedEventFixture(name = golden.issuer.display_name, symbol = 'AAPL') {
  return {ok: true as const,
    workspace: {...golden, issuer: {...golden.issuer, display_name: name,
      listings: [{...golden.issuer.listings[0], ticker: symbol}]}},
    receipt: {
      schema: 'earnings.retained_baseline.v1', owner: 'earnings.workspace_generation',
      company_id: golden.issuer.company_id, event_id: golden.event_id, generation_id: golden.generation_id,
      workspace_schema: golden.schema, manifest_schema: 'event_workspace_manifest.v1', authority: 'context_only',
      manifest_sha256: 'a'.repeat(64), manifest_bytes: 2048, workspace_sha256: 'b'.repeat(64), workspace_bytes: 4096,
      fingerprint: 'c'.repeat(64), public_known_at: golden.lifecycle.source_available_at,
      platform_known_at: golden.lifecycle.observed_at, generation_emitted_at: '2026-10-21T12:00:00Z',
      rights: {allowed: true, policy_version: 'fixture-retained-context.v1', checked_at: '2026-10-21T12:00:00Z'},
    },
  };
}
