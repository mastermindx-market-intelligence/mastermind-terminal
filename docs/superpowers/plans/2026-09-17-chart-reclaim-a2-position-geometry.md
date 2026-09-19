# Reversal & Reclaim A2a — original versus remaining opportunity

**Mission:** Existing Long/Short Position drawings must distinguish their original planned reward/risk from what remains at the last chart price, without implying a fill, live quote, outcome, recommendation or stop/target execution.
**Authority:** Chairman approved the charting audit and full leadership. Sol retains product/source responsibility. Base Terminal a9b615f41fc44a6cc6a3588ef1aace26226b3eec; current Skillpack Mastermind@8b231e8267f09cfb002ed3e87bec14906dce1720.
**Carrier:** CHART-RECLAIM-A2-GEOMETRY-20260917-SOL-001 / claude/chart-reclaim-a2-geometry-20260917-sol-001. Disjoint from A1 #602 except eventual common-master integration; no A1 source is copied.

## Exact design
Extend the existing drawing-settings math with a pure `calculatePositionOpportunity(kind, points, referencePrice)` result. Derive original R from the existing three semantic controls: entry points[0], target points[1], stop points[2]. Accept only finite positive ordered geometry (long target > entry > stop; short target < entry < stop). Return unavailable rather than pretending malformed prices are zero-risk trades.

For a reference strictly inside the target/stop boundaries, remaining R is distance(reference,target)/distance(reference,stop). At or beyond a boundary, remainingR is null and state says `at_target` or `beyond_stop`; those are geometric descriptions, not historical outcomes. Missing reference yields missing_reference. Distinguish at_entry/before_entry/after_entry for inspectable evidence, not signals.

The current position drawing keeps its sizing/target/stop labels and adds a compact bilingual `Plan 2.80R · Left 1.18R` chip underneath the entry label. The always-visible secondary line says last-chart-price basis and before-costs. Native SVG title gives reference date/price and planning-only disclosure. Reference is barsRef.current's last original OHLC close, not a transformed Heikin candle or invented realtime quote. Replay uses the existing chart prefix. No persistence, new account setting or altered saved drawing.

Dark treatment: existing chart panel material, muted numeric foreground, token hairline; important R remains legible without neon signal colors. Light treatment: existing panel white/cool material with darker text and hairline, not inverted trade colors. Both preserve the same small chip geometry. Maximum visible text is clamped to chart width without reducing font size; full text survives in accessible label/title. No pointer interception; existing drawing selection/drag owner remains.

## Files and tests
- terminal/lib/drawing-engine/settings.ts: pure opportunity geometry.
- terminal/lib/__tests__/positionOpportunity.test.ts: long/short mirror, screenshot example, reference/boundary/missing/invalid geometry, finite numbers, no mutation, old sizing unchanged.
- terminal/components/ChartPanel.tsx: existing position branch only plus its import.
- terminal/lib/i18n.tsx: English/Chinese labels in existing LEX.
- terminal/e2e/position-opportunity.spec.ts: actual chart/drawing/last-bar path, light/dark × EN/ZH × existing desktop/tablet/mobile projects, no production credentials and no altered globals.

## Ordered delivery
1. Run existing drawing baseline. Add red geometry tests, observe assertion failures on absent capability.
2. Implement pure math, turn tests green. No change to sizing or saved state.
3. Integrate visible label in the real position renderer, then browser tests with inspectable chart reference and screenshot evidence.
4. Typecheck/full-unit, source diff review, independent exact-head review, required native checks, canonical deployment and real-state proof. An open PR is not delivered UI.

## Parent frontier
This is one useful A2 sub-slice, NOT the Reversal & Reclaim workspace itself. Cross-suite task presets, linked price/oscillator evidence, truthful pending/confirmed views and the full chart-to-decision journey remain owed. Keep TOI/Live Entry Radar/Options Alpha owners and validation gates. No new signal score or trade authority.
