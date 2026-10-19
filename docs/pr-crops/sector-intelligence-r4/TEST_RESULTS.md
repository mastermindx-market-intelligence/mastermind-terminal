# Sector Intelligence R4 — real owner-envelope qualification

Status: BUILT_NOT_PROVEN / DRAFT / NOT DEPLOYED. Parent macro#7646; same source operation `sector-intelligence-terminal-20260926-sol-001`, same Terminal PR #754 and original Studio Direct worktree. This is consumer integration, not a new data producer or design programme.

## Material changes

The original R3 correction bundle was applied after fresh same-carrier session/resource/source reconciliation: the persistent browser test awaits the actual entrance animation; singular company wording is correct; browser history closes the group dialog; the older capture helper accepts an optional evidence output directory. The modal animation and geometry assertions were not disabled or weakened. Two additional browser cases cover Back/Forward while the dialog is open and exact singular/zero coverage wording.

The persistent company/group suite then passed **33/33** across desktop, tablet and mobile. This run occurred **before** the later owner-envelope corrections below, and is not current-head end-to-end acceptance.

A fresh inspection of the actual Macro files exposed two material R1/R3 fixture-hidden defects:

- Theme State uses `themes[].foresight.stage` and `themes[].foresight.entry_ready`, not flat fields on the theme record. The old consumer returned zero real themes.
- The heatmap's ticker field is `tiles[].t`, not `ticker`. Its cap concentration also requires `size_basis=marketcap`, a complete `n_tiles` count and a valid full selected-sector denominator. The old consumer returned no actual concentration.

R4 removes recursive look-alike record discovery. Sector rows come only from `sectors`; confluence rows come from its explicit `subsectors` and `sectors` collections with `ok=true`; themes require `neuralweb.theme_state.v1`; heatmap identity/size/complete-count checks are explicit. Missing theme readiness is null, not false. Stale theme-input warnings remain visible. The BFF rejects unsupported envelopes with 502/null instead of claiming usable data. No fixture fallback was added to production.

## Actual immutable owner data

Repository: `mastermindx-market-intelligence/macro`, commit `79dbe3f2431b9e21cabf23071f02eab5add57eb4`.

| Owner file | Git blob | Source date |
|---|---|---|
| site/sectordata/sector_central.json | 119611420df3ac314b45996ebf4d3f46b44682bf | 2026-09-25 |
| site/marketdata/subsector_confluence.json | fea23e1e8c8611dc3958100f78edfcdeeb44a203 | 2026-09-25 |
| site/neuralwebdata/theme_state.json | 8f93007477d530a0186f6b518b9f142be727d931 | 2026-09-26 |
| site/marketdata/sp500_heatmap.json | 3756c1b48f4761cf8c2d6d89cf4efaa801dbf5c2 | 2026-09-25 |

`owner-source-qualification.json` binds full SHA-256/byte counts and compares the old and new consumers against those same unmodified files. Result: **11 sectors, 76 source groups, 18 themes, 14 Semiconductor members**. Technology's exact 79-name heatmap cohort yields top-five capitalization share **0.6288935002403907**, rendered 62.9%; this population is not silently joined to advancing participation. Six stale theme legs are disclosed. No score, rank, entry permission, economic exposure or history is synthesized.

Full input bytes are preserved privately under `/private/tmp/sector-intelligence-owner-proof-20260926-sol-001/`, not installed as production data. GitHub retrieval and local gateway interception do NOT prove authenticated published-data transport.

## Final source qualification

- Full Vitest: **394 test files passed; 6,333 tests passed; 4 todo**. Final command chain process 87402 completed with exit 0.
- Final TypeScript and scoped source/test ESLint: PASS. Not a whole-repository lint claim.
- New exact-envelope/denominator tests: **25 passed**; new gateway admission tests: **8 passed**. Gateway tests use explicitly mocked authentication and network, not a real user session.
- Actual-owner-payload browser qualification: **25/25 passed**, Chromium desktop English/light and WebKit mobile Chinese/dark, zero page exceptions. Raw upstream bodies are unmodified; only local transport is intercepted. Checks cover full owner counts, group search, correct absolute/relative company values, existing Analysis links, theme dates/staleness, complete company table, Back and horizontal overflow.
- Reproducible helper: `terminal/e2e/tools/qualify_sector_owner_payloads.cjs`; final report `owner-browser-qualification-v2.json`; two visually inspected screenshots.

The first owner-browser probe timed out because it assumed MU was in the first six rows, as in the Sep-23 design example. Current owner order differs. The corrected probe uses the real Show all companies action before selecting MU; it does not reorder owner data or reload to recover. The original failed report remains `owner-browser-qualification.json`.

## Exact open test-fixture gate

A later compound request to update the old historical browser fixture envelopes (and inspect shared label helpers) was safety-status blocked before dispatch. Neither `terminal/e2e/fixtures/sector-company-v3.ts` nor that request's confluence-fixture change in `terminal/e2e/sector-group-discovery.spec.ts` was applied. No smaller/rephrased/cross-carrier replay was attempted.

Therefore the old browser fixtures still carry `groups` and flat theme flags, which the corrected production consumer intentionally no longer accepts. The earlier **33/33 is superseded as current-candidate browser proof**. The existing persistent browser suite needs that permitted fixture migration and a new exact-candidate run; its current status is HOLD, not PASS. The actual-owner browser proof does not waive this gate. Do not restore fixture-only aliases in production merely to make the tests green.

Some source-issued theme-stage variants still fall through the older display vocabulary to Unavailable even though the raw owner stage exists (BROADENING/ PRECIPICE/ RE-RATING variants). Preserve the source semantics and obtain the existing vocabulary mapping; do not invent a new signal interpretation. Primary view clock/IA refinement, source-specific claims and independent comprehension acceptance remain open. The theme view is now populated, not declared finished.

## Dependency reconciliation and next action

Macro #8041 at `8a489d249d183e2e87f24609bd43397f64b2ff4d` supplies the candidate consolidated experience contract: Overview / Companies / Signals / Drivers / History with contextual Sources. It is still draft, not protected published doctrine or independent native acceptance. Current Chairman human-first direction remains controlling; preserve existing studies and do not start another IA programme.

At the inspected Macro main, `engine/sector_intelligence` has no Technology dossier producer and `data/sector_intelligence` contains fixtures only. The existing registered historical Technology carrier was read without modification: clean at `4122e3b7e1524482216fb156f201f8229c14011b`, upstream branch gone, planned `dossier_projection.py` absent. This does not prove the Task 2 execution lease expired or authorize takeover. Preserve `stsi1-sector-dossier-producer-technology-20260925-sol-001`; its exact current custody/return remains to be reconciled through the existing parent owner.

Next: after genuine recovery for the original refused fixture/label action, migrate only the test envelopes to the observed owner shapes, close the source-label/clock truth gaps, and rerun the exact candidate. Then complete consolidated-design acceptance, actual authenticated upstream binding, canonical dossier/exposure/CPU identity, Business Pulse, strategy/horizon availability, PIT/corrections and admitted save/alert persistence. Independent review, exact-head CI and normal non-Vercel release proof remain required.

No Paper write, worker, watcher, source-owner displacement, merge or production deployment occurred. Protected Skillpack pin remains `763ec8f920177fdf48b18df1b8e37b61ab482ef0`, version1.0.1/bootstrap1. Same-carrier entry session `7d433fa9-3dcf-4ad7-a0a5-0306464855ec` and resource configuration were observed; no global permission recovery is inferred from an individual success. Next mode: retain the working mode; the remaining restriction is action-specific, not a reason to use mode switching as a bypass.
