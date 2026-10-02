# Options Volatility Investigation R1

Operation: `options-volatility-investigation-r1-20261001-sol-001`

This increment turns the existing nightly volatility surface into a stricter, expiry-led investigation without introducing a new data source, cache, pricing model, calendar, signal ranker, or trade-authority path.

## User journey

The existing Volatility tab remains the owner. A single root-keyed selected expiry now joins term structure and smile/skew:

1. The first default is the first expiry actually present in both term and smile data; otherwise the first admitted term expiry, then the first admitted smile expiry.
2. Every admitted term expiry remains selectable, including an expiry whose ATM IV is unavailable.
3. Selecting an expiry updates one shared context strip with exact expiry, DTE when supplied, source-reported ATM IV or unavailable, and exact-expiry smile availability.
4. The smile never silently substitutes a neighboring expiry. If the selected expiry has no supplied per-strike series, it says so and leaves the chart unavailable.
5. Smile expiry controls move the same shared selected-expiry context. They do not create a second selection owner.

Paper reference: file `Terminal` (`01M3NSZGE8JWN2EZCSF0DT05RM`), page `09 · Options · Volatility Lab` (`p-D-0`). The R1 references are V01 desktop `UM6-0`, V02 mobile `URH-0`, and V03 missing/source/refresh states `UT6-0`. Paper data is explicitly synthetic/design-only; it is not source-host or production acceptance.

## Integrity repairs

The existing panels previously used JavaScript numeric coercion on nullable source fields. `Number(null) === 0` could therefore turn missing IV into a plotted 0%, join lines across missing observations, count a null history row as real coverage, or let per-side smile gaps enter proxy calculations.

The repair keeps finite, non-negative numeric source observations only. A genuine numeric zero stays zero. Null, strings, booleans, invalid dates, and unsupported sides remain unavailable. Explicit gaps break paths rather than being deleted and reconnected.

Exact source identities also fail closed. Duplicate term expiries, smile expiries, smile strikes, and history dates are excluded rather than arbitrarily choosing a winning row or inflating coverage. Calendar admission is only a strict ISO-day round trip; it is not a second market-session or expiry-lifecycle calendar.

Term-difference chips name the actual supplied tenors used (for example `7→28d`), rather than presenting approximate labels such as `0→30d`. Smile window copy now says `Full supplied range`; the display proxy is explicitly not observed spot moneyness. The IV-minus-realized-volatility fields are labeled as descriptive source-reported spreads, not an earned cheap/rich or directional verdict. Headline ATM IV states that its tenor is not supplied by this payload.

## Existing owners preserved

- Root loading and request-race guard: `components/vol/VolView.tsx` + `lib/flowClientCache.ts`.
- Payload contract: `components/vol/volTypes.ts`.
- SVG geometry/hygiene: `components/charts/svgChart.ts`.
- Existing Volatility panels: `components/vol/*`.
- Root-universe expansion remains the separate existing #686 work; this increment does not duplicate it.
- Chart-linked options heatmap work remains the separate existing #723 work; this increment does not replace or absorb it.

## Verification

Focused native tests cover missing-versus-zero behavior, strict dates, duplicate identities, per-side smile gaps, actual-tenor copy, shared selected-expiry behavior, and exact-expiry no-substitution. The responsive browser qualification uses the actual branch components at desktop/tablet/phone widths in EN/ZH with a synthetic nightly fixture.

Required before merge/release:

- full TypeScript and changed-file lint/plain-language checks;
- whole unit suite and production build;
- rebase/collision check against current protected `master` and #686 before merge;
- real entitled/published volatility source proof through the native route for at least one covered root;
- stale/missing/root-switch behavior on the native route;
- independent review after the final published head.

Passing synthetic fixture tests does not establish provider methodology, executable option marks, full-chain completeness, a current market view, pricing/model correctness, relative value, probability, ranking, sizing, or trade authority.
