# Flow selected-interval summary — C3 / C7 proof

## Outcome and scope

Selecting a Flow time bucket now exposes its exact New York date/time range, gross premium, contract volume, event aggregates and reported prints. A native disclosure separates call/put/unknown-type premium from estimated buy/sell/mixed/unclassified premium. The summary uses the existing filtered projection and withdraws when its selected bucket disappears. No adjacent bucket is substituted.

The interval region is bounded and scrollable so an expanded breakdown cannot consume the fixed feed area. Existing keyboard/touch selection, event-card expansion, exact print inspection, filters, coverage and held-feed receipts remain reachable.

This is one independent slice of the [Options completion programme](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/f77799f69ff227ad3d241cfa3f2c12de554e49d1/docs/OPTIONS_SUITE_COMPLETION_2026-11-14.md). Organisational continuity is proposed in [Macro #11260](https://github.com/mastermindx-market-intelligence/macro/pull/11260), exact records head `42e3b326ea2a3ab533ad808c911a046103542574`. Neither this slice nor those records complete the programme.

## Source and custody

- Protected Mastermind procedure: `199fd4f91ecc426b1d974eb3bf47f5162476cf24`.
- Terminal input: `e109b0e07af4d6c400c99ff9ed98f17306c570d2`.
- Operation: `options-flow-interval-summary-20261114-c3`.
- Branch: `sol/web-options-flow-interval-summary-20261114-c3`.
- Product: `terminal/components/flowdesk/FlowProjectionStrip.tsx` and its new local CSS module.
- Tests: incumbent `flowProjectionControls.test.tsx` and `flow-projection.spec.ts`.
- Existing projection, FeedPane selection/filter owner, feed transport, scoring, persistence, saved views and shell owners are reused.
- Source/path census found no intersection with held #1248, #804, #781, #799, #686, #661, #1266 or concurrent shared-shell #1509. The original #687 projection is accepted input, not rebuilt.
- Principal implemented and self-checked under the current Web review waiver and retained NO_ELIGIBLE_PRE_EFFECT_WORKER / LOWER_TOTAL_OVERHEAD exception. Native advisors performed reasoning only; no independent-approval claim is made.

The first workspace acquisition returned NOT_APPLIED/REPOSITORY_SOURCE_UNAVAILABLE. After the exact base object became readable in the original owner's environment, one bounded same-operation acquisition returned WORKSPACE_ACQUISITION_UNQUALIFIED. Same-owner status reconciled the actual clean workspace, exact base and operation on the installed storage volume. No third acquisition or alternative publisher was used.

## Proof results

| Check | Result |
| --- | --- |
| Meaningful unit baseline, before implementation | 12 cases: 5 passed, 7 failed |
| Final projection + mounted controls units | 64 passed, 0 failed, 0 skipped, across two files |
| Classic Options browser deployment | 12 passed: EN/ZH × three viewports × selection/inspection and held-feed journeys |
| Existing Shared Shell browser deployment | 18 passed: EN/ZH × dark/light selection/inspection plus two held-feed journeys per viewport |
| Final focused ESLint | exit 0 |
| Final full TypeScript check | exit 0 |
| Final whitespace/diff check | exit 0 |

The 30 final browser cases cover desktop 1440×900, tablet 820×1180 and mobile 390×844. They activate bucket controls by keyboard and pointer/touch, verify all summary quantities, reach every expanded breakdown value, then select an actual event card and inspect its canonical identity/premium calculation. Changing interval or clearing selection removes the summary without losing the search filter. Loaded-feed coverage remains separate from the selected-interval population. Held feeds preserve their reason and last-read projection.

Selected W3A fixture arithmetic is explicit: the 10:40–10:45 EDT interval contains two event aggregates, seven reported prints, 12,000 contracts and $720,000 gross premium. The separate six-event interval contains $1,671,000. Units also cover decimal premium, unknown type/side, invalid negative values, genuine zero quantities, vanished selection, different dates with the same local clock, the repeated daylight-saving hour, and midnight-crossing intervals.

## Defects caught and corrected during verification

1. The host default Node 26 test environment lacked the expected localStorage method. That initial setup failure is retained as `unit-environment-error.json` and is not counted as a product regression. Subsequent before/after runs used the existing verified Node 22 binary.
2. The first desktop browser run had four failed interaction cases because the expanded summary left event cards outside the reachable feed area. The bounded-scroll CSS fixes that actual layout defect. The failed log is retained.
3. The initial browser test changed only `data-theme`; classic Options does not enable light tokens without the incumbent appearance owner. Those early “light” labels did not prove light rendering. Final tests use `mmx.shell.theme` through the existing Shared Shell owner, assert its marker and theme, and check the summary's computed background colour. Classic deployment runs dark only. Earlier interaction-only runs are not added to the final 30-case count.

Final runtime process 41043 exited 0 in 194.83 seconds: shared browser 64.65s, classic browser 42.89s, ESLint 3.34s, TypeScript 83.63s. Empty lint/typecheck logs mean no diagnostics; their success is supported by the retained execution receipt, not inferred from empty files.

## Reproduction

All commands ran from the operation's `terminal/` directory with locked dependencies. The existing Node binary was:

```text
/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-conflict-successor/.pr1275-conflict-runtime/node-v22.23.4-darwin-arm64/bin/node
SHA256 2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0
```

It was executed in place; that older workspace was not modified. Its bin directory was prepended only to child-process PATH.

```sh
node node_modules/vitest/vitest.mjs run lib/__tests__/flowProjection.test.ts lib/__tests__/flowProjectionControls.test.tsx --reporter=json
MMX_SHARED_SHELL=1 TERMINAL_E2E_PORT=3190 TERMINAL_VISUAL_EVIDENCE_OPERATION=options-flow-interval-summary-20261114-c3 node node_modules/@playwright/test/cli.js test e2e/flow-projection.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line --output=test-results/flow-interval-shared-final-20261114
MMX_SHARED_SHELL=0 TERMINAL_E2E_PORT=3190 TERMINAL_VISUAL_EVIDENCE_OPERATION=options-flow-interval-summary-20261114-c3 node node_modules/@playwright/test/cli.js test e2e/flow-projection.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line --output=test-results/flow-interval-classic-final-20261114
node node_modules/eslint/bin/eslint.js components/flowdesk/FlowProjectionStrip.tsx lib/__tests__/flowProjectionControls.test.tsx e2e/flow-projection.spec.ts
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Browser suites used the existing W3A feed fixture through the real Desk/EventSource/poll consumers. The isolated test port was not allowed to reuse another operation's server. Shared Shell was enabled only for the local browser process; no deployed feature flag or account preference was changed.

## Visual evidence and limits

Nine unchanged browser captures are retained with origin paths and SHA256 identities in `captures-manifest.json`. Principal inspected the final classic desktop compact view, Shared Shell desktop/tablet light compact views, mobile ZH light compact view and mobile EN dark expanded breakdown. Additional captures preserve ZH desktop and mobile inspector states. Expanded screenshots show the actual scrolled region; they are not stitched full-content renders.

This proves deterministic mounted behaviour and rendered presentation with explicit fixtures. It does not prove real-time vendor coverage, paid-account entitlement, live source availability, production installation or human comprehension. Market status and source timestamps visible in the fixture captures remain dated.

Protected CI, native queue admission, merge, existing deployment-owner execution and an entitled production browser journey remain separate acceptance steps. The full C1–C7 mission is active. The original D08B uncertain push and installed C3 publisher dependency, #1248 uncertain publication, payoff/statistics review holds and Investigation persistence restrictions remain fenced; this work does not clear them.
