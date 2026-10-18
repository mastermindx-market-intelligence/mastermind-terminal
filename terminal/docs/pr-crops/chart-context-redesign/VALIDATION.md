# Chart Context redesign — validation

## Result

The Paper design is implemented as one responsive Terminal feature. Desktop Context occupies the existing right rail, with a measured compact toolbar launcher outside the plot. Tablet uses the toolbar and an inline reader below all chart and indicator panes. Phones open Context from More → Analysis hub; the closed reader takes no space. Fullscreen and native shells use a bounded inline reader.

[Paper desktop and mobile designs](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-21-0)

## Verified source

The production build uses integrated application source f522ff9eab21e30a2d20a0b6546983160d69f8fa. The accepted browser reports use 761cc7ab0ce7e2e43f5633f6417ad787108922e4, whose only subsequent source change selects the visible canvas in the test entry helper; application bytes are identical. It includes protected master 9f26d3a00dbaada3580706f7e059dd8eff682d7e and preserves its research-pane touch exit. Browser reports retain their actual timestamps. Content hashes bind all recorded layout sources and screenshots. Earlier qualification is retained in commit 54adec6253a53f486efabb4c71bf4dfbe3a1b1fa and the historical manifest section.

## Local results

| Check | Result |
| --- | --- |
| Production build and TypeScript | PASS — npm run build on integrated application source; npx tsc --noEmit on accepted source; both exit 0 |
| Complete unit suite after evidence refresh | 737 files; 12,313 tests passed; 4 existing todo; no exclusions |
| Original Visual Intelligence compatibility | 30/30 passed; zero failures, skips, retries or flaky cases |
| Combined responsive and integration report | 46 passed; 9 deliberate viewport skips; zero failures or retries |
| Context placement, keyboard, disabled recovery and native/tray journeys | Included at desktop, tablet and phone; transition also closes/reopens at phone width |
| Real Options state → Context → Options | EN/ZH at all three viewports; held build, selected strike 780, dashed pin, scroll and same mounted instances preserved |
| Original native fill, tray overflow, phone fold and expanded strip | Unchanged assertions passed |
| Tablet toolbar and language/theme fit | Unchanged assertions passed; EN/ZH at 1180px and 1024px included |
| Chart context-menu remount | Original three-viewport listener and disposed-engine assertions passed |
| Research-pane touch exit | Newly merged upstream journeys included |
| Source-bound evidence readers | All three included and passed in the complete unit run |
| Plain-language gate | PASS — no blocking findings on the complete PR diff |
| Required remote CI | Must qualify the final published PR head before merge |

## Actual captures and interaction proof

The three placement images show Context outside every visible chart pane. Three native placement images show the bounded reader below the chart. The English and Chinese reader crops and exact 30-case report are in ../terminal-visual-intelligence/. The complete PL6 packet has 24 regenerated crops, and ../options-level-axis-labels/ has five fresh captures with the original line/tag overlap proof. The Options parked/returned crops and nonzero scroll offsets are under options-state/.

The keyboard journey checks initial focus on Close and the heading in the viewport before any reader interaction can scroll it. It then verifies local key ownership and Escape return focus. The multi-pane journey closes and reopens at phone width and verifies the persistent More return target, active symbol, timeframe, historical bar and fullscreen placement.

Paper’s phone board was updated to remove the extra launcher row and document the actual Hub entry. Its drawn price history is explicitly illustrative. Local browser captures use repository fixtures, not live market data.

## Repaired CI interactions

The earlier full CI run caught the permanent 44-pixel row reducing native chart height, overflowing the phone tray, and moving the normal phone fold and expanded strip. The row was removed; native web launchers were gated out. The toolbar launcher became a measured core tool to prevent the tablet More control overflowing.

The earlier desktop trace also showed a click aimed at the temporary startup position while the chart name tab was collapsing. The shared entry helper waits for the visible chart before targeting the toolbar; it does not wait for RSI, so the disabled-reader recovery case remains meaningful. The reader reveals its header on explicit opening and restores an appropriate opener after resizing.

The original calendar tests retain their loading, unavailable, outgoing-symbol isolation, event-overlay, replay and persistence assertions. Only their fixture coverage declaration was aligned with their intercepted NVDA/AAPL fund routes.

The Visual Intelligence test file retains its eight pre-existing no-explicit-any lint findings. No claim is made that those unrelated existing findings were removed.
