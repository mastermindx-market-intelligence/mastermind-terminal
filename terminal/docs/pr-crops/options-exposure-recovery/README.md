# Exposure workspace recovery — 2026-10-20

Synthetic browser captures from the connected Structure / Compare / Scanner workflow, including four shared-host price charts, shared timeframe, pane expiry overrides, full-screen comparison, stored-book selection and wrong-date archive rejection.
Desktop 1440×900, tablet 820×1180, phone 390×844; English and Chinese; shared light/dark appearances. These demonstrate interaction and visual behavior, not live data qualification or production acceptance.

The current source and source/contract tests remain in the normal PR. Existing owner reads provide the books, matrix, cross-market index, ranks and historical changes. No extra chart, scanner service or pricing engine is introduced.

Reproduce: `TERMINAL_E2E_PORT=3193 npm run test:e2e:responsive -- options-exposure-workspace.spec.ts options-exposure-map.spec.ts --workers=1`. Capture files are emitted under `test-results/`; copy accepted run images here.

The production upgrade remains open until protected CI, deployment and authenticated behavior are verified. Exact source qualification, nonlinear mechanics and empirical research have separate outstanding requirements.

Current checks: 31 map/desk/workspace cases passed (two duplicate viewport skips); the added four-chart workflow passed all six EN/ZH viewport cases; full-screen comparison passed both desktop language cases with all four panes inside the viewport. The complete shared chart-context matrix passed 30 cases. Dated Gamma is independently capability-gated and is not instantaneous or historical PIT evidence.
