# Futures GEX + depth + footprint: development evidence

Date: 2026-10-12 UTC. PR #964. These are browser captures of the actual Terminal
application at `/dev/futures`, not a standalone mock-up or a live-data product.

## What works in this development slice

The ES development consumer switches between Depth and Footprint while retaining
identical mapped SPX gamma coordinates. It supports ratio/offset conversion,
replay cutoff, GEX toggle, price zoom, source inspection, executed-volume profile,
English/Chinese, and explicit stale-quote, late-publication and depth-gap states.
The volume profile includes only the observations admitted by the replay cutoff.
The quote/exposure input checks and order-book/footprint/depth reducers are real
implementation modules. Their demonstration data is entirely **SYNTHETIC**.

The fixture generator feeds the actual hub reducers with 192 generated executions,
4,203 observed contracts and 24 minutes of data. There is a deliberate two-minute
depth gap and unknown-side execution volume. No CME feed was connected.

## Verification

- Focused Terminal Vitest: **57 passed, 0 failed** (56 gamma/frame tests plus one
  production-route guard; the 56 include a 1,000-case deterministic invariant loop).
- New MBO/footprint/depth tests: **64 passed, 0 failed**.
- Full Quote Hub suite: **452 passed, 0 failed**, including those 64 new tests.
- Full Terminal TypeScript check: **exit 0**, no diagnostics.
- Scoped ESLint: **exit 0**, no diagnostics.
- Focused Playwright: **9 passed, 0 failed** across **1440x900**, **820x1180** and
  **390x844**, with English and Chinese captures, no page/console errors and no
  horizontal document overflow.
- Production-boundary test: the route returns not-found before importing the
  development consumer when `NODE_ENV=production`. This is not a production deployment test.

`EVIDENCE.json` records hashes of 14 tested input/source files and 18 final PNGs.
`verification-log.txt` preserves the focused test results and full-suite summary.
The first browser run found React SVG-title hydration errors; the source was fixed
and re-tested. No refresh workaround is part of the passing flow.

## Representative captures

- [Desktop depth, English](desktop-depth-en.png)
- [Desktop footprint, English](desktop-footprint-en.png)
- [Desktop injected depth gap](desktop-depth-gap-en.png)
- [Tablet footprint, Chinese](tablet-footprint-zh.png)
- [Mobile footprint, English](mobile-footprint-en.png)
- [Mobile stale-GEX state](mobile-stale-gamma-en.png)

All 18 captures are retained beside this file. They are full-page screenshots;
the viewport contracts above are the browser dimensions, not the full image height.

## Performance witness

`kernel-benchmark.json` is one synthetic local Node 26.5.0/macOS arm64 run with
10,000 resting orders and 10,000 one-order modifications. Updates took 329.64ms;
100 aggregated book views took 1,468.32ms (14.68ms per view), and the initial snapshot
103.42ms. These figures exclude live decoding, network, archives, market bursts,
subscriber fan-out and browser rendering. They are not exchange-latency or production
capacity claims. The reproducible command is `node hub/tools/bench_futures_mbo.js`.

## Still not delivered

No licensed real-time or historical CME source comparison, authenticated receipt
integration, production Chart-shell integration, independent review, merge or live
deployment is proven here. NQ has conversion tests, not its own browser dataset.
The GEX consumer is all-expiry only. Raw DBN decoding, source-event assembly,
sequence/gap verification, status/definition ingestion, corrections, 0DTE filtering,
and calibrated predictive alerts remain open. Publisher-specific flags are refused.

CME displayed outright orders exclude implied liquidity. The reducer preserves that
scope, and handles explicitly non-trading crossed books without calling them executable.
CVD is based at the selected window start, not silently advertised as session-wide.

Next: validate a lawfully usable ES/NQ source sample, connect the existing Quote Hub
and options/quote receipt owners, then review and release through the normal path.
The complete research and implementation frontier is
[`FUTURES_GEX_ORDERFLOW_RESEARCH_2026-10-12.md`](../../FUTURES_GEX_ORDERFLOW_RESEARCH_2026-10-12.md).
