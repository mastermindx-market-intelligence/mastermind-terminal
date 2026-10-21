# Options R1 — W2 freeze (Packet 2 rotation integrity, Packet 4 persistence)

Frozen 2026-10-21 by the Options R1 commissioning session, after W1 integration (`docs/OPTIONS_R1_W1_FREEZE.md`, programme record `docs/OPTIONS_R1_PROGRAM.md`). Same rules as W1: every lane receives exact owner paths, acceptance names and a return location; a lane returns artifacts plus the checks it actually ran; the commissioning session integrates and judges. MASTERPLAN §6.3 lists the eleven gates; each is mapped below to a concrete test.

## 0. Owner map (existing code; read before touching anything)

Macro Dashboard (`/Users/chriswong/Documents/Cluade/Macro Dashboard`, work only in a worktree on the SSD policy root):

- `engine/sector_cycles.py::_leadership(close_full, ticker, bench="SPY", asof)` — the incumbent coordinates: `rs = close[ticker] / close[bench]` on the shared close frame, `rs_21d = rs.pct_change(21)`, `rs_63d = rs.pct_change(63)` (percent, 1 dp), minimum 210 RS rows else `thin_history`. `_apply_leadership` folds them into `now.rs_21d / rs_63d`. This is `incumbent_rs_63_21/v1`; it is never modified by W2.
- `scripts/build_sector_central.py` — writes `site/sectordata/` (`sector_central.json`, `sector_cycles.json`). The history contract the Terminal validates is `meta.rs_history = { schema: "sector_cycles.rs_history.v1", mode: "reconstructed_price_history", naturally_observed: false, basis: "tr", benchmark: "SPY", horizons_sessions: [21, 63], max_points_per_sector: 252 }`.
- `lib/nyse_calendar.py` — the only exchange calendar: `is_session`, `last_session_on_or_before`, `sessions_between`, `missing_sessions(have, start, end)`, `expected_last_session(now)`, `session_date`. W2A uses it for the completed-week endpoint; no second calendar.
- `collectors/sector_holdings.py` — top-20 holdings by weight per sector ETF, upserted into `data/sector_holdings/<FUND>.parquet` plus `history.parquet`. **Not present in the primary checkout** (`data/sector_holdings` absent); `config/dataset_registry.yml` registers only its `StockPriceAdapter` price store (`data/stocks/{ticker}.parquet`, total-return, Yahoo). W2B must first locate the live holdings store on the producing host.
- `config/rotation_universe.json` v2.0 — bench SPY; XLK, XLV, XLF, XLP, XLU, XLC, XLE, SMH, IGV and three baskets. The W2A sector universe is the sector ETFs the Sector Central feed already lists; baskets and donor/receiver pairs are out of scope.

Terminal (`terminal/`):

- `lib/sectorIntelligence.ts::sectorRotationHistory` — strict validator for the incumbent history; returns `null` on any contract mismatch (never partial). W2A adds a sibling validator, it does not loosen this one.
- `components/sector-intelligence/SectorRotationMap.tsx` + `lib/rotationEligibility.ts` (`placeRotation`, `placeRotationCohort`, `ROTATION_METHOD_INCUMBENT`, W1B placement) — the map, its shelf, its method drawer and `rotationShownReceipt`.
- `app/api/sector-intelligence/route.ts` — `PATHS` map (`sector`, `confluence`, `heatmap`, `risk`, `history`, `events`); every feed is served through this one owner with a `FeedReceipt`.
- `components/sector-intelligence/SectorCompanyComparison.tsx` — the holdings roster that mints the W1A origin; W2B coverage lands in its header.
- `lib/investigations.ts` (`INVESTIGATION_ADMISSION`, `applyInvestigationRevision`, `readInvestigation`, `readInvestigationOperation`) and `lib/investigationContracts.ts` (`investigation_manifest.v2`, 128 KB, `InvestigationEvidenceRef { owner, object_type, object_id, mode: "pinned" | "follow_head", version_ref?, fingerprint?, selection? }`; admission is a list of `{ owner, object_types }`, there is no adapter registry inside the contracts module) — the only persistence path for W2C.

