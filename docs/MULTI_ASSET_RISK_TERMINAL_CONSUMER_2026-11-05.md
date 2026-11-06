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
