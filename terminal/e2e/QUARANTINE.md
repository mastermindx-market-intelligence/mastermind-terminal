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
| terminal/e2e/drawing-system.spec.ts:992 | flagship geometry, editing, and path limits survive adversarial interaction | desktop (tablet/mobile already width-skipped) | 33942726252 — failed initial attempt + Retry #1 + Retry #2, all three at spec line 1140 (single-run deterministic reproduction, rule 1) | issue #485 (R1 reliability program); no repair PR owns this journey yet | Delete this row and the `test.fixme` at the top of the test body in the same PR that makes the Path tool commit on double-click, with one green desktop run of this spec on the repair head |

## Coverage given up

`test.fixme` at drawing-system.spec.ts:998 aborts the entire monolithic test body (lines
992-1183; the next `test(` is at line 1184), not only the Path-commit assertion at :1140. On
unmodified master, everything before :1140 was passing and is now unasserted too. Surrendered
contracts, by rough source line:

- vertical-SVG line count (~28)
- text editor opens on the correct tool (`.text-edit`, ~45)
- inspector binding + `data-drawing-id` wiring (~53-54)
- fib `stroke-dasharray` / `stroke-width` / `fill-opacity` (~58, 59, 66)
- inspector draft survives a live language/quote rerender (~80-82)
- drag span/midpoint invariants (~111-112)
- brush polyline contract (~121-124)
- coarse-pointer tap-to-finish 16px tolerance, `toHaveCount(2)` (~170)
- triangle preview cleanup/abort (~183, 189, 190)

None of these are known-broken; they are simply unasserted while this row is quarantined. The
re-enable condition above restores all of them, not only the Path-commit contract.

## Defect under quarantine

`drawing-system.spec.ts:1140` asserts that after three Path-tool clicks and a finishing
double-click one committed `g[data-drawing-kind="path"]:not([data-id="_p"])` element is visible.
On run 33942726252 the element was never found on any of three attempts. `_p` is the in-progress
preview id (`terminal/components/ChartPanel.tsx:7063`), so "no non-`_p` path" means the
double-click finish committed nothing.

Leading hypothesis, unproven — no local reproduction was run: the segmented-tool pointerdown
handler refuses a new anchor while a pointer id is still held
(`terminal/components/ChartPanel.tsx:6997`, `if (pending.pointerId != null) return;`, immediately
after `svg.setPointerCapture`). A pointerup lost under runner contention would leave
`pending.pointerId` set, silently swallow every later click, and leave `pending.points` below
`spec.creation.minPoints`, so the `dblclick` finisher at `ChartPanel.tsx:7005-7020` commits
nothing and the preview `_p` is all that ever exists. That is a product-correctness question
inside a ~7,000-line component that also collides with open PR #501 (`ChartPanel.tsx`), which is
why this is quarantined rather than patched.

Falsifier for this quarantine: if
`npx playwright test e2e/drawing-system.spec.ts --project=desktop -g "flagship geometry"`
passes repeatedly on unmodified master, the failure is contention rather than a Path-tool defect,
and this row must be replaced by a harness fix.

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
