# Terminal options companion — implementation contract

## Mission and custody

Chris requested a toggleable GEX heatmap beside the Terminal main chart, with a Paper-first design, reuse of the existing options estate, and useful Vanna, OI and Flow perspectives. This is additive work, not a replacement for the chart, watchlist, Portfolio, Exposure desk or Flow desk.

Entry pins: protected Mastermind `bf764f494b9cd0ecede6234bb472c3344c8e77cc`; Terminal base `886e05ad9b9686beedef9448c7f8d60f20a1edb0`; Macro contract observation `668237947e016f679782e41e61c91c9133a5ea99`. Loaded the pinned skill index, cold-start, active-execution, delegation, reconciliation and closeout procedures. Native execution carrier: Studio Direct; isolated branch `claude/terminal-options-heatmap-20260923`. This mission does not take over chart PRs #701/#702/#705/#707/#713/#718 or the #688 marker repair. Neighbor #714 owns the visual-context docks; do not duplicate or remove them.

## Editable design

Paper file: **MASTERMIND PAGES**, page **Live Site Baselines · Wave 1 · 2026-09-21**.

https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-8-1

New artboard: **Terminal · Options companion · Gamma · Design fixture**. The existing Terminal chart artboard was cloned, not overwritten. Its right rail was replaced on the new artboard only. The source chart and all other original Paper boards remain intact.

Preview: `terminal/docs/pr-crops/options-companion-20260923/paper-gamma.png`.

The figures in the design are explicitly illustrative. The 33 visible cells sum to +$38.9M; they are not current market observations. Production code must not import these design values.

### Visual treatments

Dark: the existing instrument-like Terminal canvas remains dominant. A 360px rail (resizable using the existing rail control), 12px inset and 8px vertical rhythm, compact Inter controls, tabular monospace numbers, restrained surfaces and hairlines. Signed exposure uses cyan/violet, not price-up/price-down tokens; amber outlines a selected cell and marks the snapshot reference. No third hue changes the meaning of exposure.

Light: cool research canvas, white panels, darker cyan/violet ink and restrained low-opacity cell fills. Hairlines and a small panel shadow establish hierarchy instead of dark-surface luminance depth. The same numerical scale and sign meanings survive both themes and East/West price-color preferences. Touch controls enlarge to 44px; mobile uses the existing sheet primitive instead of squeezing the chart to an unusable width.

### Interaction contract

- Open Options without navigating away from the chart. Closing it restores the existing rail without losing watchlist selection or scroll state.
- Four perspectives: Gamma, Vanna, OI, Flow. Lazy-mount the expensive data consumers only while needed.
- Gamma: strike × expiry GEX in dollars per +1% spot. This is NOT the shared desk's existing `hedge` metric, whose sign is reversed.
- Vanna: dealer VEX in dollars per +1 absolute volatility point. Use a correctly signed, explicitly unit-tagged strike × expiry source when available; otherwise show the existing all-expiry strike profile with that limitation visible. Never distribute an all-expiry total across expiries.
- OI: contracts, with a separate ΔOI lens. OI magnitude is not a bullish/bearish signal. Missing is not zero.
- Flow: observed activity, with its own source-time receipt. Session volume is a separate EOD map, not a substitute for dealer inventory or signed flow-GEX.
- Expiry count, strike window and normalization are real controls. Global normalization is the comparison default; per-column normalization must explain that colors are no longer comparable across columns. 0DTE must match the snapshot's own session exactly; a front expiry is never relabeled 0DTE.
- Cell selection opens an inspector. Keyboard arrows navigate cells; Enter/Space select and Escape clears. A chart pin is explicit and ephemeral, root-scoped, and removed on root change/close. It must never recreate the chart or become a saved user drawing accidentally.
- State visible on the surface: root, snapshot session, units, basis, missing coverage, fetch failure/retry and model assumptions. Stream connectivity is not a live-data claim. EOD snapshots do not follow intraday replay.

## Reuse audit

