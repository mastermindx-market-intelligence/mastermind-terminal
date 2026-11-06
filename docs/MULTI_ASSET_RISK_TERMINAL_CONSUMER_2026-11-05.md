# MA-5: Terminal consumes qualified cross-asset observations in Risk Radar

**Date:** 2026-11-05 America/Vancouver. **Operation:** `multiasset-terminal-20261105-sol`.
**Owner:** current Chairman-assigned Sol; existing Grey Deer / MAS-258 global Risk Radar mission.
**Source:** Terminal `master` exact base `90a15953a731ba5d9064a6c496018b339bfffaf2`.
**Producer:** Macro #10795, proposed `mastermind.multi_asset_daily_context/v1` under existing `mastermind.risk_envelope/v1`; this consumer has **no independent producer**.
**Sibling:** Mastermind portfolio scenario PR #2124, queued separately. No Terminal code may call it to size capital.
**Capability status:** Source implementation, fixture unit tests, real local Macro JSON replay; not authenticated production proof or deployed app.

## User journey / scope

User opens existing Oracle/Risk Radar market-risk chip, expands the existing keyboard-accessible disclosure, and sees the actual source's US-listed daily ETF proxy comparisons. Show the benchmark absolute USD adjusted return and each comparable candidate's *absolute* USD adjusted return and correct relative-wealth ratio versus SPY; explicitly distinguish a down-but-down-less foreign proxy from an absolute gain.

Display observation window, expected US cash session, real source `STALE`/partial condition, which currency/return convention is used, and the absence of live flows, new predictions or capital instructions. Remain bilingual EN/ZH and responsive; no dedicated dashboard, new nav item, risk score, policy, book/mandate or trade/alert lifecycle. Observations can still contradict the US domestic market state; foreign markets do not inherit the US hazard.

Existing `terminal/lib/marketRisk.ts` owns the risk qualifier and Risk Radar summary. Previously `ENVELOPE_FIELDS` allowlisted risk fields and dropped `multi_asset_context`; this patch adds the optional field *after* independent constrained validation, retaining existing qualified risk state/hazard/repair/policy when absent or invalid. It never recomputes source owner scores, risk stage or asset allocation.

### Fail-closed consumer handling

`terminal/lib/multiAssetContext.ts` rejects unknown schema/method, bad/stale/future-known clocks, malformed IDs/currency/returns/ratio/classification, missing benchmark, false coverage or status, forged original-availability assertions, unwanted authority, duplicate rows, foreign listing/FX assumptions, overlapping invalid JSON values and unknown source family. It preserves bounded source IDs and hashes, market session, currency, return basis, observed values, input status and explicit observation limitations. It sorts **identity only**, not investment attractiveness.

This client validates 64-hex source/context digest *shape*, not independent SHA-256 of Macro's original bytes: source identity and cryptographic hash verification belong to the existing authenticated BFF/source-owner transport. The client must not invent a trusted provenance claim from a payload's self-stated hash. `multi_asset_context` is optional and **never invalidates the valid core Risk Envelope** when unavailable/malformed. A source correction and digest change need a fresh qualified owner artifact to become visible.

## Test/evidence contract

- `terminal/lib/__tests__/multiAssetContext.test.ts` — 21 adversarial tests for happy/negative/correction/authority semantics.
- `terminal/lib/__tests__/marketRisk.test.ts` — existing risk regression retained.
- `terminal/lib/__tests__/sectorOwnerGateway.test.ts` — existing signed-in transport/fail-closed test retained.
- `terminal/e2e/multi-asset-risk-context.spec.ts` — local fixture response through actual running Next.js Risk Radar, keyboard disclosure, sourced absolute vs relative readings, stale transition, optional malicious authority withdrawal, viewport/light/dark/EN/ZH captures. This is a **local fixture**, not live authenticated production nor backtest evidence.
- Real-file replay: the Nov 5 Macro evidence `research/grey_deer/multi_asset_20261105/evidence/context.json` was consumed unchanged by Node's TS loader and qualified as **STALE**: requested 11/observed 10/comparable 9, end session November 4 versus expected November 5, benchmark SPY -0.71%. No file copied into Terminal source, no source data recast as realtime, and no actual customer book connected.

