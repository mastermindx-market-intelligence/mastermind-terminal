# Terminal Options workspace

## Current completion record — 5 November 2026

The [final implementation and verification record](final-delivery-20261105/README.md) supersedes the historical gate statements below. It includes the completed Paper design, 294 state captures, original and integrated 39-case browser runs, the final 12-case chart correction, all three clean typechecks, repaired evidence readers, and the passing production compiler. Publication and hosted CI belong to the exact final PR heads.


The reported journey starts in Options, compares flow at different points within a trading session, and moves into a desk to inspect a contract or price level. The initial Exposure repair is tracked in [#1243](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1243). This change follows the existing category, tab, replay and data owners.

## Historic data cannot masquerade as live flow

Flow Desk's prominent session line now marks **Historical feed** when even the youngest measured source response is at least 72 hours old. This uses the measured `live_flow.meta/v2` source-response clock, not a reload, polling target or page-build timestamp; open/closed exchange status remains a separate fact. Chain Heat's receipt independently displays **Historical · source age** when its source-only `source_asof` is at least 72 hours old, with improved warning contrast and legibility. An unavailable or future source clock stays `Source age unavailable`, not fresh; a fresh source remains marked `Last session` when the exchange is closed. No market signal, score or ranking algorithm was changed.

The fixed-clock fixture's feed and Chain Heat date back to July 2026, and actual browser screenshots confirm that the source warning is visible before any hover or expansion. [Desktop historical receipts](command-historical-source-desktop.webp) · [390px phone historical feed](command-historical-source-mobile.webp). Source freshness UI passed the responsive EN/ZH desktop/tablet/phone test plus the 12-case load/Retry matrix, and `flowFreshness`'s 23 unit tests. These checks are local fixture proof; they do not establish real-time data freshness in production. A further independent 24/24 Chain Heat error/absence/retry crop pass covered EN/ZH at 1440/820/390 with the historical receipt. [390px historical contracts](chainheat-historical-390.webp) · [390px historical refresh failure](chainheat-historical-refresh-failed-390.webp). The capture's packet-root PNGs were restored after successful verification: a newer protected branch has a separate operation-scoped cache evidence qualification, so replacing its canonical lock with this branch's older manifest would be incorrect. Reconcile those scopes on the current integrated candidate rather than force the older packet.

### Source-locked Chain Heat failure-state recapture

The Command scroll repair changed `CommandWorkspace.module.css`, invalidating an older EOD/Flow screenshot source hash. A fresh, complete capture using the existing failure-state runner passed **24/24** real EN/ZH × 1440/820/390 × load/refused/absent/retry states. The original packet-root captures were restored; this evidence belongs to the distinct [Options #1248 operation folder](../../pr-crops/eod-heatmap-flowdesk-load-failure/operations/options-1248-chain-history-20261104/). Its SHA-256 source and screenshot digests are recorded under `commandChainHeatFollowup` in the existing [EOD/Flow evidence manifest](../../pr-crops/eod-heatmap-flowdesk-load-failure/EVIDENCE.yml). `eodHeatmapFlowdeskLoadFailureEvidence.test.ts` now verifies all 24 assets, the six source hashes, and the new CSS hash, while preserving the historical snapshot for comparison. This validates the source capture on the PR head, not integration with newer protected-master evidence owners or live production.

## Command print: one scroll on compact layouts

The selected Command print previously had two independent vertical scrollers: the desk itself and a `max-height`-capped evidence pane. On a 390px phone with expanded Print evidence, hundreds of pixels of source fields existed but were clipped until users found the pane's invisible inner scroll. The final compact layout uses the desk's existing native page scroll for the full print inspector; the separate desktop research rail retains its bounded scroll. The original feed, filters, source details and Chain Heat are unchanged. Browser regression checks EN and ZH at desktop 1440px, tablet 820px, phone 390px and an additional 320px layout, covering expanded evidence, full lower rows, keyboard return and no horizontal overflow. [End-of-print / Chain Heat transition on phone](command-print-evidence-scroll-390.webp).

## Follow a strike or ticker across desks

| Journey | Observed behavior | Browser evidence |
| --- | --- | --- |
| Surface → strike | Open **Inspect strike** or tap a price on the heatmap. The dialog opens on a stored observation, shows its session and measurement, and lets the user change strikes. A missing measurement displays a dash and a measured zero retains its value. Pinning and price-alert setup use the selected strike. | [Desktop](surface-strike-1440.webp) · [Phone](surface-strike-390.webp) |
| Screener → Tickers | Switching symbols replaces all three reads. A late reply for the last symbol cannot change the current ticker. Ticker flow, volatility and activity can recover independently. Charts and contract rows fit inside the phone viewport. | [Desktop](ticker-drill-1440.webp) · [Phone](ticker-drill-390.webp) |
| Levels → guide → Levels | The guide identifies the return symbol and restores its board. Keyboard navigation, Back and Forward preserve the ticker. Invalid or ambiguous symbol links open the default SPY board. | [Phone guide](levels-guide-390.webp) |
| Exposure → Command → Back | A local preview combined this navigation with the companion Exposure ladder. It showed 12 complete strikes at 1440 × 900, five at 1280 × 720, 18 at 820 × 1180 and six at 390 × 844, both on entry and after Back. Market State had zero internal vertical overflow at all four sizes. | [Phone ladder](combined-exposure-390.webp) · [Phone Market State](combined-market-state-390.webp) |

The inspector's numeric GEX breakdown requires a matching root, a matching source session and a publication clock no later than the inspection. The price alert uses the existing alerts service. Its browser test intercepted the request and checked the selected direction and strike with fixture data.

## From Command to a contract

The [Options journey directory](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-2-0) groups discovery, investigation and follow-up. The [U05 print inspector](https://app.paper.design/file/01M5EPQ16VBT7SBW2NQVX2RJG4/p-2-0) pairs a stable feed with the selected contract. The [U08 phone study](https://app.paper.design/file/01M5FNCKAND6CBSJNYM5FZWR8Y/p-1-0) leads with the observation, then presents its supporting evidence. These are design references. The screenshots below show the implemented Terminal with repository fixture data.

| Task | Desktop | Phone |
| --- | --- | --- |
| Find a desk and scan Command | [Flow Desk](command-desk-1440.webp) | [Flow Desk](command-desk-390.webp) |
| Inspect a print, see its price and check how the side was inferred | [Selected print](command-print-1440.webp) | [Selected print](command-print-390.webp) |
| Scan contracts and narrow the Tape | [Options Tape](tape-scan-1440.webp) | [Options Tape](tape-scan-390.webp) · [One print expanded](tape-print-detail-390.webp) |
| Compare Chain Heat contracts | [Contract list](../../pr-crops/eod-heatmap-flowdesk-load-failure/chainheat-retried-1440.png) | [Contract list](../../pr-crops/eod-heatmap-flowdesk-load-failure/chainheat-retried-390.png) |

The phone inspector can be compared on the same controlled print in the [previous build](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/7bd947615ce5c806197dd52305c6dbedc2198e24/terminal/docs/pr-crops/options-r1-w3/flow-desk-inspector-390.png) and the [revised build](../../pr-crops/options-r1-w3/flow-desk-inspector-390.png). On the 390 × 844 Command desk, opening advanced filters previously left 70 CSS pixels for a 121-pixel print. In the revised layout the feed retained 357 pixels.

- The view picker groups all 15 destinations. A second click on the active category keeps the current desk. Malformed and legacy links have explicit landing behavior.
- In Command, select a print by pointer or keyboard. Its contract, premium, price and side estimate are visible first. Open **Print evidence** for arithmetic and source limitations. **Back to flow** restores focus to the originating print.
- In Chain Heat, expand a contract to inspect timing, inferred lean and coverage. Open its ticker in Tape and use browser Back to return to the same expanded contract. The link applies the ticker filter across the Tape. Individual print matching would require a shared source identifier.
- In Tape, open **Contract filters** for expiry and moneyness. Active values remain visible when it closes. Selecting a session highlight replaces a prior ticker search. On phone the compact row shows the contract and quantity, and **Details** exposes the full expiration, sector, moneyness and flags.
- **0DTE** and **Largest Events** keep pagination and counts visible. Expand **How events are counted** for the aggregation method and source timestamp.

## User journeys and release checks

| Desk | Behavior to exercise |
| --- | --- |
| Surface | Pick a stored time, drag across the elapsed-time rail, then release to load that observation. Step using the keyboard, switch to Quad and back, adjust chart settings and return to the latest stored frame. Check missing sessions and timestamps on nightly overlays. |
| Tape and Tide | Distinguish the exchange session, market observation time and feed connection. Inspect feed details. Verify Eastern time on Tide. |
| 0DTE and Largest Events | On a feed with over 100 rows, move beyond rank 100, inspect the same flags on a phone, and filter back to a single ticker. Counts and ranks refer to the selected population. |
| Screener | Understand why below-average activity can rank highly. Sort using a keyboard and open a ticker. |
| Exposure | Use the existing PR to verify the ladder remains usable with the expiry drawer open. Enter from Matrix on a phone, select a partial expiry and read why the total is unavailable. |
| Positioning, Levels and Structure | Read the full chart titles, inspect named levels, toggle low-friction zones, and compare the two OI charts at wide and narrow sizes. |
| Volatility | Compare the history panels across the available width. When observation dates differ, inspect the historical series and the source-reported spread independently. |
| Statistics | Compare prints and contracts when premium coverage is zero. Verify genuine zero, partial premium and missing observations separately. |
| Prophet | Read the plan phase and the published action guidance before looking at historical levels. An invalidated plan identifies its original direction. |
| Navigation | Move between categories and use browser Back and Forward. Resize a desktop workspace to phone width while a trailing category is selected. Multi-view categories retain a view selector. |

## Browser evidence

These are snapshots of the local Terminal route using the repository's fixture data. They establish interaction and layout behavior. Signed-in market data and production delivery have separate release checks.

At a 1440 × 900 viewport the Surface timeline grew from 620 × 18 to 1,332 × 44 CSS pixels. At 390 × 844 the new rail measures 354 × 44 pixels. On the 1,760-pixel-wide Structure desk, each open-interest chart grew from 549 to 830 pixels wide.

| Before | After |
| --- | --- |
| [Desktop Surface](before-surface.webp) | [Desktop Surface](after-surface.webp) |
| [Phone Surface](before-surface-phone.webp) | [Phone Surface](after-surface-phone.webp) |
| [Structure](before-structure.webp) | [Structure](after-structure.webp) |
| [Volatility](before-volatility.webp) | [Volatility](after-volatility.webp) |
| [Largest Events](before-events.webp) | [Largest Events](after-events.webp) |
