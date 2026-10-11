# Extended quote provenance evidence — 2026-10-11

Protected base: `292357daa86525d6c488fb2042340f782cf91e60`.

The Next.js extended-quote route discarded the incumbent Quote Hub's source and
price basis. The repair preserves a valid source identifier and the existing
LIVE / DELAYED_15M / UNOFFICIAL vocabulary, with missing or unrecognized basis
omitted. It does not activate a Tiingo feed, replace a quote authority, or infer
LIVE from a provider name. The existing timeout and unavailable response remain.

Actual tests:

- `route-red.log`: 2 regressions failed and 9 tests passed before the repair.
- `route-green.log`: 33 tests passed across extQuoteRoute, liveCandle,
  quoteDisplay and quoteRouteView after the repair.
- From `terminal/`, `./node_modules/.bin/tsc --noEmit --incremental false`
  completed with exit 0.

The logs contain actual test output with trailing whitespace removed for Git
hygiene; no assertion or result was altered. Mock Tiingo provenance is a contract
test, not a live Tiingo receipt or production browser acceptance. Hosted CI,
independent review, protected merge, existing VPS release and live acceptance
remain separate obligations. The registered Fabric review attempt was refused
before lease/launch by its local log reservation permission; no worker ran.

Programme source: Macro PR #8698. This Terminal carrier owns only the consumer
metadata repair. Raw Tiingo data and capture remain with the existing Macro
collector and external archive.