## 0.1 Scoped dependency ledger

| Capability | Dependency | State | Blocks |
|---|---|---|---|
| W2A producer | Macro worktree + `data/stocks` price store on the producing host | price store registered PRODUCED; host access to be verified at lane launch | W2A-MACRO only; W2A-TERM starts on fixtures |
| W2A quant tolerance | the 0.01 convergence tolerance and 0.05 boundary band are proposed engineering gates | frozen here as *proposed*; the method drawer says so | nothing — disclosed |
| W2B | live `data/sector_holdings/*.parquet` | not located | W2B-MACRO HELD; W2B-TERM on fixtures |
| W2C | existing investigation RPCs, entitlement | available (used by earnings evidence today) | nothing |

## W2A frozen spec — original relative trend method `relative_trend_ema/v1`

### A1. Formula and policy (binding; MASTERPLAN §6.2–6.3)

- Inputs: the same total-return adjusted close series the incumbent uses (`basis: "tr"`), asset vs `SPY`. Never mix adjusted and unadjusted, or total-return and price-only, series.
- Weekly observation = the exchange-calendar final session of each **completed** week (NYSE, `America/New_York`). The expected endpoint is `last_session_on_or_before(sunday_of_week)`; if that session is a session but the provider row is missing for the asset *or* the benchmark, the week is `missing_endpoint` for that sector and **no coordinate is emitted** — never backshifted to the prior session. A genuine exchange holiday on Friday is not a missing endpoint: the calendar already names Thursday as that week's final session. The current, incomplete week is never emitted in v1.
- `q_t = P_asset,t / P_bench,t`; `X_t = 100 · EMA10(q)_t / EMA40(q)_t`; `Y_t = 100 · EMA3(X_t / X_{t−3})_t`; weekly index `t`.
- EMA recursion `alpha = 2 / (span + 1)`, seed = simple mean of the first `span` observations, then recursive. Alternative seeds are a gate-6 *report*, not a switch.
- History anchor: first completed week on or after `2016-01-01` for every series (fixed; a different anchor is a new version). Warm-up: observations before 120 completed weeks after the anchor are `warming_up` and carry no coordinate.
- Duplicate session rows → the vintage is rejected (`invalid_vintage`, nothing emitted for that sector). Nonpositive or nonfinite price in the observation window → that week `invalid_input`.
- Precision: 2 dp on `x` and `y`. Boundary: `|x − 100| ≤ 0.05` or `|y − 100| ≤ 0.05` → `boundary` with both actual values (proposed tolerance, disclosed). Trail: the last 12 completed weeks.
- Vintage: `sha256` over the asset and benchmark close rows up to and including the observation week, so a later vendor correction is a new vintage (gate 3).
- Labels: axes "Relative trend" (x) and "Trend momentum" (y), centre 100. Quadrant words may be reused only with the drawer sentence "105 is an indicator value, not a five-percent forecast".

### A2. Macro: `engine/rotation_relative_trend.py` (new, pure) + emitter

- Pure functions: `completed_week_endpoints(sessions: list[date], asof: date) -> list[WeekEndpoint]` (uses `lib/nyse_calendar`), `ema(values, span) -> list[float]` (seed rule above), `relative_trend(asset: pd.Series, bench: pd.Series, *, asof, anchor=date(2016,1,1)) -> list[Observation]` where `Observation = {week_end, x, y, status, vintage}` and `status ∈ {observed, boundary, warming_up, missing_endpoint, invalid_input}`.
- Emitter: `scripts/build_sector_central.py` writes `site/sectordata/sector_rotation_relative_trend.json`:
  `{ meta: { asOf, method: { id: "relative_trend_ema", version: "v1", center: 100, formula: "x=100*EMA10(q)/EMA40(q); y=100*EMA3(x/x[-3])", alpha_rule: "2/(span+1)", seed_rule: "sma_first_span", anchor: "2016-01-01", warmup_weeks: 120, endpoint_policy: "completed_week_last_session_no_backshift", basis: "tr", benchmark: "SPY", calendar: "NYSE", timezone: "America/New_York", trail_weeks: 12, boundary_tolerance: 0.05 }, vintage }, sectors: [ { id, ticker, kind: "sector", observations: [ { week_end, x, y, status, vintage } ] } ] }`.
  Sectors with `thin_history` or no price series are emitted with an empty `observations` array and `reason`, never dropped silently. The builder stays additive and never fatal for the other feeds.
