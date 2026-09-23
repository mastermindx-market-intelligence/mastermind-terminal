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


FINALIZATION_CLASSIFICATION: CHECKPOINTED_CONTINUATION
MISSION_COMPLETE: false. Product state: BUILT_NOT_PROVEN. This is a completed UI-repair/qualification boundary, not production acceptance. The next phase crosses into the existing Macro matrix producer and store-host custody after two interrupted continuations; preserve the now-qualified Terminal implementation rather than widening an uncheckpointed cross-repository repair.

Authority: Chris's current same-chat continuation of the original end-to-end GEX-sidebar assignment. Protected Mastermind source: 4c1b3d389286df2a4b5b98a4d4491f2c8a1263f2, protected=true, v1.0.1/bootstrap1; INDEX/COLD_START/ACTIVE_EXECUTION/WEB_CEO_DELEGATION/RECONCILE_STATE/CLOSEOUT loaded atomically. Direct work reason: PRINCIPAL_JUDGMENT / CRITICAL_PATH_SHORTCUT. No worker assignment, runtime admission, custody transfer or automatic ChatGPT wake is claimed.

Carrier/source: Terminal PR #723, branch claude/terminal-options-heatmap-20260923, original Mac Studio worktree /Users/chriswong/Documents/Cluade/charting-app/.claude/worktrees/terminal-options-heatmap-20260923. Native Remote Desktop Commander remains bound to device3f5ce987-e3eb-40a3-af9f-4b0ae54919cc; Studio Direct is absent from this generation and was not silently substituted for an unresolved effect. Qualified implementation head799ee3f549c7c2e46055774a7d9ee203e71881f2, following mobile repair321ef80d8af78ed4c5f938b328ea24a9ccb29118. Terminal protected base movement886e05ad9→d4c71912 changes only precisionEntry.ts and its tests, not this candidate's dependency or authority source.

## Accepted local capability delta
The chart companion works on the real Terminal route under explicit fixture data: Gamma strike×expiry, OI/ΔOI, session volume, shared Flow tape, canonical all-expiry Vanna, root-scoped ephemeral native chart pins, explicit-refresh recovery, keyboard cell navigation/Escape, existing mobile sheet and original chart/Overview restoration. No second provider/cache/auth/renderer owner. Removing the duplicate mobile rail-switch row restores the Oracle cards above the phone fold. The seven-action phone hub includes Options in its complete keyboard cycle. Its label reuses the existing bilingual Options string; the global i18n file is byte-identical to base, so unrelated account/research proof was not fabricated or restamped.

## Exact qualification
Current head799ee3f: full unit suite382files/6117passed/4TODO, zero failures; TypeScript and scoped ESLint exit0. Final companion+phone-hub browser run28passed/14intentional viewport skips/zero failures, including desktop/tablet/mobile EN/ZH controls, native pins, no chart remount, correct symbol switching, wrong-root refusal/recovery, real0DTE semantics, no unentitled options fetch, cell Escape and opener focus. The preceding mobile/chart regression run38passed/31intentional skips resolved the three candidate-caused mobile failures. Separate actual chart-context recapture30/30passed, mobile crosshair1/1passed, and existing options-axis capture5/5passed. Capture-owned blobs remain unchanged after the localized hub-label reuse.

Proof: terminal/docs/pr-crops/options-companion-20260923/EVIDENCE.json with18new EN/ZH/three-viewport captures and copied test logs; refreshed real options-axis/visual-context captures and content hashes. The light crop is a scoped companion material test, not a Terminal-wide light-mode release. Original broader responsive run954passed/331skipped/5failed remains historical, NOT silently greened. Two path-disjoint research-nav/marker failures were not rewritten; current hosted integrated checks remain their own release gate. Do not call local unit/browser success production proof.

## Production/data frontier
Prior canonical R2 fallback audit2026-09-23T11:22:35Z: SPY/NVDA/AMD returned zero-cell/null-spot/null-session matrices; MU/ARM/INTC404. This is dated fallback evidence, not proof that every primary path fails. No authentic production heatmap journey has been proven. Current primary-backend SSH read: default authentication failed; the documented deploy-identity attempt was refused by tool safety-status before a PID. No production mutation occurred, and that refusal was not routed around.

Read-only exact-source reproducer at Macro@ce33ec3d46b9a7dc5a94a4a854676f917f9ba9b7 proves engine/options_matrix.py::_extract_spot substitutes median OPTION close2.0 for absent underlying spot using synthetic closes[1.25,2.0,4.75]. The correct unavailable-underlying result is null. This is a material producer defect, not yet the proven cause of the empty fallback matrices. The helper also returns a negative supplied reference, but build_matrix already rejects nonpositive spot; do not misreport that case as a publish-path defect. Legacy matrix vex_mn sums call+put Vanna, unlike canonical signed dealer exposure: keep the existing Vanna profile fallback until a correct per-cell contract exists. No Macro source was modified.

## Continuation — one primary next action
Recover the existing Macro matrix producer/store-host owner, read its current source laws and latest canonical checkpoint, then diagnose the real zero-cell reason with correct underlying-price/session inputs. Repair the producer's option-premium-as-spot fallback and qualify a real supported-root matrix through the existing published API into this exact Terminal companion. Keep PR#723 draft until required integrated checks, accepted source/data proof and the normal git-gated release/live verification are satisfied. Do not invent replacement pipelines or weaken provenance/entitlement checks to fill the UI.

DO_NOT_REDO: Paper artboard/design contract, feature implementation e512e80d5/0fa0ea1bf/517daca78, mobile321ef80 repair, bilingual-label799ee3f reuse, accepted local qualification and already-consumed exact capture receipts. Preserve neighboring chart/context carriers #701/#702/#705/#707/#713/#718/#714 and marker#688. No merge, deploy or worker is claimed. All qualification processes completed; original owned dev serverPID11350/port3219 is only a preview server, not ongoing task execution.

Local residue:64unrelated tracked test outputs were archived then restored before the current source commit; archive digest34ea5287c25782fbcc5b33158a2a3a7a98966bbc89e7a3ca38cc7fbeba4cd8a7. Six untracked workspace-test screenshots remain outside this feature's commit scope: a cross-device move failed and the subsequent cleanup request was explicitly refused. Preserve them; do not bypass the refusal or claim a wholly clean worktree. No unknown modifying effect exists on the feature branch. Intended resume: same authorized Sol task and exact PR checkpoint, not a new branch/session custody assignment.
