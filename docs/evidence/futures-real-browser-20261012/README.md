# Real historical source to actual Terminal browser

The five-minute public ESZ5 source canary now reaches the existing reusable
`FuturesMicrostructureChart` through `/dev/futures-sample`. This is actual vendor
historical data, not the separate generated ES/NQ development fixtures. The page
is deliberately unavailable in production before any private sample file read.

## Proof

- 18,418 MBO records; 8,831 starting orders; 4,471/4,471 matching BBO comparison groups.
- Depth integrates **all 8,070 completed source events**, not one-second snapshots.
- A retained initial-quote +/-24-tick price window has explicit bounded coverage;
  requesting a wider range fails rather than converting unknown prices to zero.
- Five one-minute replay cutoffs retain 165, 375, 486, 751 and 839 observed contracts.
  Every included depth minute has full time coverage under the declared 120-second
  source-age policy. It is not a claim about live network latency.
- Both Depth and Footprint, volume profile and captured-window known-side CVD render
  in the actual Next.js application. Browser tests verify replay and missing GEX.
- **6/6 browser cases passed**, desktop/tablet/mobile, English/Chinese, zero page/console
  errors and no document overflow. Nine actual-price screenshots stay LOCAL; only
  their hashes are committed. Desktop/mobile images were visually inspected.
- **524 Hub tests**, **144 focused Terminal tests**, full typecheck and scoped lint
  pass. Prior **24 Python conformance tests** remain accepted for unchanged inputs.

## Integrity and limits

The local view is digest-bound before loading, has no caller-supplied path or URL,
validates source labels and cutoff/volume invariants, and cannot carry fabricated
GEX. There are no contemporaneous SPX positioning/quote inputs in the public sample,
so that layer is honestly unavailable. No synthetic gamma is added to real prices.

Actual market rows and images remain under ignored `.local-futures/`. The production
route is gated before loading; Next file-trace exclusions additionally exclude that
directory from deployment traces. Tests prove these guards, not a production rollout.
No live feed, authenticated venue definition, commercial redistribution license,
independent release review, merge or production deployment is claimed.

Reproduce internally after the source canary:

```
node hub/tools/build_futures_sample_view.js
cd terminal
RUN_FUTURES_PUBLIC_SAMPLE=1 npx playwright test --config playwright.futures-sample.config.ts
```

The local spec is skipped in ordinary CI unless explicitly enabled; it never fetches
market data in CI. Synthetic regression tests remain the automated shared test input.
