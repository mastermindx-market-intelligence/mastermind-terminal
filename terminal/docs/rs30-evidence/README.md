# RS30 engineering and source evidence

Operation `rs30-pivot-terminal-build-20261009`, Terminal PR #879. These receipts prove their named scopes; they do not establish scientific edge or production delivery.

The admitted Fabric review `rs30-review-028a49a6-20261009` examined candidate `028a49a64e9e716b515bbca5102f7f8f1241a324` against base `4d6a9ac81d01ac9f14c22fd3180f5d00f0239000` and returned REPAIR. Parent reproduced four regressions before repair: an open exit marker appearing on the prior completed candle, duplicate pre-render requests, a partial interior session counted as wholly missing, and omission of a pivot confirmed at the final completed close. `rsPivotChartReplay.test.tsx`, `rsPivotRequest.test.tsx`, and `rsPivotStudy.test.ts` now cover those failures. The headline table separately discloses unresolved gaps and right censoring; export preserves `history_stale` and `snapshot_state`.

Run the focused and integration checks from `terminal/`:

```sh
npx vitest run lib/__tests__/rsPivotStudy.test.ts lib/__tests__/rsPivotChartReplay.test.tsx lib/__tests__/rsPivotRequest.test.tsx lib/__tests__/rsPivotShellIdentity.test.tsx lib/__tests__/intradayEvidence.test.ts lib/__tests__/intradaySession.test.ts lib/__tests__/intradayRouteGates.test.ts --minWorkers=1 --maxWorkers=2
npx tsc --noEmit
npm run build
npm run test:e2e:responsive
```

The 70 focused/integration tests and six focused responsive workflows passed after repair. The browser tests exercise source loading, four-arm comparison, chart and replay, frozen export, control invalidation, unavailable-source recovery without reload, EN/ZH, viewport bounds, and guest denial at 1440×900, 820×1180, and 390×844. The included `fixture-desktop-en.png` and `fixture-mobile-zh.png` are **localhost synthetic fixtures**, never production or PIT receipts. Their corrected history is deliberately stale so the degraded state is visible.

`production-source-census.json` is a read-only production store census using the incumbent Python qualifier, containing source hashes and coverage only. It establishes no replay outcome or source admission. The full scientific boundary and reproducible four-arm handoff are in `docs/research/RS30_PIVOT_RESEARCH_BOUNDARY.md` at repository root.

The copy guard requires the recognized bilingual `pick` helper; chart labels and all benchmark names have explicit EN/ZH text. The shell identity fixture is opt-in via `mm_e2e_rs30` only under development plus the existing fixture flag. Four security/isolation tests cover production ignoring fixture cookies, unrelated suites retaining verified claims, and opted-in account/guest identities. The broader thesis browser test exposed background `/api/brain/me` 429s; its setup now stubs that unrelated read at context scope while retaining every persistence and zero-error assertion. Production Brain auth and limits are unchanged.
