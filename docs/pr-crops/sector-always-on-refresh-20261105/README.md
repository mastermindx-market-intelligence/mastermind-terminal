# Sector foreground refresh verification — 2026-11-05

Part of the [always-on Macro migration](https://github.com/mastermindx-market-intelligence/macro/issues/10779).

## Behavior proved locally

The existing Sector workspace revalidates all active owner feeds every 60 seconds while visible and immediately on visibility return. Each feed has at most one pending request in its current owner context and a ten-second timeout. Account/source changes cancel old work; late parsing cannot apply a response after that context ends. Daily source dates remain source supplied. Existing five-second quote updates retain their own owner.

No BFF, route, authentication, quote service, ranking, design or data-producer contract changes are included. This slice improves discovery of newly published data; it does not itself make a daily source live or repair an old upstream generation. It preserves the existing fail-closed per-feed error behavior.

## Validation

- 78 focused Vitest tests passed: workspace refresh, existing discovery, and owner envelopes.
- 12 Playwright cases passed at 1440×900, 820×1180 and 390×844: open-tab refresh in Rotation, breadth and research details, plus existing live Discover quotes.
- `npx tsc --noEmit --incremental false` exited 0.
- `git diff --check` passed.
- Parent self-review inspected the component diff and representative desktop, tablet and mobile images.

[Machine-readable receipt and image digests](verification.json) records the exact fixture run. The images below are **synthetic local browser fixtures**, not production data. Missing fields and source/device-clock disagreement in historical fixtures remain visibly qualified; no live freshness claim is inferred from them.

| Surface | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Rotation after accepted revision | [Image](sector-refresh-rotation-desktop.png) | [Image](sector-refresh-rotation-tablet.png) | [Image](sector-refresh-rotation-mobile.png) |
| Breadth after accepted revision, Chinese UI | [Image](sector-refresh-breadth-desktop.png) | [Image](sector-refresh-breadth-tablet.png) | [Image](sector-refresh-breadth-mobile.png) |
| Research details after accepted revision | [Image](sector-refresh-detail-desktop.png) | [Image](sector-refresh-detail-tablet.png) | [Image](sector-refresh-detail-mobile.png) |
| Existing quote-driven Discover | [Image](sector-discovery-desktop.png) | [Image](sector-discovery-tablet.png) | [Image](sector-discovery-mobile.png) |
| Existing heatmap, dark | [Image](sector-heatmap-labels-dark-desktop.png) | [Image](sector-heatmap-labels-dark-tablet.png) | [Image](sector-heatmap-labels-dark-mobile.png) |
| Existing heatmap, light | [Image](sector-heatmap-labels-light-desktop.png) | [Image](sector-heatmap-labels-light-tablet.png) | [Image](sector-heatmap-labels-light-mobile.png) |

## Release and remaining acceptance

This receipt does not establish hosted CI, merge, installation, production credentials or an authenticated beta session. The assigned migration session owns those next steps through the existing protected release and git-gated deployment path. Existing Terminal PR #1285 owns feed-failure reporting in the BFF/heatmap; those files remain outside this slice.

Source base: `f9d3280a2a3ff28dd925b128231702b836c8a247`.
Operation: `macro-always-on-terminal-refresh-20261105-c3`.
