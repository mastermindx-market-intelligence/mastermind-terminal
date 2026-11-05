# D08B term structure — exact expiry investigation

## Result and authority

The existing term chart deliberately omitted most markers beyond 60 supplied days to expiry. Selecting a finite connected 90D or 180D observation therefore did not make that selected point locatable. The panel also lacked exact per-expiry values. This slice adds a selected marker and vertical guide, an exact selected readout, and an expandable semantic expiry table through the existing controlled selection callback.

**Built and locally verified; production remains BUILT_NOT_PROVEN.** This is a continuation of [Terminal Draft #1266](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1266), returning through [D08B design #10686](https://github.com/mastermindx-market-intelligence/macro/pull/10686) to [D08 #10649](https://github.com/mastermindx-market-intelligence/macro/pull/10649). The Chairman's resumed implementation instruction applies; no merge, Ready, un-draft, enqueue, held relabel or deployment is authorized.

The current Web review waiver removes blanket separate-review ceremony. The optional native source check here is additional evidence. Protected law, required CI, CODEOWNERS, formal non-author approvals and D08 product acceptance remain distinct requirements.

## Inputs and custody

| Input | Exact identity |
| --- | --- |
| Compatible governing pin | Mastermind `910803421beca53ca25145392725ab2d84c7a8e9`, bootstrap 1 / skillpack 1.0.1 |
| Current protected comparison | Mastermind `75a6540519cf519edfef7633e74f57b68aef9329`; INDEX blob `95b36446601250ccaf298dfb1c9b51fa9823e042`; material execution/Web/Paper laws unchanged |
| Same-SHA closeout read | INDEX, CLOSEOUT, RECONCILE_STATE and dialogue-close law read at `75a6540519cf519edfef7633e74f57b68aef9329` before durable return |
| Frozen interface | D08-OPTIONS/1.0.0 at macro `d0516e1bad9cb5982d43d20c4167d0355cb70e2c` |
| Design / foundation | Original 18-board D08B package, corrected macro head `62f95141ce3bc56dbf96ab9b97ff5b3c8b806612`; F01/F02 candidate.4 remains unreleased |
| Paper binding | Terminal file `01M3NSZGE8JWN2EZCSF0DT05RM`, page `p-12-0`; B04 `1OMF-0` and B08 `1PG1-0` were re-inspected before volatility changes |
| Source before this slice | Terminal `4a58b778ade85a78834f8a61cb0ca8c52556f0bf`; original Term blob `37fbf6e81969ca26e21e0bbc69519bd432148d6d` |
| Managed operation | `d08b-surface-exact-values-20261104-c3` |
| Original branch | `sol/web-d08b-surface-exact-values-20261104-c3` |
| Original workspace | `/Volumes/Mastermind/agent-workspaces/terminal/web/d08b-surface-exact-values-20261104-c3` |

The original publisher remains the only Terminal publication carrier. No Paper edit or file switch occurred in this slice. The live B01 repair and Surface source remain accepted and unchanged. The complete ten-PR ownership census and exact incumbent heads are recorded in the preceding [Skew return](../d08b-vol-skew-exact-20261104/README.md). The same complete file lists were checked for Term paths; no collision was found. Principal #1243/#1248/#804 heads were re-read and unchanged before mutation. This is known-PR evidence, not a claim about unpublished writers.

## User journeys

### Locate the exact selected expiry

Choose a supplied expiry through the existing Investigate expiry selector or the new exact-table expiry button. The parent remains the sole selected-expiry owner. The full ISO expiry, supplied DTE and unrounded admitted ATM IV appear in the selected readout. A finite selected 90D/180D observation gets a ring marker even when it belongs to a connected long-tail segment. The vertical guide uses the identical existing `xOf(suppliedDte)` coordinate.

The table button calls `onSelectExp` once and waits for the parent's controlled readback. Its pressed state, the select, selected readout, shared context and smile expiry therefore move together. No optimistic local expiry, invented contract, pin or Plan item is created. Read-only use without a callback renders ordinary expiry text.

### Investigate missing or conflicting IV

A selected valid expiry with a known DTE and unavailable IV keeps its full date and supplied day coordinate. It gets a guide but no fabricated IV marker. A duplicate expiry with one agreed DTE retains the existing gap and explicitly says **Conflicting records**. Disagreeing duplicate DTEs remain unplaced: the selected date remains visible, while DTE and IV stay unavailable/conflicted and no guide or neighbor is substituted.

If source rows disappear, old values, table and chart disappear. The explicit selected identity remains available with the existing unavailable choice. Finite zero stays `0%`; tiny nonzero values do not collapse through display rounding. The exact table remains usable when all admitted IV observations are unavailable and the chart cannot draw.

### Read exact values on a phone or narrow pane

Open **Exact expiry values** with touch, pointer, Enter or Space. The semantic table exposes full ISO expiry, supplied days to expiry and ATM IV (%) for every admitted row. Long numbers wrap without truncation. Expiry buttons remain at least 44px and preserve native keyboard focus. The disclosure uses ordinary page/container vertical scrolling, with the last row separately hit-tested in browser proof.

Below the shared chart's 240px minimum, the plot is replaced by a readable explanation and exact-value action. That action focuses the persistent expansion button. The selected identity/readout, expiry selector, exact rows, source disclosure and provenance remain reachable. The source/method disclosure explains numeric precision and which coordinates were admitted; rejected or ambiguous rows are not assigned synthetic dates or day counts.

## Retention, source and build contracts

| Concern | Required and implemented behavior |
| --- | --- |
| R35 / A11 selected volatility investigation | Keep the selected long-tail point locatable; expose the same admitted exact values and controlled expiry |
| R36 / A10 missing selected expiry | Retain the requested ISO identity; never select a neighboring term or smile implicitly |
| R37–R40 source context | Existing ATM/RV/VRP, rank windows, coverage/since, RR signs and smile trim methods remain owned by their current panels/readers |
| Admission | Reuse `admitVolTermRows`; no parser, conflict winner, source revision or new validity rule |
| Chart mathematics | Retain H=244, sorted supplied DTE domain, Y-domain, ticks, segmentation, gap placeholders and continuity withholding |
| Structure comparison | Preserve front versus nearest 90D, bounded to 90±45 days, with existing suppression rules |
| Slope comparisons | Preserve actual front→nearest 30D and nearest 30D→nearest 90D anchors, tolerances and subtraction signs |
| Marker density | Keep ordinary near-curve/isolated markers; add only the explicit finite selected long-tail marker |
| Exact units | Source ATM IV is already a percent number. `String(value)` preserves the admitted JavaScript number; no extra conversion and no claim to original serialized decimal bytes |
| DTE | Use supplied DTE verbatim; do not recompute from the wall clock or infer from the expiry date |
| Counts / coverage | Existing count means supplied admitted expiry rows, not source collection coverage or a complete contract universe |
| Clocks | VolView as-of/freshness and existing nightly EOD provenance remain unchanged; this component receives no new source timestamp or snapshot |
| State ownership | Only local table-open presentation state is added; selection remains `selectedExp`/`onSelectExp` |
| Backend / security | Existing route, readers, cache, source transport, authentication and entitlements are unchanged |
| D08C / D08D | No Plan/Save, contract cast, source-list pin, replay admission or cursor change |

The write set is the Term component, a local CSS module, local EN/ZH strings, one new unit suite, one route suite and this proof directory. Shared admission/math/types, VolView, shared strings, Surface and source owners remain byte-identical. `source-blobs.json` records exact source and unchanged-owner identities.

## Verification and visual corrections

| Check | Observed result |
| --- | --- |
| Unit | **79 passed**: 11 new Term cases, 33 missingness, 8 conflict-continuity, 6 real-parent expiry journeys, 21 rejection-disclosure cases |
| Scoped ESLint | PASS |
| Final browser | **11 passed, 4 intentional viewport skips**: 7 new Term cases, 3 existing shared-expiry cases and the existing phone-overflow regression |
| Viewports | 1440×900, 820×1180, 390×844; additional 320×844, CSS `zoom:2`, reduced motion and a composed 230px panel |
| Locale / palette | EN/ZH, ordinary dark and explicitly controlled existing light tokens |
| Exact viewport evidence | **42 PNGs**, each captured after scroll and hit-testing of the intended visible readout, row or control |
| Rendered contrast samples | **624 text samples**, minimum **5.554996509050376:1**; **84 mark samples**, minimum **5.028420134408705:1**, across 12 JSON records |
| Build | `npm run build` PASS, including TypeScript/static generation; existing unrelated Tiingo tracing warnings retained |
| Scope / whitespace | `git diff --check` PASS; original writer/carrier preserved |

The first browser run caught the existing expiry-count label at 4.454100311:1. Its local presentation now uses the existing readable `--text-2` token at 11px. `browser-initial-contrast.log` and `before/` preserve that failure and its images/measurements.

A later run passed interactions, but visual inspection found that oversized whole-element screenshots on desktop captured the wrong region in the fixed-height Options scroller. Those images are retained in `before-capture-correction/` and are superseded as desktop visual evidence. The final suite captures the actual viewport only after the intended readout/row/control is in bounds and hit-tested. `browser-before-capture-correction.log` preserves the earlier interaction result; `browser.log` is the final 11-pass run. Root inspected final light desktop readout/row, phone, 320px, tablet and narrow composition evidence. Screenshot success alone was not treated as visual acceptance.

Light-token proof uses the existing helper introduced by Skew. It scopes the actual shared-shell light declaration to this panel and verifies the resulting token. It does not activate a production shell, change flags or prove account theme-preference delivery. See the preceding Skew return for the explicit correction of old Surface light filenames.

The optional independent native source review passed the exact hashes in `source-review.json`; its final delta verified the count-color correction, persistent unit-test toggle, contrast sampling and viewport capture method. It did not independently execute tests or certify rendered contrast or assistive-technology behavior. No reviewer/watch daemon is awaited.

### Reproduction

From `terminal/`:

```sh
npx vitest run lib/__tests__/volTermExactValues.test.tsx lib/__tests__/volatilityMissingness.test.tsx lib/__tests__/volatilityConflictContinuity.test.tsx lib/__tests__/volatilityExpiryInvestigation.test.tsx lib/__tests__/volatilityRejectionDisclosure.test.tsx
npx eslint components/vol/VolTermPanel.tsx components/vol/volTermStrings.ts lib/__tests__/volTermExactValues.test.tsx e2e/options-vol-term-exact.spec.ts
TERMINAL_E2E_PORT=3468 TERMINAL_VISUAL_EVIDENCE_OPERATION=d08b-surface-exact-values-20261104-c3 npm run test:e2e:responsive -- --config=docs/verification/d08b-vol-skew-exact-20261104/playwright.config.ts e2e/options-vol-term-exact.spec.ts e2e/options-vol-exact-expiry.spec.ts e2e/options-vol-term-mobile-overflow.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
npm run build
python3 docs/verification/d08b-vol-term-exact-20261104/verify_package.py
```

The shared proof config preserves the repository's real route, fixture/auth seams, projects and assertion budgets; it extends only observed local server-startup time and uses zero retries. The browser substitutes a declared volatility fixture at the existing flow route. It does not prove live provider availability, deployed clocks, production entitlements or a full mounted A→B→C handoff.

## Acceptance and exact remaining boundary

This adds bounded evidence for A10, the term/expiry portion of A11, keyboard/exact-path portions of A14/A18, tested-width portions of A16/A17, locale/palette portions of A19, and ownership/reader-reuse portions of A23/A24. It does not mark all A01–A26 passed. Native browser/text zoom, complete 400% reflow, assistive-technology certification, integrated foundation, live-source proof and final D08 acceptance remain unclaimed.

The next same-carrier work is the disjoint History exact-values alternative required by the frozen brief, followed by a cumulative D08B/D08 return. No release action is authorized. Current source and evidence are reviewable on the existing Draft; the published exact head is bound by GitHub readback in that cumulative return. Any later accepted regression should be reverted through the same normal reviewed source path while retaining incumbent work.
