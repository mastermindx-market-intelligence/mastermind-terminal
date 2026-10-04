# Options Alpha investigation workflow

This is implemented source on the existing Terminal #667 carrier, not a new
candidate engine and not a production or predictive-performance acceptance.

## User-visible capability

Measured source activity remains accessible when the independent legacy shadow
projection is unavailable. Search covers all events in the loaded snapshot rather
than only the first six cards. Each event opens an accessible bilingual detail
view with preserved source identity, measured coverage and original clocks.
The user can open the existing underlying chart and save the underlying into a
selected owned watchlist through the existing API. No signal, trade, option
position, automated alert, candidate, outcome or scoring authority is created.

A save is reported only after inventory readback confirms the symbol in that exact
list. Lost/error responses are reconciled by reading, not by repeating the POST.
Shared/read-only lists cannot become writable targets. Older read responses cannot
overwrite a newer verified save. Open evidence survives empty-source refreshes.

## Verification

- Native Next/Playwright: 45 cases passed, one worker, no retries, three viewports.
- Native watchlist POST/GET/service logic exercised with the incumbent isolated
  fixture database; API behaviour is not mocked in the end-to-end save/reopen case.
- Underlying chart opened on the native /terminal route with the correct symbol.
- Full Terminal Vitest: 407 files, 6,633 passed and four existing todo.
- TypeScript and scoped ESLint: passed.
- The new outage/search tests failed on the original code. Separate discriminating
  cases reproduced open-observation loss, invisible action text, and late-read
  overwrite of a verified save before each corresponding repair.

Commands from terminal/:

```sh
npm test
npx tsc --noEmit
npx eslint components/prophet/OptionsAlphaInvestigation.tsx components/prophet/OptionsAlphaView.tsx e2e/options-alpha-investigation.spec.ts
CI=1 TERMINAL_E2E_PORT=3395 npx playwright test e2e/options-alpha-investigation.spec.ts e2e/options-alpha-measured-evidence.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0
```

Screenshots are the running local app with declared synthetic source events.
The verified Observatory palette is dark in EN/ZH. A root light-theme attribute
probe did not alter this surface's palette; it is not light-mode proof and no
global theme rule was changed. Existing user-path tests, not screenshots alone,
prove save/readback, missing-source isolation, snapshot retention and navigation.

## Release and scientific boundary

Current-head independent review, permitted hosted release checks and authenticated
post-release user-path verification remain owed. The previous action-specific
safety holds are not bypassed. No merge, deploy, production collection, historical
ledger rewrite, fitted model or synthetic-performance claim occurred. Candidate
formation and outcome pipeline gates remain with their incumbent Macro owners.

Protected procedure: Mastermind 0c75bc308da39c099b42f10e30741bec416b5afc.
Exact source/image/log hashes are in receipt.json. Detailed logs remain under
/Volumes/Mastermind/agent-evidence/options-prophet-completion-20260929-sol/.
