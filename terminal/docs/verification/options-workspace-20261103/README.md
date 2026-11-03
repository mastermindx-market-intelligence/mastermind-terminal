# Terminal Options workspace

The reported journey starts in Options, compares flow at different points within a trading session, and moves into a desk to inspect a contract or price level. The initial Exposure repair is tracked in [#1243](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1243). This change follows the existing category, tab, replay and data owners.

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
