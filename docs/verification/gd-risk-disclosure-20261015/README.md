# Existing risk-chip disclosure — local verification

Program: Grey Deer / MAS-258 / Macro #8128. Source operation: `gd-risk-disclosure-20261015`. Base Terminal master: `73a935e0246fa1245f538a0fc77447911b38179a`.

## User-visible change

The existing collapsed Oracle risk chip keeps the measured verdict and score unchanged, and separately shows a qualified native hazard, an unavailable hazard, and any source-reported contradiction. An admitted US envelope is explicitly labeled US. Opening the existing disclosure names unavailable sources and their own observation dates; malformed dates remain unavailable rather than borrowing the current session.

No model, score, threshold, country assignment, freshness budget, entitlement, policy grant, producer, refresh interval or transport changed. Missing optional coverage does not become a required-hazard alarm. A rejected envelope cannot supply a current hazard, and an invalid measured base still shows no numerical score. Unknown/prototype-like labels map to Unavailable. The existing source normalizer and every byte outside `riskEnvelopeCopy` / `MarketRiskChip` are unchanged.

The #856 bridge/normalizer is the baseline, not the obsolete #849/#852 candidates. The separate #865 workspace remains on its original branch; this patch does not adopt its older nested-data reader or transfer its custody. Parent/source decision is recorded on #856 at comment 6184739751.

## Executed evidence

- Fourteen initial component tests: 11 expected failures on the original source, 3 passing controls. Two additional prototype-key cases then failed before own-property label lookup fixed them; a third unknown-label control passed.
- Current chip, normalizer, disclosure and copilot suites: **97 passed** (17 new disclosure + 5 existing chip + 37 existing normalizer + 38 copilot cases).
- Full project TypeScript check: exit 0, no diagnostics. Focused helper/new-test lint: exit 0. Diff whitespace check: clean.
- Actual browser at 390×844 initially reproduced **162px horizontal overflow** from a long unavailable-source ID. `overflowWrap: anywhere` fixes that within the same details region.
- Existing Playwright fixture server, real component and current refresh path: **12 browser tests passed** — six new disclosure cases plus six original rotation/context regression cases across desktop 1440×900, tablet 820×1180 and mobile 390×844, English/light-request and Chinese/dark-request pairs.
- Browser sequence: measured baseline → qualified fragility → required input unavailable → source-reported contradiction → invalid measured source. Changes arrive through the existing focus refresh without reopening or reloading. The details toggle is exercised by keyboard; the compact warning is visible while details remain closed. These checks do not certify every assistive-technology announcement.

The screenshots are actual rendered fixtures, not generated mockups. Their names preserve the requested theme parameter; the Oracle chip inherits existing Terminal theme tokens, and no new light-mode implementation is asserted. Representative mobile conflict and tablet Chinese stale-input captures were visually reviewed. All 18 captures have exact hashes in `manifest.json`.

## Representative captures

| State | English mobile | Chinese tablet |
|---|---|---|
| Native fragility, unchanged score | [Capture](screenshots/risk-fragile-mobile-en-light.png) | [Capture](screenshots/risk-fragile-tablet-zh-dark.png) |
| Required input unavailable, own date | [Capture](screenshots/risk-stale-required-mobile-en-light.png) | [Capture](screenshots/risk-stale-required-tablet-zh-dark.png) |
| Source reports a conflict | [Capture](screenshots/risk-conflict-mobile-en-light.png) | [Capture](screenshots/risk-conflict-tablet-zh-dark.png) |

## Reproduce

From `terminal/`, with this checkout's installed lockfile dependencies:

```sh
npx vitest run lib/__tests__/marketRiskDisclosure.test.tsx lib/__tests__/marketRiskChip.test.tsx lib/__tests__/marketRisk.test.ts lib/__tests__/copilotTools.test.ts --maxWorkers=1 --minWorkers=1
npx tsc --noEmit --incremental false --pretty false
TERMINAL_E2E_PORT=<an unused local port> npx playwright test e2e/market-risk-disclosure.spec.ts e2e/rotation-risk-context.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
```

Use the existing local-only fixture server and a port owned by this run; never reuse another session's dev server or substitute fixture authentication for production proof.

## Acceptance boundary

Evidence class: **LOCAL_SYNTHETIC_BROWSER_ONLY**. No original financial ledger or live market endpoint is used by these source tests. This is not proof of current production data, authenticated real-user delivery, a new forecast or de-risking policy. Independent exact-source review, hosted required CI, merge, git-gated deployment and a real production read remain separate obligations. Source-specific prior denials and the original Macro #8132 warning-delivery holds remain untouched.

Independent review child: `gd-risk-disclosure-review-20261015-01`, original parent/root `gd-native-publish-continuity-20261015`; normal Fabric router selected Qwen/Bailian on Ubuntu2. Review packet SHA256: `2967850a5685728dc1eae1a25c40eb006578ee352551ff8f06cca5e8b893afb7`. At this verification save, the review is running, not accepted. Source publication and production acceptance are not inferred from its launch.
