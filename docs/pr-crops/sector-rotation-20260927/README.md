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

## R9 — human-first Rotation hierarchy and selected-sector depth

This bounded repair consumes PR #754 review `5329681739` without changing the R8 source owner, coordinate model or URL state plane. It retains the same exact `sector_central.json` population and existing `sectorWorkspace`, `sectorRotationMode`, `sectorRotationQuery`, selected-sector and contextual Sources keys.

### User-facing hierarchy

- Rotation now leads with a plain market read derived from the current complete coordinate population, not hard-coded sector names. On the bound 2026-09-25 owner body it states: **Technology is the only sector positive on both 21D and 63D relative strength. Energy has the strongest 63D relative strength, but its 21D trend is negative.**
- The large denominator, focus-lens caveat, coordinate coverage and no-history/method copy are demoted to a compact dated receipt plus a collapsed Method and source disclosure.
- Only three peer jobs remain in the outer navigation: Rotation, Discover and Market breadth.
- Existing `sectorWorkspace=detail` is presented as subordinate selected-sector research with an explicit return path. No `sectorDetail`, `sectorJob`, `sectorRep` or compatibility layer is introduced.
- Explicit return restores the exact outer state, including selected sector, map/list mode, display query and prior group identity; browser Back remains independently valid.
- The producer's tactical source state is separately labeled from the 21D/63D descriptive quadrant.
- Mobile order is answer, map/list and filter, selected-sector inspector, then collapsed methodology and Sources.

### Verification chronology

The first human-first browser run stopped after eight checks because its proof compared CSS-transformed uppercase `TACTICAL STATE` case-sensitively. The interface was correct and the helper was repaired without weakening the product check. The second run stopped after fourteen checks because the new explicit return restored the outer workspace but not its prior independent group identity; that was a real product defect. The workspace now snapshots and restores the complete outer `SectorState`. Both failure receipts remain under `human-first-r1/` and `human-first-r2/`.

Final `human-first-r3` qualification: **101/101 PASS**, five captures and zero page exceptions across Chromium desktop/tablet/mobile and WebKit desktop/mobile, EN/ZH and light/dark. It proves the derived answer and compact receipt, exactly three outer jobs, separate tactical label, collapsed filter/method, exact owner coordinates, fixed scale, full map/list identity, explicit return plus browser Back, contextual Sources, access-loss clearing and no horizontal overflow.

Final local source proof:

- answer/Rotation/URL targeted slice: **49/49 PASS**;
- complete related Sector surface: **148/148 PASS** across eight files;
- full Terminal unit suite: **6,419 PASS / 4 todo**, 398 files;
- Next route generation, TypeScript, scoped TypeScript/TSX ESLint and `git diff --check`: **PASS**;
- forward-only plain-language guard: **zero new blocking findings**.

The browser lane still uses exact-owner local interception. It is not authenticated production transport or independent final comprehension acceptance. Paper remains untouched, and the incumbent native bubbles/Matrix/theme hierarchy writer is not displaced.

Human-first source aggregate SHA-256: `65e1906e86239af5d2cff469b60094afa032529db8d8bb9912094af0b74c08b6`. Human-first manifest SHA-256: `a8ee5e696d30cf865f26af142733110128388a13e292bcc659ad622badb24407`.
