# D08B volatility history — exact observations and cumulative route proof

## Capability delta

Before this change, ATM IV history exposed only a chart with shortened date labels and formatted axis ticks. Fewer than ten finite observations produced the honest chart-empty state, but the valid supplied observations were then impossible to inspect. A chart-only path also lacked a useful textual alternative in a narrow composition.

The panel now offers **Chart / Exact history values**. Its read-only semantic table shows full admitted ISO observation dates and unrounded admitted percent-number IV, including sparse history, zero, tiny nonzero, unavailable values and duplicate-date conflicts. The chart retains its ten-finite-observation threshold and its original mathematics. This closes the frozen product brief's requirement that history source values remain reachable and charts have a textual/table alternative.

**Built and locally verified; production remains BUILT_NOT_PROVEN.** The work continues the original [Terminal Draft #1266](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1266) under the Chairman's resumed implementation instruction, for return through [D08B #10686](https://github.com/mastermindx-market-intelligence/macro/pull/10686) to [D08 #10649](https://github.com/mastermindx-market-intelligence/macro/pull/10649). No merge, Ready, un-draft, enqueue, held relabel or deployment is authorized.

## Exact sources and writer

| Input | Identity |
| --- | --- |
| Original design / requirement | Macro frozen package `a3356474cebbdd88e6448e05ffc3d2e44faa5ca6`, PRODUCT_SPEC Journey J3 and INTERACTIONS_ACCESSIBILITY §5; later design return `62f95141ce3bc56dbf96ab9b97ff5b3c8b806612` |
| Frozen common interface | D08-OPTIONS/1.0.0 at macro `d0516e1bad9cb5982d43d20c4167d0355cb70e2c` |
| Compatible law pin | Mastermind `910803421beca53ca25145392725ab2d84c7a8e9`; applicable material deltas inspected through protected `75a6540519cf519edfef7633e74f57b68aef9329` |
| Closeout bundle | INDEX, CLOSEOUT, RECONCILE_STATE and dialogue-close law read at the same protected `75a6540519cf519edfef7633e74f57b68aef9329`, compatible bootstrap 1 / skillpack 1.0.1 |
| Previous source head | Terminal `ee40d56dfdd447ec7f01e4075aac70275195f160` |
| Original History blob | `ef5d8110de2f24feb96bf9dacecc8fbda24f7dac` |
| Shared admission blob | `17b49ca0772fe9bb1dca503abfa4465df67bd5b4` |
| Managed operation | `d08b-surface-exact-values-20261104-c3` |
| Original branch | `sol/web-d08b-surface-exact-values-20261104-c3` |
| Original workspace | `/Volumes/Mastermind/agent-workspaces/terminal/web/d08b-surface-exact-values-20261104-c3` |
| Paper input | Terminal `01M3NSZGE8JWN2EZCSF0DT05RM`, B04 `1OMF-0` / B08 `1PG1-0`; exact native inspection already consumed for the volatility continuation |

The complete ten-PR file census in the [Skew return](../d08b-vol-skew-exact-20261104/README.md) was also checked for History's five source/test paths and proof prefix. There was no known collision. The principal incumbent #1243/#1248/#804 heads and own Draft were re-read before this mutation and unchanged. No Paper mutation or foreground switch, new branch, source carrier or release effect was used.

## Real investigation journeys

### Read the source values behind the line

Open Volatility, then choose **Exact history values** with pointer, touch, Enter or Space. The table consumes the same `admission.rows` as the chart. It preserves full dates and exact admitted JavaScript numbers without another percent conversion, interpolation or compact rounding. A supplied `0` and `1e-9` remain distinct. Missing, invalid or negative IV reads **Unavailable**. A duplicate date retains one **Conflicting records** row and no selected winner.

The count separates finite IV observations from admitted supplied date coordinates. Invalid dates remain excluded by the existing admission rule; the interface does not invent an excluded-row count. Table rows have no buttons, selection state, links or replay effects. Changing History's view does not move the shared term/smile expiry.

### Inspect short history without overstating analytical support

Nine finite observations still do not produce a chart. Their nine exact source rows remain inspectable. Likewise, valid dates whose IV is entirely missing remain in the table with unavailable values. When source history disappears completely, the old values, table and view controls disappear. If data later recovers, only the user's local view preference survives; former source observations do not.

### Understand date and method boundaries

The **Source & method** disclosure states that the date is an observation identity and that its availability timestamp is not supplied here. It states the percent scale, missing/conflict rule, valid-date scope and ten-finite chart threshold. These are admitted numeric values, not a reconstruction of original serialized decimal bytes. No source release time, replay cutoff, historical rank, close series or new source clock is inferred.

### Continue on phone, magnification or a narrow pane

The header and controls wrap, native buttons and summary remain at least 44px, and the table uses normal vertical page/container scrolling. A 90-row fixture proves access to the last supplied observation at 320px and CSS zoom 2. The final phone column allocation keeps its full `25.1234567890123` fixture value on one line at 320px; longer values in narrower panes wrap without clipping or rounding.

Below the shared chart's 240px minimum, the chart supplies an explicit exact-values fallback. Activating it focuses the persistent Exact history values button before the temporary action disappears. The 230px composition retains full date/value content, source disclosure and focus. Read-only rows remain a semantic table; this does not introduce a tab stop for every observation or pretend to be an interactive replay selector.

## Retention and source/backend/build contract

| Concern | Preserved contract |
| --- | --- |
| R38 history / rank / coverage / since | Add exact history evidence without replacing existing published rank and coverage/since controls |
| Admission | Reuse unchanged `admitVolHistoryRows`: valid date identity, sorted coordinates, nonnegative finite IV and duplicate-date quarantine |
| Curve continuity | Use the existing finite segments; missing/conflicting coordinates remain gaps |
| Chart gate and geometry | Preserve ten finite observations, H=250, padded Y-domain, date domain, scales, ticks and inward-anchored labels |
| 52-week references | Use existing supplied scalars only when inside the existing padded domain; distant extrema never expand or flatten it |
| Units / precision | Already-percent numbers via `String(point.v)`; zero remains an observation |
| Clocks | Existing VolView as-of/freshness and nightly EOD provenance remain; observation date is not an availability timestamp |
| Rank / RV / VRP / RR | Existing 252/all methods, nullable rank/close, source-reported VRP and sign conventions remain untouched |
| State | Only local Chart/Exact view preference; no selected history date or new callback |
| Backend / auth | Existing `/api/flow`, cache, authentication, access fences and root-selection owner remain unchanged |
| D08C / D08D | No contract cast, Plan/Save, replay admission, cursor, archive or effective-cutoff owner |

The write set is the History component, panel CSS, local EN/ZH strings, one unit suite, one browser suite and this proof package. An independent source comparison verified that the complete admission-through-reference-calculation block is byte-identical to the original. Surface, Skew, Term and shared source/parent owners are unchanged by this slice; their hashes are recorded.

## Verification

| Evidence | Observed result and limit |
| --- | --- |
| Combined volatility unit closure | **100 passed** across seven suites: History 11, Term 11, Skew 10, missingness 33, conflicts 8, parent expiry 6, rejection disclosure 21 |
| Scoped ESLint | PASS |
| Combined actual-route run | **32 passed, 10 intentional duplicate-width/source-case skips** across History, Term, Skew, existing shared expiry, existing phone overflow and existing load-failure/retry suites |
| Final History recheck | **8 passed, 4 intentional skips** after the final phone column-width correction; includes an explicit one-line assertion for the 320px precision fixture |
| Viewports | 1440×900, 820×1180, 390×844; additional 320px, CSS `zoom:2`, reduced motion and composed 230px panel |
| Final History visual evidence | **51 viewport PNGs** and **51 adjacent capture metadata records**, with viewport size, zoom, pixel ratio and visible target bounds |
| Contrast | **764 rendered text samples**, minimum **5.554996509050376:1**; **60 mark samples**, minimum **5.028420134408705:1**, in 24 records |
| Build | Final `npm run build` result recorded in `build.log` and `VERIFICATION_RESULT.json`; no deployment |
| Whitespace / scope | `git diff --check`; unchanged-owner and exact-source hashes in `source-blobs.json` |

The combined run is retained as `browser-combined.log`. It passed before the final CSS-only change from 47% to 42% for the date column. Root visual QA found one final digit wrapping onto a separate line at 320px; `before/` preserves that image and capture metadata. The focused final run in `browser.log` verifies the corrected table at every declared viewport. No calculation or source behavior changed after the combined run.

All final captures use the actual viewport after scrolling to and hit-testing a bounded visible target. They do not use oversized whole-element screenshots, which the preceding Term phase found unreliable inside the fixed Options scroller. Root inspected desktop light chart, phone light precision, 320px last row, 230px composition and phone ZH source disclosure. Full-page/whole-shell light activation is not claimed: the existing light-token helper scopes actual shared-shell tokens only to the tested panel.

One native adviser prepared the local draft. A separate read-only source verifier independently fetched original/shared source and checked the exact draft blobs. Root independently integrated, reviewed, tested and visually inspected the result. The final CSS/test-only delta is explicitly separated in `source-review.json`; the verifier did not execute tests or certify rendered contrast. The current Web waiver does not require a separate reviewer ceremony, and no reviewer or watcher is awaited.

### Reproduction

From `terminal/`:

```sh
npx vitest run lib/__tests__/volHistoryExactValues.test.tsx lib/__tests__/volTermExactValues.test.tsx lib/__tests__/volSkewExactValues.test.tsx lib/__tests__/volatilityMissingness.test.tsx lib/__tests__/volatilityConflictContinuity.test.tsx lib/__tests__/volatilityExpiryInvestigation.test.tsx lib/__tests__/volatilityRejectionDisclosure.test.tsx
TERMINAL_E2E_PORT=3468 TERMINAL_VISUAL_EVIDENCE_OPERATION=d08b-surface-exact-values-20261104-c3 npm run test:e2e:responsive -- --config=docs/verification/d08b-vol-skew-exact-20261104/playwright.config.ts e2e/options-vol-history-exact.spec.ts e2e/options-vol-term-exact.spec.ts e2e/options-vol-skew-exact.spec.ts e2e/options-vol-exact-expiry.spec.ts e2e/options-vol-term-mobile-overflow.spec.ts e2e/options-vol-load-failure.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
npm run build
python3 docs/verification/d08b-vol-history-exact-20261104/verify_package.py
```

The browser uses the real route and existing local fixture/auth seams with declared controlled source data. It proves the tested consumer behavior, not production provider access, deployed clocks, real entitlements, or actual account theme delivery. CSS zoom is not native browser/text zoom or a full 400% reflow audit. Sampled style contrast and table semantics are not complete WCAG or assistive-technology certification. Existing unrelated build tracing warnings are retained.

## Acceptance and return boundary

This supplies bounded R38 and A11 history evidence plus portions of A14/A16–A19/A23/A24. It also verifies that the previously completed volatility paths remain compatible with History, including real shared expiry and failure/retry behavior. The 60-item ledger still has zero removals. All A01–A26 are not globally marked PASS.

The original design package, accepted B01 correction, Surface implementation and all three volatility slices now have durable source/proof returns. D08's assigned receiver owns composition with the still-separate matrix/Lab/Levels/navigation/foundation work and exact-contract/source/replay interfaces. Required CI/formal approvals, released foundation, integrated A→B→C proof, complete accessibility/performance coverage and live production acceptance remain distinct gates. The current Web waiver removes blanket mandatory separate-session review, not these real source/platform requirements.

The cumulative D08B design update binds the published exact Terminal head and actual CI disposition. The original managed writer/carrier remains in place; this return neither transfers a live lease nor authorizes any held release action. No duplicate runner, unknown effect or unattended continuation is claimed.
