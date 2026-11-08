# P18.T1 formed candidate to underlying chart

Local source acceptance, November 5, 2026. Synthetic server-response fixtures; no live candidate, provider acquisition, authentication, activation or production browser proof.

The formed SPY candidate opens `/terminal?symbol=SPY` in a new tab with no opener. Closing it preserves the originating candidate text, revision and URL. The action is at least 44px high, keyboard focusable and produces no horizontal document overflow. Missing, invalid-ticker and wrong-revision campaign context withholds the action. The source uses only the existing normalized frozen campaign context.

`npm run test:e2e:responsive -- options-alpha-candidate-chart.spec.ts --workers=1 --project=desktop --project=tablet --project=mobile`: 15 passed, no retries. EN/ZH at 1440x900, 820x1180 and 390x844, including data-theme attribute compatibility. The six captures below show the actual legacy dark surface; light attribute cases do not establish a light art direction.

82 affected unit cases and `npx tsc --noEmit` pass. Spec and string-file lint pass. Component lint reports an inherited `react-hooks/set-state-in-effect` error at unchanged `fetchOnce()`; linting the immutable base via stdin reproduces it.

Initial retained RED: the supplied action inherited a 26px chip; a scoped 44px minimum and focus outline repair it. The local SSD dev watcher also served an old chunk after edits; a fresh fixture-server instance was used for the accepted final run. No production cache or service was changed.

| Viewport | English | Chinese |
|---|---|---|
| 1440x900 | [Desktop](desktop-dark-en.png) | [Desktop](desktop-dark-zh.png) |
| 820x1180 | [Tablet](tablet-dark-en.png) | [Tablet](tablet-dark-zh.png) |
| 390x844 | [Mobile](mobile-dark-en.png) | [Mobile](mobile-dark-zh.png) |
