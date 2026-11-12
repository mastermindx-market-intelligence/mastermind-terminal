# EX-08 — Dislocations localization and ET-age clarity

This is a **new scoped browser-evidence directory**. The historical `docs/pr-crops/dislocations/` crops and fixtures are untouched.

## What changed

- English group titles **Confirmed / Forming / Ended** are independent of the Chinese **已确认 / 形成中 / 已结束** translations.
- An event from a prior **America/New_York calendar day** leads with its actual localized ET date, then the ET clock; a year appears across calendar-year boundaries. Current-day rows retain the compact HH:MM ET hierarchy.
- Relative ages use real elapsed time and day/hour units for older signals. Missing/invalid timestamps remain unknown (—); future values are labeled ahead, not freshly observed.
- The header's “updated” and existing stale-warning copy now include an actual ET date when the last read was from another day. Existing stale, delayed, data-quality, empty and paywall states remain intact.
- Midnight uses 00:XX rather than the former 24:XX locale-specific clock artifact.

## Verification and provenance

- 53/53 focused Dislocations view/route unit tests pass, including newly added midnight, year rollover, DST spring/fall, future/invalid and EN/ZH render assertions.
- 12/12 real Playwright local-browser fixture cases pass: **desktop/tablet/mobile × EN/ZH × fresh/stale**. Zero failures, skips, or retries. All 12 PNGs and the actual machine report are in this directory; `evidence.json` binds their SHA-256 values to the source-file checksums.
- Reproduce with:
  `TERMINAL_EX08_CROPS=1 TERMINAL_E2E_PORT=<unused> NODE_OPTIONS=--no-experimental-webstorage PLAYWRIGHT_JSON_OUTPUT_NAME=docs/pr-crops/ex08-dislocations/browser-report.json npm run test:e2e:responsive -- e2e/dislocations-ex08.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --reporter=list,json`.
- Next type-generation and TypeScript passed in the acquired operation worktree. New browser-spec ESLint has zero findings. Comparing the component's lint results against the exact base yielded the same two inherited hook errors and one warning, **no new lint findings**. Those pre-existing fetch-lifecycle issues are out of this narrow language/date repair.
- All tests are fixture/source proof; neither live market-feed freshness nor production deployment is claimed. Protected CI, independent review and actual user-path proof remain separate acceptance gates.