- Tests `tests/test_rotation_relative_trend.py`, each able to fail (RED run quoted in the return):
  1. `constant relative ratio converges to 100/100 and is classified boundary, not leading` (gate 1)
  2. `scaling the asset or the benchmark by a constant leaves x and y unchanged after warm-up` (gate 2)
  3. `appending later rows does not change earlier observations within the same vintage` and `a corrected historical row produces a new vintage` (gate 3)
  4. `a missing Friday row yields missing_endpoint and never a Thursday observation`, `a Friday exchange holiday uses Thursday as the week endpoint`, `duplicate sessions reject the vintage`, `nonpositive and nonfinite prices yield invalid_input` (gate 4)
  5. `expanding the history prefix by 40, 80 and 120 weeks moves evaluation-window coordinates by less than 0.01 and changes no quadrant outside the boundary band` (gate 5)
  6. `seed sensitivity report on monotonic, oscillating, flat and shock fixtures states the maximum deviation` (gate 6 — a report assertion with a frozen ceiling, printed in the return)
  7. `steady compounding outperformance yields x above 100 while y tends to 100` (gate 11)
  8. `an options overlay cannot enter the coordinates` is satisfied by construction (the module imports no options data) and asserted by an import-surface test.

### A3. Terminal: parser, method switch, trail

- `lib/rotationRelativeTrend.ts` (new, pure): `sectorRotationRelativeTrend(data): SectorRotationRelativeTrend | null` validating the schema above exactly (unknown status, extra keys, non-monotonic `week_end`, `x`/`y` present on a non-coordinate status → `null`); `ROTATION_METHOD_RELATIVE_TREND = "relative_trend_ema/v1"`.
- `lib/rotationEligibility.ts`: `placeRotation(x, y, { center: 100, boundaryTolerance: 0.05 })` option (default stays `center 0`, exact-zero boundary); labels unchanged; existing tests unchanged, new cases added.
- `app/api/sector-intelligence/route.ts`: `PATHS.relative_trend = "/sectordata/sector_rotation_relative_trend.json"`.
- `SectorRotationMap.tsx`: explicit method switch (segmented control "Relative return · 63/21" | "Relative trend · weekly EMA", URL `rotationMethod=incumbent|relative_trend_ema`, default incumbent). Under the new method the axes read "Relative trend"/"Trend momentum", the scale is centred on 100, the trail is drawn only across consecutive `observed|boundary` weeks and breaks at any other status, the shelf lists `warming_up`/`missing_endpoint`/`invalid_input` sectors with those reasons, and `rotationShownReceipt` names the method, vintage and endpoint policy. Switching methods never relabels or re-plots saved/URL coordinates of the other method (gate 10). Chart, table (List view), tooltip and receipt read one value and date (gate 7, asserted by a test that compares the rendered strings). Gate 9 is a drawer disclosure ("present-day sector membership; no survivorship-free backtest claim").
- Tests: parser suite (every rejection path), eligibility tolerance cases, a jsdom map test for the switch and trail breaks, and an e2e in `e2e/rotation-relative-trend.spec.ts` on a fixture feed (desktop/tablet/mobile, EN/ZH, dark/light) plus a crop state added to `e2e/options-r1-w1-crops.spec.ts`'s successor packet.

## W2B frozen spec — holdings coverage, breadth and concentration

