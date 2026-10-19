# Chart Context redesign — validation

## Result

The Paper design is implemented as one responsive Terminal feature. Desktop Context occupies the existing right rail, with a measured compact toolbar launcher outside the plot. Tablet uses the toolbar and an inline reader below all chart and indicator panes. Phones open Context from More → Analysis hub; the closed reader takes no space. Fullscreen and native shells use a bounded inline reader.

[Paper desktop and mobile designs](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-21-0)

## Verified source

The production build and every current browser report use integrated source 9fe57b566316be7e1436e6d4b5e3b91c0a8c59bb. It includes protected master 3e0be25bfc1393d75684a9ebb97dacf2fbf2c5d9, preserving comparison anchors, capture review, study templates, and the chart-hosted research lifecycle. Content hashes bind the actual sources and newly generated captures. Browser reports retain their actual timestamps. Earlier complete local qualification remains in commit 617c13adea8ee8f52d51fedeb91d003f87901288.

## Local results

| Check | Result |
| --- | --- |
| Production build and TypeScript | PASS — npm run build and npx tsc --noEmit on integrated application source; both exit 0 |
| Complete unit suite after evidence refresh | 772 files; 13,017 tests passed; 4 existing todo; no exclusions |
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
| Phone Analysis hub | 8 passed; eleven tiles including Capture and Context, complete keyboard cycle and focus return |
| New palette/template handoffs | 15 passed; existing keyboard containment and template preview handoffs |
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

## Mastermind AI continuation merge — 2026-10-19

Fresh qualification covers the actual working normal merge of original AI continuation 330913f983a463e126a35a33f8ab1ab910e924ae and protected Chart Context redesign e1c66d0b137bec948e9a714b22ae81e0e72a382f. The current EVIDENCE.json records this capture's source hashes and retains the complete upstream qualification under retainedParentQualification.

The new executions are: 30/30 Visual Intelligence cases; 13 docking cases plus two existing viewport skips; three chart-remount cases; six bilingual Options coexistence cases; 24/24 PL6 captures; 5/5 options-axis captures; 52 focused integration assertions; and 10 existing evidence-reader assertions. All executable selected cases passed without retries. The canonical production build, post-build TypeScript and enforce-added language gate passed. The current 25-file VI and 28-file docking source coverage is preserved. These local fixture results do not qualify production or ordinary-model behavior.

The Options suite emitted its 14 new PNG/offset artifacts at its existing default output location. Their creation times and hashes were checked against the actual six-case run, their exact bytes were placed into this packet's options-state directory, and the original emissions were retained. No recapture is claimed for copying these already-generated files. The actual reports remain separate: ../terminal-visual-intelligence/browser-report.json, merged-dock-remount-report.json and merged-options-coexistence-report.json.

Required hosted CI and coordinated Macro admission remain pending for the final combined publication. The earlier 330913f hosted run failed one desktop browser shard and is not an admitted result. Full continuity and local logs are linked from docs/research/CMX_COPILOT_CONFIGURED_STUDIES_2026-09-26.md.

The prior desktop-2 failure is the thesis rapid Back/Forward selection test, not a passing release gate. Its three hosted traces and the exact case's single no-retry local pass on this merge are documented in the original continuation record. No thesis source or test assertion was changed, and the local diagnostic does not establish a fix or replace fresh hosted CI.
