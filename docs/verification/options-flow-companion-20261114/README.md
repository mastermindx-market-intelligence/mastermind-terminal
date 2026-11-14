# Chart Flow → exact-symbol Options Tape

Operation: `options-flow-companion-context-20261114-c3`  
Base: `e109b0e07af4d6c400c99ff9ed98f17306c570d2`  
Protected procedure pin: Mastermind `199fd4f91ecc426b1d974eb3bf47f5162476cf24`

## User outcome

The chart's optional Flow companion now opens the incumbent Options Tape with the chart's exact instrument. The link names that instrument in English and Chinese. Changing the chart from NVDA to AMD updates the link even while the shared feed still contains NVDA. An empty AMD population stays empty; nearby roots and unrelated SPY prints cannot leak into it.

This is one bounded continuation of [the full Options programme](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/43093737b9d3b682bb19859c3a6fc4cd6cae6b77/docs/OPTIONS_SUITE_COMPLETION_2026-11-14.md). The suite is not complete.

## Implementation and consumer contract

Only `FlowCompanion.tsx` changes in the final product diff. It composes the existing default Tape view with `drillTicker: root`, encodes it with the existing codec, and uses the existing `/options?tab=tape&tapeView=…` route. The visible accessible link combines the exact instrument with the existing `tape` destination label (“NVDA · Activity tape” / “NVDA · 交易动态”). An unsupported root uses the existing generic unavailable label and has no link. The shared `optionsStrings.ts` dictionary is byte-identical to the protected base.

The consumer is the existing Tape view decoder and exact `event.root === drillTicker` filter in `OptionsHubView.tsx`. A ticker search is a different, broader operation and is not used for this handoff. No feed, persistence, event selection, scoring, transport, or market-data owner is added.

The chart root is the source of identity; the first feed row is not. The codec supports roots up to ten characters while the companion can receive longer valid chart roots. An unrepresentable root therefore renders a status message and no link, without truncation or fallback to an unfiltered Tape. Dotted `BRK.B` is representable and verified.

This link carries instrument scope. It does not claim to carry an exact event, contract, archived session, or a complete chart-return itinerary.

## Verification

| Check | Observed result |
|---|---|
| New component regression before implementation | 8 failed, 0 passed; actual missing scope/unavailable-state assertions |
| Component plus existing Tape codec after implementation | 30 passed: 8 new component cases and 22 existing codec cases |
| Shared-shell journeys | 18 distinct cases passed across desktop, tablet and mobile |
| Classic-shell journeys | 12 distinct cases passed across desktop, tablet and mobile |
| Final focused ESLint | Exit 0 |
| Final full TypeScript check | Exit 0 |
| Final diff whitespace check | Exit 0 |

The **30 distinct browser cases** cover the real chart entrypoint, optional Flow panel, keyboard activation of its link, canonical Tape consumer, exact root filtering, and CSV population count. Main journeys run in EN/ZH; shared-shell main journeys additionally run with its real dark/light theme owner. Viewports remain 1440×900, 820×1180 and 390×844. Main journeys assert no document horizontal overflow; all journeys assert no browser page errors.

The mixed feed has two matching rows, one near-root row and one unrelated row. Consumer assertions require two matching rows and exclude the near root and SPY. Root-change journeys select AMD through the actual chart picker while the old NVDA feed remains; the destination's population remains zero. Dotted-root journeys require the two BRK.B rows.

The shared shell's native theme preference `mmx.shell.theme` is used, and the real rendered theme is asserted. No DOM-only theme substitution is used.

### Retained test failures and repairs

The first shared desktop run returned 3 pass / 3 fail. Two Chinese cases attempted to scroll a server-rendered table while its node was being replaced during hydration; the test now waits for the existing interactive filter and populated rows. BRK.B has a valid chart identity without historical price bars in this fixture; the test now checks the existing chart instrument header and canonical active-symbol state, rather than requiring a plotted-price tag.

The next shared run returned 16 pass / 2 fail. At tablet/mobile widths, the visible close button belongs to the MobileSheet header outside the companion body. The test's close lookup was corrected to the visible page-level control and now asserts panel closure. Only those two failing responsive cases were rerun: both passed. The untouched 16 passing cases are reused. The full classic set subsequently passed all 12 cases.

Product source did not change during these test-harness repairs. The final qualification process `58016` exited 0 after classic browsers, focused lint, full typecheck and diff check, in 143.26 seconds. Exact outcomes and process boundaries are recorded in `execution-receipt.json`; raw logs retain the failed attempts and the successful corrections. The classic server log includes a screenshot/caret-style hydration diagnostic; all browser `pageerror` assertions remained clear.

### Exact-head CI correction: shared destination vocabulary

