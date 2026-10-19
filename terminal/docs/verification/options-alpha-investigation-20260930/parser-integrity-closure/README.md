# Measured parser integrity — same-carrier closure

Consumes #667 reviews 5355848878 and 5374424452. This is a parser and test change, not a new candidate or data owner.

The exact reference parser postimage is `602d8857064376cfd2c41459122f76aa72bd461c4330d5107997d1500b84573f`. It validates calendar dates and compares all supplied fractional timestamp digits, rejects contradictory zero-valid-quote measurements and unsafe integer counts, collapses equivalent IDs, and withholds every valid contradictory record for a conflicting ID within the current snapshot. Valid zero coverage, tiny rounded premiums, original timestamp text, distinct same-contract event IDs and source stale/refresh handling remain supported.

The accepted investigation component, view, CSS, watchlist API/service and source ownership are unchanged. The current-master merge preserves the shared cache refresh improvement. No candidate, score, direction, price threshold or publication clock is inferred.

## Verification

The original parser gives 12 failing / 16 passing focused assertions. The applied reference gives 28/28. The integrated whole Terminal suite passes 6,747 tests in 415 files, with four existing todo cases. TypeScript and scoped ESLint pass. All 54 native Next/Playwright cases pass at the three contract viewports, one worker and zero retries. Nine of those browser cases exercise duplicate/conflicting identity omission, nanosecond availability ordering/retention, and impossible-date/zero-quote contradiction rejection in the mounted investigation.

Run from `terminal/`:

```sh
npm test
npx tsc --noEmit
CI=1 TERMINAL_E2E_PORT=3397 npx playwright test e2e/options-alpha-investigation.spec.ts e2e/options-alpha-measured-evidence.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0
```

The receipt names the exact code tree and source/log digests. Logs remain under `/Volumes/Mastermind/agent-evidence/options-prophet-completion-20260929-sol/parser-integrity-closure/`. Existing UI screenshots are retained as prior evidence; these parser tests use declared synthetic events, not a new natural source observation.

Independent review, protected release and authenticated natural-source production acceptance remain separate and unclaimed. This does not relax the campaign/correction/AD-1T2 or scientific-promotion gates.
