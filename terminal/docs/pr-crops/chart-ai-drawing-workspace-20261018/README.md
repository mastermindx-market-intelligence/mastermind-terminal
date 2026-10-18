# AI drawing workspace — joined-source browser evidence

This packet records the real Terminal frontend at source commit `7f0da48b8a7ec87af09100f23c5f734c41797352`, after joining master `367f488e5c67d0871d4a34c2aa7371f327d44c3d`. The model transport and OHLCV are explicit fixtures. The host callback, command queue, native drawing renderers, study settings/visibility, mirrored state POST and AI-layer controls are the production implementations.

## Executed matrix

Eight executing tests passed, with no failures or flaky cases. Six cases cover English and Chinese at 1440×900, 820×1180 and 390×844. The other two run the full 24-command queue/cancellation test and raw-price Fibonacci-extension arithmetic on a logarithmic display. Those two viewport-independent cases are explicitly skipped on tablet and phone, accounting for the report's four skips.

The responsive composition combines a native channel, three-pivot Fibonacci extension, interpretive Elliott wave, reaction rectangle, price measurement, callout, and legacy compound channel. Assertions inspect real renderer nodes, exact custom Fibonacci prices, receiver capability count, indicator settings and effective visibility, per-child ACKs, and mirrored drawing identities. They exercise a hidden native module, an unrelated RSI configuration, and subsequent reveal without losing the original native settings.

The AI layer is below the indicator legend. Each case expands its inventory, deletes one child of a compound channel while preserving the sibling and human drawing, hides one construction, toggles global visibility without losing individual choices, removes another construction, and clears only AI drawings. The same cases check keyboard focus, touch target sizes, panel containment, horizontal overflow, and separation from chart wheel/Shift gestures.

## Artifacts and reproduction

`manifest.json` binds the actual capture time, source hashes, command, report hashes, fourteen PNGs, and fourteen mirrored-state attachments. `browser-report.json.gz` preserves the exact original 10,290,745-byte Playwright JSON report, including inline attachments; it is compressed to avoid committing a duplicate large text file. Each `*.mirrors.json.gz` is the exact decoded JSON attachment for convenient inspection. Decompress with Python's `gzip.decompress` or `gzip -dc`; hashes of both compressed and original report bytes are recorded.

Run from `terminal/`:

```bash
TERMINAL_E2E_PORT=3589 PLAYWRIGHT_JSON_OUTPUT_NAME=docs/pr-crops/chart-ai-drawing-workspace-20261018/browser-report.json npx playwright test e2e/brain-drawing-workspace.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line,json --max-failures=2 --retries=0
```

The repository Playwright configuration starts the existing local fixture server. The screenshots are real captures, not generated illustrations. Fixture anchors demonstrate execution semantics; they are not a validated market setup. The deliberately near-edge English callout is partly clipped by the existing native renderer. The model protocol requests short labels and interior text anchors, but this packet does not establish real-model placement quality.

## Qualification limits

The joined source also passed 30/30 existing Visual Intelligence browser cases and regenerated the existing PL6 and options-axis packets. All four source-bound evidence guards passed (14 assertions), followed by Next route type generation and TypeScript with no diagnostics. Required hosted CI and a deployed, ordinary-model showcase are separate release gates. Local fixture receipts alone do not prove live model selection, authentication, analytical correctness or production pixels.
