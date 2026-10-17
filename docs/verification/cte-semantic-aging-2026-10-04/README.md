# CTE v1 semantic-aging verification — 2026-10-04

## Reviewed source and preserved evidence

This package binds the bounded six-file consumer repair based on `c298fa1b831509dd3dcb7553aa34c03d69dd0084`, branch `claude/gmi-cte-semantic-aging-20261004-astra-001`. Independent revised source review passed; parent inspected the final EN desktop fresh, ZH mobile future/expired and EN tablet empty crops. This evidence is local fixture proof, not natural-publication, premium delivery or production acceptance.

The original [source receipt](source/source-wire-final-receipt.json), [source patch](source/source-wire-final.patch) and [verification manifest](verification-wire-final.json) are byte-preserved. Patch SHA256: `06a311543877717fc4d4e98d22a7a3e04109f8add4e3b0c293b9781c34d7e96d` (53,068 bytes). Original verification manifest SHA256: `c57f6193bd4ed1936887f17e61275daf84ac02c3f284c67f56e014052dbc32df`.

[artifact-map.json](artifact-map.json) maps every original source artifact to its stable stored path, byte length and SHA256. All 92 original manifest artifacts were verified before copy, then checked after copy. The original manifest itself is also preserved: 93 copied artifacts total, plus this README and the path/hash map. PNG directories distinguish viewport/language and avoid collision. No superseded run or unrelated `.claude` artifact is included.

## Checks and exact commands

Commands run from the authorized worktree's `terminal/` directory. Owning units: **40/40**, typecheck exit0, focused lint exit0, corrected browser matrix **72/72**, and unchanged incumbent theme integration **3 passed/6 source-declared tablet/mobile skips**. Unit/type/lint launcher PID49516, browser PID51324, incumbent PID58024. Type/lint logs are empty because successful commands emitted no output; they remain zero-byte originals. Explicit exit0 results are recorded in the original verification manifest and native launcher output.

```sh
npx vitest run lib/__tests__/companyThemeExposure.test.ts lib/__tests__/companyThemeExposureRoute.test.ts lib/__tests__/companyThemeContextCardAging.test.tsx
npx tsc --noEmit
npx eslint lib/companyThemeExposure.ts components/fin/CompanyThemeContextCard.tsx lib/__tests__/companyThemeExposure.test.ts lib/__tests__/companyThemeExposureRoute.test.ts lib/__tests__/companyThemeContextCardAging.test.tsx e2e/company-theme-context-aging.spec.ts
CI=1 TERMINAL_E2E_PORT=3201 npm run test:e2e:responsive -- e2e/company-theme-context-aging.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --reporter=list --output=../.claude/evidence/cte-aging/browser-wire-final
CI=1 TERMINAL_E2E_PORT=3202 npm run test:e2e:responsive -- e2e/company-intelligence.spec.ts --grep 'theme context|theme-sidecar|lagging theme' --project=company-intelligence-desktop --project=company-intelligence-tablet --project=company-intelligence-mobile --no-deps --workers=1 --retries=0 --reporter=list --output=../.claude/evidence/cte-aging/browser-incumbent-wire-final
```

The focused wire RED command was `npx vitest run lib/__tests__/companyThemeExposureRoute.test.ts lib/__tests__/companyThemeExposure.test.ts`: **1 failed/28 passed**, at the real browser parser after a hash-verified resolver and actual API returned future-source `state:partial` with immutable `context.status:ready`. The final regression continues through the actual mounted card and passes. [RED](logs/wire-red.log), [GREEN](logs/wire-green-final.log), [typecheck](logs/type-wire-final.log), [lint](logs/lint-wire-final.log), [matrix](logs/browser-wire-final.log), [incumbent integration](logs/browser-incumbent-wire-final.log).

Both browser runs were sequential, single-worker, zero-retry, fresh fixture servers with `CI=1` (reuseExistingServer=false). Browser contexts are cold. No reload or extra theme fetch is used to cross expiry. Each matrix case checks page errors and page-level horizontal overflow. Desktop is 1440×900; tablet 820×1180 touch; mobile 390×844 touch. There are **84 final card crops**: 14 states × two languages × three viewports.

## State × language × viewport captures

