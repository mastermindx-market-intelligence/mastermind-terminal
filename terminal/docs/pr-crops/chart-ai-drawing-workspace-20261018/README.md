# AI drawing workspace — joined-source browser evidence

This packet records the real Terminal frontend at source commit `c41f3578883fd77b48d99b8abef8bba3962d6cf1`, after joining master `3e0be25bfc1393d75684a9ebb97dacf2fbf2c5d9`. The model transport and OHLCV are explicit fixtures. The host callback, command queue, native drawing renderers, study settings/visibility, mirrored state POST and AI-layer controls are the production implementations.

## Executed matrix

Nine executing tests passed, with no failures, retries or flaky cases. Six cases cover English and Chinese at 1440×900, 820×1180 and 390×844. The other three exercise the full 24-command queue/cancellation behavior, raw-price Fibonacci-extension arithmetic on a logarithmic display, and independent RSI instances through a human template revision. Those three viewport-independent cases run on desktop and are explicitly skipped on tablet and phone, accounting for the report's six skips.

The responsive composition combines a native channel, three-pivot Fibonacci extension, interpretive Elliott wave, reaction rectangle, price measurement, callout, and legacy compound channel. Assertions inspect real renderer nodes, exact custom Fibonacci prices, receiver capability count, canonical indicator settings, effective visibility, per-child ACKs and mirrored drawing identities. They exercise a hidden native module and subsequent reveal without losing its original settings.

The RSI assertions now compare the actual plotted series and Data Window against an independent Wilder calculation, including changes from length 21 to 34. The additional template case preserves separate RSI lengths 9 and 7, keeps a hidden sibling through an unrelated Bollinger Bands edit, refuses the unknown `len` key without changing settings, and edits only the exact second RSI to length 21. Applying a human template invalidates queued commands addressed to the previous chart state.

The AI layer is below the indicator legend. Each responsive case expands its inventory, deletes one child of a compound channel while preserving the sibling and human drawing, hides one construction, toggles global visibility without losing individual choices, removes another construction, and clears only AI drawings. The same cases check keyboard focus, touch target dimensions including Chinese labels, panel containment, horizontal overflow, and separation from chart wheel/Shift gestures.

## Artifacts and reproduction

`manifest.json` binds the actual capture time, nineteen source hashes, command, report hashes, fifteen PNGs and fifteen mirrored-state attachments. `browser-report.json.gz` preserves the exact original 10,701,747-byte Playwright JSON report, including inline attachments; it is compressed to avoid committing a duplicate large text file. Each `*.mirrors.json.gz` is the exact decoded JSON attachment for convenient inspection. Decompress with Python's `gzip.decompress` or `gzip -dc`; hashes of both compressed and original report bytes are recorded.

Run from `terminal/`:

```bash
TERMINAL_E2E_PORT=3589 PLAYWRIGHT_JSON_OUTPUT_NAME=docs/pr-crops/chart-ai-drawing-workspace-20261018/browser-report.json npx playwright test e2e/brain-drawing-workspace.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line,json --max-failures=2 --retries=0
```

The repository Playwright configuration starts the existing local fixture server. The final capture began at 2026-10-19T00:18:21.099Z and ran for 180,919.784 ms. The screenshots are actual browser captures. Fixture anchors demonstrate execution semantics; they are not a validated market setup. The deliberately near-edge English callout is partly clipped by the existing native renderer. The model protocol requests short labels and interior text anchors, but this packet does not establish real-model placement quality.

## Qualification and limits

The joined source passed TypeScript and the binding added-language check. The full local unit run recorded 13,267 passes, four existing todo cases and four failures confined to stale source-bound evidence locks. Their four incumbent owners then actually regenerated 41 captures: PL6 batch 1 (24), Conductor fit badge (6), Visual Intelligence (6, with all 30 browser cases passing) and options-axis labels (5). All seventeen assertions across those four evidence guards now pass. Required hosted CI must qualify the final published artifact head; this sequence is not relabeled as a fresh full local suite pass.

The previous eight-case capture remains explicitly historical in the manifest. It did not establish canonical built-in RSI calculations. The current packet includes that missing proof and verifies geometry remains readable when optional parameter documentation is omitted under the mirror byte budget.

The separate send-time preparation and shared-widget/gateway checks are recorded in the paired Macro workstream; the model transport stub in this packet does not exercise the ordinary provider. Required hosted CI, coordinated deployment and an ordinary-model live showcase remain separate release gates. Local fixture receipts alone do not prove live model selection, authentication, analytical correctness or production pixels.

The following sections preserve earlier CI diagnoses and repairs as history. Their source identities and test inventories are not new qualifications of the current candidate.

## Historical hosted CI capacity repair

Hosted run `39121850650` at the earlier published head reached the existing 60-minute cap on desktop shard 1, which carried 415 tests. The Investigation save/readback test had a timed-out first attempt that recovered on retry; its unchanged component and test remain with their existing owner. This run does not establish complete desktop coverage.

The existing desktop matrix now has three complete `--shard=i/3` entries. The 60-minute limit, one CI worker, all project selections, separate dependency chain, artifact uniqueness, and required aggregate are preserved. The existing coverage guard, with its mutations derived from each project's actual shard total, passes all 22 tests. A real `CI=1 playwright test --project=desktop --list --reporter=json` inventory at that earlier source contains 834 cases; the three selections contain 278 + 278 + 278, with disjoint identities and a complete union. The refreshed hosted run must still execute and pass them all.


## Historical Conductor bilingual routing follow-up

At d731e1e4cf85a753bdf00f44819ffb848343ba36, hosted run 39127614959 passed all 12,547 unit tests across 755 suites (four existing todo cases). Its following plain-language step rejected four inline bilingual Conductor labels because they did not use a recognized translation route. Commit 96ffe8df4644ed4a03e16f19e21740d620077a3f routes the same English/Chinese pairs through the existing shared `pick` selector; it changes no displayed wording or chart behavior. The checker now reports zero blocking findings.

The two affected capture owners actually regenerated their six and sixteen captures at 96ffe8df. Their source closures now include the imported selector. All 40 existing Conductor and evidence assertions pass, as do fresh Next route generation and TypeScript. The core drawing-workspace source files bound by this packet are unchanged; the newer Conductor captures and hashes are in `../conductor-fit-badge-zh/` and `../b-pl-6-batch-2/`. A new full hosted run still needs to qualify the final published head; the preceding run is not counted as a successful release.
