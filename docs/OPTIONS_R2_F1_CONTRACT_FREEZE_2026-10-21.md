> Repository copy (2026-10-22) of the F1 contract freeze written by the read-only Opus data/quant suborchestrator on 2026-10-21. ERRATA, per Agent OS decision DEC:OPTIONS-R2-ORACLE-OUTRANKS-FREEZE-TEXT: where this text disagrees with the attached `quant_oracles.py` (terrashade-quant-oracles/1.0.0), the oracle governs. Two known errata: `distance_fit` is the trapezoid 0 for d ≤ 0.1, (d − 0.1)/0.4 up to 0.5, 1 through 2.0, (4 − d)/2 down to 4.0, 0 beyond, and null on a negative or non-finite distance (not "capped at 1"); the TypeScript port therefore returns `number | null`, not `number`. The scenario golden (+184,702,119.15) is reproduced from the unrounded move fraction; never from a rounded −0.04 %.

# F1 contract freeze: qualified per-cell DEX extension and node reducer v1

Author: Opus suborchestrator A (data/quant), read-only. Baselines: Terminal master `e3ca39a82`; Macro `origin/main` `e5dd30c63`.
The package pinned Macro at `90eb4df17`. Every producer anchor below was re-read at `e5dd30c63`.
Line anchors are `file:Lstart–Lend` on those heads.
Lane note: the glm census lane (`pool run glm`) was refused before launch with `LOCAL_SEAT_REMOTE_REQUIRED host=m2`, exit 78. I did not switch carriers, and all extraction was done directly.
Evidence class of this document: **source_implemented → specification only**. It contains no production, rights or statistical claim.

## 1. Oracle reproduction

| Check | Claimed | Observed | Status |
|---|---|---|---|
| `quant_oracles.py` (sha256 `e23eb6a3…c7e6f1`, pin `3d75cc73`) run under `python3 -I`, with `--output`/`--fixtures-output` under `$SP/work/oracle_run/` | 499 checks | `all_passed true, checks 499, passed 499, failed 0` (Python 3.14.7) | REPRODUCED |
| Reverse zero-gamma root: +1 at K95, −1 at K105, σ .20, τ 30/365, r=q=0 | 99.71087869045874 | bisection 99.71087869045874 (46 iterations, bracket width 5.7e−13). Closed form √(K₁K₂)·e^(−σ²τ/2) = 99.71087869045856. Orientation positive_to_negative; GEX at −0.01 is +1.447, at +0.01 is −1.447 | REPRODUCED |
| Scenario: S0 600.24→600, GEX −1.383B, VEX 220M, CEX −80M, Δσ −0.01, 0.25 day | +184.702119M | H = −G·(ΔS/S0/0.01) − V·(Δσ/0.01) − C·days. The spot term is −55,297,880.85 (−0.039984 % move), vol +220,000,000, time +20,000,000, total **+184,702,119.15**. Rounding the move to −0.04 % gives 184.68M, so the unrounded fraction is required | REPRODUCED (independent arithmetic; this case is not inside the oracle) |
| Fixture parity | `reference/quant_oracles_fixtures.json` | The oracle regenerated its own fixtures (sha256 `7944d7db…367042`). The reference file was **not attached**, so a byte-compare against it was impossible | NOT REPRODUCIBLE |
| DESIGN 11×6 synthetic book | `designs/synthetic_fixture.json` | Not attached. The published aggregates are internally consistent: 621/2,703 = 22.975 %; 471/621 = 0.75845; −0.24/600.24 = −0.039984 %. §4 freezes a reconstruction that matches every published aggregate | AGGREGATES ONLY |

## 2. Producer/consumer DEX compatible extension

**Decision.** Add a new named top-level block, `delta_extension`, to the unchanged `options_hub.exposure_projection/v2` envelope.

**Rejected alternatives.**
- A new `cell_encoding`: the incumbent reader refuses any `cell_encoding !== "tuple-v1"` (`exposureMapProjection.ts:L180`). During a mixed-version rollout, deployed and cached readers would lose Gamma.
- A fourth tuple slot: forbidden, and already refused by the `row[3].length !== 3` check (`exposureMapProjection.ts:L191–192`).

