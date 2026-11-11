# Sector breadth: design and browser evidence

[Editable Paper study](https://app.paper.design/file/01M6FAXA774QT1VRDMAG7DFQ2W/p-1-0) · artboard `1-0`, **Terminal · Sector Breadth · Rotation groups**. These are screenshots of the actual local Discover route with the October 22 owner replay, **not** screenshots of a deployed feature or current market readings.

| View | Desktop | Tablet | Phone |
| --- | --- | --- | --- |
| Ranked board | [1440 px](historical-replay-desktop.png) | [820 px](historical-replay-tablet.png) | [390 px](historical-replay-mobile.png) |
| Rotation groups | [Desktop](rotation-groups-desktop.png) | [Tablet](rotation-groups-tablet.png) | [Phone](rotation-groups-mobile.png) |
| Chinese, light theme | [Desktop](historical-light-zh-desktop.png) | [Tablet](historical-light-zh-tablet.png) | [Phone](historical-light-zh-mobile.png) |
| Six closes and peer comparisons | [Desktop](historical-detail-desktop.png) | — | [Phone](historical-detail-mobile.png) |

## What a reader can conclude

Above 50% means a majority of matched stocks advanced, not that the sector ETF rose. Widening/narrowing compares unrounded advancing shares over the chosen one or five **closing sessions** on the same population. Exactly 50%, unchanged shares, and insufficient comparisons are not assigned a directional quadrant. No intraday, flow, forecast, or trade signal is implied. The daily basis requires 90% matched coverage for each ranked sector. When the page only has monthly mover counts it explicitly changes basis, preserves ties and hides the rotation controls.

At the October 22 five-session setting, 501 of 503 stocks matched. Nine sectors had a majority advancing; seven of those nine had lost breadth. Consumer Staples and Utilities were broad and widening. Energy was below half but widening; Technology was below half and narrowing. These are regression witnesses, not constants in the UI.

## Release acceptance on a naturally published close

1. Verify protected releases of [the CI dependency](https://github.com/mastermindx-market-intelligence/macro/pull/10623), [the daily producer](https://github.com/mastermindx-market-intelligence/macro/pull/10604), and [the Terminal board](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1232). Record the deployed product revisions independently of PR CI.
2. Use the normal signed-in Discover → Sector Central → Market breadth route. Without fixtures, request interception or alternate credentials, compare the displayed date and sample with the served heatmap receipt and `sector_breadth_close` for that close. Record the source hash/date, eligible/matched counts, all measured sectors and any exclusions. Do not store credentials or user details with evidence.
3. From the source integer counts, check each sector’s latest share and both one- and five-session changes, matching the round-on-display rule. Verify extrema including ties, each rotation-group count, and average change per session. The totals of the groups including neutral/unmeasured rows must equal the sector universe, with each eligible identity appearing only once.
4. Open a sector from its group and return. Confirm the selected interval, rank, keyboard focus and viewport; inspect peer order using the two final closes rather than treating a rank change as proof of a sustained overtake. Capture the signed-in desktop and phone views against that same receipt or label different dates explicitly.

Use the existing release and verification paths. A historical replay, mock, local accessibility scan, green CI job, or review request cannot substitute for this production check.
