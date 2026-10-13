# Source-owned key levels and observed volume POC

The reusable futures chart now displays call wall, put wall and gamma flip using
`optionsLevels.ts`, the incumbent Options Levels owner. Only the coordinates are
converted to ES/NQ with the selected ratio/offset. No new wall model, copied vendor
algorithm, MVC guess, support/resistance guarantee or extra source request is added.

Every historical line segment uses its own frame's admitted source. A latest-frame
level is never painted backward. Landmarks retain an explicit ALL-expiry scope when
the GEX bubbles are filtered to source-session 0DTE or another narrower lens. A
bilingual expandable source inspector shows the role, source price and mapped price.

The footprint POC is computed from only admitted captured-window execution cells,
including unknown-side volume, with a lower-price tie rule. Grouped rows describe
their bucket rather than inventing an exact within-bucket traded peak. POC continues
when gamma is off/unavailable. It is not a full-market/session volume-profile claim.

The first visual pass found badges covering the last footprint's numbers. The chart
now reserves a separate label column; a browser geometry assertion proves labels
are beyond the plotted cells. Existing price-axis badge placement handles vertical
collisions. Wire validation bounds and whitelists at most three named roles, recomputes
coordinates, retains the derived frame-availability clock and refuses inconsistent
age/availability. Explicit source-distribution restriction stops automatic polling;
only transient source outages use the existing recovery timer.

## Current verification

264 focused Terminal tests passed across 15 files (including 50 incumbent level/tag
checks); typecheck and scoped lint passed before the final candidate build. Browser
checks: 27 production-route synthetic HTTP cases, 15 synthetic ES/NQ laboratory
cases, and six actual historical ES cases; three responsive viewports, English and
Chinese, no page/console errors in asserted flows and no manual page reloads. Browser
retries are zero. The actual-price screenshots remain local; only their hashes are
retained. The real historical sample contains no contemporaneous gamma and still
renders no named gamma levels. The market-data sample itself was not re-downloaded.

All public screenshots are explicitly labeled synthetic HTTP fixtures. Full-chart
crops additionally cover the complete chart inside the app's scroll container; the
full-page screen capture alone could cut off its lower part. Source hashes and both
sets of image hashes are in EVIDENCE.json. Earlier source/math agreement remains
accepted at its original evidence revision, not reinterpreted as new live proof.

## Still required

Compile and qualify the final changed candidate; retain whole-candidate regression,
exact-head hosted CI and independent release review. The previous compiled guest
proof belongs to its exact earlier source. An approved CME capture/display grant,
real capture/status/definition and options/quote publication integration, production
installation and paid-session live browser proof remain unactivated. No independent
review worker was admitted under the recorded Fabric constraints. No release bypass
or hypothetical live data is substituted for these requirements.