**Why old readers are unaffected.** Neither the top-level Terminal validator (`qualifiedExposureProjection`, L211–222) nor Python `expand_projection_cells` (`options_exposure_projection.py:L92–125`) exact-keys the envelope. Both therefore ignore the block. `expandExposureProjection` spreads `...raw` (L207), so the block survives expansion for the new validator.

**Unit `usd_delta_notional`.**
- It is the memo's `delta_notional_usd` field and the `exposure_math.EXPOSURE_UNITS["delta"] = "level"` quantity: `base·Δ·S`, with base = ±OI·100 (`exposure_math.py:L161–171`).
- Unlike the `usd_delta_per_*` shock units it has no "per", so it can never enter `-(G·s + V·v + C·t)`.
- The raw unit is `underlying_shares_per_option_share`, which is the feed's "shares per share".

### 2.1 Wire shape (producer → consumer)

```json
"delta_extension": {
  "schema": "options_hub.exposure_delta_extension/v1", "encoding": "dex-tuple-v1",
  "root": "SPY", "kind": "<parent kind>", "input_sha256": "<parent input_sha256>", "population_id": "<parent population.id>",
  "unit": "usd_delta_notional", "raw_unit": "underlying_shares_per_option_share",
  "position_basis": "assumed_long_call_short_put", "scale": "dollars",
  "capabilities": {"delta_cells": true, "scenario_term": false, "joint_member": false},
  "row_fields": ["expiry_index", "strike", "metric"],
  "metric_fields": ["expected","received","qualified","missing","status_index","net","gross","known_net","known_gross","qualified_population_index","call","put","exclusions"],
  "cells_status": "complete" | "source_unqualified" | "payload_limit", "cell_count": <parent cell_count>,
  "summary": [<13-field tuple, whole population; same semantics as metrics.gamma>],
  "cells": [[<expiry_index>, <strike>, [<13-field tuple>]], ...]
}
```

**What is reused rather than redefined.**
- The tables `expiry_terms`, `population_ids` and `metric_statuses` are the parent's. Their indices are parent indices, and no second table is allowed.
- The receipt is `greek_provenance.delta` = `{source_ref, model_ref, method, tenor_policy, unit: raw_unit}` inside the parent's existing `greek_provenance`. `source_ref` must equal `source_snapshot_ref`.
- The parent clocks, input digest and population digest are reused unchanged.
- `cells[i]` is index-aligned with parent `cells[i]` and echoes its `[expiry_index, strike]`.
- The parent `joint` tuple keeps its meaning of G/V/C only, so DEX never sets `joint.complete`.

### 2.2 Producer rules (Macro, follow-on PR; `engine/options_exposure_projection.py`)

| Rule | Anchor / function |
|---|---|
| Compute DEX once through `dealer_exposures(is_call, oi, spot, delta=[Δ])["delta"]`. A short put's native Δ<0 multiplied by sign −1 gives a **positive** put DEX. Never use `abs(Δ)` and never negate twice | `build_exposure_projection` row loop (L560–590; `dealer_exposures` call L585) |
| `METRIC_UNITS`/`CELL_FIELDS`/`METRIC_FIELDS`/`metric_order` stay byte-identical. Add new constants `DELTA_UNIT`, `DELTA_RAW_UNIT`, `DELTA_EXTENSION_SCHEMA` and `DELTA_ENCODING` | L27–51 |
| `_summary(rows, metric, expected_known, *, both_sides, unit=None)`: the unit override serves `"delta"`, and the semantics are otherwise unchanged (gross = Σ\|contract\| before netting; known_* hold the covered subset) | L386–418 |
| `encode_delta_extension(cells, wire) -> dict` and `expand_delta_extension(projection) -> list[dict]` are the Python reference pair (round-trip tested) | new, beside L53/L92 |
| Zero OI gives a measured 0.0. A missing Δ gives `greek_missing` (counted, never 0). The same exclusions, identity and terms guards apply as for Gamma | L564 `dated_metric_unavailable`, L579 `greek_missing`, L585 |
| Dated class: emit only with `greek_provenance.delta.method == "provider_observed"` and the dated tenor. The parent `DATED_CAPABILITIES` stays byte-identical, and Vanna/Charm stay `dated_metric_unavailable` even at zero OI | L24–25, L564 |
| Byte budget: `fit_gex_transport` **first** withholds only the extension (`cells_status:"payload_limit"`, `cells:[]`, summary kept). Only then does it withhold the whole projection, as it does today | L150–165 |

