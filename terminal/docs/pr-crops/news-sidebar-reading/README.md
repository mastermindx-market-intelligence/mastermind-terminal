# News reading sidebar — verified fixture evidence

The redesigned News rail uses the full available desktop sidebar, with a compact header, dated stories, optional publisher filtering, and expandable grouped reports. The company-detail board returns when the reader leaves News.

These captures use routed test news and a fresh Playwright browser context. They are local product evidence, not an authenticated production-session recording. Source revisions, source hashes, image hashes, dimensions and the complete browser report are recorded in [EVIDENCE.yml](EVIDENCE.yml).

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

There are **21 PNG captures**. The light specimens use `docs/specimens/news-flow.light.css` and `data-specimen-theme="light"` on the News panel. They are token compatibility specimens, not an assertion that the production shell offers a light theme. The live marker is visible in every live matrix cell.

## Verified behavior

- **204 focused News unit tests pass across eight suites**, including accessible controls, safe source links, filtering, date grouping, ticker races, group-error retry, absence of review-state writes, and reports whose different publishers use the same article ID.
- Six earlier regressions cover removal and same-ID return, continuously corrected rows, late responses and request cleanup, and valid detail surviving an unrelated row's update. The two original removal/return tests failed before the repair. Cached detail, errors and pending requests belong to the current canonical row revision. Invisible changes to grouped members still require an exposed canonical revision.
- Fourteen additional regression/control cases cover out-of-order dates in EN/ZH, stable ordering for equal displayed times, publisher removal and return, pending/failed/stale refreshes, and safe single-pass entity decoding in headlines, teasers and linked/unlinked reports. Nine of the new cases failed against the previous renderer before the correction; the other five controls already passed.
- Display sorting uses the existing `updated_at || published_at || received_at` precedence and a copied array. This makes date headings consistent with displayed times; it does not claim that every update is an original publication or a substantive correction.
- Common named entities and valid numeric Unicode entities decode once into React text. Unknown or malformed entities stay visible, encoded markup stays inert, and raw source strings and URLs are retained. A teaser equivalent to the displayed title is omitted.
- **TypeScript passes**. The 204-test and typecheck runs were repeated after integrating protected Terminal base `d943b0c12221b8e640145eca0d63d0971217849f`, at integrated source `3e88ee5c15f9b414dc2d846f661a8a75b0048043`.
- **14 browser cases pass with no failures, retries or flaky cases.** Nineteen project combinations are intentionally skipped because each journey has an explicit viewport owner; the desktop-owned matrix itself sweeps all three widths, both languages and both palette treatments.
- The browser pass verifies company-board hiding and return, internal desktop scrolling, natural mobile document flow, and the 44px touch-control floor. Its log contains no duplicate-key warning.
- The existing **30-case Chart Context capture** and **24-image B-PL-6 capture** remain applicable: their exact locked inputs are unchanged by this correction or protected-base integration. All 45 B-PL-6 layout inputs and 12 harness inputs remain locked. The four B-PL-6 and three Chart Context evidence tests pass. See [Chart Context](../terminal-visual-intelligence/EVIDENCE.yml) and [B-PL-6](../b-pl-6-batch-1/EVIDENCE.yml).

[correction-checks.json](correction-checks.json) retains the original report-lifetime repair evidence and records the new failing regressions, integrated green results, source hashes, capture result and log hashes.

The parent verified all 21 image hashes and dimensions and inspected all five images whose bytes changed in this capture. Sixteen images are identical to the previously inspected matrix. The capture ran on clean, committed source `6fe44d2a2ea17b49d0cecfebf6466d06fc114d4c`. Every recorded News input remains identical at integrated source `3e88ee5c15f9b414dc2d846f661a8a75b0048043`; the integrated protected base changed 17 separate files.

Independent review `terminal-news-sidebar-20261020-c4-review-001` was accepted as a review with findings on earlier source `90619bdb19382de7eb037da5b282ba671f65afc9`. Its evidence finding was resolved in `bfa61ae8b48e7aba641ceddaf04543c13574bca2`; the date, publisher and obsolete-comment findings are corrected in this source. The new renderer/helper changes require a separate focused review. The current review, CI and release record belongs to [PR #1081](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1081).

The earlier independent run `terminal-news-sidebar-20261018-c4-review-001` returned no verifiable result. Its original `EFFECT_UNKNOWN` state is preserved; that review has not been accepted or replayed.

## Reproduction

From `terminal/`, the browser command was:

```sh
TERMINAL_CROPS=1 TERMINAL_E2E_PORT=3238 \
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/terminal-news-sidebar-20261020-c4-review-delta-news-report.json \
npx playwright test e2e/news-sidebar-reading.spec.ts e2e/ticker-news.spec.ts \
  --project=desktop --project=tablet --project=mobile \
  --workers=1 --retries=0 --max-failures=2 --reporter=line,json \
  --output=/tmp/terminal-news-sidebar-20261020-c4-review-delta-news-artifacts
```

The report was copied here as [browser-report.json](browser-report.json) after the passing result was verified. The incumbent ticker-news spec also regenerates its older crop directory under `TERMINAL_CROPS=1`; those 11 temporary outputs were restored to their historical committed versions. This directory owns the new sidebar evidence. Browser story times use `America/New_York`.

Source hashes identify the renderer, display helper and capture inputs. Later evidence-only commits do not relabel a capture as having run against a different source.
