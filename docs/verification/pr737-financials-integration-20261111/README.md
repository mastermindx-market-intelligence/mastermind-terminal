# PR737 Financials integration proof — 2026-11-11

The current-master composition fixes screenshot retention in the two existing Financials capture sites. Each screenshot is written to its test-owned output path and that file is attached, so the existing GitHub reporter/test-results upload retains it. No fixture, assertion, timeout, retry, financial calculation, product component or workflow was changed by this repair.

## Exact input and result

- Original branch head: `56230d1835911ac18da974ef028ec53b7068cab1`.
- Protected composition base: `18fabe9d3c1439c4185559ba5ce491518fe999c9`.
- Actual tested source tree: `6b1899d6b20b696aa1e5cbb89469aa83a7f47543`, independently recreated through GitHub Git objects.
- Scoped lint, Next type generation and full TypeScript all passed.
- Existing focused browser cases: **7 passed / 2 existing mobile-only skips / 0 failures / 0 flakes**, one worker and zero retries.
- The6649 tracked TS/JS/JSON/CSS/YAML input hashes remained unchanged across browser execution.
- Playwright's existing server owner returned; port57728 was closed and the Next lock had no open handles. The inert lock pathname still existed; no cleanup success beyond those observations is claimed.

## Captures

These are the four actual frames from this run. File bytes were read back independently and matched their recorded SHA256 values. All four were visually inspected.

| Frame | Viewport | File |
| --- | --- | --- |
| Desktop EN | 1440×900 | [desktop-en](captures/desktop-en.png) |
| Tablet EN | 820×1180 | [tablet-en](captures/tablet-en.png) |
| Mobile EN | 390×844 | [mobile-en](captures/mobile-en.png) |
| Mobile ZH | 390×844 | [mobile-zh](captures/mobile-zh.png) |

The semantic tests also check missing-metric period alignment on each viewport. The two skipped cases are the unchanged mobile-only bilingual case on desktop/tablet; they are not hidden failures.

## Evidence and limits

[receipt.json](receipt.json) binds the exact tree, changed-source blobs, source snapshot digest, named outcomes, capture digests, visual observations and environment-recovery facts. [browser-report.json](browser-report.json), [browser.log](browser.log), [browser-execution.json](browser-execution.json), and [checks.json](checks.json) retain the observed execution records.

This is the existing loopback Financials fixture journey, not production authentication or installed financial data. September captures remain dated historical records. The older all-green run42866082633 stays valid for its actual checkout, but its in-memory Financials frames were never persisted. The205 previously accepted financial cases are attributed to unchanged financial source, not represented as newly run.

The newly changed spec passes its diff check. Five pre-existing blank-line-at-EOF findings in untouched Financials source/test files are disclosed in the receipt. Normal exact-head required CI, native queue, deployment and live acceptance still apply.

Parent duty: [Mastermind2028](https://github.com/mastermindx-market-intelligence/Mastermind/issues/2028#issuecomment-6790462232). Source claim: [PR737 comment6791103971](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/737#issuecomment-6791103971).
