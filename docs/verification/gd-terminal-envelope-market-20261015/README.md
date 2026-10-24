# US market-envelope identity — verification

Status: SOURCE-VERIFIED / NOT DEPLOYED. Grey Deer / MAS-258 / Macro #8128.
Operation: `gd-terminal-envelope-market-20261015`.
Base: `e12d93687e6257fa6c26cac06ab2f7b9715fee8c` (Terminal master).

## User-visible defect and bounded repair

The existing Python bridge and shared TypeScript normalizer use US/New York
session semantics, but qualified another market's envelope when dates and
other fields matched. A CN/HK or missing-market hazard could reach the actual
Oracle chip and copilot as US context. This is a reproduced software defect,
not evidence that an actual historical user received the wrong-market warning.

Both existing qualifiers now require exactly `market == US`. No case conversion,
whitespace repair, country inference, new risk score, schema version, source
selection, clock, policy, notification or portfolio effect. The optional
unqualified envelope is withheld with `market_mismatch`; independently usable
market-state verdict/score remain intact. An absent/foreign envelope is not calm.
The code change is five added lines across the two original qualifiers. The
Python positive fixture now explicitly declares its US market; missing-market
negative tests remain.

## Executed proof

- Original Python owner with new tests: 14 intended failures / 1 valid control.
- Original actual TS/consumer path: 17 intended failures / 1 valid control.
- Repaired Python bridge + new regressions: **59 passed**.
- Repaired TS normalizer, copilot, mounted Oracle chip and disclosure suites:
  **124 passed** across five test files. Python-to-JSON-to-TS and the actual
  get_market_state dispatcher are exercised with synthetic input.
- Full project TypeScript check, focused lint, script-style `ingest` import,
  Python AST scope and git whitespace checks: passed.
- Actual local Playwright browser: **12 passed**, zero retries, one worker,
  three viewports (1440x900, 820x1180, 390x844), EN/ZH, explicit existing
  html[data-theme] light/dark fixture inputs. US -> CN -> missing -> US
  source transitions, unchanged score, visible unavailable context, keyboard
  disclosure and no chip overflow are checked. No production/authenticated
  browser or saved-preference delivery is claimed.

The first twelve functional captures only requested theme via localStorage.
Visual inspection found that this did not prove applied theme, so that run is
NOT counted as separate light-theme visual proof. The test now explicitly sets
and verifies the existing CSS root and attaches its theme/computed-color data;
the full twelve-case run was repeated once. screenshots.json holds the final
capture hashes; initial-theme-request-only.json preserves the superseded hash
receipt. The existing risk chip retains its own dark-looking material even in
the root-light capture. This repair does not change or certify theme preference
persistence or redesign that existing palette. Two final representative captures
were inspected. These are functional/fixture images, not a new visual design.

An early inherited Python positive-fixture failure was corrected by adding the
real producer's required US market field. One new TS assertion was corrected to
retain multiple legitimate reasons: undefined metadata also carries the existing
invalid_json_values reason. finiteJson was not weakened. Existing negative
assertions and all previously registered tests are preserved.

Commands:
```
python3 -m pytest tests/test_market_risk_envelope_market.py tests/test_market_risk_bridge.py -q --tb=short -p no:cacheprovider
cd terminal
./node_modules/.bin/vitest run lib/__tests__/marketRiskMarketScope.test.tsx lib/__tests__/marketRisk.test.ts lib/__tests__/marketRiskChip.test.tsx lib/__tests__/marketRiskDisclosure.test.tsx lib/__tests__/copilotTools.test.ts --maxWorkers=2 --minWorkers=1
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/eslint lib/marketRisk.ts lib/__tests__/marketRiskMarketScope.test.tsx e2e/market-risk-market-scope.spec.ts
TERMINAL_E2E_PORT=<free-owned-port> CI=1 ./node_modules/.bin/playwright test e2e/market-risk-market-scope.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --reporter=list
```

Pytest reported existing permission warnings while cleaning unrelated temporary
browser-test garbage. Those paths were not modified. No missing-data, market,
ledger or production test was skipped to produce these counts.

## Independent source review

Normal M2 Fabric selected MiniMax on Ubuntu3 for bounded source-only review
`gd-terminal-envelope-market-review-20261015-01`; author provider OpenAI.
Original root/parent both `gd-native-publish-continuity-20261015`.
Packet: 26,073 bytes; SHA256
`1dc8b32f781140214237c987b7bd11c3b33aae879fd2e7a9149ffd0fc4631431`.
Retained result: 3,774 bytes; SHA256
`e027a42f2dcb3a90ef3fa62ef5ecbfbb8ae8e8e35b631d845c6039f3facdd6aa`.
Verdict ACCEPT, adjudicated once; original status TERMINAL/ACCEPTED/reviewer.
All five source/unit-test hashes matched the review packet. The later browser
fixture theme-root clarification was parent-verified, not represented as part
of the earlier review. No reviewer test execution or hash recomputation is claimed.

Qualification of review wording: both validators continue collecting all
reasons; the added gate does NOT short-circuit later qualification. Negative
tests are successful rejection assertions, not ignored failing tests. The
review's loose prose is not a different implementation contract.

## Release boundaries

Independent review is not a merge or deployment. Required current-head CI,
current-base composition and normal protected source release remain owed.
Separate #1011 publication-file mode changes are not copied here; the market
filter composes in a different function but must retain that source on merge.
Original #1008 live-deployment and live403 diagnostic refusals are not retried,
proxied or cleared by this work. No global proactive alert delivery, forecast
promotion, QLedger cutover or user trading action is claimed.

## Exact source hashes

- `ingest/pull_macro_risk.py`: `5367fcd97e867b63830acd9c0251d5a02e32bbb15b1a3f99b1a60ec2f608cbc0`
- `terminal/lib/marketRisk.ts`: `264172f4d17e753e7d9cc0e6bd78fc81f842679f0f15fc4f22c0d38ed99620d4`
- `tests/test_market_risk_bridge.py`: `a7d6443fef1457503b88383f3a1eba4ea6f29a3acc4c04d8323d69923bcbd0ea`
- `tests/test_market_risk_envelope_market.py`: `7fd06b3122fd1bb482e4fb0f84e8d766af057f695ce6184976a0508ac15c70c9`
- `terminal/lib/__tests__/marketRiskMarketScope.test.tsx`: `4b249a597a611fc911da85d39c2e23e09eb750e349b3ba848334f9500f5ebc69`
- `terminal/e2e/market-risk-market-scope.spec.ts`: `fb24a97a9ae924c9f69aab7cccc2fd144e58a0ad898d4788e1fcef38c6f0d747`
