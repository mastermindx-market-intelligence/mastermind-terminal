# Sector Central rotation vertical — R8 evidence

Operation: `sector-intelligence-terminal-20260926-sol-001`

Parent published head: `5391f0479e66e48c1b66c58c2121608a43a3fbe1`

State: candidate only; draft, unmerged and not deployed.

## Capability

This slice adds **Rotation** to the existing one-product Sector Central workspace without replacing Discover, Market breadth or Sector research.

- One URL-bound selected sector is shared by map, list, Sources and sector research.
- Horizontal coordinate: 63-session change in the sector/SPY relative-strength ratio.
- Vertical coordinate: 21-session change in the same ratio.
- Quadrants are sign-based: Leading, Improving, Lagging and Weakening.
- The axis domain is symmetric and fixed over the complete source population. Display search never recalculates coordinates or the denominator.
- Exact zero remains zero; a missing coordinate remains unavailable and is never placed on an axis.
- Map and list use the same source rows and preserve source order.
- Keyboard arrows/Home/End, touch selection, EN/ZH, light/dark, contextual Sources and browser Back are included.
- The inspector exposes exact source values, ranks, 200-day state, 1M sector return and advancing participation.
- Historical trails are explicitly unavailable. No prior position, turn, forecast, entry permission or ranking mandate is manufactured.

## Source contract

Exact public owner body:

- repository: `mastermindx-market-intelligence/macro`
- revision: `f94256971e49b6372645af3d329080d6e3747ea9`
- path: `site/sectordata/sector_central.json`
- source date: `2026-09-25`
- SHA-256: `61a45950781430f66fe00a93f64325819d226f6f36b704f9f899dd106b0b2dc1`

The producer contract is defined by `engine/sector_cycles.py`: relative strength is the sector close divided by SPY, and `rs_21d` / `rs_63d` are the 21- and 63-session percentage changes in that ratio. The producer itself describes these as a fast month lens and quarter lens. The consumer does not reinterpret them as price return, alpha, forecast or trade permission.

## Verification

Local source qualification on the exact candidate:

- targeted Rotation + URL continuity: **47/47 PASS**;
- complete related Sector unit surface: **146/146 PASS** across eight files;
- full Terminal unit suite: **6,417 PASS / 4 todo**, 398 files;
- Next route type generation + TypeScript: **PASS**;
- scoped TypeScript/TSX ESLint: **PASS**;
- `git diff --check`: **PASS**;
- forward-only plain-language guard: **zero new blocking findings**.

Browser qualification used the exact owner body through local interception; it is not authenticated production transport or independent design acceptance.

- `qualification-r1`: **76/76 PASS**, five captures, zero page exceptions.
- `qualification-r2`: **76/76 PASS**, five captures, zero page exceptions.
- Chromium: desktop, tablet and mobile.
- WebKit: desktop and mobile.
- EN/ZH, light/dark, exact coordinates, complete population, map/list identity, fixed filter scale, keyboard selection, research return, contextual Sources, access-loss clearing and no horizontal overflow.

R2 supersedes R1 only for visual label de-cluttering and capture scroll reset; R1 remains retained evidence rather than silently replaced.

Manifest SHA-256: `36f61ada73c903640c8063ff2bf647501c4c65dd7630dde06e075ff86aa21896`.

## Boundaries retained

- Existing R1–R7 implementation and evidence are not rebuilt.
- The held historical responsive fixture/label action is not modified, replayed, weakened or quarantined.
- No Paper board or native designer artifact is edited or duplicated.
- Themes, subsectors, bubbles, industry-by-cap Matrix, nested theme heatmaps, historical trails, authenticated source transport, save/alert persistence, independent comprehension and production release remain separate unfinished gates.
- PR #754 must remain draft and unmerged until those applicable gates and exact-head CI are consumed.
