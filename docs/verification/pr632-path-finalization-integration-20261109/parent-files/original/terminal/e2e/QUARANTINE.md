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

_The table is empty._ The Path double-click journey that used to sit here was repaired under
issue #510 rather than re-quarantined, so no coverage is currently given up.

## Resolved: the Path double-click finish (was quarantined 2026-09-05 — 2026-09-18)

The quarantined row asserted that three Path clicks plus a finishing double-click leave one
committed `g[data-drawing-kind="path"]:not([data-id="_p"])`. Its stated leading hypothesis — a
pointerup lost under contention stranding `pending.pointerId` — was **not** the cause and did not
reproduce: instrumenting a real Path journey (wheel-pan and a window blur mid-gesture included)
shows `lostpointercapture` always following a delivered `pointerup`, never stranding the id.

The real cause was deterministic, not contention. A segmented tool's closing click was recognised
as a repeat by RAW cursor distance to the previous PROJECTED anchor within a 3px desktop radius,
so snapping — the magnet parking a price on an OHLC level, or x quantised to a bar centre — made
the closing click miss a placement it in fact meant, appending a duplicate anchor and leaving the
draft uncommitted. The native `dblclick` that used to rescue that is not dispatched at all when the
closing press hit-tests onto an existing drawing: the creation pointerdown's own re-render detaches
that node, press and release share no live ancestor, and Chromium emits neither `click` nor
`dblclick`. A Path closed over any existing object therefore committed nothing, 3/3, exactly as run
33942726252 recorded.

The repair reads the closing click's SNAPPED placement (`samePlacement`) as authoritative for
variable-multi repeat completion, keeping raw proximity as the coarse-pointer fallback, and
consumes the gesture's own trailing native `dblclick` so completion stays exactly-once. The
discriminating contract is `drawing-system.spec.ts`'s "a desktop Path finishes exactly once when
its closing double-click has no native dblclick", which fails on the unrepaired base.

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
