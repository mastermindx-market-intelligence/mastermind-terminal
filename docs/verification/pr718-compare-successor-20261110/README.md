# PR #718 — current comparison-settings successor

## Result and scope

This packet qualifies the original `claude/terminal-compare-settings-ux-20260922` carrier at original head `eac52855170a66e86e347278b3474570d05580c9`, composed with fixed protected Terminal `b5afc7eca5c37b3e2eee25871b764807203957a6`. Procedure pin: Mastermind `5257967eb23d10418dc2326bb7a7b31f7e6a5915`. Current principal custody: [6772988899](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/718#issuecomment-6772988899).

The effective product change is confined to CompareSettings.tsx, its scoped CSS, and the original three-line More → Compare action in TerminalShell. Current native dialog, focus helper, color parsing/opacity, preference callbacks, global i18n/CSS and shared settings geometry remain their existing owners. The protected pane-sync assertion is byte-identical; the old already-delivered correction is not reapplied. The eleven historical comparison proof members are preserved byte-for-byte.

The component now permits an empty numeric draft without publishing zero, previews only bounded valid integers, and commits out-of-range/fractional/negative values through the existing bounded helper. It does not carry an uncommitted draft into a different symbol. Grouped color/line/scale controls, selected-state semantics, visible hex and line preview retain the original UX scope.

The real coarse-pointer Settings button disappears when its comparison legend row closes its action tray. Current source supplies the existing dialog helper a connected, visible, exact-symbol comparison row in the active pane as fallback. The helper still prioritizes a surviving opener and retains its nested-dialog/scroll cleanup. No second focus manager or preference store is introduced.

## Discriminating source evidence

| Evidence | Actual result |
|---|---|
| Original current-protected control | Five width-draft source counterexamples; one separate unsupported Vitest matcher failure. Original report, log, source and test preimages are retained. |
| Matcher reconciliation | Replaced the unavailable convenience matcher with equivalent call-count and last-arguments assertions. No source assertion weakened and no red replay. See red-reconciliation.json. |
| First repaired source | 62/62 affected component/accessibility/shared-helper contracts passed. |
| Missing-opener regression | The targeted vanished-opener case failed; surviving-opener control passed. Twelve other tests were deliberately unselected in this two-case red probe. |
| Current final source | **64/64 passed, zero failed/skipped**, through the actual component and unchanged shared dialog helper. See focus-green-execution.json. |
| Current type/lint checks | Next type generation and full-project `tsc --noEmit` passed. Affected component/test lint passed with zero findings. The current browser spec's scoped lint pass remains source-bound in its own receipt. CSS and the three-line shell change are checked through the actual browser matrix and full TypeScript where applicable; no whole-file TerminalShell lint pass is claimed. Generated next-env.d.ts was restored. |

The initial source-check driver apostrophe syntax error occurred before any checks executed. Its script preimage is retained; the corrected driver ran only the previously unexecuted checks. No success is attributed to that failed wrapper.

## Actual browser qualification

The scoped configuration imports the unchanged protected Playwright configuration, existing webServer environment and global warmup. It visits the actual `/terminal?symbol=NVDA` route using the incumbent NVDA/AAPL fixture files. It does not seed a comparison or saved layout, replace the renderer or introduce an alternate data/lifecycle service.

Both current matrices use one worker, zero retries and the same three viewport sizes: desktop1440×900, tablet820×1180 and phone390×844, each EN/ZH.

| Current operation | Cases | Duration | Source / lifecycle |
|---|---:|---:|---|
| browser-chromium-focus-owner | **6 passed; 0 failed/flaky/skipped** |113.765s |3429 inputs stable;11 historical members unchanged; generated types restored; owned port47187 closed |
| browser-webkit-focus-owner | **6 passed; 0 failed/flaky/skipped** |66.312s |3429 inputs stable;11 historical members unchanged; generated types restored; owned port47188 closed |

Each journey creates AAPL through the real comparison picker. Tablet physically taps More → Compare from an empty comparison state; phone uses the existing Analysis hub. Assertions cover the native modal/focus, editable width draft and disabled bound, actual saved color/style/width/scale, hit-test reachability and44px touch targets, Tab/Shift+Tab wrapping, Escape/Done/Close return focus, reopen persistence, no horizontal overflow and zero page errors.

Six current representative modal PNGs were visually inspected across both engines, all three sizes and both languages; exact files are in visual-review.json. All twelve matrices also have actual screenshots and automated geometry/hit-test checks. This is not a claim that every duplicate attachment was individually inspected. WebKit ran with an OS light preference against Terminal's existing dark surface. The shared surface intentionally uses `--pop-bg-modal: rgba(16,19,28,.93)` and the existing blur token; WebKit shows more chart bleed-through than Chromium. Controls and text remain readable and unclipped. No fabricated product light palette or physical Safari/iOS qualification is claimed.

## Preserved failures and causal repairs

1. **browser-chromium**: stopped on the first desktop case's strict page-error assertion. The existing layoutStore.useLang test helper attempted to set documentElement attributes before that element existed. The new fixture uses the original storage-only `mm.lang` initialization; the error was not ignored or filtered. Other product assertions in that failed case do not turn the case into a pass.
2. **browser-chromium-locale-owner**: two desktop passes, then a real tablet failure because focus returned to BODY when the touch opener disappeared. The raw focus attachment, report and trace remain. The component fallback repair and separate unit counterexample address this exact failure.
3. **browser-chromium-focus-owner / browser-webkit-focus-owner**: both complete matrices passed on the repaired component. Their source-before/source-after maps bind the actual code and unchanged shared dependencies.

All four operations retain their own immutable output directories. No failed captures were overwritten or relabelled as accepted current proof.

## Delivery and acceptance

#688 is already merged at `d71551154604981b5dc4468fbbe3dc7cae5ab9c6`; its separate production acceptance is [5825857603](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/688#issuecomment-5825857603). This composition consumes protected source, without copying or replaying that marker repair.

The original #718 Draft/hold condition still requires its own new eligible natural PR CI before Ready. Current local qualification does not waive required checks, repository approval enforcement, protected merge or exact-generation public comparison proof. Root's retained approval-enforcement coverage gap independently prevents a new root auto enrollment. No direct merge, formal approval, deployment or parent chart-programme acceptance is recorded by this packet.

Publication must use one expected-head update of the original ref after exact custody and immutable-object readback. See the canonical PR receipt for the resulting public commit/tree; INVENTORY.json binds this packet, while publication request/response records remain on the original native carrier.

## Lossless trace transport after explicit GitHub size rejection

The first failed Chromium trace is48,998,182 bytes. GitHub returned HTTP422 (input too large) for its immutable blob request after54 other blobs were acknowledged; no tree, commit or branch update was attempted. Original-actor readback confirmed the original PR/ref unchanged. The initial shared-login guard had likewise sent only a read; the saved original native credential was then scoped to the publisher without changing the shared login.

The complete original trace remains untouched on the original workstation. In this repository it is represented by ordered parts of at most4MiB, with every part and the original SHA-256/byte length bound in segmented-trace-manifest.json. The parts were actually concatenated and compared byte-for-byte to the original. Run reconstruct-trace.py from this packet to restore the original trace.zip path; an existing file is verified and never overwritten. This is a lossless packaging change, with no browser replay, evidence deletion, new source claim or alternate publication carrier. The smaller second failed trace remains a normal ZIP. The old unpublished inventory and exact rejection/reconciliation are retained separately from the current inventory.