| Existing owner | Reuse / constraint |
| --- | --- |
| `components/shared/StrikeExpiryMatrix.tsx` | One matrix model, aggregation, scales and renderer. Preserve existing card/desk behavior; add an opt-in rail presentation and explicitly named raw exposure metrics. |
| `components/gexdesk/matrixDoc.ts` | Existing schema/root guard and session metadata; reject wrong-root or incompatible data. |
| `components/gexdesk/GexDeskView.tsx`, `lib/gexLadder.ts` | Existing Vanna profile and canonical million-dollar formatting; a narrower Vanna expiry cut cannot be invented. |
| `lib/flowClientCache.ts` | `flowGetFresh` waits for revalidation through the same cache owner. Do not create another upstream/provider API. |
| `lib/flowStream.ts`, `components/flowdesk/FlowFreshnessReceipt.tsx` | Shared Flow transport and measured source-time receipt; do not label an open SSE connection “live GEX.” |
| Terminal rail resizer, `MobileSheet` | Reuse existing geometry and modal/focus behavior rather than a second drawer system. |
| Macro `engine/exposure_math.py` | Single financial formula. Gamma = signed OI × multiplier × gamma × spot² × 0.01. Vanna = signed OI × multiplier × vanna × spot × 0.01. House sign assumes dealers long calls / short puts, not observed dealer inventory. |

### Vanna producer discrepancy discovered

The observed Macro matrix producer already publishes an experimental `vex_mn`, but its code adds call and put Vanna exposures. The canonical dealer formula applies the long-call/short-put sign. These are different quantities. Do not silently label legacy `vex_mn` dealer VEX, and do not infer the missing signed split from net/total OI. A future canonical per-cell field requires explicit unit/sign metadata and producer tests; the existing correctly signed all-expiry GEX-payload profile is the safe fallback. Preserve legacy fields for existing consumers.

## Research receipts

- Bullflow, July 12, 2026 premium update: cyan/violet is an alternative positive/negative GEX palette; net-change percentages can compare with the open or previous close. https://www.bullflow.io/blog/bullflow-premium-update-major-upgrades-to-gex-advanced-charting-dark-pool-data-and-the-bullflow-api
- Bullflow, Complete Guide to GEX: strike/expiry axes and spot/large-cell annotations. The screenshot's yellow cell is not sufficient evidence of a universal vendor rule. https://www.bullflow.io/blog/the-complete-guide-to-gamma-exposure-gex
- Cboe, Evaluating the Market Impact of SPX 0DTE Options: actual dealer positioning, rather than gross option volume, determines aggregate gamma hedging; long gamma implies hedging against the move. https://www.cboe.com/insights/posts/volatility-insights-evaluating-the-market-impact-of-spx-0-dte-options
- OCC/OIC FAQ: open interest is neither inherently bullish nor bearish and is updated after clearing opening/closing positions. https://www.optionseducation.org/referencelibrary/faq/general-information
- ThetaData second-order Greeks: gamma and Vanna are available with quote timestamps; Greeks are not executed trades. https://docs.thetadata.us/operations/option_snapshot_greeks_second_order.html
- Next.js lazy-loading guide, checked because this checkout's installed `next/dist/docs` directory is absent: https://nextjs.org/docs/app/guides/lazy-loading

## Release gates

Pure model tests: units/signs, null versus zero, malformed/future sessions, wrong-root envelopes, duplicate cells, no invented 0DTE, finite magnitudes, scale/cell identity and the legacy Vanna guard. Component tests: stale responses after root changes, hidden/unmounted subscriptions, keyboard selection, retry and explicit pin clearing. Browser proof: 1440×900, 820×1180, 390×844; dark/light and EN/ZH; real controls, no chart remount, no horizontal page overflow, no console/page errors. Protect existing matrix and chart tests.

Completion is not a mockup or an open PR: commit, push, concluded checks, merge through the normal gate, then reconcile the served release before a git-gated deployment and verify the live behavior. Record exact proof and remaining blockers; never equate fixture proof with production data freshness.

## Cumulative implementation checkpoint — 2026-09-23 continuation

MISSION_COMPLETE: false. Capability: BUILT_NOT_PROVEN. Current continuation authority: Chris's same-chat instruction to continue the whole Terminal GEX-sidebar delivery. Protected Skillpack pin: Mastermind@4c1b3d389286df2a4b5b98a4d4491f2c8a1263f2 (protected=true; v1.0.1/bootstrap1; index, cold-start, active-execution, delegation, reconciliation and closeout loaded atomically). Direct repair/review reason: PRINCIPAL_JUDGMENT / CRITICAL_PATH_SHORTCUT; no worker commission or transfer.

