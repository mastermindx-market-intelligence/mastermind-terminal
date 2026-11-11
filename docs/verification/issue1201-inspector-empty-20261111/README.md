# Issue #1201 — Inspector empty-state layout proof (N3)

## Outcome

The existing Inspector empty-state title and explanation previously shared a horizontal flex row, squeezing the English title into a narrow vertical column. The complete product change adds two declarations to `.obs-insp-empty` in `terminal/app/observatory.css`:

```css
flex-direction: column;
gap: 8px;
```

Existing markup, translations, tokens, widths, selected-event behavior and surrounding layout remain unchanged.

## Qualified source and authority

- Original operation: `terminal-pr-duty-20261111-1201-c3`.
- Source base: `ffcc39bcdf89cb19b08444b8bb64cadbc1a3a5ec`.
- CSS original blob: `0c7ff826df0655c5016fcb6be838971bc4f4531a`.
- CSS qualified blob: `f2498634f1c3964a0bdf57fd2cf38562f53e6565`.
- CSS SHA-256: `b31919527c21e991e0be91129b72ddfa6c4166baf74c6ce817e625466a216c06`.
- Unchanged Inspector component blob: `ca8d2cb60ef970e6bc3576f71c8251387c812bdd`.
- Qualified harness SHA-256: `dba92e525848b71f3137aca37187f3d17d9a6cd0588b85e65381cffc1cace0b0`.
- The original CSS blob still matches protected master `74c007125129090cc762f2bc4b1b152123326444`; no base refresh was needed for this source.
- Continuation: [issue #1201 N3 pickup](https://github.com/mastermindx-market-intelligence/mastermind-terminal/issues/1201#issuecomment-6789885031).
- Parent mission: [Mastermind #2028](https://github.com/mastermindx-market-intelligence/Mastermind/issues/2028).
- Procedure pin: `dae5a4622f560b7cc470f3f6614a69a3784a323d`.

## Actual browser matrix

The final matrix passed **8 of 8 cases**, with no skips, unexpected failures, flaky cases, retries, report errors or page errors:

| Theme | Language | Viewport | Context |
| --- | --- | --- | --- |
| Dark | English / Chinese | 1440 × 900 | Chromium, touch disabled |
| Dark | English / Chinese | 390 × 844 | Chromium, touch enabled |
| Light | English / Chinese | 1440 × 900 | Chromium, touch disabled |
| Light | English / Chinese | 390 × 844 | Chromium, touch enabled |

Every case ran under the existing **desktop** Playwright project with explicit suite-level viewport and `hasTouch` overrides. These are touch-enabled 390px Chromium contexts, not additional executions of the configured mobile project or physical-device tests. The receipt’s `hasTouch` field records context configuration rather than an independent hardware measurement.

Dark cases use the default shell. Light cases use the existing Shared Shell and its actual public appearance/language controls. The route is `/options?tab=desk`, using the existing synthetic `options-r1-w3a-flow.json` fixture. No account creation, sign-in, entitlement override or account-metadata write was performed.

The harness asserts actual FD title/explanation translations, theme and language, empty-state presence, card and text containment, vertical ordering, spacing and no page overflow. It scrolls the entire card into the existing horizontal rail before measuring. Dark English desktop and phone cases also select the real fixture $504K event and check the selected class, visible print Inspector, disappearance of the empty state, bounded width and no page overflow.

All eight saved receipts show column layout, exactly **8px** between title and explanation, explanation width **276px desktop / 266px phone**, and zero explanation/page horizontal overflow. Phone cards retain their existing **300 × 340px** size. Their outside edge is 1px beyond the rail’s measured right edge, within the explicit harness tolerance; text remains inside the padded card.

## Saved proof and visual review

- `qualified-dark-report.json`: 4 passed, 0 skipped/unexpected/flaky.
- `qualified-light-report.json`: 4 passed, 0 skipped/unexpected/flaky.
- `qualified-matrix-execution.json`: actual commands, source/harness identities, run times, closed owned ports and temporary-spec removal.
- `qualified-dark/` and `qualified-light/`: eight actual PNGs with adjacent geometry/source/image-hash JSON receipts.
- `qualified-typecheck.json` and its log: qualified harness typecheck exit 0.
- `capture-qualified-v2.spec.ts`: the exact qualified harness.

For execution, the harness was temporarily installed at `terminal/e2e/issue1201-inspector-empty-capture.spec.ts` so its imports and root resolution used the existing Playwright configuration, global setup and server owner. That temporary file was removed after the settled runs. The archived documentation copy is not intended to execute directly from this directory.

The final dark run exited 0 in 58.434s and closed port 60184. The final light run exited 0 in 84.133s and closed port 60703. All twelve recorded source hashes remained stable and match the current files. All eight PNG hashes match their receipts.

Root visually inspected every final PNG: the title sits above readable explanation copy in both languages, themes and widths; no clipped or one-word vertical title remains. The existing tall phone card is retained. A read-only reasoning audit independently checked reports, source/image hashes, geometry and the current diff; it is not a formal GitHub approval.

## Retained diagnostic attempts

The earlier artifacts remain intact and are not counted as qualified passes:

1. The first baseline harness tried the signed-in Settings path in a guest context and reached signup instead of appearance preferences. It stopped before a product change.
2. The next baseline used the public appearance controls but looked up Inspector copy through the wrong translation namespace. Its failure screenshot visibly shows the original narrow-column title; that image is a diagnostic baseline, not a passing baseline case.
3. The first postimage harness reached the corrected layout and selected-event state, then the strict page-error assertion caught its own pre-document language initializer accessing a missing document root. One case failed and three were not run; the light phase did not start. The final harness guards that initializer and retains the strict page-error assertion.

Each attempt’s distinct harness, raw reports/logs and lifecycle receipts remain in the packet. `inventory.json` hashes the saved packet files except itself.

## Scope and delivery boundary

This is synthetic fixture UI proof. It does not claim provider-data validation, production deployment or an authenticated live Options journey. The available production browser currently presents the Essential/Pro access gate; an entitled session is needed for that separate acceptance step.

The companion [B9 packet](../issue1201-chainheat-interception-20261111/README.md) records nine positive cases and the two intentionally failing wrong-path discriminator cases. The accepted B9 source remained unchanged throughout N3 work. Existing W3, unknown-truth, GMI and other proof packets were preserved.

Natural PR CI, protected merge-group qualification, merge/deployment and issue closure remain separate outcomes. Root contributed source and therefore records self-review only, without self-approval.
