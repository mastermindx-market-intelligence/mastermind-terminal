# PR964 Review — HEAD 54bf1bc931832655b7c0ca4de24e26fbab598d11

## Hashes reviewed (no tests executed)

| File | SHA256 |
|---|---|
| `terminal/lib/futuresGexVisual.ts` | `d03a63459ddfef8a06d98f9bc5f812686c3226d2c035c1a0805286e6b835bd76` |
| `terminal/components/futures/FuturesMicrostructureChart.tsx` | `bcf4851c92ac1438e37dfa2f7b021855ac71f4f63bd09cad6d17ba9550e300ec` |
| `terminal/lib/__tests__/futuresGexVisual.test.ts` | `6bba6b0a636bfcb11853d2513187a61f69424e4c725dec1ef64033778dd61070` |
| `terminal/e2e/futures-density.spec.ts` | `3408d258aa9ffd49ba9de0d4ef451eefe3cbbeb574a675556feb7d783bce3e84` |
| Navigation delta | `OptionsWorkspace.module.css` + `OptionsWorkspace.tsx` (link moved into existing category row) |

## Scope confirmation
Only this newly added visible-prefix display scale, its filtering, integration into the chart, and the navigation structural diff. The earlier immutable domain source at 5ea5 is owned by another worker and not re-audited. Source custody / admission / live-capacity are out of scope. No execution, network, source writes, permission changes, merge or deploy.

## Result: no blocking findings

The supplied semantics are internally consistent and the delta does what it claims:

- **Offscreen exclusion.** `futuresGexVisual.ts:16` filters `row.futuresPrice` via `futuresGexInView` against the same `lo/hi` used at the chart layer; the bubble path at `FuturesMicrostructureChart.tsx:104` uses the same predicate, and the right-edge `bar` path at `FuturesMicrostructureChart.tsx:120` uses the equivalent `y(p) ∈ [top, bottom]` gate. E2E confirms 4872 → 72 SVG circles with all 203 inspector rows retained.
- **Billion-dollar relative size.** `futuresGexVisual.ts:21-23` produces a 1/2/5×10^n upper bound; test 1 pins `[800, -1600, 3200] → limitMn=5000` and the no-mutation witness (`expect(f).toEqual(before)`) holds. Pre-fix saturation at 400M is genuinely gone.
- **Zero vs missing.** `futuresGexVisual.ts:16` uses `=== null` (not `!Number.isFinite`), so `null` is excluded but `0` is counted (`knownPoints`) without inflating `maximumMn`. Test 3 verifies.
- **Overflow.** `Number.MAX_VALUE` → `log10` floors to 308, `[1,2,5,10]·10^308` produces `[finite, ∞, ∞, ∞]`; `Number.isFinite` filter + `candidate ?? maximumMn` falls back to a finite value. Test 3 verifies.
- **Inclusive edges / NaN.** `futuresGexInView` uses `>=` / `<=` plus `Number.isFinite(price)`. Test 4 pins both edges and the NaN false-branch.
- **Label units.** `futuresGexScaleLabel` (`futuresGexVisual.ts:26-31`) routes ≥1e9 through `toExponential(2)`, ≥1000 through `(value/1000).toLocaleString(... { maximumFractionDigits: 2 })` with explicit "-" sign for negative, else `toLocaleString("…", { maximumSignificantDigits: 3 })`. Test 4 pins `-1600 → "-1.6B"`, `5000 → "5B"`, `500 → "500M"`, `1e100 → "1.00e+100M"`. Sign handling on negatives is correct in both B and M ranges (exponential branch uses `valueMn.toExponential` directly, so the negative sign rides through).
- **React rendering.** Pure render from props; `useId()`/`useRef()` only; no effects, no state that could loop. Bubble and bar radii/widths clamp via `Math.min(1, …)` / `Math.min(gammaWidth, …)`, so a1-fallback `limitMn` cannot produce NaN/Infinity widths.
- **Test discrimination.** The four unit tests combine exact `toEqual` shapes (catches any algorithm change), an `< 1000` upper bound tied to offscreen exclusion (test 2), and exact label strings (test 4). The e2e pins three independent witnesses: absolute counts (72 circles, 203 inspector rows), strict ordering of the first three radii (catches saturation regressions), and the "5B" label literal.

## Minor non-blocking observations (not findings)

- `FuturesMicrostructureChart.tsx:119` renders right-edge gamma bars only for `current` (last frame), while the scale spans all `visible` frames. If the largest visible-frame magnitude is in an earlier frame, current-frame bars render small — consistent with the labeled "visible range" semantics and unchanged by this delta, so out of scope.
- Unit tests pull from the e2e fixture (`browserFuturesFixture`), which couples `knownPoints: 3` and the e2e `toHaveCount(203)` to that fixture's mapped-row count. The fixture is stable here, and the assertions would catch a row-count drift; flagged for awareness only.
- CSS tokens in the navigation delta (`--line`, `--r-pill`, `--text-2`, `--text`, `--panel-2`, `--brand-2`, `--font-ui`) are assumed to be defined globally per the rest of the design system; not verified in this review.

## Conclusion
No blocking findings for this bounded delta. The visible-prefix scale, the offscreen filter at bubble and bar render sites, the inclusive edge / zero-vs-null / overflow handling, and the navigation structural move are internally consistent and the tests genuinely discriminate the regression modes the delta is meant to fix.
