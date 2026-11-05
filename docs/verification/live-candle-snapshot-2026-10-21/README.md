# Snapshot candle verification — 2026-10-21

These deterministic Playwright fixtures reproduce the production source shape:
qualified polygon-snapshot-rt / REALTIME / last / asOfMs observations alongside
a separately delayed extended quote. They are not live-market screenshots.

The test checks the actual rendered series and readout, preserved history open
and volume, same-price observation ordering, minute rollover with zero unknown
volume, explicit partial coverage, and the countdown 00:50 → 00:40 → 00:58.
The existing forming-candle regression passes at the same three viewports.
No ChartPanel implementation or locked screenshot packet changed.

## Command and result

```sh
TERMINAL_E2E_PORT=3197 npm run test:e2e:responsive -- e2e/live-candle-snapshot.spec.ts e2e/forming-candle.spec.ts --workers=1
```

Six cases passed in 1.1 minutes in fresh browser contexts with no manual recovery.
Each capture shows the final new-minute candle and 00:58 countdown.

| Viewport | Evidence |
| --- | --- |
| Desktop, 1440 × 900 | [desktop](desktop-snapshot-candle.png) |
| Tablet, 820 × 1180 | [tablet](tablet-snapshot-candle.png) |
| Mobile, 390 × 844 | [mobile](mobile-snapshot-candle.png) |