### 2.3 Consumer validation (Terminal `lib/exposureMapProjection.ts`)

```ts
export const DELTA_EXTENSION_SCHEMA = "options_hub.exposure_delta_extension/v1";
export const DELTA_ENCODING = "dex-tuple-v1"; export const DELTA_UNIT = "usd_delta_notional";
export type DeltaRefusal = "absent" | "not_v2_wire" | "mixed_encoding" | "wrong_root" | "receipt_mismatch"
  | "oversized" | "misaligned" | "payload_limit" | "source_unqualified" | "provenance_unqualified" | "invalid_metric";
export interface QualifiedDelta { unit: typeof DELTA_UNIT; kind: QualifiedProjection["kind"]; populationId: string;
  inputSha256: string; summary: Metric; cells: ReadonlyMap<string /* `${expiry}|${strike}` */, Metric> }
export type DeltaRead = { status: "qualified"; delta: QualifiedDelta } | { status: "refused"; reason: DeltaRefusal };
export function qualifiedDeltaExtension(raw: unknown, p: QualifiedProjection, root: string, session: string): DeltaRead;
export function deltaProjectionNodes(p: QualifiedProjection, d: QualifiedDelta, lens: ExposureLens, now?: number):
  { rows: ExposureNodeInput[]; coverage: {expected: number|null; received: number; qualified: number; missing: number}; coveredOnly: boolean };
```

| # | Rule (in order) | Refusal |
|---|---|---|
| V0 | `qualifiedExposureProjection` and `expandExposureProjection` keep their signatures and results. Their outputs for gamma/vanna/charm are deep-equal whether or not `delta_extension` is present. `QualifiedMetric` stays `"gamma"\|"vanna"\|"charm"` (L5), and `metrics` (L29) stays three entries | (none; the parent is unaffected) |
| V1 | Key absent → DEX unavailable. `exposureMap.ts:L87` keeps the labelled legacy aggregate reference (`delta_net`). The two are **never** merged per strike | `absent` |
| V2 | The raw schema must be `…/v2` with `cell_encoding:"tuple-v1"`. A v1 verbose raw payload with any `cells[].delta`, or an extension on a v1 raw payload, is refused | `not_v2_wire` / `mixed_encoding` |
| V3 | `schema`, `encoding`, `row_fields` and `metric_fields` must match exactly (JSON-equal), and `capabilities` must be exactKeys with exactly those values. A metric tuple of length ≠ 13 or a row of length ≠ 3 is refused | `mixed_encoding` |
| V4 | `root === p.root === root`. `input_sha256`, `population_id` and `kind` must equal the parent's. `position_basis`, `scale` and `unit` must be exact | `wrong_root` / `receipt_mismatch` |
| V5 | `cells_status` is `payload_limit` or `source_unqualified`. Gamma stays qualified | same name |
| V6 | `cells.length > 50_000`, or `cell_count !== p.cells.length` | `oversized` |
| V7 | `cells.length !== raw.cells.length`, or `row[0]/row[1]` ≠ parent `raw.cells[i][0]/[1]`, or an index is outside the parent tables | `misaligned` |
| V8 | Each tuple passes `validMetric(raw, cell, m, "delta", dated, session)`. This helper is **extracted unchanged** from L268–302 and runs for gamma/vanna/charm exactly as today. The only `"delta"` extensions: DEX is treated as Gamma-class for the dated value ban (L273) and the partial known-subtotal requirement (L286–287) | `invalid_metric` |
| V9 | When both sides are non-null, `\|net − (call+put)\| ≤ 1e-9·max(1,\|net\|)`. A positive `put` is accepted as is, with no sign coercion in the consumer | `invalid_metric` |
| V10 | `greek_provenance.delta` must carry a `model_ref` and a `source_ref === source_snapshot_ref` whenever any gross or known_gross ≠ 0, and `unit === raw_unit` | `provenance_unqualified` |
| V11 | Any single refusal refuses the whole extension; there is no partial row salvage. An unknown cell keeps `net`/`known_net` null and never becomes 0 | (as above) |

