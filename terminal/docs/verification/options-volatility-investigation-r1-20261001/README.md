# Options Volatility Investigation R1

Operation: `options-volatility-investigation-r1-20261001-sol-001`

This increment turns the existing nightly volatility surface into a stricter, expiry-led investigation without introducing a new data source, cache, pricing model, calendar, signal ranker, or trade-authority path.

## User journey

The existing Volatility tab remains the owner. A single root-keyed selected expiry now joins term structure and smile/skew:

1. The first default is the first expiry actually present in both term and smile data; otherwise the first admitted term expiry, then the first admitted smile expiry.
2. Every admitted term expiry remains selectable through one compact exact-expiry selector, including an expiry whose ATM IV is unavailable. The control was stress-tested with 33 real SPY expiry rows rather than only the six-row design fixture.
3. Selecting an expiry updates one shared context strip with exact expiry, DTE when supplied, source-reported ATM IV or unavailable, and exact-expiry smile availability.
4. The smile never silently substitutes a neighboring expiry. If the selected expiry has no supplied per-strike series, it says so and leaves the chart unavailable.
5. Smile expiry controls move the same shared selected-expiry context. They do not create a second selection owner.

Paper reference: file `Terminal` (`01M3NSZGE8JWN2EZCSF0DT05RM`), page `09 · Options · Volatility Lab` (`p-D-0`). The R1 references are V01 desktop `UM6-0`, V02 mobile `URH-0`, and V03 missing/source/refresh states `UT6-0`. Paper data is explicitly synthetic/design-only; it is not source-host or production acceptance.

## Integrity repairs

The existing panels previously used JavaScript numeric coercion on nullable source fields. `Number(null) === 0` could therefore turn missing IV into a plotted 0%, join lines across missing observations, count a null history row as real coverage, or let per-side smile gaps enter proxy calculations.

The repair keeps finite, non-negative numeric source observations only. A genuine numeric zero stays zero. Null, strings, booleans, invalid dates, and unsupported sides remain unavailable. Explicit gaps break paths rather than being deleted and reconnected.

Exact source identities also fail closed. Duplicate term expiries, smile expiries, smile strikes, and history dates are excluded rather than arbitrarily choosing a winning row or inflating coverage. Calendar admission is only a strict ISO-day round trip; it is not a second market-session or expiry-lifecycle calendar.

Term-difference chips name the actual supplied tenors used (for example `7→28d`), rather than presenting approximate labels such as `0→30d`. Smile window copy now says `Full supplied range`; the display proxy is explicitly not observed spot moneyness. The IV-minus-realized-volatility fields are labeled as descriptive source-reported spreads, not an earned cheap/rich or directional verdict. Headline ATM IV states that its tenor is not supplied by this payload. The derived historical spread may display separately when older, but percentile/range, 5-session trend and 1-session change are withheld unless its final derived session exactly matches the current volatility source session. A missing source-reported current spread never falls back to a derived historical value.

## Real-source qualification

A bounded read-only qualification on 2026-10-02 UTC consumed the canonical public R2 mirror that the existing flow source maps to `options_hub/vol/{ROOT}.json` and `options_hub/aggtrend/{ROOT}.json`. No provider endpoint, entitlement bypass, publication write, or market-data mutation was used.

For SPY, the captured volatility payload is `options_hub.vol/v1`, source session `2026-09-30`, with 33 term rows, two smile expiries, and 90 history rows. Its SHA-256 is `a3139a7df017eb6cc77cf2bf36a1f914bcd688ee7f36267bb34136dd7fc8e8ef`. The paired aggregate-history payload ends `2026-07-30`, SHA-256 `2954accf08843c1c7d6b600161784fe13c229a986c037ca35e71ac6afa0a9bb9` is intentionally NOT copied here because the canonical receipt carries the exact digest in `REAL_SOURCE_20261002.json`.

That date mismatch is now represented honestly: the Sep-30 source-reported spread remains visible; the Jul-30 derived historical chart remains useful context; current historical range/percentile, 5-session trend, and 1-session change are withheld. The 33-expiry inventory is exposed through a compact selector whose measured control height is 75px EN / 81px ZH at 390px, down from the pre-repair 572px chip wall while retaining every source expiry.

The responsive real-source component qualification is 78/78 assertions across 1440/820/390 × EN/ZH, zero page errors, zero external browser requests. It is stronger than synthetic-only proof but is still not the native Next route or signed-in entitlement journey.

## Existing owners preserved

- Root loading and request-race guard: `components/vol/VolView.tsx` + `lib/flowClientCache.ts`.
- Payload contract: `components/vol/volTypes.ts`.
- SVG geometry/hygiene: `components/charts/svgChart.ts`.
- Existing Volatility panels: `components/vol/*`.
- Root-universe expansion remains the separate existing #686 work; this increment does not duplicate it.
- Chart-linked options heatmap work remains the separate existing #723 work; this increment does not replace or absorb it.

## Verification

Focused native tests cover missing-versus-zero behavior, strict dates, duplicate identities, per-side smile gaps, actual-tenor copy, shared selected-expiry behavior, and exact-expiry no-substitution. The focused synthetic tests remain as negative controls. The current responsive captures use the actual branch components with exact captured public SPY volatility + aggregate-history payload bytes at desktop/tablet/phone widths in EN/ZH.

Required before merge/release:

- full TypeScript and changed-file lint/plain-language checks;
- whole unit suite and production build;
- rebase/collision check against current protected `master` and #686 before merge;
- native-route / entitlement proof using a published volatility source for at least one covered root (public R2 source-to-component proof is now established);
- stale/missing/root-switch behavior on the native route;
- independent review after the final published head.

Passing synthetic fixture tests does not establish provider methodology, executable option marks, full-chain completeness, a current market view, pricing/model correctness, relative value, probability, ranking, sizing, or trade authority.