## Boundaries and next release steps

Retain Terminal #1311/#1285/#1244 and other active Sector Central/API writers: this slice changes only the existing shared `terminal/lib/marketRisk.ts`, adds helper/test and this record. Existing authenticated `/api/sector-intelligence?source=risk` and `/data/market_risk.json` transport remain the only source ingress; no client-origin endpoint or new proxy. Keep conflicting/expired/missing risk distinct.

Before release, prove local TypeScript/ESLint/Vitest and Playwright responsive screen behavior, then exact-head Terminal hosted CI and actual protected merge-on-green. A source merge is not deployed user behavior; after deployment require real signed-in risk endpoint/Macro generation, stale/unknown states and authentic visual proof. If upstream Macro PR #10795 has not merged/deployed, the Terminal optional consumer must remain backwards compatible and have no apparent new data.

The complete portfolio mission remains incomplete: MA-2 fast source-clock and options-positioning qualification, MA-3 scientifically preregistered stress/rotation forecasts, MA-4 portfolio-native actual book/FX/mandate integration and shadow results, re-entry validation and authorized protection policy all remain separate. No naked inferred dealer-gamma sign, predicted VIX jump, live cash rotation or automated exit is claimed.

## Actual local source-and-browser qualification (2026-11-05, current branch)

- `./node_modules/.bin/vitest run lib/__tests__/marketRisk.test.ts lib/__tests__/multiAssetContext.test.ts lib/__tests__/sectorOwnerGateway.test.ts --reporter=dot`: **110 tests passed** across 3 existing/new files, exit 0. Focused 58-test Risk Radar subset also passed.
- `./node_modules/.bin/tsc --noEmit --pretty false`: **exit 0** after correcting strict types in the new tests and consumer helper; no compiler exceptions were suppressed.
- `./node_modules/.bin/eslint lib/marketRisk.ts lib/multiAssetContext.ts lib/__tests__/multiAssetContext.test.ts e2e/multi-asset-risk-context.spec.ts`: **exit 0**, no errors or warnings after removing an unused synthetic helper.
- `TERMINAL_E2E_PORT=32175 TERMINAL_VISUAL_EVIDENCE_OPERATION=multiasset-terminal-20261105-sol ./node_modules/.bin/playwright test e2e/multi-asset-risk-context.spec.ts --workers=2 --reporter=line`: **6/6 passed in 67.05 seconds**, desktop/tablet/mobile x EN light/ZH dark; fixtures cover response/hydration/keyboard, stale and unsafe-source transitions and screenshots. Captures were written to the isolated Playwright output, not authenticated production.
- `TERMINAL_E2E_PORT=32176 TERMINAL_VISUAL_EVIDENCE_OPERATION=multiasset-terminal-20261105-sol-legacy ./node_modules/.bin/playwright test e2e/market-risk-disclosure.spec.ts --workers=2 --reporter=line`: **6/6 passed in 28.31 seconds** across the same responsive matrix. The pre-existing risk disclosure's risk/correction/gap behavior was not broken.
- Read-only live-file replay with Node TypeScript import of Macro's 2026-11-05 `research/grey_deer/multi_asset_20261105/evidence/context.json`: qualified true, `status=STALE`, 11 requested, 10 observed, 9 comparable, October 28-November 4 interval vs November 5 expected, SPY benchmark -0.71%. No data file copied or modified.
- `git diff --check`: exit 0. Browser local dev returned HTTP 200 on its intended fixture path; **no real signed-in end-to-end or deployed risk endpoint was tested**.

**Source acceptance boundary:** reviewable implementation, not approved scientific forecast, production install, active trading or final parent acceptance. Further hosted CI, protected release and authenticated production validation are mandatory.

## R2 recovery: actual ingest path and strict producer-contract parity

