# Sector Central R11 — exact selected-sector Company Heatmap

`BUILT_NOT_PROVEN / DRAFT / UNMERGED / NOT DEPLOYED`

Operation: `sector-intelligence-terminal-20260926-sol-001`

Parent: `macro#7646 / sector-central-redesign-20260921-sol-001`

Predecessor: `b7d42c263fe8524c232b68e47b3c16680756410f`

## Capability

Discover now has three coordinated representations inside the existing `sectorWorkspace=discover` job:

- **Table** — the exact eleven-sector owner population and existing sector measurements.
- **Heatmap** — the selected sector's exact S&P 500 company population, grouped by owner-supplied industry, sized by market cap and coloured by one selected performance window.
- **Matrix** — the same selected-sector population crossed by owner industry and deterministic market-cap bands.

The Heatmap consumes the incumbent `heatmap` BFF and the already-bound `site/marketdata/sp500_heatmap.json` owner. It creates no collector, endpoint, publisher, cache, taxonomy, source identity, history store, save/alert store or browser-computed market authority.

For the selected sector it provides:

- exact canonical sector-label matching, separate from translated display labels;
- deterministic nested industry/company layout over the complete readable owner population;
- company area driven by source market cap and a disclosed 0.1% industry visibility floor so a small source industry cannot disappear below a display pixel;
- a fixed symmetric colour domain computed from the complete selected-sector population; industry/cap filters cannot rescale it;
- durable `1D / 1W / MTD / 1M / 3M / 6M / YTD / 1Y` state;
- missing observations distinct from exact zero;
- one plain answer derived from largest industry market-cap share plus broadest observed participation;
- URL-bound industry, cap-band and company selection, with the selected company inspector and existing Company Intelligence link;
- explicit selected-sector depth and exact return to prior representation, filters, timeframe, company, independent group identity, scroll position and opening-action focus;
- desktop one-canvas + inspector, tablet stacking and mobile selected-insight-first behavior with the dense map behind a deliberate disclosure;
- EN/ZH, light/dark, contextual Sources and access-loss clearing.

Sector, timeframe, industry and cap filters preserve the selected company identity. If that company is outside the visible scope, the inspector temporarily serves the largest visible company; clearing the filter restores the exact selected company rather than deleting its state.

## Exact owner boundary

Macro revision: `f94256971e49b6372645af3d329080d6e3747ea9`

| Owner file | Date | SHA-256 | Use |
|---|---|---|---|
| `site/sectordata/sector_central.json` | 2026-09-25 | `61a45950781430f66fe00a93f64325819d226f6f36b704f9f899dd106b0b2dc1` | selected sector identity and outer workspace context |
| `site/marketdata/sp500_heatmap.json` | 2026-09-25 | `beeadcf92f52b363ebed2ae458acf658702a8d0822e84ef3cc3531b278129961` | exact company, industry, market-cap and performance observations |

The exact Technology scope remains **79 names**. The separate `Information Technology` source row remains excluded rather than silently aliased. The current exact 1D colour domain is **±6.3%**; the final proof also verifies that filtering does not change this domain.

This vertical does **not** admit the separately rights-held Finviz theme/bubble plane. Bubbles, full-family selection, nested theme/subtheme heatmaps, overlap/evidence/compare and historical trails remain separate owner-gated work.

## Verification

- Full Terminal unit suite: **400 files / 6,453 passed / 4 todo**.
- Complete related Sector surface: **181/181 PASS** across ten files before the final full-suite confirmation.
- Targeted Heatmap + Discover + Matrix + Rotation: **82/82 PASS** before the final layout repair; final Heatmap/Discover retest: **47/47 PASS**.
- Next route generation, TypeScript, scoped TypeScript/TSX ESLint: **PASS**.
- Plain-language self-check: **PASS**.
- Exact-owner Heatmap browser qualification `exact-owner-r6`: **98/98 PASS**, five captures, zero page exceptions.
- Matrix regression `exact-owner-r11-regression`: **81/81 PASS**, five captures, zero page exceptions.
- Discover/Breadth regression `journey-r11-regression`: **106/106 PASS**, ten captures, zero page exceptions.

Browser coverage includes Chromium desktop/tablet/mobile and WebKit desktop/mobile; English and Chinese; light and dark; exact population; exact source date; canonical-vs-localized identity; fixed colour scale; complete company reachability; answer derivation; filters; selected company; Table/Heatmap continuity; explicit detail return; focus restoration; contextual Sources; access-loss clearing and horizontal-overflow checks.

Browser evidence uses immutable exact-owner files through local interception. It is **not** authenticated publication-to-Terminal or served production proof.

## Failure chronology retained

The unsuccessful proof runs are preserved rather than overwritten:

1. `exact-owner-r1` exposed a real population defect: fixed industry title/padding consumed the smallest source block and only 78 of 79 names were reachable. R11 now applies a disclosed industry visibility floor plus adaptive chrome/insets; a dedicated unit regression proves a tiny exact-owner industry remains present.
2. `exact-owner-r2` exposed a proof-harness Promise/string conversion mistake in the fixed-domain assertion; no product change.
3. `exact-owner-r3` exposed that a native closed `<details>` hides its body despite desktop CSS. The map is now explicitly open on desktop and closed on mobile through viewport-aware state.
4. `exact-owner-r4` exposed a real state defect: filtering cleared the selected company, so switching representations did not restore it. Company identity now survives presentation filters and Matrix cells.
5. `exact-owner-r5` exposed an over-strict URL-string assertion: identical state was serialized in a different query-parameter order. Final proof compares the semantic parameter set.
6. `exact-owner-r6` is the final green exact-owner proof.

## Boundaries

- The 0.1% industry floor is presentation-only and disclosed. Source market caps, answers, receipts, company inspectors and filtering use unmodified owner values.
- Heatmap colour is descriptive source performance, not a forecast, rank, entry signal or position-size instruction.
- Missing performance remains unavailable, not neutral or zero.
- No theme/bubble rights decision is inferred from the admitted S&P 500 heatmap owner.
- Existing Paper boards and incumbent native design custody were not modified.
- The separately held historical responsive-fixture/label action was not replayed or routed around.
- Independent review is not a gate under the Chairman's current instruction; this does not authorize merge, deployment, rights expansion or production acceptance.
