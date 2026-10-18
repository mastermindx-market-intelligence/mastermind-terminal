# AI drawing workspace — joined-source browser evidence

This packet records the real Terminal frontend at source commit `c95d350f60764ba72a611a2be6d34202c98385a7`, after joining master `9f26d3a00dbaada3580706f7e059dd8eff682d7e`. The model transport and OHLCV are explicit fixtures. The host callback, command queue, native drawing renderers, study settings/visibility, mirrored state POST and AI-layer controls are the production implementations.

## Executed matrix

Eight executing tests passed, with no failures or flaky cases. Six cases cover English and Chinese at 1440×900, 820×1180 and 390×844. The other two run the full 24-command queue/cancellation test and raw-price Fibonacci-extension arithmetic on a logarithmic display. Those two viewport-independent cases are explicitly skipped on tablet and phone, accounting for the report's four skips.

The responsive composition combines a native channel, three-pivot Fibonacci extension, interpretive Elliott wave, reaction rectangle, price measurement, callout, and legacy compound channel. Assertions inspect real renderer nodes, exact custom Fibonacci prices, receiver capability count, indicator settings and effective visibility, per-child ACKs, and mirrored drawing identities. They exercise a hidden native module, an unrelated RSI configuration, and subsequent reveal without losing the original native settings.

The AI layer is below the indicator legend. Each case expands its inventory, deletes one child of a compound channel while preserving the sibling and human drawing, hides one construction, toggles global visibility without losing individual choices, removes another construction, and clears only AI drawings. The same cases check keyboard focus, touch target sizes, panel containment, horizontal overflow, and separation from chart wheel/Shift gestures.

## Artifacts and reproduction

`manifest.json` binds the actual capture time, source hashes, command, report hashes, fourteen PNGs, and fourteen mirrored-state attachments. `browser-report.json.gz` preserves the exact original 10,072,280-byte Playwright JSON report, including inline attachments; it is compressed to avoid committing a duplicate large text file. Each `*.mirrors.json.gz` is the exact decoded JSON attachment for convenient inspection. Decompress with Python's `gzip.decompress` or `gzip -dc`; hashes of both compressed and original report bytes are recorded.

Run from `terminal/`:

```bash
TERMINAL_E2E_PORT=3589 PLAYWRIGHT_JSON_OUTPUT_NAME=docs/pr-crops/chart-ai-drawing-workspace-20261018/browser-report.json npx playwright test e2e/brain-drawing-workspace.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line,json --max-failures=2 --retries=0
```

The repository Playwright configuration starts the existing local fixture server. The screenshots are real captures, not generated illustrations. Fixture anchors demonstrate execution semantics; they are not a validated market setup. The deliberately near-edge English callout is partly clipped by the existing native renderer. The model protocol requests short labels and interior text anchors, but this packet does not establish real-model placement quality.

## Qualification limits

The joined source also passed 30/30 existing Visual Intelligence browser cases and regenerated the existing PL6 and options-axis packets. All four source-bound evidence guards passed (14 assertions), followed by Next route type generation and TypeScript with no diagnostics. Required hosted CI and a deployed, ordinary-model showcase are separate release gates. Local fixture receipts alone do not prove live model selection, authentication, analytical correctness or production pixels.

The final recapture at 2026-10-18T12:04:33.495Z includes the send-time state preparation source and the current-master touch research-pane exit fix. All eight executing cases passed again, with the same four declared non-desktop skips, zero retries and zero flaky cases. The separate mounted callback and mirror preparation suites passed 20 assertions; the shared widget/gateway preparation behavior is qualified in Macro, not by the transport stub used in this packet.


## Hosted CI capacity repair

Hosted run `39121850650` at the earlier published head reached the existing 60-minute cap on desktop shard 1, which carried 415 tests. The Investigation save/readback test had a timed-out first attempt that recovered on retry; its unchanged component and test remain with their existing owner. This run does not establish complete desktop coverage.

The existing desktop matrix now has three complete `--shard=i/3` entries. The 60-minute limit, one CI worker, all project selections, separate dependency chain, artifact uniqueness, and required aggregate are preserved. The existing coverage guard, with its mutations derived from each project's actual shard total, passes all 22 tests. A real `CI=1 playwright test --project=desktop --list --reporter=json` inventory at this source contains 834 cases; the three selections contain 278 + 278 + 278, with disjoint identities and a complete union. The refreshed hosted run must still execute and pass them all.
