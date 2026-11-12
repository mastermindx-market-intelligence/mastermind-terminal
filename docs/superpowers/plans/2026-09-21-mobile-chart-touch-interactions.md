# Mobile Chart Touch Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the phone chart roller actions reliably touchable and make Seasonality values visible by touch and keyboard without changing chart or seasonality arithmetic.

**Architecture:** Keep the existing responsive Terminal and data pipeline intact. `RollerStrip` adds component-scoped geometry classes that enlarge only hit regions and reserve nonoverlapping flex space around the unchanged 28px controls. `SeasonalityCard` keeps its existing monthly-return computation, adds localized semantic month controls plus an always-readable selection detail, and uses a single full-size native month selector as the accessible 44px alternative to twelve narrow plot bars.

**Tech Stack:** Next.js 16.2.9 App Router, React 19 client components, CSS Modules, Playwright 1.61 responsive E2E, TypeScript.

**Spec:** mastermind-terminal issue #694, “Session C — touch-first chart controls and stock-detail explanations”; authorized evidence `/Volumes/Mastermind/agent-evidence/terminal-mobile-audit-20260920-sol-001/{effective-hit-areas.json,seasonality-tap-settled.*}`.

## Global Constraints

- One focused PR for MM-007 and MM-008 only.
- Do not edit `MobileNav`, `AnalysisHubSheet`, `TerminalShell`, `ChartPanel`, `globals.css`, or the shared locale registry.
- Preserve existing seasonality arithmetic, sample counts, source/freshness meaning, theme variables, and locale/up-down semantics.
- The primary roller target is a nonoverlapping 44×44 CSS-pixel point-hit area while the visual glyph remains 28×28.
- Do not pack twelve 44px targets into the plot; retain bar taps and provide a full-size alternative selector/detail affordance.
- Release programme #483/#622 owns deployment; this lane may commit, push, open, test, and merge but must not deploy independently.
- PR #654 may move `SeasonalityCard` into `SeasonalityCardImpl.tsx`; if it lands first, rebase and port only this lane’s scoped hunk.

## Review Focus

- At 320px, the widened roller targets must not move the symbol/interval wheels or disable horizontal action scrolling.
- Adjacent expanded hit regions must retain a measurable dead gap, including Draw/More and Undo/Redo/Share.
- A month with no samples must announce a translated empty state rather than a numeric zero.
- Negative monthly averages must use `var(--down)` and retain their minus sign under either up/down color preference.
- Long Chinese labels and the detail readout must wrap without horizontal document overflow.

---

### Task 1: MM-007 roller target geometry

**Files:**
- Modify: `terminal/components/mobile/RollerStrip.tsx`
- Create: `terminal/components/mobile/RollerStrip.module.css`
- Create/extend: `terminal/e2e/mobile-chart-touch-upgrade.spec.ts`

**Interfaces:**
- Consumes: existing `.mrs-*` strip layout and button callbacks.
- Produces: `data-testid` controls whose point-hit region is 44×44, whose visual box remains 28×28, and whose centers are at least 46px apart for a 2px dead gap.

- [ ] **Step 1: Write the failing point-hit test**

Add a mobile-only Playwright case that opens the fixture Terminal at 320/360/390/430 widths, calculates each roller action center, asserts `elementFromPoint()` at ±21px on both axes resolves to the same button, asserts consecutive action centers are at least 46px apart and their midpoint is not owned by either action, confirms symbol/interval x positions stay fixed while the action cluster scrolls, and uses `page.touchscreen.tap()` on edge points for Draw, More, and Share.

- [ ] **Step 2: Run the test and verify RED**

Run: `CI=1 TERMINAL_E2E_PORT=3287 npx playwright test e2e/mobile-chart-touch-upgrade.spec.ts --project=mobile --grep "roller" --workers=1`

Expected: FAIL because the current effective horizontal span is 34px and the ±21px point is not owned by the target.

- [ ] **Step 3: Add the scoped geometry**

Import `RollerStrip.module.css`, add one scoped row class and one scoped class to each `.mrs-ic`, reserve 8px inline margin per action, reduce the row’s inter-item gap to 2px, and override `::before` to `inset:-8px`. Do not change SVG dimensions, wheel widths, strip height, callbacks, or the global stylesheet.

- [ ] **Step 4: Run the roller test and verify GREEN**

Run the Step 2 command again.

Expected: PASS at all four phone widths; 28×28 visual boxes, 44×44 point-hit regions, 2px or greater dead gaps, fixed wheels, and scrollable cluster at 320px.

