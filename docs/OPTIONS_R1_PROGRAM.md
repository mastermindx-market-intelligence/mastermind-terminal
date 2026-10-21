# Options R1 — Mastermind Options: Rotation, Positioning and Research Continuity

Program and continuation record. Compact by design: one current checkpoint, the lane matrix, rulings and the next action. Source documents: the handoff package (MASTERPLAN, FEATURE_MATRIX, DESIGN_SPEC, AUDIT_REPORT, FABLE_HANDOFF) delivered 2026-10-21; the W1 freeze is `docs/OPTIONS_R1_W1_FREEZE.md`.

## Mission and exit gate

One continuous journey — Sector Central → holding → expiry/strike → chart → matched change → save → watch → review — on the existing Terminal owners, delivered through the full chain (commit → push → PR → CI → merge-on-green → git-gated deploy with `--target-sha` → live verification on `https://app.mastermind-x.com`). Completion ladder (MASTERPLAN §11): 1 plan → 2 Paper reviewed → 3 implementation committed and reviewed → 4 checks pass at the integrated revision → 5 real journey verified in a browser against the current source → 6 release receipt and production proof. Nothing below rung 6 is "done".

## Baseline pins

| Repo | Commit | Note |
|---|---|---|
| Terminal | `e3ca39a82d9713061e5e27ac0cd3ac1d249af127` | worktree HEAD, VPS gitsrc and live `data-dpl-id` at planning; `origin/master` moved to `ea7b20286` (#1093, Tiingo 24H history) on 2026-10-21 — rebase before PR |
| Macro | `90eb4df175c009b770303dee417eb09aef1a63b4` | producers; no O-OPT Phase-0 results exist (`data/oracle/gauntlet/oopt_results.json` absent, registry empty) |
| Mastermind procedural | `3d75cc73fd1c83936fff875c7a3e248b9c6c846e` | |

Test baseline at `e3ca39a82`, measured 2026-10-21 in this worktree: vitest 864 files, 14534 passed, 4 todo, 52 s; `tsc --noEmit` exit 0.

## Carrier

This session (Claude Fable 5.1, meta-CEO seat) in worktree `/Volumes/Mastermind 2/agent-workspaces/claude/5600d31ffa29643a/fable-handoff-commission-4c333e-09883fdd66ba5372`, branch `claude/ssd-fable-handoff-commission-4c333e-09883fdd66ba5372`. Fabric lanes via `pool remote`; returns in the kit (`$KIT/ext/lanes/<run-id>.remote.stdout`, `$KIT/ext/state/remote_sub/<run-id>.log`, `KIT=~/.claude/projects/-Users-chriswong-Documents-Cluade-Macro-Dashboard/handoff_kits/meta-ceo-b-2026-09-08`). Opus suborchestrators only where a bounded orchestration or independent audit needs them (`ROUTE: ORCHESTRATION` / `ROUTE: AUDIT`, `WHY OPUS:`). Fable weekly limit unused this week; prefer fabric for labor.

## Wave plan

| Wave | Content | State |
|---|---|---|
| W0 | Freeze + lanes (this record) | DONE 2026-10-21 |
| W1A | Sector origin → constituent → existing exposure/chart → back; reload + deep-link proof | lane accepted + integrated 2026-10-21 (`0e3300db2`, `d0bd71346` after the rebase on master `d9ec4d2b8`); browser journey proven by `e2e/sector-exposure-journey.spec.ts` (`3fa242d6c`) |
| W1B | Missing/degenerate peer repair, boundary states, fixed universe under filters, coverage clocks | lane accepted + integrated 2026-10-21 (`fc8c420c3`, `b537aa051` after the rebase) |
| W1C | Change inspector over the existing matched comparison (descriptive only) | lane accepted + integrated 2026-10-21 (`3f6dc0905`, `5e506955e` after the rebase) |
| Design | Paper boards U01–U04 upgraded in the new file "Terminal · Options R1 · Design Upgrade · 2026-10-21" (dark + light, EN/ZH); remaining boards before W2+ builder fanout | U01–U04 released 2026-10-21 |
| W2A | Original EMA rotation method (`relative_trend_ema/v1`), completed-week endpoint, trails | after W1 integration |
| W2B | Holdings coverage / breadth / concentration, ETF vs constituent | after W1 |
| W2C | Save/reopen investigation revisions via `investigations.ts` command path | after W1 |
| W3A/B/C | Flow confidence/corrections/packages; comparable volatility/events; condition watches via the alerts owner | after W2 |
| W4A/B | Replay/within-session change; scenarios | after W3 |
| W4C | Validated research claims | HELD: no O-OPT results exist; descriptive journey proceeds |
| W5 | Responsive/a11y/perf/EN-ZH/light-dark proof, CI, merge, deploy, live verification | last |

## Lane matrix (W1)

| Lane | Run id | Host / mode | Owned files | Branch on host | Status |
|---|---|---|---|---|---|
| L-W1A ORIGIN+STRIP | `options-r1-w1a-1021-v2` (v1 on ubuntu2/qwen refused: bailian key 403, 24 h cooldown) | ubuntu3 / glm | `lib/exposureOrigin.ts`, `components/exposure-map/{useExposureOriginRoster.ts,exposureOriginStrings.ts,ExposureOriginStrip.tsx,ExposureOriginStrip.module.css}`, 3 tests | `claude/options-r1-w1a-1021` → `0e06f8d1` | accepted (deterministic) → cherry-picked `e88e9803d`, rebased `0e3300db2` |
| L-W1B ELIG | `options-r1-w1b-1021` | ubuntu3 / glm | `lib/rotationEligibility.ts` + test | `claude/options-r1-w1b-1021` → `91791cb7` | accepted (deterministic) → cherry-picked `9dec58bc6`, rebased `fc8c420c3` |
| L-W1C INSPECT | `options-r1-w1c-1021-v2` (v1 on ubuntu0 refused: rc=75 thermal admission) | ubuntu1 / glm | `lib/exposureChangeInspector.ts`, `components/exposure-map/{exposureChangeInspectorStrings.ts,ExposureChangeInspector.tsx,ExposureChangeInspector.module.css}`, 3 tests | `claude/options-r1-w1c-1021` → `708e7b57` | accepted (deterministic) → cherry-picked `72b72ca8d`, rebased `3f6dc0905` |

All three lanes returned `worker_rc=0` with complete STATUS/RESULT/EVIDENCE/GAPS/DEVIATIONS packets and the `OPTIONS_R1_W1x_DONE <sha>` token, but the controller recorded `rc=79 output_contract_missing` (`USAGE_RECEIPT_MISSING`): a controller receipt gap, not a worker failure. Each return was re-verified in this worktree (vitest, `tsc --noEmit`, eslint, plain-language guard) before `pool ledger outcome <run-id> --accepted-by deterministic`.

Contested files are single-writer (the seat): `ExposureMap.tsx`, `ExposureChartReference.tsx`, `SectorCompanyTable.tsx`, `SectorIntelligenceWorkspace.tsx`, `SectorRotationMap.tsx`, `GexDeskView.tsx`, `GexMarketMemory.tsx`, `exposureMapStrings.ts`, e2e specs. Lane commits are fetched directly from the host worktree (`git fetch <host>:lanes/wt/<run-id> <branch>`) when a push is refused.

Integration decisions (seat, 2026-10-21):

- W1A origin is minted only by `SectorCompanyComparison` (the holdings roster the user actually stepped through); `SectorCompanyTable` is deliberately not wired because its matrix population is not the holdings roster, so an origin minted there would claim a cohort the strip cannot step. The desk binds the origin to the company in the URL and drops it on any mismatch; stepping pushes one history entry per holding so Back/Forward step the cohort; landing on the return address focuses the exact holding once without a scroll jump.
- W1B placement replaces the map's own classification: exact zero → boundary (drawn on the line, nearest quadrant named), null/NaN/unmeasured → unplaced shelf with a reason, counts stay universe-wide under display filters, the trail SVG is drawn in plot pixel units.
- W1C inspector is mounted inside the existing matched reported Gamma block in `GexMarketMemory`, replacing the duplicated aggregate trio and single-strike readout (one canonical count per population); strike selection in the inspector drives the map selection.

## Rulings and holds

- RULING ORIGIN-TRANSPORT: sector origin travels as a separately versioned `origin` query parameter composed onto the existing v1 hrefs; `ExposureChartRequest` v1 and its hash are untouched (handoff Packet 1). Reversibility: easy.
- RULING ZERO-BOUNDARY: an exact zero on either rotation axis is a boundary state, never Leading; null/NaN/unmeasured are unavailable states with reasons (handoff Packet 2). Reversibility: easy.
- RULING INSPECTOR-DESCRIPTIVE: the change inspector carries no causal/predictive/flow vocabulary; a lint test enforces it in both languages. Reversibility: easy.
- HOLD W4C: no O-OPT Phase-0 results exist in the Macro checkout; predictive or confirmation admission stays blocked until a registered evaluation exists. Scoped to W4C only.
- HOLD EMA: the original `relative_trend_ema/v1` method is added only after formula, seed, exchange endpoint and convergence gates are frozen (W2A); the incumbent 63/21 coordinates are never relabelled JdK.

## Concurrent writers (danger area)

A sibling Fable session (`fable-handoff-orchestration-7b70a0`) launched R2 lanes on 2026-10-21 (`r2-pr1-dex-reducer-1021-v1`, `r2-pr1b-node-reducer-1021`) touching `lib/exposureMapProjection.ts`, `lib/exposureMap.ts` (readSource delta branch) and `lib/exposureNodeReducer.ts`. No file overlap with W1 lanes. The W1 branch was rebased onto master `d9ec4d2b8` (#1094) on 2026-10-21 and the exposure suites re-run there; any later R2 merge must be rebased over again before the git-gated deploy.

## Do not redo

- Reading the nine handoff owners (T1–T9) and the Macro O-OPT absence: done 2026-10-21, recorded in the freeze.
- Measuring the vitest/tsc baseline at `e3ca39a82`: done (above).
- Recapturing the `gex-levels-heatmap-load-failure` and `eod-heatmap-flowdesk-load-failure` evidence packets after the `GexDeskView.tsx` origin change: done 2026-10-21 (114 + 114 crops, locks green; attribution of the one deterministic ladder-height drift to master in each packet's `options_r1_w1_recapture` note). Re-run only if a lock file changes again.
- Attributing the 3 local `onboardingOAuthContext.test.ts` failures: Node 26 + vitest jsdom `localStorage` shadowing, environment-only (CI runs Node 20). Do not bisect the branch for it.

## Current checkpoint (2026-10-21)

Working build: the session branch on master `d9ec4d2b8` (#1094) with W1A + W1B + W1C integrated and the journey spec `3fa242d6c`, plus the W1 release commit (programme record, W2 freeze, sector-intelligence edge-accent removal, recaptured load-failure packets, `e2e/helpers/optionsR1Journey.ts`, `e2e/options-r1-w1-crops.spec.ts`, packet `terminal/docs/pr-crops/options-r1-w1/` with 38 crops).

Gates on that build: `tsc` 0; plain-language guard blocking 0 / waived 2; scoped eslint 0; `git diff --check` clean; evidence locks 11/11; vitest 872 files green with the only red being the three Node-26 `onboardingOAuthContext` cases (local runtime only, CI runs Node 20); browser gate `sector-exposure-journey` + `options-exposure-workspace` + `rotation-risk-context` + crop spec at one worker across desktop/tablet/mobile: 99 passed, 42 skipped (crop slots without `OPTIONS_R1_CROPS`), rc 0 (10.5 min).

Design law: the six sector-intelligence `.answer` callouts lost their `border-left: 3px solid var(--brand)` (no colored container-edge accents, 2026-10-18 rule); no pixel snapshots depend on it.

W2 is frozen in `docs/OPTIONS_R1_W2_FREEZE.md` (owner map, `relative_trend_ema/v1` policy, eleven gates mapped to tests, holdings coverage schema, persistence adapter and proof, lane table). Open fact: the Macro primary checkout (branch `feature`) does not contain an emitter for `sector_cycles.rs_history.v1`; the Terminal validator exists but the producer must be located on another Macro branch or host before W2A-MACRO is launched.

## Next action

Open the W1 PR against `master` with `merge-on-green` and native auto-merge; bind it; while CI runs, launch L-W2A-TERM and L-W2C-TERM on the fabric (fixture-driven, no Macro dependency), locate the Macro `rs_history` producer and the live `data/sector_holdings` store, then launch L-W2A-MACRO from a fresh Macro worktree on the SSD policy root. After merge: git-gated deploy `--target-sha <merged master sha>` and live verification of the Sector Central → Exposure → chart → Changes journey on `https://app.mastermind-x.com`.
