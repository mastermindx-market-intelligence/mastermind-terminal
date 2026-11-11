# Expanded futures workspace evidence

Actual development browser tests of BOTH ES/SPX and NQ/NDX, using generated data
through the real source/event adapters and book/trade reducers. This is NOT live
market data. The production route guard still refuses `/dev/futures`.

## New working capability

- ES and NQ switching keeps quote, exposure, source reference and chart identity aligned.
- All-expiry / source-session 0DTE / later-expiry / named-date lenses reuse the existing
  GEX matrix helper, with stricter selected-null, root, timestamp and session checks.
- Matrix whole dollars become USD millions once. Missing cells stay unknown; covered
  zero stays zero. Matrix age/availability contributes to frame provenance.
- One- and five-minute intervals; one-, four- and eight-tick price groups. Trade
  volume and raw-price OHLC are conserved. Diagonal imbalances use selected neighbors.
- Captured-window known-side cumulative delta is now a synchronized optional lower pane.
- Aggregation never advances a replay cutoff. Incomplete intervals are visibly absent;
  one nanosecond of future availability cannot sneak in through millisecond rounding.
- The reusable `FuturesMicrostructureChart` imports neither fixtures nor a vendor feed.
  Synthetic generation and fault injection remain isolated to the development harness.

## Verification

507 full Quote Hub tests; 15 SDK conformance tests; 127 focused Terminal tests
(including 42 unchanged incumbent GEX-ladder tests); 15 browser cases across
1440x900, 820x1180 and 390x844, English/Chinese, zero console/page errors and no
horizontal document overflow. Full Terminal typecheck and scoped lint exit 0.
27 final screenshots and 14 source/input digests are retained here.

Browser data: 24-minute synthetic examples; ES has 4,203 observed contracts and
NQ has 4,202. Unknown-side volume is disclosed. The source-session expiry label
is NOT proof that every dated option is still tradable intraday (AM/PM settlement
and exchange cutoff need actual contract-reference data).

The preceding source-adapter phase is documented at
`docs/evidence/futures-source-20261012/`. Neither phase proves live-data rights,
production integration, an independent review, deployment or predictive performance.