- Precondition (HOLD until met): locate the live `data/sector_holdings/<FUND>.parquet` store (producing host, freshness, fund list). The dataset registry does not register it; registering it is part of the Macro lane.
- Macro emitter `scripts/build_sector_holdings_coverage.py` → `site/sectordata/sector_holdings_coverage.json`, schema `sector_holdings.coverage.v1`: per fund `{ fund, as_of, source, n_holdings_total: number | null, total_unknown: boolean, listed: [ { ticker, weight_pct, rank } ], coverage: { count: { listed, total: number | null }, weight_pct: sum of listed weights, concentration: { top3_of_fund_pct: number | null, top3_of_sample_pct } } }`. Three denominators, never merged. No weighted distance to strikes in v1 (MASTERPLAN §7.1: not an ETF price target).
- Terminal: `lib/sectorHoldingsCoverage.ts` parser (strict, null on mismatch); `SectorCompanyComparison` header line "Covers N of M holdings · W% of fund weight · top 3 = X% of fund" with "total unknown" rendered as words, never 0 or 100 %; EN/ZH; the mobile layout keeps answer + coverage + next action.

## W2C frozen spec — save and independently reopen

- New admitted adapter `lib/investigationEvidenceOptions.ts` (pure): `optionsEvidenceRefs({ origin, request, rotation })` → `InvestigationEvidenceRef[]` with `owner: "terminal.options_exposure"` and object types `exposure_chart_request` (object_id = sha256 of the canonical `ExposureChartRequest` v1 JSON, `mode: "pinned"`, `version_ref: "v1"`, `fingerprint` = same hash), `sector_origin` (object_id = `${sector}/${group}/${company}@${contentHash}`, pinned, `version_ref: "v1"`), `rotation_measurement` (object_id = `${method}:${observationDate}:${sector}`, pinned, `version_ref` = method version). The only edit to `lib/investigations.ts` is adding `{ owner: "terminal.options_exposure", object_types: [...] }` to `INVESTIGATION_ADMISSION.evidence`. URLs carry no serialized chains; the saved revision carries references and fingerprints.
- Save = existing `applyInvestigationRevision` with a `investigation_manifest.v2` manifest; reopen = `readInvestigation(id, revision)` then current evidence is evaluated beside the saved refs; a fingerprint mismatch renders "Source corrected since this revision" with both values; saved values are never overwritten. Thesis edits create a new immutable revision through the same command.
- Proof (all required): reload; an independent authenticated Playwright context with its own storage state under the same entitlement reopens the same revision; corrected source (fingerprint mismatch) case; revoked entitlement refuses the read with an explanation; edited thesis revision; 390 px mobile flow. A viewport resize alone is not persistence proof.

## Lanes

| Lane | Repo / host | Owns | Acceptance | Return |
|---|---|---|---|---|
| L-W2A-MACRO | Macro worktree (SSD policy root); fabric glm if the host has the Macro checkout, else local | `engine/rotation_relative_trend.py`, `tests/test_rotation_relative_trend.py`, emitter in `scripts/build_sector_central.py` | A2 tests with quoted RED runs; `python -m pytest tests/test_rotation_relative_trend.py`; a dry-run emitted JSON validated by the Terminal parser fixture | branch `claude/options-r1-w2a-macro`, RESULT in the lane stdout |
| L-W2A-TERM | Terminal worktree; fabric glm | A3 files + tests + fixture JSON | vitest suites + `tsc` + plain-language guard blocking 0 | branch `claude/options-r1-w2a-term` |
| L-W2B-MACRO | HELD | — | store located and registered | — |
| L-W2B-TERM | Terminal; fabric glm | parser + header on fixture | vitest + guard | branch `claude/options-r1-w2b-term` |
| L-W2C-TERM | Terminal; fabric glm | adapter + admission + save/reopen e2e | vitest + e2e incl. independent-client proof | branch `claude/options-r1-w2c-term` |

## Rulings

- No JdK or GammaPulse parity claim, no purchased subscription, no inferred coefficients; the method is original and named.
- Incumbent coordinates are never relabelled or re-plotted under the new method; the switch is explicit and the default stays incumbent until the quant owner accepts gates 5–6 on real series.
- Unknown is never rendered as zero: a missing endpoint, an unknown holdings total and a withheld coordinate each say what is missing.
