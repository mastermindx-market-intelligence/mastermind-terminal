# No-captured-trade recovery: final candidate qualification

Functional candidate: `3a8bb176281f629669ee0cda6e0348cddcb6bbc2` on original PR #964.
The accompanying evidence-only commit preserves the exact qualified source tree.

## Verified on this candidate

- Full Terminal: **11,332 passed, zero failed, four existing TODOs; 682 files**.
- Full Hub: **595 passed**; focused futures tests: **232 passed**.
- No-captured-trade browser cases: **6 passed** on desktop/tablet/mobile.
- Existing production-route synthetic cases: **27 passed**.
- Synthetic ES/NQ development cases: **15 passed**.
- Actual historical ES browser: **6 passed**, real-price images stay private.
- Full typecheck, scoped lint and optimized production build: **exit 0**.
- Actual compiled `next start` with guest contexts: all three viewports show the
  existing paywall with zero futures requests and no futures component/page errors.
  Futures API 403/private-no-store; development/private sample paths 404; all
  compiled traces exclude private samples. Exact receipt is beside this file.
- Owned loopback ports 3594/3596/3597 are closed after verification.

This completes recovery of the originally interrupted interval fix: observed depth
and time remain present when no trade is captured, OHLC stays null, no price candle
is invented, and prior unknown-side volume continues to qualify cumulative delta.

## Source-release decision versus live activation

The author/commissioning principal has reviewed the no-trade diff and executable
falsifiers. Retained independent source/API, display, aggregation and gamma/client
reviews have concrete adjudications. None is described as externally executed tests
or comprehensive independent coverage of every file. The failed/blocked book review
and event-adapter request remain accurately recorded and were not bypassed.

This code-only candidate is ready for the existing protected merge checks; the
missing live-data grant is NOT used as an excuse to keep verified source indefinitely
in draft. The public sample is never a subscriber fallback, the new publisher is not
activated, and no source/auth/entitlement configuration changes are included. Source
merge is NOT delivery of the requested live product and NOT permission to deploy or
activate an unqualified source. Actual deployment admission and live-source grant/
matched source receipts remain required before their respective effects.

Three required checks remain enforced by GitHub. Ancillary Vercel previews are not
the canonical VPS application build: the inspected Terminal preview selects root
FastAPI and exceeded its Python function bundle limit; a second preview was rate-
limited. Those failures are retained, not patched away or called passing.

Current protected-base 5fa856bfad4819f5befc7af66488965abdc01c75 has no owned-path
overlap and merges conflict-free. It changes the marketStructure aggregate/scenario
helpers but not the topology function used by our existing options-level dependency;
flowFreshness changes do not enter the futures join. Hosted latest-base proof still
must pass. Normal merge-on-green may refresh only the compatibility base and must
rerun its required checks; no untested or admin merge is authorized.

There is no new background worker, paid purchase, vendor message, market-data grant,
real customer session or live-feed claim. The prior source-configuration preflight
refusal is still held and is not interpreted as proof a license is absent.
