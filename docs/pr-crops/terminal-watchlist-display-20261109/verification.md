# Watchlist display controls — verification

## Result
The Last-column switch now removes the actual header and cells. Every existing display choice uses a native labelled switch, checkbox or radio over TerminalShell's existing settings state and persistence. Selection, column widths, quote demand, list management and drag ownership remain unchanged.

Opening focuses Table view once; changes preserve the current control's focus. Escape returns to the launcher, outside focus stays outside, and clicking the launcher from inside closes without reopening. The panel scrolls within available rail height; its CSS viewport bound applies immediately during resize. Native controls follow the theme, and coarse-pointer rows measure at least 44px.

## Source and authority
- Protected base: `1c0bf028cf72539a4d3fcb17fa137ee474d764f9`.
- Product/test head: `0811463827b440fb700256085812303cb9d4f1e2`.
- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Five source/test files; TerminalShell changes are confined to one import, two disclosure refs, column projection and the settings launcher/panel.
- Held TerminalShell startup, group drag, D06 and other active hunks inspected. This slice does not include the separately queued chart-keyboard correction.
- Isolated browser tree: **3,379** canonical source/config/test files verified against Git blob hashes; **zero mismatches**. Comparison, screener, preference and chart candidate runtime changes were absent.

## Verification
- **14 affected tests passed**: eight new mounted disclosure cases and six incumbent settings-resolution cases.
- Full TypeScript exited 0 with the final watchlist runtime/test source.
- New component and tests lint clean. TerminalShell's existing findings reduce from 53 errors/18 warnings to 51 errors/18 warnings by removing two any casts; remaining findings are pre-existing.
- **6 real /terminal browser cases passed, zero retries**: two EN/ZH desktop display journeys; two existing extended-hours persistence/outage regressions; two EN/ZH coarse-pointer display journeys.
- Display journeys exercise the real column headers and cells, independently switched Ext/Ext %, native Space and radio-arrow behavior, Name/Both presentation, logo removal, table/spacious density, zero numeric columns, Escape/trigger/outside focus, reload persistence and 1440×520 viewport resizing.
- Both coarse-pointer cases measure every full-row label at >=44px.
- Synthetic fixture and canonical quote-demand regression only; no production or live account mutation claim.

## Discriminating failures and repair
Both English/Chinese new journeys fail on unchanged source because Last remains visible after its setting is disabled.
The first candidate passed the extended-hours regressions and the main interaction flow but failed short-window containment. It used a JS-updated pixel height, allowing focus during viewport resize to scroll clipping ancestors. The final implementation measures the anchored edge/inset and lets viewport-responsive CSS bound height immediately. All six final cases pass, with the rail header stationary and the final radio visible inside the scrolled popup. Original baseline and intermediate failing logs are retained; final qualification is the watchlist-fit logs.

## Visual inspection
Desktop English, short-window Chinese and short-window coarse English captures were inspected. Native control contrast follows the dark panel; selected state and labels remain legible. Short windows scroll the popup rather than shift the surrounding rail.

## Delivery and continuation
Ready PR with deliberate merge-on-green opt-in, followed by one original exact-head native auto-merge request. Required CI, queue, review and release controls remain binding. This evidence is source and fixture-browser qualification, not merge or production acceptance.

The next independent slice is native timeframe selection/favorites. A read-only settings-navigation audit also found offscreen active tabs after resize, incomplete tab keyboard behavior and short-height rail clipping. That broader SettingsPanel/CSS change affects at least 11 existing evidence gates (136 original capture cells), including packets under active PRs #1353/#904; it is deferred for a coordinated source/capture pass rather than rewriting another active writer's evidence.
