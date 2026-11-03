# Terminal Options workspace

The reported journey starts in Options, compares flow at different points within a trading session, and moves into a desk to inspect a contract or price level. The initial Exposure repair is tracked in [#1243](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1243). This change follows the existing category, tab, replay and data owners.

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
