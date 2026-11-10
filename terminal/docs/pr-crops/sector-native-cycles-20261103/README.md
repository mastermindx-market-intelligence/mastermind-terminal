# Native sector cycles: cross-surface verification

[Desktop: sector history](terminal-1440-en-cycle.png) · [Phone: Beta, Chinese](beta-390-zh-cycle.png) · [320px Beta](beta-320-en-cycle.png) · [Theme comparison](terminal-1440-en-themes.png) · [Phone: themes](beta-390-zh-themes.png) · [Eight-cell receipt](receipt.json)

The screenshots are local browser runs. They use the actual October 30 Macro files, not today's market and not deployed code. Git trees: feature `67a6688320ea7603a09abdbbda34c81a0d47f947`, Beta #1244 `7063a8e1324c75f69361688161f1e2a90bf87951`, conflict-free composed tree `297f4f585f502be8063db4a1e411cf57a4072d4b`. Both URL entries really rendered: `/discover?tab=sectors` and `/sectors`. This is not a protected merge, live login or CSP certification.

## Source and checks

Inputs at Macro `5dafc6c931bbbd29c2ba6914b7cc25c100fd793e`: `site/sectordata/sector_cycles.json` (Git blob `7893fd4855ec3dc35aaf85b2380cced272c11bde`) and `site/sectordata/sector_central.json` (`c7f42913f28c309f9367ff512ea8c941c77ef551`). No production credentials. The incumbent #1244 loopback identity fixture and browser-only response interception expose the unmodified source files to the actual route. `e2e/tools/qualify_sector_cycle_owner.cjs` hashes both raw bodies, selects the subject by identity, and checks 11 sector actions, two 21/63-session return legs, 49 theme basket choices, two independently selected basket values, back navigation, access loss and no overflow at 1440, 820, 390 and 320px. Separate guest case withholds the panel. Market and account evidence are not interchangeable.

Energy was **expanding, 71.5/100** on the source's price-basis cycle; **+12.9% / +19.8%** are the 21-/63-session rolling changes in Energy's total-return ratio to SPY. This matches Macro's actual `now.phase` and `now.pos` renderer, not the illustrative scale on the Paper board. Baskets have their own identities even when they share a proxy ETF. A historical turn is hindsight, a provisional turn is explicitly marked, and neither generates an order or a watch.

## Production acceptance

Retain non-author review and hosted CI. Verify independent rollouts of both the shell route/registry and the native UI. On one naturally emitted close, match both authenticated routes to the live source observation and artifact hash; recheck an access loss. These files do not close the wider Research/Watches/Time Machine or paid/unpaid production journeys. Macro remains the producer. Do not fork the publisher, user store, or entitlement decisions.
