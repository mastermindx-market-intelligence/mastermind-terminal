# Intraday Dislocation R0 — current 5-minute store census (2026-10-02)

Purpose: bounded read-only evidence for the Dislocation + Reclaim R0 preregistration.
This is an inventory of the current Terminal static intraday store, not a vendor entitlement
census, historical investable universe, point-in-time availability proof, or trading result.

## Existing owner reused

The canonical input-qualification software already exists:

- `ingest/intraday_qualification.py`
- `scripts/qualify_intraday_research.py`
- `terminal/lib/usEquitySessionProjection.json`

R0 does **not** add a second qualifier, event store, calendar, scanner, replay owner, or
market-data collector. The current-store census below is a read-only diagnostic used to
decide what the existing qualifier and incumbent scientific owners may safely consume.

Existing D0 law remains binding: legacy static stores do not carry per-observation
`available_at_utc` receipts. Their corrected history may support event-time geometry
experiments, but it does not prove what was historically available to a live decision maker.

## Read-only store inventory

Observed current static store:

| Measure | Result |
|---|---:|
| 5-minute files | 680 |
| 1-hour files | 4,108 |
| total intraday directory size | 2.7 GB |
| readable 5-minute files | 680 / 680 |
| 5-minute source field | `polygon` on 680 / 680 |
| 5-minute bar-quality field | `real_ohlc` on 680 / 680 |
| total 5-minute bars | 21,113,724 |
| total 5-minute bytes | 960,613,373 |
| smallest 5-minute file | 824 bars |
| p10 bars/file | 21,711 |
| median bars/file | 27,040 |
| p90 bars/file | 50,005 |
| maximum bars/file | 60,000 |

The 60,000-row ceiling is consistent with the existing incremental refresh implementation,
which merges old and refreshed observations and then retains the final 60,000 rows. This is
a count-based retention ceiling, not a common calendar window across symbols.

## Calendar-span dispersion

First observed 5-minute dates across current files:

| Statistic | Date |
|---|---|
| earliest | 2025-06-02 |
| p10 | 2025-06-02 |
| median | 2025-06-02 |
| p90 | 2025-07-07 |
| latest | 2026-07-13 |

Start-month concentration is highly uneven: 606 of 680 files begin in June 2025, 39 in
July 2025, 21 in August 2025, and the remainder begin later for newer or differently
retained symbols. Therefore a single claimed `2021 -> now` 5-minute research horizon is
not supported by the current files.

Last observed 5-minute dates also vary:

| Statistic | Date |
|---|---|
| earliest | 2025-11-10 |
| median | 2026-08-21 |
| latest | 2026-09-25 |

Relative to the latest last-bar date in the store:

- 226 / 680 files end within one day of the maximum observed last date;
- 447 / 680 files end more than seven days before that maximum.

This is a file-freshness dispersion fact, not proof of a provider outage. Missing recent
aggregates can arise from writer coverage, current top-N membership, retention/update
behavior, symbol lifecycle, or other causes that require owner-specific evidence.

## Source-code reconciliation

Current `ingest/backfill_intraday.py` states:

- 5-minute history is built for the top-N by dollar volume;
- the current default `--top` is 500;
- the 5-minute full-backfill request window is 400 days;
- incremental updates merge corrections/recent bars and retain the last 60,000 rows;
- 1-minute storage support exists as a 40-day source capability but is not evidence that
  a durable 1-minute archive is currently published.

The current store contains 680 five-minute files, so present file population reflects
historical writer runs and refresh membership rather than simply today's default top-500.

## Implications for Dislocation R0

1. **No whole-store naive backtest.** A cross-sectional replay that treats all 680 files as
   equally current and equally deep would mix different retention/freshness regimes.
2. **No survivorship claim.** Current files are a fixed-current inventory unless a historical
   universe and membership source is supplied by the incumbent research owner.
3. **No point-in-time availability claim from legacy stores.** The static `asof` field is the
   final stored bar-start display epoch, not the time each historical observation became known.
4. **No fake one-minute replay.** Five-minute bars will not be interpolated into one-minute data.
5. **No duplicate data qualifier.** Existing D0 qualification remains the admission surface.
6. **No live authority from corrected history.** R0 historical work is exploratory until a
   source with historical availability/correction receipts or forward shadow evidence exists.

## Research-admission sequence

The next owner-correct sequence is:

1. Choose a bounded liquid pilot through existing Live Entry Radar / Setup Species ownership.
2. Run the existing qualifier on explicit files and calendar windows.
3. Freeze market/sector factor mapping, beta `asof`, same-time-of-day baseline construction,
   event de-duplication, catalyst evidence contract, and causal fill semantics.
4. Run corrected-history structural experiments with the historical-availability limitation
   printed in every result.
5. Start forward shadow accrual through the incumbent Radar event/evaluator path before any
   scored/product promotion.

## Reproducibility note

The census was produced by a bounded read-only parse of the current static `*.5m.json`
documents and filesystem metadata after regular U.S. market hours. It read each file once,
recorded bar counts and first/last stored display epochs, and performed no writes, refreshes,
provider calls, credential reads, service restarts, or production configuration changes.

Example observations from the inventory are diagnostic only. The full store remains the
source owner’s data; raw licensed histories are not copied into this repository.

## Capability state

`INPUT_INVENTORIED_NOT_RESEARCH_ADMITTED`

The data plane is now better characterized, but this document proves neither an exploitable
edge nor historical point-in-time availability. The next lawful implementation belongs under
the existing Macro Live Entry Radar / scientific registration owners, with Terminal remaining
a downstream product consumer.
