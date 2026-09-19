# Support Context + Startup Indicator Integration Qualification

Operation: `TERMINAL-SUPPORT-CONTEXT-20260918-SOL-001`

Protected Sol Skillpack at recovery: `Mastermind@20dc89a201b9dfa65c2b6a2366072f45d885cb5c` (`mastermind.sol_skillpack.v1`, v1.0.1, bootstrap major 1).

Terminal recovery base: `02e082b3603f7be03e93918051f2c924003e6a10`.

## Chairman job

The motivating screenshot has one practical job: make heavy support easy to see, distinguish a base from a failed level, then let the user wait for a higher-quality confirmation instead of guessing in the middle of the chart.

The requested outcome is **not** “copy proprietary pixels.” It is to make that job native to Mastermind Terminal, with truthful timing, explainable inputs, alerts, and a path to scientific validation.

## Vendor identification and legal boundary

The supplied chart is strongly consistent with the current Startup.io Indicator Suite product family: its public V8 marketing shows the same family of gray channels, colored candles, horizontal highlighted zones, and diamond-like signal glyphs. The supplied screenshot itself does not expose a study name, version, input settings, source code, or exact formula, so exact algorithm identity remains unverified.

Public references checked in the original research:
- `https://startup.io/`
- `https://startup.io/terms-and-conditions`
- TradingView webhook alerts: `https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/`
- TradingView alert placeholders: `https://www.tradingview.com/support/solutions/43000531021-how-to-use-a-variable-value-in-alert/`

Startup's public terms grant a limited, nonexclusive, nonsublicensable, nontransferable license and restrict derivative works, copying, redistribution, publication, display, and commercial exploitation without written permission. A normal retail entitlement is therefore **not proof** that Mastermind may redistribute Startup's proprietary signal or zone output to other users.This program will not extract private Pine source, infer formulas from pixels, reproduce vendor branding, or pretend our existing Fibonacci Golden Pocket is their proprietary “Gold Zone.”

A licensed provider adapter remains a separate gate: exact product version and settings, authorized account access, exposed alert conditions/plots, and written permission for the intended commercial use must be established first.

## What Mastermind already owns

The existing Structure Core has multiple independent, lawful building blocks for the same user job:
- Smart S/R: confirmed pivot clusters with touch, reaction, recency, hold, and break semantics.
- Premium & Discount: confirmed dealing ranges, equilibrium, 0.618–0.650 Golden Pocket, and 0.786 OTE.
- FVG: fair-value-gap zones and retests.
- Market Structure: BOS / CHoCH / CISD.
- Order Blocks, liquidity, and swing-failure modules.
- Existing suite-event Alert Center and two-step same-suite sequence evaluator.

No new signal store, event plane, scheduler, queue, scoring authority, or trade authority is needed for the first useful slice.

## Bounded native slice

This change makes Smart S/R evidence usable rather than leaving it as chart geometry only.

### Support Context

Smart S/R now projects the nearest **displayed, intact** support and resistance into the existing `ChartTables` owner:
- price and clustered-pivot touch count;
- signed distance from the latest loaded chart close field;
- an explicit `At price` state instead of arbitrarily calling equality support or resistance;
- honest warmup, no-confirmed-level, and latest-bar-unavailable states;
- EN / 中文;
- an explicit “latest bar may be open; not a trade signal” caveat.

Broken levels may linger as dashed historical geometry but are excluded from the intact Support Context immediately.

The panel consumes the exact levels Smart S/R already selected for display. It does not maintain another support calculation.

### Hold / break marks

The module can display the latest eight existing `sr_hold` / `sr_break` source events:
- circle = hold;
- diamond = break;
- the marker is attached to the source confirmation bar;
- tooltip shows level, source evidence, and chart-bar basis.

A diamond here means **a level broke**. It is deliberately not labeled BUY, SELL, confidence, expected return, or win probability.

### Existing Alert Center

`sr_hold` and `sr_break` are now first-class `structure/sr` Essential-tier events in the existing suite alert catalog.

That unlocks:
- single event watches such as bullish support hold or bearish support break;
- minimum-strength filtering using the existing descriptive source strength;
- the existing two-step same-suite sequence, e.g. bullish support hold → bullish BOS within N bars.

Sequence semantics stay honest:
- B must confirm strictly after A;
- freshness and previous-fire watermarks remain owned by the existing evaluator;
- it does not prove A and B reference the same support level;
- it does not automatically cancel on an intervening support failure;
- it is not a new validated “Launchpad signal.”

Server-side suite alerts continue to use published daily bars and module defaults. A user's custom chart settings do not silently become server alert settings. The existing daily-file owner remains responsible for completed-bar qualification; this PR does not create another session-close classifier.