The first hosted head `c45c3f42800c471073c5265772099a7bb6f70fc0` failed two unit shards because its shared dictionary change invalidated the retained R5 Exposure browser fingerprint. The seven evidence-owner and two R5 successor failures reported `NO_QUALIFIED_CAPTURE` ([run 43600409738](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43600409738)). The evidence reader and its 72-source boundary remain unchanged.

The final correction reuses the already-owned Activity tape destination vocabulary in the Flow consumer and restores the dictionary's exact protected SHA-256, `91bec03bdb1cdfec2be674da5562cf7e1a16e9154f1d7c4390bd49a474f30b3a`. This also removes the old “Flow desk” destination mismatch: the link actually opens Tape. It introduces no replacement translation dictionary or evidence exemption.

All 107 cases in the Flow component, Tape codec, Exposure evidence-owner and R5 successor suites passed after the correction. Four fresh real shared-shell journeys (EN/ZH × desktop/mobile, light theme) passed with exact-root populations, keyboard activation, accessible destination names, no page errors and no horizontal overflow. These are reruns within the original 30-case matrix, not 34 distinct browser cases. Final focused lint, full typecheck and diff check passed again.

`copy-capture-index.json` binds eight new source/destination captures without modification. The final EN desktop and ZH mobile source captures were visually inspected: the exact-symbol destination link is visible and readable in both. The existing freshness-spacing defect remains separately open. The original nine captures remain historical proof for the first implementation; the new captures show the final destination wording. This correction leaves the separate incomplete PL6 receipt-spacing operation untouched.

## Visual inspection and capture provenance

Nine representative browser captures are copied without alteration into `captures/`. `capture-index.json` records each original Playwright path and matching SHA-256. They cover real light/dark presentation, EN/ZH, all three widths, dotted roots and a changed-root empty population. Source and evidence hashes are retained in `manifest.json`.

The inspected desktop light source and Tape destination preserve the instrument and readable exact population. The narrow Chinese light destination retains the instrument chip, export count and responsive table; the page remains vertically scrollable. This is fixture UI evidence, not entitled production acceptance.

### Separate spacing defect and incomplete PL6 control

Inspection exposed an existing Flow freshness-text spacing defect. `OptionsCompanion.module.css` currently lacks the receipt's wrapping flex layout. That stylesheet is bound by both PL6 batch 1 and Visual Intelligence evidence manifests.

The actual #804 holds concern Investigation release, B5 ingress, migration and its original T03k effects. Manifest-path overlap alone is not a blanket source-custody fence; the stylesheet is unchanged between that PR and protected master. This was checked before attempting a fresh, scoped control capture. See the [actual hold](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/804#issuecomment-6547233146), [prior scoped recapture](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/804#issuecomment-6115032711), and the existing `capture_pl6_batch1.cjs` owner.

The fresh control operation `flow-receipt-pl6-control-20261114-c3` captured four ChartChrome observations (EN/ZH × desktop/mobile) before its original cleanup failed with `kill EPERM`. Its parent process `72759` exited 1 after 56.30 seconds. The stack locates the failure in a signal-zero observation during the drain following SIGTERM. It does not prove zero cleanup effects or complete group settlement.

The original four case JSON/PNG pairs and start record remain in `terminal/docs/pr-crops/b-pl-6-batch-1/`. No final execution report exists; **these are incomplete observations and are not a qualified capture**. The standalone producer did not retain the detached server PID/PGID. Subsequent read-only checks found no listener on its port 3200 and no matching workspace capture process, but those observations do not prove the missing exact group's closure. No refused signal was repeated, no successful receipt synthesized, and no replacement capture was started. The planned VI control never started.

The CSS repair and its evidence-lock updates remain pending original-owner lifecycle reconciliation. Neither the stylesheet nor either `EVIDENCE.yml` is changed by this PR. This separate capture failure does not invalidate the functional bridge's already-completed browser runs.

## Source/effect custody

The current chart companion, strings and Tape codec are unchanged in both public and prepared #1248 source compared with this base. The prepared source was checked through complete relevant Git trees, rather than treating the capped 3,000-file PR response as a complete negative. #1248's held campaign → Tape workflow is a different ingress and its original tree-publication uncertainty remains preserved.

Concurrent #1509 owns the Tape → chart return leg and shared navigation. This change consumes its incumbent view codec and does not modify that return leg. The scope here is the forward exact-symbol chart handoff.

The installed C3 workspace/publisher remains the source operation's carrier. Workspace acquisition's adapter-level unqualified return was reconciled through that same owner's exact clean branch/status before editing. Root implemented directly under the previously established unavailable eligible paid-Fabric pre-effect path; native children supplied bounded reasoning only.

C1 #1514 has separately merged at `43093737b9d3b682bb19859c3a6fc4cd6cae6b77`. The continuing programme's Macro records have merged through their incumbent controller. Neither fact proves this bridge is deployed. Hosted exact-head checks, permitted native release, actual served build identity and the owed entitled production/browser journey remain separate acceptance stages.
