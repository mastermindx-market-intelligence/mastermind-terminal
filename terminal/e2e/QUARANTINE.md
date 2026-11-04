# Quarantined e2e journeys

A quarantined journey is a real defect that is not being asserted right now. This ledger is
printed by CI on every run (`.github/workflows/ci.yml`, step "Disclose quarantined e2e
journeys"), so a green responsive matrix can never be read as full coverage.

Rules (Meta-CEO ruling 2026-09-05, under issue #485):

1. A spec may be quarantined only when it failed or flaked in >= 2 inventoried CI runs, OR when
   a single run reproduced a deterministic all-attempts-failed result (initial attempt + every
   retry failing at the same line), or when the error is a documented nondeterministic harness
   race.
2. A spec that fails deterministically for a product reason is FIXED, not quarantined, when the
   fix is <= ~40 lines and obviously correct.
3. Every row names its evidence run ids, an owner, and a re-enable condition, and states any
   coverage given up beyond the row's own defect (assertions inside the same test body that stop
   running as a side effect of the quarantine).
4. This table shrinks. It never grows without the ruling above and a row here. When the
   table empties, keep this file in place with an empty table — CI hard-fails if the file
   is missing, by design (see "Disclose quarantined e2e journeys" in ci.yml).

| Spec:line | Test title | Project | Evidence runs | Owner | Re-enable condition |
| --- | --- | --- | --- | --- | --- |

No journey is quarantined. The last row — `drawing-system.spec.ts:992` ("flagship geometry,
editing, and path limits survive adversarial interaction", desktop, evidence run 33942726252) —
was closed under rule 2 on 2026-10-18: the Path tool's double-click finisher was repaired in
`terminal/components/ChartPanel.tsx` (40 changed lines) and the whole test body, including the
nine contracts that the `test.fixme` had been aborting, asserts again. The defect was real and
position-dependent, not a harness race: the `pointerup` finish check compared the RAW pointer
against the already bar-SNAPPED previous anchor, so a double-click more than 3px from its bar
centre appended a fifth anchor instead of finishing, and the repaint that followed detached the
element the mousedown was recorded on, which makes Blink drop the native `click`/`dblclick` pair
outright. `e2e/drawing-system.spec.ts` ends with a regression test that places the finishing
double-click deliberately off-centre on a coarse monthly grid; it fails on the unrepaired
component.

## Observed but NOT quarantined (watch list — no coverage given up)

These recur but have never turned the required check red: Playwright counts a retry-pass as a
pass (issue #485 body: run 33286870497 "passed only after seven flaky retries"). Quarantining
them would be coverage loss with no effect on the check. Re-open the question if any of them
appears in a `failed` bucket on a run made after 2026-09-04.

Every run id below is cited as a *flake* (a check-run annotation's `flaky` bucket, or a
retry-then-pass with no annotation at all), never as a `failed` bucket entry — the column is
titled "Flaked in" rather than "Evidence runs" for exactly that reason. Two rows were
verified directly: run 33787644981's annotations list both
`watchlist-bulk-actions.spec.ts:143` and `drawing-system.spec.ts:1586` under "3 flaky", with
no failure stack trace for either — confirming they never reached the `failed` bucket in that
run. A retry-then-pass with zero remaining flakiness produces no GitHub annotation at all, so
an unannotated citation elsewhere in this table records a locally-observed flake, not a gap.

| Spec:line | Symptom | Flaked in | Note |
| --- | --- | --- | --- |
| terminal/e2e/marker-tooltip.spec.ts:465 | `.mm-sig-tip` hidden after a touch tap | 33942726252 (tablet, flaky) | The only anomaly besides the quarantine on the current harness |
| terminal/e2e/marker-tooltip.spec.ts:483 | same tooltip race on the travel-is-a-pan journey | 33915200713 (tablet), 33599177226 (mobile) | Quarantine-eligible by run count; deliberately not taken |
| terminal/e2e/marker-tooltip.spec.ts:366 and terminal/e2e/indicator-prim-tooltip.spec.ts:287 | pan travelled ~79px against a commanded 180px; `Math.abs(moved - dx) < dx * 0.35` | 33915200713 | Shared assertion shape. Loosening the tolerance would not even pass (ratio 0.56) and would destroy the contract |
| terminal/e2e/w2a-workspaces.spec.ts:73 | Saved Layouts menu unreachable via `terminalToolbar.ts:57` | 33787644981, 33599177226, 33542289811 (all pre-#505) | Owned by PR #496 (R1-T). Do not touch these paths |
| terminal/e2e/crosshair-price-label.spec.ts:216 | active-axis label rendered on the wrong axis (x=963/965 vs ~113) | 33787644981, 33542289811, 33599177226 (all pre-#505) | Owned by PR #501 (R1-C1). Green on both post-heal runs |
| terminal/e2e/indicator-snapshot.spec.ts:109 | `ready: false` at baseline export | 33787644981, 33542289811 (both pre-#505) | Owned by PR #497 (R1-A3) |
| terminal/e2e/layout-integrity.spec.ts:162 | Saved Layouts menu timeout | 33787644981 (pre-#505) | Owned by PR #496 |
| terminal/e2e/washout-retro.spec.ts:617 | 30s test timeout | 33787644981 (pre-#505) | #492 (`86a75b68`) already landed the fix; green on both post-heal runs |
| terminal/e2e/watchlist-bulk-actions.spec.ts:143, terminal/e2e/portfolio-positions.spec.ts:326, terminal/e2e/drawing-system.spec.ts:1586 | assorted timeouts | 33787644981 / 33599177226 / 33787644981 (all pre-#505) | Contention set cured by #505/#506 |