Exact source: PR #723, claude/terminal-options-heatmap-20260923, local and remote head 517daca787dd529f8ee2fc52bf897bdb7029f1a9. Same Mac Studio worktree and evidence directory. Studio Direct is absent from the current discovered tool surface. Remote Desktop Commander is bound to the original Mac Studio device 3f5ce987-e3eb-40a3-af9f-4b0ae54919cc; the prior checkpoint already reconciled this transport. Current source contains no uncommitted implementation changes: remaining dirty files are browser-test crops/manifests and new companion captures, not a new writer. No unresolved modifying effect found; existing dev server PID11350/port3219 remains running. No worker or automatic ChatGPT return path exists.

DO_NOT_REDO: existing Paper artboard, accepted design contract, feature commits e512e80d5 / 0fa0ea1bf / 517daca78, source-cache recovery, native pin implementation, actual-symbol selection repair and cell-level Escape repair. Preserve unrelated chart PRs and #688 marker-repair custody; do not recreate branches or introduce another data/cache/auth/renderer owner. Current protected Terminal movement from base886e05ad9 to d4c71912 only changes precisionEntry.ts and its tests, not candidate dependencies or source law.

Recovered qualification: current-head hosted run35853136751 has Quote Hub, Ingest, CodeQL, desktop/tablet/serial browser shards SUCCESS; unit and mobile shards FAILURE. Local full responsive run completed 954pass/331skip/5fail. Three mobile failures concern the new Options launcher and inherited hub assumptions; research-nav and marker cases require evidence-based attribution, not retry-to-green. Local full unit run reported6115pass/4todo/2fail, both exact-source screenshot evidence manifests invalidated by the ChartPanel changes. Dedicated companion qualification before the last repair reported49pass/2skip/3fail; the later full responsive run must be consumed rather than claiming that earlier run passed. TypeScript and focused lint logs are clean at the recovered checkpoint.

Production dependency: existing source audit dated2026-09-23T11:22:35Z inspected the canonical Terminal R2 fallback from the production host. SPY/NVDA/AMD returned schema-correct zero-cell/null-spot/null-session documents; MU/ARM/INTC returned404. This is source evidence, not authenticated browser proof and not evidence that every upstream path fails. No empty matrix may be called a working heatmap. Next data step: inspect current primary source and its existing producer, preserving canonical source/timing/entitlement owners.

Next actions: repair the actual mobile regression contract on this branch; recapture changed chart-axis and visual-context evidence using their existing capture paths; qualify companion/current required tests; investigate and advance the existing matrix producer lane until real production data reaches the visible companion. Keep draft until review, required checks and owed real-path proof are satisfied. No deployment, merge or background execution is claimed by this checkpoint.

### Current repair result

The additional Overview/Options switch is now desktop-only: phones/tablets already enter through their existing More controls, so an extra 44px row no longer pushes the Oracle cards below the phone fold. The mobile hub contract now includes the real Options action in its complete focus cycle and seven-action inventory. Exact repair browser command: `TERMINAL_E2E_PORT=3219 npx playwright test e2e/options-companion.spec.ts e2e/mobile-chart-hub-upgrade.spec.ts e2e/mobile-chart-chrome.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --reporter=list`. Result: **38 passed, 31 intentional viewport skips, zero failures**, with desktop/tablet/mobile EN/ZH native-pin, restoration, refresh, 0DTE and identity/entitlement checks. Actual captured desktop and phone output was visually reviewed. This resolves all three candidate-caused mobile failures; it does not erase the older full-run failures.

The current Macro producer source at ce33ec3d46b9a7dc5a94a4a854676f917f9ba9b7 also has a separate material defect: `engine/options_matrix.py::_extract_spot` falls back from missing underlying-price Greeks to the median **option contract close**, which is not the underlying spot. This is source evidence, not yet the proven cause of the empty production matrices. The exact production primary-backend read has not been completed: default SSH authentication failed, and the attempt using the documented deploy identity was refused by the current tool safety-status path before any process receipt. No release or data write occurred. Do not route around that refusal or invent a live proof.
