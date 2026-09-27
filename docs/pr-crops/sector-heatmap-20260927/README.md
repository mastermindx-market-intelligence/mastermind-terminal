# Sector Central Company Heatmap — current-source correction and final proof

`BUILT_NOT_PROVEN / DRAFT / UNMERGED / NOT DEPLOYED`

Operation: `sector-intelligence-terminal-20260926-sol-001`

Parent: `macro#7646 / sector-central-redesign-20260921-sol-001`

Original implementation head: `6016f174366cd06807f9ee876bf54fbdcd4376dc`

## Capability

The selected-sector Company Heatmap uses the exact readable `sp500_heatmap.json` population, grouped by owner industry, sized by source market cap and coloured by one selected performance window. It shares sector, timeframe, industry, market-cap band and selected-company state with the Company Table and Industry × Market Cap Matrix.

It provides:

- exact source-sector matching separate from translated display names;
- complete company reachability in a deterministic nested industry/company layout;
- a disclosed 0.1% industry visibility floor so a tiny source industry remains selectable without changing source values;
- a fixed symmetric colour domain computed from the complete selected-sector population, unaffected by filters;
- durable `1D / 1W / MTD / 1M / 3M / 6M / YTD / 1Y` state;
- missing observations distinct from exact zero;
- a current answer derived from largest industry market-cap share and broadest observed participation;
- selected-company inspector, Company Intelligence link and exact representation/detail return;
- desktop one-canvas + inspector, tablet stacking and mobile selected-insight-first disclosure;
- EN/ZH, light/dark, contextual Sources and access-loss clearing.

No collector, publisher, taxonomy, score, forecast, history store, save/alert store or browser market authority is introduced.

## Provenance correction

The original Heatmap qualification runs `exact-owner-r1` through `exact-owner-r6` used Macro revision:

`79dbe3f2431b9e21cabf23071f02eab5add57eb4`

The first manifest incorrectly projected those runs as proof of later Macro revision `f942569...`. The source population identity stayed stable, but the observations did not: 499/503 heatmap tiles changed, including all 79 Technology tiles, and all eleven Sector Central rows changed material measured fields. The original runs remain valid only for their immutable `79dbe3f...` input.

Current-source proof uses Macro revision:

`f94256971e49b6372645af3d329080d6e3747ea9`

| Owner file | Date | SHA-256 |
|---|---:|---|
| `site/sectordata/sector_central.json` | 2026-09-25 | `61a45950781430f66fe00a93f64325819d226f6f36b704f9f899dd106b0b2dc1` |
| `site/marketdata/sp500_heatmap.json` | 2026-09-25 | `beeadcf92f52b363ebed2ae458acf658702a8d0822e84ef3cc3531b278129961` |

Technology remains exactly 79 names with cap-band counts `24 / 26 / 29 / 0`; the separate `Information Technology` label remains excluded.

## Final current-source browser proof

`exact-owner-r14-current-atomic-final/qualification.json`

- **98/98 checks pass**;
- five Chromium/WebKit desktop/tablet/mobile EN/ZH light/dark captures;
- zero page exceptions;
- exact population, date and canonical/localized identity;
- fixed full-population colour scale;
- all companies reachable;
- answer derivation, filters, selected company and representation continuity;
- explicit detail return, focus restoration, Sources, access loss and no horizontal overflow.
- combined industry/cap scope clears through one atomic state transition.

`current-source-history/` retains qualification-only receipts for the stale `.next` startup failures and the first passing current-source run. Repeated screenshot sets were archived outside the repository; the final directory above is the current-source screenshot evidence.

## Original implementation failure chronology

The original `79dbe3f...` qualification preserved these useful product findings:

1. the smallest industry block initially hid one of 79 names; adaptive layout plus the disclosed visibility floor repaired it;
2. a proof Promise/string conversion error was corrected without a product change;
3. closed native `<details>` hid the desktop map; viewport-aware disclosure repaired it;
4. filtering erased selected-company continuity; identity is now preserved across presentation filters;
5. an over-strict query-string order assertion was replaced by semantic parameter comparison;
6. `exact-owner-r6` passed for the original immutable snapshot.

## Boundaries

- The visibility floor is display-only; answers, receipts, inspectors and filters use unmodified owner values.
- Colour is descriptive performance, not a recommendation, forecast, entry signal or position size.
- Missing performance stays unavailable.
- Theme/bubble rights are not inferred from the S&P 500 heatmap owner.
- Browser proof uses local interception and is not authenticated production transport.
- The aggregate current result, auth repair and exact continuation are recorded in `../sector-r12-convergence-20260927/README.md`.
