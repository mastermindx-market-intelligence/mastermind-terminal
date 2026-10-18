# Chart Context redesign — validation

## Result

The Paper design is implemented as one responsive Terminal feature. Desktop Context occupies the existing right rail; the compact launcher sits outside the plot. At the single-column breakpoint, fullscreen, and native chart shells, the same reader moves below the complete chart and its indicator panes.

[Paper desktop and mobile designs](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-21-0)

## Verified source

The final production build and fresh 30-case acceptance report use source 9d790bdbede22d6b57ea09309ca3a485d08aea4a. CI found two headline fragments that needed the existing bilingual helper; their English and Chinese output is unchanged. The three placement captures were also regenerated. Earlier Options, keyboard and toolbar reports retain their actual run times; their original evidence is preserved in commit 692236b16cb72ed1f12dd05f9c75fc2d7f96d7d8. Content hashes bind the latest captured files.

## Local results

| Check | Result |
| --- | --- |
| Production build | PASS — npm run build, exit 0 |
| TypeScript | PASS — tsc --noEmit, exit 0 |
| Complete unit suite after evidence refresh | 737 files; 12,313 tests passed; 4 existing todo; no exclusions |
| Existing Visual Intelligence compatibility | 30/30 passed; zero failures, skips, retries or flaky cases |
| New Context placement and interaction journeys | 10 passed; two deliberate duplicate transition skips |
| Real Options state → Context → Options | 6/6 passed; EN/ZH at desktop, tablet and mobile |
| Toolbar fit, including Context launcher | 4/4 passed; EN/ZH at 1180px and 1024px |
| Calendar fixture correction falsifier | Both reproduced mobile failures passed after the fixture correction |
| Source-bound evidence readers | All three passed in the complete unit run |
| Plain-language gate | PASS — no blocking findings on the complete PR diff |
| Required remote CI | Must qualify the final PR head before merge |

The transition journey runs once from desktop through mobile and fullscreen with two real chart panes, checking that the visible active pane and Context keep the same symbol, timeframe and selected bar. Independent placement journeys cover 1440×900, 820×1180 and 390×844.

The Options journey holds a nontrivial SPY build, selects and pins strike 780, records nonzero scroll offsets, enters Context, and returns to the same mounted Options and chart canvas instances. It checks the selected summary, dashed chart pin, held build, pending newer build, scroll offsets and return focus. The retained offset tables and parked/returned crops are under options-state/.

## Actual captures

- desktop-placement.png, tablet-placement.png and mobile-placement.png show the chart and reader placement.
- ../terminal-visual-intelligence/ contains six fresh EN/ZH viewport crops and the exact 30-case browser report.
- ../b-pl-6-batch-1/ was regenerated in full: 24 crops from the integrated application source.
- ../options-level-axis-labels/ was regenerated in full: five captures and native line/tag overlap proof.
- EVIDENCE.json records the additional browser reports and screenshot hashes.

The desktop placement, mobile reader, and Chinese tablet reader were visually inspected. Terminal is dark-only under the existing product decision. Browser data comes from repository fixtures and intercepted fixture contracts, not live market-data verification. The Paper mockup reproduces the supplied screenshot’s metric values and labels its drawn price history as illustrative.

## Calendar fixture correction

A production build regenerates the local coverage index. This clean worktree has no physical fund files, so its fresh coverage response declared an empty fund list. The calendar tests separately intercepted NVDA and AAPL fund requests, creating an inconsistent fixture: the coverage consumer could pre-seed an absence and suppress those intercepted reads. Trace evidence showed getFund returning null within milliseconds while another delayed request was still pending.

Only the two calendar-interception tests now supply matching fresh NVDA/AAPL coverage before navigation. Their original loading, unavailable, outgoing-symbol isolation, event-overlay and persistence assertions remain. No production calendar, cache, or data-file change was required. All temporary diagnostic logging was removed, and the final application source was built again successfully.

The existing Visual Intelligence test file still has its eight pre-existing no-explicit-any lint findings; the corresponding casts are unchanged from protected master. The edited Options and toolbar test files pass their targeted lint run, and the complete TypeScript and unit gates pass.
