# Nine-Bar Exhaustion — Data and Availability Census

Status: implementation evidence, frozen before outcome analysis.

## Current admitted surfaces

### Committed daily research snapshot

`terminal/public/data/*.json` currently contains 34 files with at least 40 chronological OHLCV bars in the canonical six-field daily format. Thirty are US equities or ETFs and four are crypto pairs. The common equity history is 1,255 daily bars from 2021-06-28 through 2026-06-26; the crypto history is approximately 729–730 daily bars from 2024-06-27 through 2026-06-26. Representative records identify `src: polygon`, `bar_quality: real_ohlc`, and `session_anchor.basis: feed`.

This is a finite, current repository snapshot. It is useful for deterministic descriptive research and chronological development/validation/holdout partitions, but it is not a point-in-time data receipt. It does not preserve each vendor correction arrival time, delisted constituents, historical universe membership, or an independently certified corporate-action ledger. The JSON files do not expose a per-bar information-availability timestamp. Any research result derived from them must therefore be labeled **snapshot descriptive evidence**, not production-qualified point-in-time evidence.

The admitted universe has no committed CN or HK single-symbol daily panel in this worktree. Cross-market claims for CN/HK are unavailable from this source.

### Runtime intraday chart path

Terminal's intraday route supports source selection among the committed store, historical provider, and search/current provider. Its provider contracts include 1m, 5m, 15m, 30m, 1h, and 4h intervals. The premium historical source requests long-range US equity/ETF history (10 years by default for 1m/5m; 20 years for 15m through 4h) and shorter crypto history (one year for 1m/5m; three years for larger intraday intervals), subject to provider entitlement and actual returned coverage.

The runtime pipeline validates chronological bars, removes duplicates and malformed observations, separates source identity from close/availability time, aligns resampled candles to market-local sessions, preserves source interval/count/fingerprint metadata, and can fall back to a bounded disk cache when configured. The repository worktree currently contains no populated `terminal/public/data/intraday/*.json` corpus, so these capabilities do not constitute an admitted all-symbol research panel.

### Session semantics

The owner session functions encode:

- US premarket 04:00–09:30, regular 09:30–16:00, and postmarket 16:00–20:00;
- HK 09:30–12:00 and 13:00–16:00;
- CN 09:30–11:30 and 13:00–15:00;
- crypto continuous 24-hour trading.

Lunch breaks and extended-hours segments are discontinuities, not synthetic missing candles. Higher-timeframe aggregation is anchored to the market-local session and carries source-bar count and close-time evidence. Known exchange holidays, daylight-saving changes, and partial sessions are owned by existing market clocks rather than reimplemented by the indicator.

### Live and replay finality

Terminal's live-candle contract allows only one accepted mutable generation per `(symbol, timeframe, session, xmode)`. Stale observations and out-of-session ticks cannot mutate the active generation; a forward bucket finalizes the prior generation. Replay bars are historical closed observations.

The nine-bar chart boundary does **not** use quote arrival as a proxy for finality. It derives the mutable tail from the actual chart timeframe, symbol-aware market-local display clock, session segment, admitted daily source rows, and existing session-anchor/grouping rules. Equity/crypto intraday bars remain forming until their scheduled bucket close, clamped to the applicable session close. Macro intraday bars use the symbol's home-market display epoch and interval close without a fabricated US-equity session clamp. Daily bars remain forming until the authoritative market close where that calendar exists; same-local-day macro daily bars conservatively remain provisional until the provider's display day rolls. Multi-day and calendar bars remain forming until their source-session group or calendar period is complete. Replay is closed by definition. Unknown or unsupported timing fails closed: the last row may render as forming but cannot emit a confirmed completion event.

US regular-session finality consumes the repository's exchange-session projection, including represented holidays and early closes. CN/HK session and lunch-break boundaries are encoded, but this worktree does not carry an equally complete CN/HK holiday calendar; the same is true for the heterogeneous futures/FX/international-index macro venues. Those market/date combinations remain coverage limitations rather than broad freshness claims. Each point's earliest-observable timestamp is the later of the current bar and four-bars-back comparison input availability; neither a delayed reference nor a forming ninth bar can be presented as known earlier than its inputs. Once the same row becomes final, it produces the deterministic event identity.

## Nine-bar interpretation by timeframe

The released computation is **bar-based**. `close[t-4]` means the fourth earlier admitted chart bar. It does not fabricate a trade exactly four wall-clock minutes earlier when a 1m feed is sparse, halted, crossing a lunch break, or otherwise missing observations. A future clock-minute/trade-based variant would be a distinct algorithm and requires a source that can prove the observation at that exact minute.

Mathematically, the kernel can operate on any chronological chart interval. Product support remains conditional on the chart having at least 13 valid bars and honest source lineage. Current implementation coverage is:

| Surface | Formula support | Current evidence |
|---|---:|---|
| Daily US equities/ETFs | Yes | 30 committed symbols/ETFs; snapshot descriptive research only |
| Daily crypto | Yes | 4 committed pairs; shorter snapshot history |
| 1m/5m/15m/30m/1h/4h chart | Yes | Runtime provider/chart path, symbol-by-symbol where entitled and fresh |
| CN/HK intraday chart | Yes in principle | Session code exists; no admitted broad research corpus in this worktree |
| Full-market real-time scan | No claim | No measured all-symbol freshness/compute/retention evidence |
| Daily suite-alert sidecar | Yes | Finalized daily files; existing freshness/idempotency gates |
| Intraday broad alert sidecar | No claim | Not implemented by this commission |

## Price adjustments and corrections

The current committed files identify their feed and real-OHLC quality but do not uniformly expose an explicit adjusted/unadjusted boolean or corporate-action receipt. Earlier ingest documentation describes adjusted Yahoo Finance ingestion, while the current representative files identify Polygon. The research runner therefore detects large discontinuities and reports them, but does not silently certify every series as split-safe or point-in-time adjusted.

A corrected bar causes deterministic full recomputation. It may legitimately alter a historical count or event, but cannot move the original real-time information-availability timestamp backward. Production research requires versioned source receipts before making causal performance claims.

## Release boundaries

The on-chart study can be released independently because formula correctness, finality, rendering, persistence, and alert timing are testable without proving predictive edge. Product copy must continue to say **possible exhaustion, not a guaranteed reversal**.

Full-market intraday scanning, CN/HK statistical generalization, exact clock-minute semantics, and calibrated reversal probabilities remain unsupported until their own coverage, point-in-time, cost, and holdout evidence exists.