## Real INTC finding: existing geometry already covers the screenshot's neighborhood

A fresh real-path read on 2026-09-18 used the production-published `INTC.json`:
- 11,722 daily bars;
- producer metadata `src=yahoo`;
- `bar_quality=real_ohlc`;
- latest published row: `2026-09-18 O=109.84 H=110.49 L=106.40 C=108.60 V=174,380,597`;
- local receipt SHA-256: `df6d61948864b09b85a87e791ed53c10054fdfb3aba90308159076881872498a`.

Default Structure Core calculations on that exact payload show important nearby native geometry:

**Premium & Discount**
- discount band: `85.14–91.605`;
- Golden Pocket: `92.6825–93.3721`;
- equilibrium: `95.915`;
- 0.786 OTE: `89.7517`;
- premium band: `100.225–106.69`.

**FVG**
- bullish/retest geometry includes zones around `92.37–100.35`, `100.48–104.70`, and `104.42–106.40`;
- an older nearby iFVG is around `92.68–95.25`.

**Market Structure**
- nearby structural marks include `89.59 BOS`, `98.33 CHoCH`, `102.40 CHoCH`, and `106.69 CHoCH`.

This is a material result: Mastermind does **not** need a guessed proprietary Gold Zone formula to render a useful support-base neighborhood around the motivating INTC chart. Existing independently implemented owners already describe much of the same price region from different structural lenses.

## Real INTC finding: Smart S/R is not itself the screenshot's Gold Zone

The same real payload also falsifies a tempting shortcut.

At default Smart S/R settings, the context panel's strongest intact support is `32.73 ×2`, far below the current market. High sensitivity surfaces an intact `40.63 ×2` support and `141.45 ×2` resistance; a `107.57` level is present only as a **broken** lingering line.

Therefore:
- Smart S/R must not be renamed “Gold Zone”;
- the new Support Context is useful evidence/monitoring, but not the full motivating setup;
- the screenshot-like current support area comes from a **composition of current dealing-range, gap, and market-structure geometry**, not from Smart S/R alone.

This finding is why the bounded slice keeps the calculators separate rather than inventing one universal support score.

## Next product composition

The clean product direction is a **Support Base workspace/composition**, not a hidden all-purpose score:

1. price pane: Premium & Discount + FVG + Smart S/R + Market Structure;
2. Support Context: nearest tested S/R plus current dealing-range landmarks;
3. optional existing confirmation events: Golden Pocket touch / FVG retest / support hold followed by BOS or CHoCH;
4. later, once scientific gates exist, Forming / Armed / Triggered / Confirmed setup state can come from the canonical Technical Opportunity Intelligence / Setup Species owner rather than Terminal heuristics.

The existing open Chart Reclaim PR #606 owns cross-suite “Start with a workflow” composition and currently changes `terminal/lib/suites/presets.ts` and `IndicatorsModal.tsx`. This operation does **not** edit those files or create a parallel workflow plane. The Support Base recipe should be integrated there or after that carrier resolves, not raced in a competing PR.

## Scientific authority boundary

The broader setup research remains owned by Macro Agent OS workstream `WS:TECHNICAL-OPPORTUNITY-INTELLIGENCE`.

Its current law still applies:
- W1 = public-method + local-estate evidence census;
- W2-0 = Daily / Weekly / 4H data, clock, correction, coverage, rights, and Terminal-parity archaeology;
- W3 outcome testing cannot start until W1 and W2-0 are accepted;
- Setup Species owns scientific setup identity;
- Live Entry Radar owns tactical intraday events;
- no LLM-originated signal, ranking, gate, position size, numeric confidence, or trade authority.

GitHub also has current bounded predecessor carriers outside this Terminal PR: W1 PR #7107 is a repaired evidence-census HOLD awaiting bounded rereview, while W2-0 PR #7094 is a PARTIAL / HOLD data-clock admission whose own record calls out early-close, fallback, same-basis, correction, and historical-denominator gaps. This slice does not rewrite either carrier or mark either accepted. The INTC structure finding is an input for those owners, not a substitute for their gates.

This Terminal slice does not claim those research gates are complete.

## Verification boundary

The local browser fixtures prove actual Terminal composition and controls with explicitly synthetic NVDA OHLC and mock alert-row persistence. They do not prove a live account write or a production deployment.

The real INTC probes prove the real published-data computation path and current numerical geometry. They do not prove profitability, historical point-in-time rights, vendor equivalence, or notification delivery.

Production release remains subject to the repository's normal protected PR/CI path and current Terminal canonical deployment program. No direct rsync or alternate deployment controller is introduced.
