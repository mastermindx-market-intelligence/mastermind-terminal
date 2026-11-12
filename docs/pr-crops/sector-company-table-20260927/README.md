# Sector Central R12 — exact selected-sector Company Table

`BUILT_NOT_PROVEN / DRAFT / UNMERGED / NOT DEPLOYED`

The Table representation is now the dense company screener for the selected sector. It consumes the same exact `sp500_heatmap.json` population as Heatmap and Matrix rather than showing a second sector-summary table under the same label.

## User capability

For one selected sector, the table exposes every readable owner company with:

- ticker, company name and source industry;
- deterministic market-cap band and exact source market cap;
- the selected `1D / 1W / MTD / 1M / 3M / 6M / YTD / 1Y` observation;
- independent company search;
- source, performance, market-cap and ticker ordering;
- industry and market-cap filtering shared with Heatmap;
- selected-company continuity even when filters temporarily hide that company;
- direct Company Intelligence and selected-sector research actions;
- EN/ZH, light/dark and responsive table/card treatment.

The first read is derived from the currently visible exact scope: performance leader, advancing/observed denominator and largest company. Missing observations stay unavailable rather than becoming zero.

The company search uses its own URL field and does not reuse the outer sector-search field. Representation, timeframe, filters, selected company, scroll and return focus remain durable across Table, Heatmap and Matrix.

## Exact owner boundary

Final proof uses Macro revision `f94256971e49b6372645af3d329080d6e3747ea9`:

- `site/sectordata/sector_central.json` — `61a45950781430f66fe00a93f64325819d226f6f36b704f9f899dd106b0b2dc1`;
- `site/marketdata/sp500_heatmap.json` — `beeadcf92f52b363ebed2ae458acf658702a8d0822e84ef3cc3531b278129961`.

Technology contains exactly 79 names; `Information Technology` remains a separate source label and is not aliased into the cohort.

## Verification

Final current-source receipt:

`exact-owner-r8-current-atomic-final/qualification.json`

- **101/101 checks pass**;
- five Chromium/WebKit desktop/tablet/mobile EN/ZH light/dark captures;
- zero page exceptions;
- exact 79-name population;
- search, sorting, industry/cap filtering, selected-company continuity and company links;
- Table ↔ Heatmap ↔ Matrix state continuity;
- explicit sector-detail return and focus restoration;
- contextual Sources, access clearing, 44px controls and no horizontal overflow.

The `history/` directory retains qualification-only receipts from the old immutable `79dbe3f...` bundle and the first current-source pass. Repeated historical screenshots were archived outside the repository; only the final current-source screenshots are release evidence.

The complete Sector unit surface passes **205/205**. The complete Terminal suite passes **401 files / 6,476 tests / 4 todo**. A final atomic-clear regression proves combined table filters clear through one state transition rather than three stale sequential writes.

## Boundaries

This table is descriptive source presentation. It does not create a recommendation, rank authority, entry gate, position size, alert or save store. Browser proof uses local interception and is not authenticated production transport. Theme/bubble rights and dated membership/history remain separate owner gates.
