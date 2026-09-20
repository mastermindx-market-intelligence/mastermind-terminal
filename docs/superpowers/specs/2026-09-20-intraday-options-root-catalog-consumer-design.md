# Intraday Options Root Catalog Consumer Design

**Operation:** `intraday-options-root-coverage-20260920-sol-001`  
**Issue:** `mastermindx-market-intelligence/mastermind-terminal#681`  
**Skillpack:** `mastermindx-market-intelligence/Mastermind@bceb5e1593b1dd7e9e34c3bccbceb02e6ccd5a26`

## Outcome

The Options Ticker Drill must expose the full intraday root universe declared by the canonical Macro live-flow producer. A root remains searchable when it is quiet, outside `top_net_impact`, and absent from `unusual_names`. Session activity affects ordering and annotation, not eligibility.

## Current defect

`OptionsHubView` currently builds candidates only from `tideData.top_net_impact` and `feed.unusual_names`, then shows only 20 by default. This makes the sidebar an activity sample rather than a coverage selector. It cannot distinguish a covered quiet root, a rotating root awaiting its bucket, an unavailable catalog, or a genuine unsupported symbol.

## Architecture

### Existing meta transport

Consume the optional `root_catalog` carried by the existing `live_flow.meta/v2` payload. The `meta` f-param already exists, so no API route or flow-source mapping is added. The meta stream is subscribed while the Tickers tab is active.

### Defensive parser

Add one pure module, `terminal/lib/liveFlowRootCatalog.ts`, responsible for validation and presentation ordering. The component never reads unknown producer fields directly.

A catalog is accepted only when:

- payload schema is exactly `live_flow.meta/v2`;
- `root_catalog` is a non-empty array;
- every row has a safe normalized root, `core|rotating` tier, exact booleans, nullable valid UTC timestamp, exact positive integer or null activity rank;
- roots are unique;
- `roots_configured`, when present, equals the row count.

Any malformed row rejects the whole catalog and activates the existing session-derived fallback. Partial acceptance would make coverage claims ambiguous.

### Candidate model

The helper returns rows with:

```ts
interface LiveFlowRootCatalogEntry {
  root: string;
  tier: "core" | "rotating";
  scheduledThisCycle: boolean;
  sourceOkThisCycle: boolean;
  lastSourceSuccess: string | null;
  hasSessionData: boolean;
  activityRank: number | null;
}
```

Producer order is preserved after validation: active roots first, then core, then rotating. Search normalization trims whitespace, removes one optional leading `$`, uppercases the query, and matches root substrings. With a valid catalog, the unfiltered sidebar shows the whole catalog in a scroll container; it is not sliced to 20.

When the catalog is absent or invalid, fallback candidates remain the union of `top_net_impact` and `unusual_names`, preserving current behavior and the 20-row unfiltered preview.

### UI behavior

- Header summary shows covered count and current activity count when catalog-backed.
- Active rows keep signed net-premium annotation.
- Quiet rows show compact `CORE` or `ROTATING` coverage annotation.
- Search always spans all catalog roots.
- Exposure, Structure, Volatility, and Positioning receive one merged root-choice list: producer catalog order first, then static EOD-only/index fallbacks, deduplicated.
- No-match copy says no covered root matches the query.
- Fallback copy explicitly says the catalog is unavailable and the list is session-scoped.
- Selecting a catalog root with `has_session_data=true` still uses the existing `ticker:{ROOT}` flow path. A catalog root with `has_session_data=false` renders the authoritative empty state directly and does not probe an artifact that the producer says cannot exist.
- Per-root drill requests carry a monotonic request identity and validate the returned payload root. A slow prior-root response, malformed payload, or wrong-root object cannot replace the newer selection. Selecting an authoritative empty root invalidates any older request before rendering its empty state.

No-data copy is truthful by entry state:

1. `lastSourceSuccess === null`: configured but awaiting its first successful session refresh;
2. receipt exists and `hasSessionData === false`: covered and checked, but no qualifying session drill data accumulated;
3. `hasSessionData === true` but no ticker payload: producer artifact is not yet available; do not call the root quiet.

All states are bilingual. Status labels use text as well as color.

## Responsive behavior

The existing 180-pixel sidebar remains the layout owner. Catalog status text is compact and truncation-safe. Desktop, tablet and mobile must keep search, rows and no-data states within the viewport without horizontal document overflow.

## Tests

RED-first unit tests cover valid parsing, malformed-row fail-closed fallback, duplicate roots, optional `$` search, preserved producer order, full catalog visibility, and fallback slicing. Browser fixture proof adds a quiet root that is absent from tide/unusual lists, searches it, selects it and verifies the truthful no-data state on desktop/tablet/mobile plus Chinese labels. The same proof verifies that the quiet root appears in all four per-root selector datalists while SPX remains available as an EOD-only index root.

## Collision boundary

Open PRs #671/#680 touch `OptionsHubView.tsx` only in Flow Leaders sections. This operation owns meta subscription, ticker candidate derivation and Ticker Drill rendering. Open PR #668 touches `flowSource.ts`; this operation deliberately does not.

## Proof and non-goals

A Terminal PR must pass unit, typecheck and focused Playwright proof. Merge/deploy remain separate. Production acceptance requires a real quiet root from Macro's catalog to appear in the deployed selector and either render its ticker drill or the exact honest no-data state. No new endpoint, manifest, catalog service, fetch loop, options engine, signal, ranker or trade authority is introduced.
