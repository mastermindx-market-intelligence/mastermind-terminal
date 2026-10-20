# Recovered source integration — 2026-10-20

The original unpublished account-collection work at `c9bc709dd3fb06bb908f9d31a0f9a7151c4e6cbe` is reconciled with remote native-delete/history repairs at `fbc020358df9dc58193e74dacf42b07e6480444e`. Both histories and the pre-existing dirty evidence were preserved. This packet qualifies that intermediate reconciliation; newer master transactional recovery must still be integrated and qualified before release.

## Verification

- 272 focused unit tests passed across 12 files: account collection persistence, route validation, account-generation ownership, exact chart targeting, native AI controller edits, indicator state, command receipts and history navigation.
- Five actual browser cases passed without retries: desktop inspector, Delete and Backspace; tablet and phone inspector. Four non-desktop keyboard cases are explicitly skipped.
- Each browser case selects the real native SVG hit area, removes one compound child, checks sibling/unrelated/human preservation, verifies canonical saved and mirrored state, rejects an extra command receipt, and reloads without replaying commands. Desktop also checks human undo cannot resurrect the deleted AI child.
- Initial browser selection failed where a fixed sample coordinate lay under the live-step card. The corrected test finds an exposed native segment using `elementFromPoint`; it uses no forced or synthetic click. No product source was changed for that fixture issue.

The source hashes, exact compressed Playwright report and five actual captures are in this directory. Model transport, market bars and account HTTP transport are explicit fixtures. These receipts do not establish ordinary-provider analysis, actual account authorization, hosted CI, deployed bytes or live acceptance.

Reproduce from `terminal/`:

```bash
TERMINAL_E2E_PORT=3593 PLAYWRIGHT_JSON_OUTPUT_NAME=native-delete-browser.json npx --no-install playwright test e2e/brain-drawing-workspace.spec.ts --grep 'native AI' --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line,json --max-failures=2 --retries=0
```
