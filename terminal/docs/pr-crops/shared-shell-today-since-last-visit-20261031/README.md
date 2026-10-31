# Today — "Since your last visit" design qualification

Source: `981408801a3fdb9f65db277f304245a2474d12ab` (branch `claude/marketos-today-since-last-visit-20261031`).

The section gives the deployed macro-api `portfolio_changes.v1` desk read its first consumer, as the first full-width row of Today's jobs grid under the Macro Command hero (desktop) and directly under the hero on mobile. The desk's own English/Chinese change lines are rendered verbatim; each ticker line links to its Analysis page; the population sentence comes from the portfolio brief; the cursor note states that the last-visit marker lives only on this device.

## What was exercised

- 9 returning-visit cells: 1440 and 390 widths × dark/light × English/Chinese, plus 320 light Chinese.
- 8 state cells (1440 dark English and 390 light Chinese each): first visit on this device, nothing changed, free-tier teaser (403 on the brief), desk unavailable (503 on the diff).
- Every cell asserts, in the harness: the stored digest is posted verbatim as `previous` (null on a first visit); the marker is advanced only after a 200 and left untouched on 403/503; exactly three lines with `/analysis?symbol=NVDA` and `/analysis?symbol=XOM` links in the returning-visit cells and no invented line in first-visit or quiet cells; one retry control in the unavailable cell; sibling Today jobs survive; one `<main>`; no page errors; no horizontal document overflow.
- 65 affected unit/component tests pass at this source (`todaySinceLastVisit`, `portfolioChangesProxy`, `plainLanguageGuard`, `plainLanguageGuardCi`), plus `readingWorkspaces` (25) under Node's `--localstorage-file` (CI runs Node 20, where it needs no flag), `todayWatchAttention`, `workspaceMenuLex`, `portfolioBriefProxy`, `sharedShellInvestigation`, TypeScript and scoped ESLint.

## Boundaries

These are isolated, populated fixtures using the actual components and CSS. Authentication and API data are mocked; non-loopback requests are blocked. The watermark is intentionally visible. Live account behaviour, the desk's real change lines, the deployed beta and desk acceptance of the producer require separate browser acceptance and are recorded apart from this matrix.

The capture script uses paths relative to its own location; the Inter font-face chunk is an optional environment input and falls back to the system font. The receipt records source, harness, report and PNG hashes.