Consumer wiring:
- `exposureMap.ts` `readSource` (L87–99): for `metric === "delta"` with `DeltaRead.status === "qualified"`, use `deltaProjectionNodes` and then `exposureNodes(rows, qualifiedSpot, null, coveredOnly ? "covered" : "complete")`.
- Otherwise the existing L109–133 legacy path runs unchanged and keeps its reference label.
- `projectedExposureScenario` (L391–411) never reads DEX.

## 3. Node reducer v1

**File: new `terminal/lib/exposureNodeReducer.ts`.**
- It composes `exposureMapProjection` (rows), `marketStructure.exposureNodes` (totals, exact ties, spot tie-break) and `exposureWorkspace.describeExposure` (ranking, runner-up ratio, ≥0.9, share), and wraps all of them without forking.
- Putting it in `exposureWorkspace.ts` would make that 190-line geometry module import the projection validator. `lib/exposureNodes.ts` would collide with the existing `__tests__/exposureNodes.test.ts`, which tests `marketStructure.exposureNodes`.
- Units are $mn, matching `ExposureNodeInput`. USD cell values are summed in canonical (strike, expiry) order before being divided by 1e6 once.

```ts
export const NODE_REDUCER_VERSION = "exposure-node-reducer/v1";
export const CONTESTED_VERSION = "runner-up-ratio/v1"; export const CONTESTED_THRESHOLD = 0.9;
export const SCANNER_VERSION = "e7-reconstruction/v1";
export type NodeMetric = "gamma" | "delta";
export type NodeScope = { kind: "all_expiries" } | { kind: "filtered_expiries"; lens: ExposureLens["kind"]; expiries: readonly string[] /* sorted, unique */ };
export interface NodePopulationIdentity { reducer: typeof NODE_REDUCER_VERSION; root: string; kind: QualifiedProjection["kind"];
  populationId: string; inputSha256: string; sourceSnapshotRef: string; metric: NodeMetric; unit: string;
  scope: NodeScope; scopeKey: string /* "all" | "exp:2026-10-21,2026-10-23" */; cellCount: number; strikeCount: number }
export interface NodeRef { strike: number; net: number; sign: 1 | -1; tieSet: number[] }
export interface ExposureNodeReduction {
  identity: NodePopulationIdentity; status: "ok" | "partial" | "empty" | "zero" | "net_cancelled";
  partial: boolean; basis: "whole_population" | "known_subset";
  net: number | null; gross: number | null; absoluteStrikeNet: number | null;
  dominantNode: NodeRef | null; largestPositive: NodeRef | null; largestNegative: NodeRef | null;
  concentration: { numerator: number; denominator: number; share: number; denominatorKind: "absolute_strike_net"; wholePopulationKnown: boolean } | null;
  contested: { version: typeof CONTESTED_VERSION; threshold: 0.9; ratio: number; contested: boolean; runnerUp: NodeRef | null; basis: ExposureNodeReduction["basis"] } | null;
  center: { strike: number; weights: "absolute_strike_net"; totalWeight: number } | null;
  unknownStrikes: number[]; coverage: { expected: number | null; received: number; qualified: number; missing: number };
  scannerScore: number | null; scanner: ScannerResult }
export interface ExpectedMoveInput { points: number; horizon: string; sourceRef: string }
export type ScannerResult = { status: "unavailable"; reasons: string[] } | { status: "ok"; version: typeof SCANNER_VERSION;
  dominance: number; cappedConcentration: number; strength: number; distanceEm: number; distanceFit: number;
  regimeMultiplier: 0.85 | 1; score: number; candidateEligible: boolean; candidateScore: number | null; direction: "above" | "below" | "at_spot" };
export function resolveNodeScope(p: QualifiedProjection, lens: ExposureLens, now: number): NodeScope;
export function reduceExposureNodes(p: QualifiedProjection, o: { metric: NodeMetric; lens: ExposureLens; spot: number | null;
  delta?: QualifiedDelta | null; expectedMove?: ExpectedMoveInput | null; fresh: boolean; now: number }): ExposureNodeReduction;
export function distanceFit(distanceEm: number): number;          // exact port of oracle distance_fit
export function scannerScore(a: { spot: number | null; strike: number | null; expectedMove: number | null; a1: number; a2: number;
  absoluteStrikeNet: number; regime: "positive" | "negative" | "zero" | null; identityComplete: boolean; fresh: boolean; coverageComplete: boolean }): ScannerResult;
```