This section supersedes the original source-completeness claim above. The first implementation's synthetic browser response bypassed a real missing consumer edge: `ingest/pull_macro_risk.py` removed `multi_asset_context` from the generated `/data/market_risk.json`. A new Python-to-TypeScript integration test failed on that exact omission before repair. The original PR was withdrawn from its native merge queue, made Draft and disarmed before modifying source; no other PR or queue entry was changed.

Five additional negative cases also failed before repair: an unknown ticker with a plausible source path; forged instrument labels/asset class (including a bond proxy called risk-free cash); a source capture later than its carrying envelope; impossible calendar dates normalized by JavaScript; and an unexplained missing-return row. The reader now binds the complete eleven-proxy v1 universe and its exact producer labels/classes/regions, rejects these contradictions, preserves genuine missing-source reasons and compares capture/publication instants including sub-millisecond precision. The source owner still determines investment meaning; this is not a new instrument eligibility or trading policy.

The existing Python ingest bridge now carries a separately bounded optional context through its existing output owner. It admits only the closed producer root/row fields, exact schema/method, explicit display-only/no-forecast flags, all-false financial authority, eleven rows, finite JSON, a 64 KiB bound and a capture no later than production. It forwards values without recomputing returns; the native TypeScript reader performs the deeper metadata/arithmetic checks. Bad optional input cannot erase an otherwise qualified native risk/hazard read. No new endpoint, authentication route, collector, persistence plane or account reader was introduced.

The revised evidence uses two fixed synthetic fixtures generated by Macro's actual `compose_daily_context` and checked by `validate_daily_context`, rather than a hand-authored three-proxy approximation. The actual `main()` ingest publisher is tested against isolated temporary input/output paths, including atomic publication and no leftover temporary files. An additional test runs the genuine Python bridge, the native TypeScript normalizer, and both language disclosures together.

Scope now also includes the additive helper/optional projection inside `ingest/pull_macro_risk.py`, existing `tests/test_market_risk_bridge.py`, and `terminal/lib/__tests__/marketRisk.test.ts`. Open PR #849 was inspected: its changes are to `_date`, native score parsing and stale flags in other functions/hunks. This increment does not copy, overwrite or supersede those changes or its separate test file.

### R2 qualification, original managed workspace

- Python: **73 passed**, six warnings, `tests/test_market_risk_bridge.py tests/test_market_risk_envelope_market.py`. Includes actual ingest `main()` and closed-field/oversize/nonfinite/clock negatives.
- Vitest: **124 passed** across `multiAssetContext.test.ts` (34), `marketRisk.test.ts` (38) and `sectorOwnerGateway.test.ts` (52). Includes the formerly failing full Python-to-Oracle path.
- TypeScript and targeted ESLint: **exit 0**; no weakening of assertions or exclusions.
- Playwright: **12/12 passed** in 60.68 seconds, three contract viewports x English/Chinese x requested light/dark, using genuine Python-bridge outputs. Cases exercise complete source coverage, stale source, forged identity and unauthorized source withdrawal without changing the core risk score.
- New evidence: `docs/evidence/multi_asset_terminal_20261105/r2/receipt.json` binds nine exact source/fixture hashes and **24 screenshot crops**. Original evidence remains historical, not proof for this new source.
- Visual scope qualification: the test asserts the actual root `data-theme` attribute, not only a filename. However, the ordinary Terminal/Oracle's existing `globals.css` is explicitly dark-only; setting the root attribute does not create an alternate light palette. These captures prove compatibility with both requested root modes, **not a newly implemented light-palette Oracle**. Expanded long content is inside the native scrollable dialog; crops are viewport-clipped and are not claimed as full-document images.
- Read-only production inspection authenticated through the existing website SSH identity, with strict host-key checking. `terminal.service` and `macro-api.service` were active; Terminal live marker and canonical checkout both reported `db06eacd8938cf44588d3906bca95bfd7122b74b`. Neither the new Terminal helper nor Macro daily-context module was installed at that inspection. No service was restarted and no production input, source or account changed.

**Remaining:** exact revised-head hosted CI, protected queue admission/merge, owner-gated production release and authenticated production user-path proof. This is not forecasting validation, portfolio activation or completion of the parent mission.
