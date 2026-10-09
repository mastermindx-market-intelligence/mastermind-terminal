# SPX hedge-target consumer contract

This is a non-publishing typed consumer for Macro's
`options.hedge_target_change/v1` output in
[Macro #8684](https://github.com/mastermindx-market-intelligence/macro/pull/8684).
It is a companion to the existing Options Workspace integration, not a new
options engine, source route, store, forecast lifecycle or chart implementation.
`terminal/lib/hedgeTargetContract.ts` owns only validation and a display projection.

The consumer keeps SPX risk units and the reference USD notional distinct from
shares, ES contracts, cash flow and price predictions. Complete means complete
for the explicitly supplied universe. An explicit expiry filter is labelled as
a selected subset; an unfiltered result still makes no market-wide coverage claim.
Null/unavailable exposure cannot become a zero. Source age is age at the payload's
decision time, not browser-render freshness. The retained source receipt and
content ID are upstream assertions; parsing does not authenticate provenance,
verify the content digest, admit data rights or enable publication.

All nine existing authority flags must remain false. The consumer rejects
malformed clocks, availability after the decision cutoff, stale complete outputs,
missing/duplicate denominator members, unsupported units and settlement pairs,
invalid selected inventory/IV, fixing crossings, and inconsistent target,
attribution, expiry or cohort totals. It performs no Greek calculation or trade
signing. `cancellation_ratio` means abs(net)/gross: label it net/gross, where zero
is maximal cancellation and one is no cancellation.

The three fixtures under `terminal/lib/__tests__/fixtures/hedgeTarget*.synthetic.json`
are generated from the actual incumbent Macro function at
`4e7e44bfcce3bf1292978266b813633bd6bbe5db`. The main fixture is the output of
`scripts/build_options_scenario_surface.py --mode hedge-target` using
`research/options_estate/SPX_HEDGE_TARGET_FIXTURE_2026-10-08.json`, SHA-256
`8dcc57469e9c361d20f893022ea924afd37c4fe13a8f81cdb5b23a20f6ea4f5f`.
The zero fixture sets target time/spot to the anchor, IV shift to zero and ending
positions to starting positions. The unavailable fixture sets `as_of` to
`2026-10-08T18:01:02+00:00`, exceeding the existing source-age threshold.
These are invented arithmetic examples, not observed market data or backtests.

This change touches no Options Workspace component, authentication, subscription,
API, publisher, chart primitive or existing scenario-surface contract. Existing
Terminal #640/#661/#799/#723/#846 writers retain those paths. Their accepted
transport and component integration must consume this projection explicitly;
neither a parser test nor a fixture is source-to-browser acceptance. Source
admission, lawful derived-panel use, natural production transport, dual-theme
EN/ZH responsive UI proof and release remain separate gates. Programme state
continues in Macro's existing `WS:ADVANCED-DATA-OPTIONS` records, not here.
