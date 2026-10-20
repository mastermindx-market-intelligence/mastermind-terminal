# Saved-view integrity — current source qualification

Source: `815753b3b2b71303ffeb8fcd376a8233d240d3b5`.

The real Next development route and Chromium exercise the existing in-memory fixture database. These are not live account/SQL/RLS or Theme Atlas integration receipts.

- TypeScript `tsc --noEmit --incremental false`: exit 0.
- Full native Vitest: 407 files; 6,642 passed; four pre-existing todo.
- Native Playwright: 24 passed across desktop, tablet and mobile in English and Chinese.
- Eighteen screenshots cover confirmed save, uncertain committed save, and original-request recovery.
- Native tests also cover unfinished initial reads, double-click prevention, reload, fixed/live definition round-trip, same-request reconciliation, changed-payload conflict, legacy isolation and retired-request rejection.

Three source-locked dependent capture sets were actually recaptured at this head after the initial full test run detected stale image/source bindings. Their 14 evidence checks passed and the complete suite then passed. No evidence hash was refreshed without the corresponding recapture.

Commands from `terminal/`:

```sh
./node_modules/.bin/tsc --noEmit --incremental false
node node_modules/vitest/vitest.mjs run --no-cache --pool=forks --maxWorkers=4 --minWorkers=1
TERMINAL_E2E_PORT=4311 node node_modules/@playwright/test/cli.js test e2e/saved-views-integrity.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
```

The earlier R12 evidence remains separately dated; these current captures do not retroactively change its provenance. Atomic concurrent account caps, deletion-receipt retention/rollback, independent review, hosted CI and real production verification remain release gates.