Semantics. Every invariant is named as a test in `__tests__/exposureNodeReducer.test.ts`.

| Invariant (test name) | Rule |
|---|---|
| `uses only the explicit eligible population of the resolved scope` | cells = `selectedProjectionCells(p, lens, now)`. An empty result gives status `empty` with every measure null |
| `names all-expiry and filtered reductions as distinct identities` | `lens.kind==="all"` gives `all_expiries`; anything else gives `filtered_expiries` with an explicit expiry list. Different `scopeKey`, so a filtered leader never relabels the global leader (P18/P19) |
| `dominant is argmax abs strike net with its sign and full tie set` | `dominantNode.strike === exposureNodes(rows).netLeader.strike` and `tieSet === netTies` (exact equality after canonical summation). Its order is `describeExposure.ranked[0]`: magnitude, then distance to spot, then lower strike |
| `gross is the sum of contract absolutes before cancellation` | gross = Σ cell.gross (or known_gross when partial). It is never derived from nets and is null if any selected cell lacks gross |
| `absolute strike net sums netted strikes` | absoluteStrikeNet = Σ_k \|Σ_exp net\| |
| `concentration declares its denominator and population knowledge` | numerator a1, denominator absoluteStrikeNet, share = `describeExposure.absoluteNetShare` when whole. `wholePopulationKnown = !partial` (always false when partial) |
| `contested uses the versioned runner-up ratio at 0.90` | ratio = a2/a1 from `describeExposure.runnerUpRatio`. Wrapper rule: exactly one nonzero strike gives ratio 0, contested false, runnerUp null. a1 = 0 gives contested null |
| `partial reductions are known-subset diagnostics with a null scanner score` | partial ⇔ ∃ selected cell with `metric.net === null`. Then basis is `known_subset`, values come from known_* only, `scannerScore === null`, and the scanner reason is `insufficient_coverage` |
| `unknown strikes stay unknown and outside ranking and ties` | a strike with no known cell gets netMn null, is listed in `unknownStrikes`, and is absent from tieSet and ranking |
| `center uses nonnegative absolute weights and refuses zero weight` | center = ΣK\|N_k\|/ΣA. A zero total weight gives null. The signed moment is never emitted as a center |
| `cancelled and zero books have no dominant node` | gross > 0 with all \|N_k\| = 0 gives `net_cancelled`; gross = 0 gives `zero`. dominant, concentration, contested and center are all null |
| `scanner ports the E7 reconstruction exactly` | regime = sign of the **gamma** reduction's whole-population net at the same identity. The delta metric gives `scannerScore:null` with reason `metric_not_scanned`. A missing EM gives `missing_expected_move`; EM ≤ 0 gives `invalid_expected_move`. Missing EM is never treated as zero distance |
| `reduction has no viewport input` | the signature takes no rows/window. Display clipping happens after reduction, in presentation |

## 4. Fixtures to add (vitest)

**DESIGN reconstruction** (the original JSON was not attached; this matches every published aggregate).

Book:
- SPY, session 2026-10-15 (the existing `producer` v1 fixture clocks), spot 600.24.
- Expiries E1–E6: 2026-10-16, **2026-10-21**, 2026-10-23, 2026-10-30, 2026-11-20, 2026-12-18.

Strike nets ($mn), 595→605: −60, −100, −150, **−471**, −170, **−621**, +90, **−471**, +120, +300, +150.
- Σ = −1,383; Σ|·| = 2,703.
- Put wall 600, call wall 604. Center 600.39956 (derived, not a DESIGN number).

Strike 600 cells: [−160, **−148**, −120, −90, −63, −40]. Every other strike is split with integer weights [24, 26, 19, 15, 10, 6] %, truncated toward zero, with the remainder in E6.

Cell values:
- every cell has gross = |net| + 50, so total gross is **6,003M** (≠ 2,703 ≠ 1,383);
- Vanna/Charm unavailable; `joint.complete` false.

Build it as `designRaw()` from `structuredClone(producer)` so that it passes `qualifiedExposureProjection(raw,"SPY","2026-10-15",now)`.