- [ ] **Step 5: Commit Task 1**

Commit message: `fix(mobile): widen roller action hit targets`

### Task 2: MM-008 accessible Seasonality details

**Files:**
- Modify: `terminal/components/SeasonalityCard.tsx`
- Create: `terminal/components/SeasonalityCard.module.css`
- Extend: `terminal/e2e/mobile-chart-touch-upgrade.spec.ts`

**Interfaces:**
- Consumes: existing `MonthStat`, `useT`, `getBars`, `MAX_YEARS`, and CSS theme variables.
- Produces: localized month names, `seasonality-month-<index>` semantic bar buttons, `seasonality-month-select`, and `seasonality-detail` live visible output; existing data calculation remains byte-for-byte equivalent.

- [ ] **Step 1: Write the failing interaction tests**

Add Playwright cases that assert the plot months are semantic buttons, tap April and observe the visible average/win-rate/sample detail, select May through the 44px native selector, use ArrowLeft/ArrowRight/Home/End to move a roving focus, retain a native hover title, switch live to Chinese and observe translated labels, and route a sparse OHLC fixture so an unsampled month displays `noSamples` instead of `0`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `CI=1 TERMINAL_E2E_PORT=3288 npx playwright test e2e/mobile-chart-touch-upgrade.spec.ts --project=mobile --grep "seasonality" --workers=1`

Expected: FAIL because no semantic month button, selector, or visible detail exists and touch changes no text.

- [ ] **Step 3: Add the semantic selection model and scoped presentation**

Use `useLang` and `Intl.DateTimeFormat` for localized month names. Keep the monthly return loops unchanged. Render the bars as narrow semantic buttons with roving `tabIndex`, `aria-pressed`, translated `aria-label`/`title`, tap/focus/hover selection, and ArrowLeft/ArrowRight/Home/End navigation. Add one 44px native select plus a wrapping `aria-live="polite"` detail output. Strip only the middle hover-instruction segment from the existing translated foot while preserving its current-month and source/context segments. Style direction only through `var(--up)`, `var(--down)`, and neutral tokens.

- [ ] **Step 4: Run the seasonality tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS for touch, selector, keyboard, hover, EN/ZH, negative values, and missing samples without document overflow.

- [ ] **Step 5: Commit Task 2**

Commit message: `fix(analysis): expose seasonality details to touch`

### Task 3: Responsive verification, evidence, and delivery

**Files:**
- Extend only if a regression is uncovered: the Task 1/2 owned files.
- Evidence (not git): `/Volumes/Mastermind/agent-evidence/terminal-mobile-upgrade-20260920-sol-001-c-touch-chart/`.

**Interfaces:**
- Consumes: the completed focused spec and current branch.
- Produces: exact command logs, measurements, screenshots, clean diff, pushed branch, one PR, and separate lifecycle states.

- [ ] **Step 1: Run the focused matrix cold and repeated**

Run the new spec with `CI=1`, unique ports, `--workers=1`, and `--repeat-each=2` for mobile, tablet, and desktop projects. Run explicit 320/360/430 and 390×568 stress cases inside the mobile project.

- [ ] **Step 2: Run static and repository gates**

Run `npx tsc --noEmit`, `npm test`, `git diff --check`, and the existing `e2e/mobile-chart-chrome.spec.ts` for mobile/tablet/desktop. Record every failure by name; do not repeatedly enqueue the full responsive pack locally.

- [ ] **Step 3: Capture before/after evidence**

Write point-hit JSON and screenshots for 320/360/390/430, 820×1180, and 1440×900; include EN/ZH, keyboard focus, sparse-data empty state, and short-height 390×568. Preserve the original audit files unchanged.

- [ ] **Step 4: Reconcile current master and PR #654**

Fetch `origin/master`, inspect #654 state, rebase if needed, and if the lazy split landed move only the completed Seasonality implementation/style import to its current implementation file. Rerun the focused and static gates after any rebase.

- [ ] **Step 5: Review and deliver**

Perform a whole-branch review against issue #694 and this plan, fix Critical/Important findings through RED→GREEN, commit, push, open one PR, apply `merge-on-green`, arm squash auto-merge, and monitor required checks. Do not trigger deployment. Return base/head SHAs, paths, finding IDs, commands/results, evidence directory, collision ruling, and explicit `prepared / implemented / tested / merged / deployed / live-verified` states.
