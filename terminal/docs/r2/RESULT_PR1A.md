# RESULT_PR1A — qualified per-cell DEX extension (freeze §2 only)

STATUS: DONE

## Baseline
- branch: claude/r2-dex-extension-1021 @ ea7b2028
- pre-edit vitest (exposureMapProjection.test.ts): 28 passed (28)

## Files changed
- `terminal/lib/exposureMapProjection.ts` — exported `Metric`; extracted `validMetric`
  verbatim (V8: delta is Gamma-class for the dated value ban and the known-subtotal
  requirement; incumbent gamma/vanna/charm verdicts unchanged); added
  `DELTA_EXTENSION_SCHEMA`/`DELTA_ENCODING`/`DELTA_UNIT`, `DeltaRefusal`,
  `QualifiedDelta`, `DeltaRead`, `qualifiedDeltaExtension` (V1–V11), `deltaProjectionNodes`.
- `terminal/lib/exposureMap.ts` — `readSource` delta branch only: qualified DEX feeds
  `deltaProjectionNodes` + `exposureNodes(..., covered/complete)`; any refusal falls
  through to the labelled legacy `delta_net` reference, never merged.
- `terminal/lib/__tests__/fixtures/exposure-projection-dex-v2.json` — new synthetic
  witness (`_note` carried), 2 expiries × 2 strikes, complete `delta_extension`
  (put +400,000 from native Δ −0.4; net +900,000).
- `terminal/lib/__tests__/exposureMapProjection.test.ts` — appended 16 cases
  (28 → 44): acceptance/table-reuse, short-put sign, it.each over
  absent/not_v2_wire/mixed_encoding/wrong_root/receipt_mismatch/oversized/
  misaligned/payload_limit/source_unqualified, provenance + never-zero-fill,
  v1-payload mixed encodings, payload_limit legacy retention, parent-reader
  strictness (fourth tuple, 4-metric order, `metric_units.delta`).

## Deviations from the freeze (with reasons)
- `expandExposureProjection` now exact-keys `metric_units` (added
  `!exactKeys(raw.metric_units, metrics)`). Required by the freeze §4 row
  "Python-style `metric_units.delta` added → null"; all existing fixtures carry
  exactly the three incumbent units, so existing results are byte-identical
  (28 pre-edit cases stayed green, post-edit run unchanged).
- `validMetric` returns a typed verdict (`null` | `invalid_metric` |
  `provenance_unqualified`) instead of boolean so a delta refusal can surface
  `provenance_unqualified` per V10; incumbent callers map any non-null verdict
  to the old whole-projection `null`, so parent behaviour is unchanged.
- Consumer `DELTA_RAW_UNIT` is not exported: V10 is implemented as
  `greek_provenance.delta.unit === delta_extension.raw_unit` exactly as the
  freeze words it; the consumer export list names only the three constants.

## Gates
1. `npx vitest run lib/__tests__/exposureMapProjection.test.ts
   lib/__tests__/exposureMap.test.ts lib/__tests__/exposureMapOneSided.test.ts
   lib/__tests__/exposureMapQqqProducer.test.ts` →
   `Test Files  4 passed (4)` / `Tests  57 passed (57)`
2. `npx tsc --noEmit -p .` → clean, exit 0
3. `npx eslint lib/exposureMapProjection.ts lib/exposureMap.ts
   lib/__tests__/exposureMapProjection.test.ts` → clean, exit 0

## Commit / push
- final commit: "Qualify per-cell DEX extension on the v2 exposure projection" — 3fe9ef90
  (preceded by 09a1b57e: validMetric extraction + readers)
- push: origin/claude/r2-dex-extension-1021