| File | Case name | Discriminating assertion |
|---|---|---|
| `lib/__tests__/exposureMapProjection.test.ts` (extend) | `rejects a silent fourth metric tuple and a four-member metric order` | `producerV2` with `cells[0][3].push(cells[0][3][0])` gives `parse` → null; `metric_order` with `"delta"` appended → null; Python-style `metric_units.delta` added → null |
| same | `ignores the delta extension in every incumbent reader result` | `parse(withExt)` minus `delta_extension` deep-equals `parse(producerV2)`; the projectionNodes gamma rows are identical |
| same | `qualifies an index-aligned DEX extension and reuses parent tables and receipt` | status `qualified`; `cells.get("<exp>\|<strike>").net` equals the wire value; the population index resolves through parent `population_ids` |
| same | `keeps the positive short-put DEX contribution from native negative delta` | fixture: call OI 100, Δ +0.5, S 100 gives call +500,000; put OI 100, Δ −0.4 gives put **+400,000**; net +900,000 → accepted, and `deltaProjectionNodes` netMn = **+0.9** (not +0.1, not −0.9) |
| same | `refuses wrong root, receipt mismatch, oversize, misalignment and mixed encodings` | one `it.each` per refusal reason in the V2–V7 table; gamma `parse` stays non-null in each case |
| same | `withholds only DEX at payload_limit and never promotes the legacy delta reference` | `cells_status:"payload_limit"` gives refused `payload_limit`; the `readExposureMap(…,"delta")` source stays the labelled reference and its per-strike values are not mixed |
| same | `requires delta provenance and never zero-fills a missing delta cell` | a missing `greek_provenance.delta` gives `provenance_unqualified`; a cell with missing>0 and net≠null gives `invalid_metric`; an unavailable cell keeps net null |
| `lib/__tests__/exposureNodeReducer.test.ts` (new) | `reproduces the DESIGN book aggregates` | net **−1,383**; dominant `{600, −621, sign −1, tieSet [600]}`; `selectedProjectionCells(p,{kind:"one",exp:"2026-10-21"})` 600 cell gamma.net/1e6 **−148**; absoluteStrikeNet **2,703**; share **0.22974** (shown 23.0 %); gross **6,003** |
| same | `DESIGN runner-up tie at 0.76 is not contested` | ratio 471/621 = **0.75845**; contested **false**; runnerUp.tieSet **[598, 602]**, with runnerUp.strike 598 (nearer 600.24) |
| same | `0.90 is contested and just below is not` | a1 = 100, a2 = 90 gives true; a2 = 89.99 gives false; equal leaders 95/105 at ±40 give tieSet [95,105], and the dominant for spot 99 is 95 for **any input order** |
| same | `unknown cell is never zero` | one 599 cell set unavailable (net and known null): status `partial`; the 599 node uses known E1–E5 only; a strike with *all* cells unknown is in `unknownStrikes`; `net !== −1,383`; no `0` appears for that strike |
| same | `partial implies null scanner score` | the same partial book with EM 1.2 gives `scannerScore === null`, reason includes `insufficient_coverage`, and `concentration.wholePopulationKnown === false` |
| same | `display clipping cannot change totals or the dominant node` | add far strike 470 at −900 (outside ±20 % of 600.24): dominant **470**, net −2,283; a 160-strike/±20 % display window of the rows excludes 470, while the reduction object keeps 470 and is identical before and after windowing |
| same | `all-expiry and filtered leaders are separate identities` | lens one 2026-10-21 has a scopeKey that differs from `"all"`; its dominant comes from that expiry only, and the all-expiry reduction is unchanged after the filtered call |
| same | `scanner matches the oracle on the DESIGN dominant` | u .241546, c .918979, strength **58.0262**; regime negative (×1). EM 6.0 gives d .04, fit 0, score 31.914, candidateScore null. EM 1.2 gives fit .25, score **43.164**, eligible. EM 0.48 gives score 76.914 |
| same | `cancellation-heavy book keeps gross and nulls the center` | +50/−50 at one strike: net 0, gross 100, status `net_cancelled`, dominant null, center null (P11) |
| same | `delta reduction is not scanned` | metric `"delta"` gives `scannerScore:null` with reason `metric_not_scanned` |
| Macro `tests/test_options_exposure_projection.py` (producer PR) | `test_short_put_native_negative_delta_is_positive_dex`, `test_delta_extension_roundtrip_reuses_parent_tables`, `test_payload_limit_withholds_delta_extension_before_projection`, `test_v2_tuples_byte_identical_with_delta_extension`, `test_dated_delta_requires_provider_observed_provenance` | positive put DEX; exact round trip; Gamma retained at the DEX payload limit; incumbent bytes unchanged; dated Vanna/Charm still unavailable at zero OI |

