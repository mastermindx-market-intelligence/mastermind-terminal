# News reading sidebar — verified fixture evidence

The redesigned News rail uses the full available desktop sidebar, with a compact header, dated stories, optional publisher filtering, and expandable grouped reports. The company-detail board returns when the reader leaves News.

These captures use routed test news and a fresh Playwright browser context. They are local product evidence, not an authenticated production-session recording. The source revision, source hashes, image hashes, image dimensions and complete browser report are recorded in [EVIDENCE.yml](EVIDENCE.yml).

## Reading views and states

| Files | What they show |
| --- | --- |
| `desktop\|tablet\|mobile-{en,zh}-dark.png` | The production dark palette at 1440×900, 820×1180 and 390×844, with English and Chinese controls. |
| `desktop\|tablet\|mobile-{en,zh}-light-specimen.png` | The same panel with the existing News light token specimen. Terminal itself remains dark-only. |
| `desktop-{en,zh}-dark-context.png` | The full Terminal viewport, showing the News rail in context and the company board hidden. |
| `source-filtered-desktop-en-dark.png` | The visible feed narrowed to Reuters, captured while that filter is selected. |
| `grouped-open-desktop-en-dark.png` | A grouped story expanded with its original source links. |
| `full-height-scrolling-desktop-en-dark.png` | Ten fixture stories; the desktop feed scrolls inside the full-height panel. |
| `unavailable-{desktop,mobile}-{en,zh}-dark.png` | A failed snapshot shows an unavailable state without stale headlines. |

There are **21 PNG captures**. The light specimens use `docs/specimens/news-flow.light.css` and `data-specimen-theme="light"` on the News panel. They are visibly distinct token compatibility specimens, not an assertion that the production shell offers a light theme. The live marker is visible in every live matrix cell.

## Verified behavior

- **190 focused News unit tests pass across eight suites**, including accessible controls, safe source links, source filtering, date grouping, ticker races, group-error retry, absence of review-state writes, and linked/unlinked reports whose different publishers use the same article ID.
- Six regression cases cover removal and same-ID return, continuously corrected rows, late responses and request cleanup, and cached or pending detail that must survive an unrelated row's update. The two original removal/return tests failed against the old renderer before the correction. Cached detail, errors and pending requests now belong to the current canonical row revision. This guarantee covers revisions exposed by the canonical row; it does not invent a revision for invisible changes to grouped members.
- **TypeScript passes** on the captured source.
- **14 browser cases pass with no failures, retries or flaky cases.** Nineteen project combinations are intentionally skipped because each journey has an explicit viewport owner; the desktop-owned matrix itself sweeps all three widths, both languages and both palette treatments.
- The browser pass verifies that the lower company board hides while News is selected and returns on Watchlists, that the desktop list scrolls internally, that mobile keeps natural document flow, and that touch controls meet the 44px floor.
- The final browser log contains no duplicate-key warning. The old MSFT/AAPL fixtures now use distinct same-publisher article IDs; production group-member identity also includes the publisher, protecting legitimate cross-publisher ID reuse.
- The shared shell change also passed the existing **30-case Chart Context matrix** and its source/hash/report guard. That evidence is in [the existing Chart Context packet](../terminal-visual-intelligence/EVIDENCE.yml).
- The integrated shell was also recaptured with the incumbent **24-image B-PL-6 harness**. All 45 existing layout inputs and 12 harness inputs remain locked; the four B-PL-6 and three Chart Context evidence tests pass. The [B-PL-6 evidence](../b-pl-6-batch-1/EVIDENCE.yml) records the actual command and result.

The original failing regressions, corrected test results, source hashes and log hashes are recorded in [correction-checks.json](correction-checks.json).

The commissioning parent inspected the corrected source, verified all 21 image hashes and dimensions, and inspected all seven images whose bytes changed in this capture. Fourteen images are identical to the previously inspected matrix. At capture time, independent source review `terminal-news-sidebar-20261020-c4-review-001` was pending on published source `90619bdb19382de7eb037da5b282ba671f65afc9`, and the PR remained draft. The current acceptance and release record belongs to [PR #1081](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1081).

The earlier independent Fabric source-review run `terminal-news-sidebar-20261018-c4-review-001` lost controller custody and returned no verifiable result. Its original `EFFECT_UNKNOWN` state is preserved; that review has not been accepted or replayed. The new review covers the materially changed source and is a separate commission.

## Reproduction

From `terminal/`, the final browser command was:

```sh
TERMINAL_CROPS=1 TERMINAL_E2E_PORT=3238 \
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/terminal-news-sidebar-20261020-c4-news-report.json \
npx playwright test e2e/news-sidebar-reading.spec.ts e2e/ticker-news.spec.ts \
  --project=desktop --project=tablet --project=mobile \
  --workers=1 --retries=0 --max-failures=2 --reporter=line,json \
  --output=/tmp/terminal-news-sidebar-20261020-c4-news-artifacts
```

The report was copied here as [browser-report.json](browser-report.json) after the passing result was verified. The incumbent ticker-news spec also regenerates its older crop directory under `TERMINAL_CROPS=1`; those temporary outputs were restored to their historical committed versions. This directory owns the new sidebar evidence. Story times are pinned to `America/New_York`.

Source hashes identify the renderer and capture tests. Later evidence-only commits do not relabel a capture as having run against a different source.
