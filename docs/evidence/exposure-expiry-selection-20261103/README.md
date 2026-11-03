# Explicit expiry and archive selection

A requested expiry now remains visibly selected when the next book does not list it. The user must choose **Show all expiries** to widen the selection. Shared expiries and return to the original book retain the date.

Explicit archived-session selection now awaits the existing cache refresh instead of rendering a stale response while its correction is fetched in the background. Failed reads stay failures; a real missing object stays an archive gap. Returning to live invalidates a late archived response. The server cache policy, admission, source clocks and endpoints are unchanged.

## Verification

- Four mounted expiry cases cover English/Chinese, loading, missing/shared expiry and archive return.
- Six actual local-route browser cases pass on desktop 1440×900, tablet 820×1180 and phone 390×844 in English/Chinese. Twelve dark/light screenshots are indexed with SHA256 in `index.json`.
- Three mounted stale-cache regressions failed before the archive repair. After repair, all 77 affected component/cache tests pass, including the late-response fence.
- Three actual local-route browser cases pass across the same viewports: select the dated book, return to live, advance past cache TTL, select the corrected book once, then preserve a failed read rather than displaying the cached success.
- The browser books and images are synthetic fixtures. They establish consumer behavior, not current market data, authenticated production behavior or A/B/C acceptance.

The GexDeskView baseline already has one `react-hooks/set-state-in-effect` error and one `react-hooks/exhaustive-deps` warning. The archive change adds no lint finding; the changed tests lint cleanly.

Originating integrated cache/API/reader finding: https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1224#issuecomment-6597591787 . The production-source publication and original unknown effects remain separate.