| State | Desktop 1440×900 | Tablet 820×1180 touch | Mobile 390×844 touch |
|---|---|---|---|
| fresh | [EN](images/desktop/en/fresh.png) / [ZH](images/desktop/zh/fresh.png) | [EN](images/tablet/en/fresh.png) / [ZH](images/tablet/zh/fresh.png) | [EN](images/mobile/en/fresh.png) / [ZH](images/mobile/zh/fresh.png) |
| expired | [EN](images/desktop/en/expired.png) / [ZH](images/desktop/zh/expired.png) | [EN](images/tablet/en/expired.png) / [ZH](images/tablet/zh/expired.png) | [EN](images/mobile/en/expired.png) / [ZH](images/mobile/zh/expired.png) |
| historical | [EN](images/desktop/en/historical.png) / [ZH](images/desktop/zh/historical.png) | [EN](images/tablet/en/historical.png) / [ZH](images/tablet/zh/historical.png) | [EN](images/mobile/en/historical.png) / [ZH](images/mobile/zh/historical.png) |
| source-stale | [EN](images/desktop/en/source-stale.png) / [ZH](images/desktop/zh/source-stale.png) | [EN](images/tablet/en/source-stale.png) / [ZH](images/tablet/zh/source-stale.png) | [EN](images/mobile/en/source-stale.png) / [ZH](images/mobile/zh/source-stale.png) |
| missing | [EN](images/desktop/en/missing.png) / [ZH](images/desktop/zh/missing.png) | [EN](images/tablet/en/missing.png) / [ZH](images/tablet/zh/missing.png) | [EN](images/mobile/en/missing.png) / [ZH](images/mobile/zh/missing.png) |
| invalid | [EN](images/desktop/en/invalid.png) / [ZH](images/desktop/zh/invalid.png) | [EN](images/tablet/en/invalid.png) / [ZH](images/tablet/zh/invalid.png) | [EN](images/mobile/en/invalid.png) / [ZH](images/mobile/zh/invalid.png) |
| future | [EN](images/desktop/en/future.png) / [ZH](images/desktop/zh/future.png) | [EN](images/tablet/en/future.png) / [ZH](images/tablet/zh/future.png) | [EN](images/mobile/en/future.png) / [ZH](images/mobile/zh/future.png) |
| future-generation | [EN](images/desktop/en/future-generation.png) / [ZH](images/desktop/zh/future-generation.png) | [EN](images/tablet/en/future-generation.png) / [ZH](images/tablet/zh/future-generation.png) | [EN](images/mobile/en/future-generation.png) / [ZH](images/mobile/zh/future-generation.png) |
| last-good | [EN](images/desktop/en/last-good.png) / [ZH](images/desktop/zh/last-good.png) | [EN](images/tablet/en/last-good.png) / [ZH](images/tablet/zh/last-good.png) | [EN](images/mobile/en/last-good.png) / [ZH](images/mobile/zh/last-good.png) |
| mixed | [EN](images/desktop/en/mixed.png) / [ZH](images/desktop/zh/mixed.png) | [EN](images/tablet/en/mixed.png) / [ZH](images/tablet/zh/mixed.png) | [EN](images/mobile/en/mixed.png) / [ZH](images/mobile/zh/mixed.png) |
| unmapped-only | [EN](images/desktop/en/unmapped-only.png) / [ZH](images/desktop/zh/unmapped-only.png) | [EN](images/tablet/en/unmapped-only.png) / [ZH](images/tablet/zh/unmapped-only.png) | [EN](images/mobile/en/unmapped-only.png) / [ZH](images/mobile/zh/unmapped-only.png) |
| empty | [EN](images/desktop/en/empty.png) / [ZH](images/desktop/zh/empty.png) | [EN](images/tablet/en/empty.png) / [ZH](images/tablet/zh/empty.png) | [EN](images/mobile/en/empty.png) / [ZH](images/mobile/zh/empty.png) |
| refreshing | [EN](images/desktop/en/refreshing.png) / [ZH](images/desktop/zh/refreshing.png) | [EN](images/tablet/en/refreshing.png) / [ZH](images/tablet/zh/refreshing.png) | [EN](images/mobile/en/refreshing.png) / [ZH](images/mobile/zh/refreshing.png) |
| unavailable | [EN](images/desktop/en/unavailable.png) / [ZH](images/desktop/zh/unavailable.png) | [EN](images/tablet/en/unavailable.png) / [ZH](images/tablet/zh/unavailable.png) | [EN](images/mobile/en/unavailable.png) / [ZH](images/mobile/zh/unavailable.png) |

## Synthetic clocks and limits

Synthetic owner-shaped CI/CTE fixtures and existing local preview/auth test seams drive the real mounted card. Fresh/expiry starts at `2026-08-06T23:00:00Z` with receipt `as_of=2026-08-01`, then advances one hour across expiry. Degraded cases use `2026-08-01T12:00:01Z`; future source is `2026-08-02`, and future generation is `2026-08-02T12:00:00Z`. Future wire uses the actual derived `partial` result state; source-stale uses actual derived `stale`. Last-good is a synthetic transport-stale result on a young source; resolver fallback mechanics are separately tested in units.

The existing owner policy is UTC calendar difference >5, so expiry is as_of+6 days at 00:00Z. Immutable source context/status/warnings/hashes remain intact; derived state ages initial200/cache/refetch/fallback and local open cards. Parent/latest-event and historical quarantine outrank aging. No new publisher, API, auth plane, scheduler, grader, source schema or rights-age policy is added.

**Light mode is unsupported by this Terminal.** `terminal/app/layout.tsx` fixes data-theme=dark; `SectionPreferences.tsx` says the Terminal has no light mode, and useMarketPrefs applies appearance to no Terminal surface. This package contains actual dark EN/ZH proof only. Light remains an explicit product-owner resolution/proof debt; no light captures or global CSS changes were fabricated.

**Premium delivery remains held:** Macro classification declares CTE PREMIUM_PRODUCT/ESSENTIAL with current shared-public-R2; sign-in-only BFF is insufficient. Incumbent private/service-authenticated/plan-aware migration is a separate unsatisfied owner dependency. V1 receipts cannot prove publication-age/all-source freshness or rights expiry. No natural publication, entitlement migration, full CTEv2/product acceptance, hosted required CI or deployed effect is claimed here. Parent owns carrier, required CI, merge, git-gated delivery and acceptance.
