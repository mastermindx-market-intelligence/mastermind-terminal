# News source selector follows the active theme

## Change and reproduced defect

The actual `/terminal?symbol=NVDA` News consumer applied the light palette, but its native source selector still computed `color-scheme: dark`. The local `NewsCatchup.module.css` now retains its established dark default and applies `color-scheme: light` under the existing `html[data-theme="light"]` presentation state. No appearance owner, news service, feed contract, filtering logic or held News-panel hunk changes.

Source base: `1377853d02fdb0295c0848d7127fdee4ca36714b`. The original CSS blob `c7387a5c7a80336586ad37359ab4d3d5a6a67e8e` was compared with protected master `f34b0deb0bb2a0b2f57ba82256b9e87886ad76e0`; the bounded open-PR census found no change to this leaf. Paper reference: [Shared Shell Integration Reference R1](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-2-0), applied presentation tokens and coherent light/dark controls.

## Consumer proof

Fresh Chromium contexts used actual saved language/theme preferences and the mounted Terminal News rail at the owned local development origin. No DOM theme override was used. `capture.cjs` records the route, fixtures and selection actions. The synthetic three-story fixture satisfies `ticker_news.snapshot.v1`; these report titles and timestamps are interaction fixtures, not market evidence. The local fixture account and existing EventSource fixture seam are used; no production account or data is changed.

- Baseline capture PID 56209: exit 0. Root theme/scheme light; selector scheme dark. `before.json` and `before-desktop-light.png` preserve the mismatch.
- Final capture PID 66824: exit 0. Desktop 1440×900 English and phone 320×568 Chinese, each in light and dark. `final.json` records selector scheme equal to the applied theme in all four cases, visible solid focus outlines, Reuters filtering to the expected single story and restoring all three stories.
- The chart-only dark root may compute `normal`; the selector intentionally preserves its explicit dark default. An intermediate `inherit` attempt was rejected because it computed `normal` for the selector. The final explicit light override resolves that consumer behavior.
- Initial fixture IDs lacked the required `ev2_` prefix and were correctly rejected by the existing parser. That setup error was repaired before baseline evidence was accepted; no product contract was weakened.
- `git diff --check` passed. The product change is one scoped CSS rule; no new redundant test suite or CI configuration was added.

These are local implementation proofs. Ready PR, merge queue, deployment and live acceptance remain separate states.
