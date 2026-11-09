# Terminal Dislocations navigation polish

Chairman requested continued UI refinement and smooth, coherent navigation while qualified independent changes proceed through the existing auto-merge process.

- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Source base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- AppNav preimage: `c5f1de45c95f5ddae758e58da115b60189574ef0`.
- MobileNav preimage: `1e944f073000919fa7934da80db3bffdeeb3493e`.
- Existing browser test preimage: `a89ddd3d6ad525596d89a814052c048c222291cc`.
- Carrier: GitHub-native source changes with exact branch leases. Validation copies do not publish source.

## Observed problem and change

Dislocations already appears in the public primary navigation but lacked a glyph entry, rendering an empty SVG in both the desktop rail and mobile drawer. Add an original two-trace divergence glyph in the existing 24-unit, current-color stroke system.

The public mobile drawer's route mapping also omitted Dislocations, incorrectly marking Chart as the current page. Add its path to the existing mapping. Preserve the separate Shared Shell information architecture, links, symbol propagation, and navigation ownership.

## Ownership and qualification

Held startup PR #654 changes AppNav link intent/prefetch handling, not the glyph table. Held Dislocations discovery PR #1230 does not change AppNav, MobileNav, or sharedShellNavigation. No held code is adopted and no hold is altered.

Extend the existing real-route mobile-navigation suite to exercise Discover → Dislocations at desktop, tablet, and phone sizes, checking painted glyph paths and exactly one current-page marker. Run the affected navigation regressions and changed-file lint before Ready; publish exact-head evidence after browser proof.

## Continuation

Loading #1373 is independently enrolled. Search #1376 and tooltip #1378 are in qualification. Queue state, merge, release, and live product acceptance remain distinct.
