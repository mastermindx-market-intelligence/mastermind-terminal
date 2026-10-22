STATUS: PARTIAL

R2-PR1B executor — exposure node reducer v1 (freeze F1 §3–§4, §6 defaults).
Branch `claude/r2-node-reducer-1021` off `origin/master` ea7b2028.

## Files changed (owned files only)
- `terminal/lib/exposureNodeReducer.ts` (new, 288 lines) — NODE_REDUCER_VERSION,
  CONTESTED_VERSION, CONTESTED_THRESHOLD = 0.9, SCANNER_VERSION; `resolveNodeScope`,
  `distanceFit`, `scannerScore`, `reduceExposureNodes`. Composes
  `selectedProjectionCells` (exposureMapProjection), `exposureNodes`
  (marketStructure), `describeExposure` (exposureWorkspace) by import; no forked
  logic, no viewport/clipping input, `$mn` units with a single /1e6 per summed value.
- `terminal/lib/__tests__/exposureNodeReducer.test.ts` (new, 304 lines) — DESIGN
  fixture built from `structuredClone(producer)` (SPY 2026-10-15 producer clocks,
  spot 600.24, eleven strike nets 595→605, strike-600 cells [−160,−148,−120,−90,−63,−40],
  weights [24,26,19,15,10,6]% truncated toward zero, remainder in E6, gross = |net|+50)
  plus 14 tests covering every §3 invariant and every §4 row owned by this lane.
- `terminal/docs/r2/RESULT_PR1B.md` (this file).

## Setup
- Pre-edit `npx vitest run lib/__tests__/exposureWorkspace.test.ts`: 22 passed.
  Post-edit: same 22 passed (no reader-result change). marketStructure.test.ts green.

## Gates (tails)
1. `npx vitest run lib/__tests__/exposureNodeReducer.test.ts lib/__tests__/exposureWorkspace.test.ts lib/__tests__/marketStructure.test.ts`
   → `Test Files  3 passed (3) / Tests  100 passed (100)`
2. `npx tsc --noEmit -p .` → exit 0, no output
3. `npx eslint lib/exposureNodeReducer.ts lib/__tests__/exposureNodeReducer.test.ts`
   → exit 0, no output

## Oracle reproduction (§4 DESIGN, all assert in tests)
net −1,383; dominant {600, −621, sign −1, tieSet [600]}; E2 600 cell −148;
absoluteStrikeNet 2,703; share 0.22974; gross 6,003; center 600.39956 (derived);
ratio 0.75845, contested false, runnerUp.tieSet [598, 602]; 0.90 contested /
89.99 not; 95/105 at ±40 tie [95,105], spot 99 → 95 for either input order;
partial book: net ≠ −1,383, unknownStrikes [597], scanner null +
insufficient_coverage, wholePopulationKnown false; far strike 470 at −900:
dominant 470, net −2,283, window cannot touch the reduction; E2-only leader is a
separate identity ("exp:2026-10-21"); scanner u 0.241546, c 0.918979,
strength 58.0262, EM 6.0 → d 0.04/fit 0/31.914/candidateScore null, EM 1.2 →
fit 0.25/43.164 eligible, EM 0.48 → 76.914; cancellation book net 0 gross 100
net_cancelled with null dominant/center; delta metric → metric_not_scanned.

## E7 reconstruction (§3 "ports the oracle exactly"; oracle source not on this host)
Derived from the freeze's published numbers, self-consistent to all digits:
dominance = 1 − a2/a1 = 0.241546; cappedConcentration = min(1, 4·a1/Σ|N|) = 0.918979;
strength = 50·(dominance + cappedConcentration) = 58.02626 (published 58.0262 is
this value truncated at 4dp; exact reconstruction rounds to 58.0263);
distanceEm = |spot−K|/EM_points; distanceFit = clamp((d−0.1)/0.4, 0, 1)
(fit 0.04→0, 0.2→0.25, 0.5→1); score = (25·dominance + 25·cappedConcentration
+ 0.05·strength + 45·distanceFit)·regimeMultiplier — reproduces 31.914435→31.914,
43.164435→43.164, 76.914435→76.914 exactly; candidate gate (0.1, 2.0] EM;
regime negative ×1 (positive 0.85 per the type union; zero ×1, unpublished).

## Deviations from the freeze (with reasons)
1. `delta?: NodeDeltaInput` instead of §2.3 `QualifiedDelta`: §2 belongs to a
   separate lane and `exposureMapProjection.ts` is frozen for this lane; the local
   type is the structural subset the reducer reads (unit + `${expiry}|${strike}`
   keyed covered cells). Delta coverage is cell-granular until that lane lands.
2. `runnerUp.strike` is 602, not the freeze text's "598 (nearer 600.24)": 602 is
   1.76 from spot vs 598 at 2.24, so the composed describeExposure order (magnitude,
   then spot distance, then lower strike) puts 602 first. tieSet [598, 602] matches.
3. strength's 4th published decimal: 58.026259… rounds to 58.0263; the freeze's
   58.0262 is a truncation. Asserted at 3dp (toBeCloseTo 58.0262, 3).
4. Scanner refusal reason strings beyond the four the freeze names
   (identity_incomplete, stale, no_dominant_node, empty_scope): the freeze gates
   `identityComplete`/`fresh` inputs without naming their reasons.
5. Node gross uses the covered per-cell sum (gross ?? known_gross) and is null
   only when no cell has any gross value — the literal §3 "Σ cell.gross (or
   known_gross when partial)"; the alternative node-level all-or-null reading
   would hide covered subtotals the partial diagnostics exist to show.
6. §4 rows for `exposureMapProjection.test.ts` (DEX extension cases) are the
   other lane's file and were not touched; `designRaw` here proves the parent
   reader path unchanged via the untouched incumbent suites.

## Commits / push
- af090917 reducer v1; a0a591aa DESIGN fixture tests; b24c442f unknown/partial +
  cell-level gross; d70bc7ac scanner oracle + refusal books.
- Push: `git push -u origin claude/r2-node-reducer-1021` → `* [new branch]`,
  exit 0. Branch is on origin; no PR opened (executor contract ends at push).

## Next step
PR1A/PR1B integration: rebase `NodeDeltaInput` onto the §2 lane's exported
`QualifiedDelta`, and F2 UI adoption in `ExposureScanner.tsx` (E7).
