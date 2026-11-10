# By Strike — Paper UX completion, 2026-11-04

## Goal and acceptance criteria

An options researcher should be able to choose a ticker, see a useful strike window immediately, interpret the published Market State with its own timestamp, compare expiration coverage, and revisit a dated book without losing the source date or return context.

DONE_WHEN for this design: complete desktop, tablet and phone compositions; dark and light contrast; English and Chinese layout; explicit loading, empty, failed, stale, partial, archived, permission and successful states; visible advanced-entry paths; actual Paper screenshots checked; JSX extracted after visual QA. Runtime acceptance additionally requires source integration, meaningful browser journeys and the existing source-bound evidence owners.

## Editable Paper source

File: Terminal (`01M3NSZGE8JWN2EZCSF0DT05RM`). Page: Options · Exposure Intelligence · R2 · 2026-10-20 (`p-V-0`).

| Board | Node | Export | Actual rendering |
|---|---|---|---|
| desktop-dark-en | `1SWN-0` | [JSX](desktop-dark-en.jsx.txt) | [JPEG](desktop-dark-en.jpg) |
| desktop-light-en | `1T68-0` | [JSX](desktop-light-en.jsx.txt) | [JPEG](desktop-light-en.jpg) |
| phone-dark-en | `1TD2-0` | [JSX](phone-dark-en.jsx.txt) | [JPEG](phone-dark-en.jpg) |
| phone-light-zh | `1TK8-0` | [JSX](phone-light-zh.jsx.txt) | [JPEG](phone-light-zh.jpg) |
| tablet-dark-en | `1TR5-0` | [JSX](tablet-dark-en.jsx.txt) | [JPEG](tablet-dark-en.jpg) |
| states | `1TY2-0` | [JSX](states.jsx.txt) | [JPEG](states.jpg) |

The six boards were created by the existing Exposure task's single Paper writer. Existing Exposure matrix boards, D08B specialist boards and the held D08 parent target were not edited. `paper-manifest.json` binds source pin, board IDs, exports and screenshot hashes.

## Hierarchy and behavior

- The strike workspace and Market State form the primary reading area. Tablet and phone use one column.
- Full-book Snapshot levels follows the main workspace in native document order, before History. Filtered totals and incomplete-coverage disclosures remain exposed.
- The long strike list keeps its own stable viewport. Expiration breakdown and Snapshot levels do not shrink that viewport.
- By Strike, By Expiry, Matrix, Price Chart, Greek selection, Net/Call–Put, expiration filters, range choices, research tools and history remain available through their existing controls.
- Market State keeps regime, polarity, stability, distance to flip, structural range and primary metrics at a glance. Details and provenance exposes the model explanations and flip-break scenario.
- The existing honesty passport stays visible outside that disclosure, including the single-name caveat when applicable. The current source's gate wording is preserved; the design does not grant predictive or trading authority.
- Market State and History navigation moves keyboard focus to the named sections. Selecting an archived session returns focus to the analysis and withdraws current Market State.
- Dates belong to their datasets. Refreshing a quote does not refresh the exposure book or state clock. Missing values remain unavailable, never zero.

## Visual self-QA

Actual native Paper renderings were inspected for signed-bar direction, a shared zero line, clipping, density, contrast, controls, EN/ZH text, source dates and full-page reading order. A renderer positioning issue was corrected using a two-column signed-bar layout; phone Call/Put alignment and header wrapping were corrected. The final JSX was read back after those corrections.

The displayed figures are illustrative fixtures, not live market observations. Exports are design references: implementation must retain the application's data, calculation, source identity, access and navigation owners. The broader Options navigation remains owned by original PR #1248; these references do not claim that its held integration is merged or deployed.

## Implementation mapping

`GexDeskView.tsx` owns the reading order, the existing Roots disclosure, the full-book Snapshot levels disclosure, and the unchanged source/navigation machinery. `ExposureWorkspace.module.css` owns the responsive workspace, stable strike viewport, visible focus treatment and native disclosure spacing. `MarketStateCard.tsx` keeps its calculations and passport, with its explanatory captions and flip-break scenario inside Details and provenance. The EN/ZH label is defined by the existing `gexStrings.ts` owner.

The implementation follows the Terminal shell's current dark-only runtime contract. The light Paper boards specify a reviewed visual direction; they do not introduce or claim application-wide light-theme support. Fixture screenshots and published-source states do not establish live-feed freshness, validated forecasts or trading authority.

The source reset follows the selected ticker before dependent children render, while existing request counters fence asynchronous state, matrix, session-date and archived-book responses. An intentional archive selection still forces a fresh read through the existing cache owner. No additional cache, request lifecycle or source authority is introduced.