## 5. E1–E10 engine contract freeze

| E | Frozen contract (F1 scope) | Owner file | Falsifier |
|---|---|---|---|
| E1 normalize/quality | Exact (root, exp, strike, right) plus series terms. A missing OI or Greek is counted, never 0. Duplicate keys are refused | Macro `engine/options_exposure_projection.py` (`_index` L206, row loop L560–590); `options_contract_identity.py`; Terminal `validDatedIdentity` L100–168 | `test_missing_oi_is_not_zero_and_stays_before_exclusions`; `unknown cell is never zero` |
| E2 IV/Greeks | Provider/owner Greeks only, with raw units declared. No IV inversion in F1 | Macro `engine/exposure_math.py`, `engine/intraday_greeks.py` | oracle `bsm_greeks` FD ≤ 5.7e−8; `test_elapsed_charm_sign_matches_existing_kernel_finite_difference` |
| E3 cube/nodes | §3 reducer: dominant, ties, gross before netting, declared denominator, contested v1, abs-weight center | Terminal `lib/exposureNodeReducer.ts` → `marketStructure.exposureNodes` L481–533, `exposureWorkspace.describeExposure` L86–164 | oracle `nodes_ties_zeros_and_cancellation`; DESIGN suite |
| E4 zero-gamma/regime | Roots and regime come from evaluated F(S), never "above flip". F1 does not compute roots | Macro `engine/gex_engine.py` `gamma_profile` L146, `_gamma_flip` L175 | reverse root 99.71087869045874, orientation positive→negative |
| E5 expected move | The scanner takes EM points only from the existing moves owner. Missing or invalid EM gives null | Terminal `exposureWorkspace.exposureMoveDistance` L175–190, `marketStructure.emFrame` | `partial implies null scanner score`; missing-EM case |
| E6 history/replay | The reduction identity binds populationId, inputSha256 and scopeKey. A refresh is a new identity, never an overwrite (P51/P52) | Macro history/publish owner (unchanged) | `test_membership_is_order_independent_and_correction_changes_identity` |
| E7 scanner | `e7-reconstruction/v1`, gamma only, candidate gate (0.1, 2.0] EM, labelled an attention ranking | Terminal `exposureNodeReducer.scannerScore` (UI adoption in F2: `ExposureScanner.tsx`) | oracle `scanner_piecewise_and_missingness` |
| E8 scenario | H = −(G·s + V·v + C·t) with spot fraction and vol points as separate inputs. Dated gives null. DEX is never a term | Terminal `projectedExposureScenario` L391–411, `marketStructure.scenarioGrid` L280–339 | +184,702,119.15 fixture; `supports dated Gamma without fabricating … scenario authority` |
| E9 path-to-node | Out of F1. No path or forecast output | none (not started) | no forecast field in any F1 type |
| E10 divergence | Out of F1 | existing TA/candle owner (not inspected) | n/a in F1 |

## 6. Open questions for Fable (defaults recommended)

1. **Dated-class DEX.** Default: the F1 consumer accepts a DEX extension on `dated_provider_approximation` only under the parent's unchanged valuation and five false capability flags. The producer emits it only with `provider_observed` delta provenance. Until then the delta metric keeps the labelled legacy reference.
2. **PR order and fixture provenance.** Default: Terminal PR-1 ships with a hand-built `fixtures/exposure-projection-dex-v2.json` labelled synthetic. The Macro producer PR then exports the real witness, which replaces it under a new "decodes the actual Python producer DEX witness" case.
3. **Scanner metric scope.** Default: v1 scores Gamma nodes only. Delta returns `scannerScore:null` (`metric_not_scanned`).
4. **Single nonzero node.** Default: the wrapper reports ratio 0, contested false and runnerUp null (as the oracle does). `describeExposure` keeps returning null and is not edited.
5. **Tie tolerance.** Default: exact equality after canonical (strike, expiry) USD summation, matching `exposureNodes`. Near-ties within the oracle's 1e-12 are left to `contested`. A tolerance change needs a `exposure-node-reducer/v2` bump.
