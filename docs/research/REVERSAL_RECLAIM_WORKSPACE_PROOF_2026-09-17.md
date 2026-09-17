# Reversal & Reclaim workspace — candidate capability and proof

**Mission:** Turn the existing independent chart studies into one usable structural/momentum/reclaim workflow. This presentation capability is not a validated stock-picking strategy or a replacement for the owner-native occurrence engine.
**Owner:** Sol, Chairman-approved charting upgrade. Operation `CHART-RECLAIM-WORKSPACE-20260917-SOL-001`.
**Base:** Terminal `75c22083249e7a1529be3d6baf819b9ad5ea509f`. Skillpack `Mastermind@8b231e8267f09cfb002ed3e87bec14906dce1720`.

## Delivered in the candidate
The existing Indicator Library now offers `Start with a workflow`. Its existing Systems & Presets surface hosts Reversal & Reclaim, with three legible questions: location, momentum, and price confirmation. One action configures existing Smart S/R, Swing Failure, Auto Patterns, Trend Engine, Mastermind Candles, RSI Engine/Signals/regular Divergence and Gap Zones. The actual chart renders those modules; this is not just a card.

The recipe lives in the existing `suites/presets.ts`, not a new signal/species/workspace registry. It keeps custom calculation inputs (for example RSI length 21 and trend sensitivity 8), preserves unknown fields and noncatalogue extensions, and explicitly applies quiet display settings and disables historical auto-optimization. Existing drawings and Pine scripts are not deleted. The current built-in study arrangement is replaced on an explicit user click only; no automatic migration.

Actual active studies/settings determine whether the workspace is configured. An in-session one-step undo restores the exact prior existing workspace state; it is withheld when later custom edits would be overwritten. No persistent undo/control store or new account setting is created. Existing subscription and anonymous-study gates remain; Free and Essential cannot apply this Pro recipe. The three guide actions use the existing Guide Center and its return path.

## Proof
- Seven pure recipe tests initially failed on missing capability; all pass against the implementation, alongside twelve catalog and five legacy preset tests.
- Full unit run: **333 files, 5,517 tests passed, 4 existing TODOs**, 46.82 seconds, with two workers and no retries. TypeScript `--noEmit` and `git diff --check` passed.
- Actual browser application/undo: desktop 1440×900, tablet 820×1180 and mobile 390×844, each in English and Chinese. Six cases passed without retries or force-clicks. Assertions verify actual persisted studies and custom inputs, configured state, the real RSI chart, zero document overflow and exact previous-state restoration.
- Additional real-client boundary cases passed for Free, Essential, and later-edit undo invalidation. Final matrix: **9 passed, 6 explicitly skipped duplicate entitlement/state checks on tablet/mobile**, 1.2 minutes. Those shared gates were tested on desktop, not silently counted as six additional passes.
- Existing Guide Center round trip: one separate desktop case passed in 5.5 seconds; it opens the actual Smart S/R guide and returns to the same configured/undoable workspace.
- The initial full-journey browser run exposed only a test locator mismatch: the actual accessible navigation name contains the existing count (`Systems & Presets 5`). The test was corrected to that exact rendered name; no timeout, interaction workaround or product behavior was weakened.
- Twelve actual chart/card captures and their content hashes are committed under `terminal/docs/pr-crops/chart-reclaim-workspace-20260917/`. Direct visual review covered desktop and mobile; these are real browser results, not design mocks. Mobile card captures are scrolled to the configured action region; the card remains vertically scrollable within the existing picker.

Terminal currently declares a dark-only visual system. All accepted captures are dark EN/ZH. No artificial light-theme pass is claimed. This operation did not change appearance/theme ownership.

## Limits / parent work still owed
The recipe provides coherent composition and guides, not a computed `FORMING/CONFIRMED` occurrence engine. Current chart context remains owned by `VisualIntelligencePanel`. Linked price/oscillator divergence, selected nearby zones/gap lifecycle, nested/wedge structure and validated cross-timeframe discovery remain distinct next dependencies. No readout, confidence score, scanner, forecast, or trading authority has been invented.

A1 alert timing and actual-runtime repair remains PR #602, with independent review consumed and its native merge-on-green release path armed; deployment proof is still owed. Original/remaining R is PR #604, explicitly HOLD: its visual overlap was rejected and its exact refinement call was platform-blocked with no write effect, so that operation remains frozen. This workspace never edits its position renderer or routes around that gate. Macro Agent OS publication remains owed behind the recorded guide-read safety gate; GitHub is the durable source/evidence owner, not a replacement organizational store.

No production deployment has occurred for this candidate. Required native checks, exact-head independent review, current-base compatibility, canonical deployment and real production browser proof remain release conditions. Parent programme is not complete.
