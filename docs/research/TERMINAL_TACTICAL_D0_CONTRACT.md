# Terminal Tactical Intelligence: D0 contract

Parent: Terminal issue #598. Chairman approved the price-first design and D0/replay milestone on 2026-09-17. Sol is the decision owner. No repeated design-approval gate remains.

## Capability
An existing-store consumer must distinguish real inspectable history from a missing file, curated fixture, malformed observation, ambiguous clock or unsupported grain. A pure cutoff view must exclude unfinished observations; as-observed mode also requires an explicit availability time. This is qualification software, not a new event replay engine, scanner, warehouse, registry, or signal.

## Source and custody
Implementation base: Terminal a9b615f41fc44a6cc6a3588ef1aace26226b3eec. Procedure: Mastermind aacf3df5a47ca37ce71cd47a3bd7caea81ad4cd2, Skillpack 1.0.1. Parent issue carries present Chairman approval. Existing Radar, TOI, Setup Species, Evaluation OS and data owners remain unchanged. The shared checkout and Terminal #595 are no-edit boundaries.

## Inputs
Consume existing `<symbol>.<timeframe>.json` stores with `t`, `tf`, `src`, and six-value bars `[display_epoch_seconds,o,h,l,c,v]`. Never import backfill_intraday.py: it reads a provider key at import time. Never read credentials or fetch a provider from this tool.

The adapter is explicitly for ET display epochs, not arbitrary Unix timestamps. Invert that encoding with America/New_York and reject ambiguous/nonexistent wall times. Preserve fractional volume. Validate prices, timestamps, sorting, duplicates, symbol, timeframe and source. Read each store once; digest exactly the bytes parsed. Missing/empty/malformed/invalid are distinct.

Consume `terminal/lib/usEquitySessionProjection.json`, the existing Macro-derived regular-session projection. Do not reimplement a holiday calendar. Record its exact digest and source revision; dates outside coverage are errors, not presumed holidays. Do not modify its producer or projection.

On ordinary sessions classify PRE 04:00–09:30, RTH from the projection, AH 16:00–20:00. On early closes, RTH follows the projection and post-close extended observations are separately labeled POST_CLOSE_UNQUALIFIED: the regular-session calendar does not establish an early-close extended-session schedule. A bar crossing a session boundary is STRADDLE, not split into fabricated finer bars. Outside 04:00–20:00 is unqualified, not proof of overnight coverage.

## Diagnostic denominator
The pilot is a fixed-current development cohort, not a historical investable universe. Preserve every requested symbol/grain cell, including missing files, and every expected regular-session date. Report observed unique interval starts versus nominal grid slots as grid occupancy, not feed completeness. An absent aggregate has unknown cause without trade/quote evidence. Include zero-volume observations as observed; never forward-fill.

The optional decision cutoff is a true UTC instant. All diagnostic inventory counts describe the requested window; only the explicitly named cutoff view is decision-time filtered. Full-file hashes and global diagnostics are not model features.

## Cutoff view
`Observation` is a frozen in-memory input view, not a persistent event identity. Canonical revision resolution remains upstream with Radar. Refuse duplicate event starts rather than choose a revision without authority.

`cutoff_view(..., mode='corrected_history')` selects only bars whose real UTC end is at or before cutoff. It makes no historical availability claim.

`cutoff_view(..., mode='as_observed')` additionally requires explicit `available_at_utc <= cutoff` and `available_at_utc >= event_end_utc` for completed-bar observations. Legacy stores supply no such per-observation receipts, so their as-observed output must be empty. Never substitute file mtime, last-bar `asof`, report generation or HTTP serving time for knowledge time.

Unknown split basis, price/volume adjustment receipts, historical membership, storage/display rights and live latency remain unknown. Structural readability or a causal event-time slice grants neither research admission nor trading authority.

## Outputs and consumer
`ingest/intraday_qualification.py` supplies pure clock/cutoff helpers and file qualification. `scripts/qualify_intraday_research.py` is a real offline consumer and emits machine JSON plus an optional compact Markdown report. Reports contain counts, diagnostics and digests, not raw price histories. Output files use create-only writes and cannot overwrite source inputs.

## Acceptance
Focused tests must discriminate DST, early close, closure/out-of-calendar, boundary-straddling hours, invalid OHLCV, fractional/zero volume, duplicate/unordered rows, absent identity, missing/empty/malformed files, incomplete-day grid occupancy, unfinished candles, unknown/delayed availability, and future mutation invariance. CLI must work from a non-repository working directory with no provider key. Use real existing-store input when accessible, without promoting sparse fixtures to coverage evidence.

Blocked predecessor operation: the live INTC `/api/intraday` inspection remains held; no alternate transport retry is part of D0. Static archival input qualification is separate from that live freshness check. Raw licensed inputs and screenshots are not committed.

## Release boundary
Source tests/local real-input proof, required hosted checks, independent review, merge and production proof remain distinct. D0 does not complete #598. Next dependency is qualified pilot coverage and registered experiments under the existing scientific owner, not unvalidated live alerts.
