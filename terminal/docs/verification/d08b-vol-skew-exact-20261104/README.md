# D08B volatility smile — exact IV investigation

## Outcome and authority

This continuation implements the source-values path and non-color call/put distinction specified by B04, within the existing `/options?tab=volatility` route. It retains the accepted Surface work on the same Draft [Terminal #1266](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1266) carrier and returns to [D08 #10649](https://github.com/mastermindx-market-intelligence/macro/pull/10649) through the original [D08B design draft #10686](https://github.com/mastermindx-market-intelligence/macro/pull/10686).

**Implementation disposition: built and locally verified; production remains BUILT_NOT_PROVEN.** No deployed behavior or whole-program acceptance is claimed.

The Chairman's renewed design/implementation instruction authorizes this disjoint panel work. The new ChatGPT Web review waiver removes blanket separate-review ceremony; it does not remove protected source law, required CI, CODEOWNERS, formal non-author approvals, D08 acceptance or the explicit release hold. The older commissioning documents' statements that implementation was uncommissioned, and their blanket Web review dependency, are historical for this resumed scope. There is no new Fabric job to await.

## Exact inputs and custody

| Input | Identity |
| --- | --- |
| Law pin | Mastermind `910803421beca53ca25145392725ab2d84c7a8e9`; compatible bootstrap 1 / skillpack 1.0.1 |
| Current protected-head comparison | `2f0a912c3cf7e6f2f7f96e2042ff03b8cb5775b2`; INDEX unchanged at blob `95b36446601250ccaf298dfb1c9b51fa9823e042`; 14-commit comparison contains release-only changes to DELIVERY_WORKFLOW, SOL_CEO_ACCOUNT_INSTRUCTIONS and BOOTSTRAP_KERNEL. Required execution, continuity, Web delegation and Paper laws unchanged. A later 20-commit comparison to protected `75a6540519cf519edfef7633e74f57b68aef9329` also changed none of those governing paths; INDEX remains identical. Retained valid pin; no mixed-SHA bootstrap |
| Frozen Options interface | `D08-OPTIONS/1.0.0`, macro `d0516e1bad9cb5982d43d20c4167d0355cb70e2c` |
| Foundation input | `F01-F02-SHELL/1.0.0-candidate.4`, macro `8926b16af4e0c3e5310cdb4cf057390ec04d18ff`; unreleased |
| Previous accepted source return | Terminal `4741b1ceb2e8718d59ab74654bbeefd9eb6c4484` |
| Protected Terminal source inspected | `f528a219cc5d73e94e058575e3df83d689632bf9` |
| Managed operation | `d08b-surface-exact-values-20261104-c3` |
| Original workspace | `/Volumes/Mastermind/agent-workspaces/terminal/web/d08b-surface-exact-values-20261104-c3` |
| Original branch | `sol/web-d08b-surface-exact-values-20261104-c3` |
| Paper file / page | Terminal `01M3NSZGE8JWN2EZCSF0DT05RM` / `p-12-0` |
| Re-inspected design targets | B04 `1OMF-0`, B08 `1PG1-0`; native screenshots and B04 JSX inspected before source changes |
| Paper read carrier | Native Mastermind Paper, catalog `16e6b93f0c51a1574ba8acee4df732052898707a04731d3817530971a88fdefd`, Paper Desktop 0.5.18 |

The foreground was another file, PROPHET. Reads named the exact Terminal file and board IDs; no foreground switch, new Paper mutation, unknown-operation retry, or B01 rework occurred. The B04 call-circle / put-diamond design and B08 exact missing-expiry behavior remain the visual inputs. Their immutable references are in the [D08B design package](https://github.com/mastermindx-market-intelligence/macro/tree/62f95141ce3bc56dbf96ab9b97ff5b3c8b806612/research/design_candidates/production_design_20261102/d08b).

## Real user journeys

### Inspect an exact IV observation

Open Volatility and choose a supplied expiry through the existing shared selector or smile expiry buttons. The chart uses a solid line with circular call observations and a dashed line with diamond put observations. Each leg retains its own missing-value gaps.

Choose **Exact IV** by pointer, touch, Enter or Space. The semantic table identifies the full ISO expiry, exact numeric strike, Call IV (%) and Put IV (%). It shows the admitted JavaScript number without compact display rounding or another percentage conversion. This preserves finite zero and tiny nonzero observations. Missing/invalid legs say **Unavailable**; conflicting strike records say **Conflicting records** for both legs. Valid coordinates remain inspectable even when both legs are unavailable and no chart can be drawn.

The table's **Source & method** disclosure explains precision, the shared range and the absence of quote inputs/IV method in this read. It is reachable by keyboard and touch without occupying the main reading area. A strike/expiry IV coordinate does not create an executable contract, contract pin or Plan item.

### Widen and restore the research range

The default ±20% window around the existing display proxy remains disclosed. **Full supplied range** is reversible from either chart or table. Both views consume the identical admitted `pts`; the visible strike count states the displayed versus available valid coordinates. The exact view does not silently show hidden wings, interpolate missing values or change the proxy calculation.

The proxy remains the strike minimizing supplied finite call/put IV difference. Existing 95% put minus 105% call skew, missing-leg refusal, adjacent interpolation and two-strike trim fallback remain unchanged. No spot input is borrowed from another store or clock.

### Keep an unavailable expiry exact

Select a term-only expiry, such as the browser fixture's November 13. The shared context keeps that date. The smile shows its existing missing state and neither a chart nor stale table from a neighboring expiry. Choose a supplied smile expiry explicitly; VolView's existing callback moves the same shared context and the user's table preference resumes. Duplicate expiry identities remain quarantined.

### Continue in a narrow or magnified pane

Controls wrap and retain at least 44px hit targets. Tables use ordinary parent/page vertical scrolling and wrap long values without clipping or truncating them. A composed pane narrower than the shared chart's 240px minimum exposes an explanation and an Exact IV action. Activating that temporary action moves focus to the persistent Exact IV control before the notice disappears. Advanced expiry, proxy-method and full-range controls remain available.

## Retention ledger and source/build contract

| Capability | Decision and implementation |
| --- | --- |
| R35 call/put smile and skew | Implement B04's non-color leg encoding and a precise source-values view; preserve exact expiry and separate nullable series |
| R40 deep-ITM wing handling | Retain existing visible/reversible ±20% proxy trim and full supplied range |
| R41 unsupported fitted IV | Remains BLOCKED_DATA; neither table nor line connects create a fitted surface or model-qualified value |
| R38 history/rank/coverage | Existing panels and 252/all methods retained; no shared-parent edit |
| R39 RR/rank methods | No cross-source or sign normalization; unchanged owning calculations |
| Source admission | Reuse unchanged `admitVolSmileExpiries`, `reportedVolNumber` and `finiteSegments`; no new parser or winning-revision rule |
| Selection | Reuse controlled `selectedExp`/`onSelectExp`; standalone expiry behavior retained; `view` is local presentation preference only |
| Units / precision | IV source numbers are already percentages; `String(number)` preserves admitted numeric value, not original serialized decimal bytes |
| Clocks / provenance | Existing VolView freshness/as-of and panel provenance remain; the panel receives no root, source timestamp or snapshot identity and invents none |
| Range / comparison | Same `pts` for chart and table; same existing proxy/skew equations, signs, segmentation, domains, ticks and paths |
| Chart renderer | Existing `useChartWidth`, `niceTicks`, `padDomain` and pixel-thinned labels; no distorted SVG scaling or new renderer |
| Backend / auth | Existing `/api/flow` route, cache and access owners unchanged; no new request, endpoint, persistent state or entitlement |
| D08A/C/D | Aggregate evidence and original observation remain separate; no new interface key, generic B-row cast, Plan/Save or replay/cursor behavior |

The 60-item design ledger remains intact with zero removals. This implements part of the volatility journey, not every R35 selected-guide/contract transition or every A01–A26 program criterion.

### State requirements

| State | Required behavior |
| --- | --- |
| Supplied | Same visible strikes in chart/table; complete ISO expiry; exact percentage numbers |
| Zero / tiny nonzero | Preserve numeric distinction; do not use truthiness or one-decimal rounding |
| One missing leg | That chart leg breaks; other remains visible; table distinguishes each side |
| Both legs missing | Table retains the valid strike coordinate; chart keeps existing unavailable state |
| Conflicting strike | One gap coordinate, both IV values withheld, textual conflict disclosed |
| Conflicting expiry | No source winner, stale table or substitute expiry |
| Selected expiry missing | Exact parent selection retained; available-expiry buttons remain explicit alternatives |
| Source disappears | No previous table values remain; preserve the existing missing/empty state |
| Trim/full range | One reversible view scope, shared by chart/table |
| Narrow pane | Readable exact path and all research controls remain; no clipped chart axes |

## Ownership census before mutation

An independent read-only census checked ten complete relevant open-PR file lists (2,703 entries). Counts matched metadata; #1243/#1248/#804 heads were re-read after pagination. None of the six source/test paths or new proof prefix collided. This bounds known PR ownership and does not claim knowledge of unpublished writers.

| PR | Exact head | Complete changed-file count |
| --- | --- | ---: |
| #1243 | `07616901eb3a33127bd5f2699d604c5b0dd1a2e5` | 414 |
| #1248 | `98ffa891116ccc9e6be58a64148dbe45591e6ce8` | 413 |
| #804 | `27df56d997df0ae94a17b6b8e2d14867431bb394` | 1,784 |
| #1266, this carrier | `4741b1ceb2e8718d59ab74654bbeefd9eb6c4484` | 50 |
| #1258 | `95fe9d0994f8a64cdac72eaa959383dbb974851d` | 3 |
| #1020 | `67709ec49f1c013ba9f59d49162772ede93ecaa5` | 2 |
| #1241 | `f53b36bd71557888c68b7aad89e0a3e9b27c0c57` | 13 |
| #686 | `450850ec2933290d6a8e86db35e8c59cfc8843c1` | 13 |
| #799 | `8b39aa25a88a71ad437a673c87d460b0eed0e027` | 10 |
| #892 | `76d92fa5cd580d72e98ff036df408031fbc0e1eb` | 1 |

The existing `volatilityMissingness` test's marker helper now counts both circles and explicitly marked put diamonds. Every original null/zero/count/continuity assertion is retained. VolView, VolComparePanel, VolVrpPanel, volStrings, volShared, volTypes, shared CSS and routing are outside the write set.

## Validation evidence

| Check | Observed result / scope |
| --- | --- |
| Unit | **57 passed**: 10 new exact-IV cases, 33 existing missingness cases, 8 conflict-continuity cases and 6 real-parent expiry-journey cases |
| Scoped ESLint | Passed on the changed TSX/TS/test files and the local proof config |
| Final Skew route run | **10 passed, 2 skipped** across desktop 1440×900, tablet 820×1180 and phone 390×844; the skips avoid duplicating the explicit dense 320/CSS-zoom/narrow-pane sequence |
| Corrected Surface presentation run | A separate combined run recorded **17 passed, 4 skipped**, including all **7 Surface** cases. The Surface implementation was unchanged; its light-token fixture and 12 screenshots correct the earlier theme claim |
| Final Skew captures | **41 PNGs**: EN/ZH, ordinary dark and controlled light tokens, chart/table, missing expiry, open source/method, dense 320, CSS zoom 2, and 230px pane |
| Sampled Skew contrast | **660 text samples**, minimum **5.554996509:1**; **84 data-mark samples**, minimum **4.989557388:1**. These are measured rendered samples, not a full WCAG or assistive-technology certification |
| Production build | Final result is recorded in `VERIFICATION_RESULT.json` and `build.log`; no deployment |
| Whitespace / scope | `git diff --check` passed; parent, shared admission/math, source/cache/auth and C/D files remain untouched |

The first unit run passed 56/57 tests and exposed an unsupported test-runner matcher, corrected to the installed Vitest assertions. Initial lint required stabilizing the empty `allPts` array for React Compiler memoization; the fix changes allocation stability, not admission or mathematics. Both original failed logs remain. A later browser attempt reached the existing 120-second development-server startup limit before any assertion ran. The process exited, its port was clear, and the same original workspace was verified with a local config that changes only startup to 300 seconds. Test assertion budgets were retained and retries are zero. No second server or checkout was created.

### Corrected presentation evidence

Visual QA found that changing only `data-theme` did not activate light tokens on the ordinary Options shell. Its current light palette requires the separate shared-shell owner marker. Consequently, old Surface captures at `4741b1c…` with `light` in their names, and the initial Skew captures in `before/`, rendered dark. Their interaction/dark-layout evidence remains valid; they are **not light-theme proof**.

The new test helper reads the existing light declaration directly from `components/chrome/shared-shell/shared-shell.css` and scopes it to the tested panel. It checks that the actual `--panel` token changed and names captures **light-tokens**. It neither enables a feature flag nor changes production theme preference ownership. Full shell theme activation/release remains with the incumbent F01/F02/Options integration. The corrected Surface screenshots are in `surface-theme-correction/`; this materially corrected claim justified repeating that otherwise accepted browser path.

The light-token check also exposed presentation issues worth fixing locally: put marks now mix the existing neutral violet with the current text token for readable contrast, axes/grid retain visibility, conflict text uses readable ink, and provenance is no longer dim microtext. A phone column adjustment preserves full numeric strings while wrapping genuinely long values. Detailed explanatory copy is behind the source/method disclosure. No analytical value or source rule changed.

Run from `terminal/`:

```sh
npx vitest run lib/__tests__/volSkewExactValues.test.tsx lib/__tests__/volatilityMissingness.test.tsx lib/__tests__/volatilityConflictContinuity.test.tsx lib/__tests__/volatilityExpiryInvestigation.test.tsx
TERMINAL_E2E_PORT=3468 TERMINAL_VISUAL_EVIDENCE_OPERATION=d08b-surface-exact-values-20261104-c3 npm run test:e2e:responsive -- --config=docs/verification/d08b-vol-skew-exact-20261104/playwright.config.ts e2e/options-vol-skew-exact.spec.ts e2e/options-vol-exact-expiry.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
npm run build
```

The browser exercises the real Options route through its existing local fixture/auth seams, with a controlled volatility response. It does not prove live provider availability, deployed source clocks, production entitlements or actual account theme preference delivery. CSS `zoom:2` evidence is not native browser/text zoom or a complete 400% reflow audit.

An optional independent native source check passed at the exact blobs in `source-review.json`: selection/calculation retention, percentage units, exact numeric representation, range parity, missing/conflict behavior, semantic table structure and narrow-pane focus. It did not run tests, inspect screenshots or certify contrast/assistive-technology behavior. It is useful additional evidence, not a new formal gate.

### Program acceptance mapping

This slice adds bounded evidence for A10 (exact missing volatility expiry), part of A11 (smile source values/units/gaps), A14/A18 (keyboard exact path), A16/A17 (reachable controls and tested widths), A19 (locale/theme/non-color cues), A23 (ownership) and A24 (existing reader reuse). It does not claim full origin-to-contract-to-C continuity, rank/RR/IV–RV acceptance, whole-program performance, all specified responsive widths, native browser/text zoom, assistive-technology certification, released foundation or final D08 product acceptance.

## Publication and return boundary

The original managed workspace/publisher retains custody. Source, proof and the corresponding D08B design update will identify the published exact head by GitHub readback. No merge, Ready, un-draft, enqueue, held relabel or production deployment is authorized. No automatic watcher, duplicate runner or unknown modifying effect is represented as running. The accepted Surface proof and repaired B01 remain unchanged.
