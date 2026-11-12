# Axis tick precision and fullscreen chart qualification

Operation: terminal-axis-tick-precision-20261111-c3. Protected basis: bec1e44956e628b271c49a0494c975efb89e9ae7. The five existing affected source paths are unchanged between that basis and protected 6c5d71ebbd797897b50f8727588bd95e834517a8; the sixth path is the new numeric regression suite.

## Problem and changes

The shared SVG formatter rounded 2.5 and 0.25 steps too coarsely and collapsed distinct tiny values. It now chooses the first decimal quantum that actually represents the step, handles floating-point noise without choosing a quantum larger than the step, preserves distinct extreme values through the normal JavaScript representation when fixed notation cannot represent them, and removes display-only negative zero.

The first real-browser run exposed an existing fullscreen measurement defect: the component remains mounted while its chart DOM is absent, so a width observer installed only once never attached when the dialog opened. The shared hook now accepts an activation argument (default true), and fullscreen passes its open state. Existing positive-width checks and cleanup remain.

Visual inspection of the second run found an additional existing defect: a descendant selector applied the square close-button geometry to both text toggles. The selector now targets only the direct close control. English and Chinese toggles keep their original content-sized styles.

Development-only fixture controls exercise tiny and fractional histories in the real Sector Cycle Lens. The default fixture is unchanged. Production access to the existing development page remains closed by its existing guard.

## Evidence

| Check | Result |
|---|---|
| Numeric baseline against the old formatter | 52 failed / 25 passed |
| Final numeric suite | 77 passed |
| Full TypeScript after formatter and observer repair | exit 0 |
| Affected ESLint, including final browser assertion | exit 0 |
| Browser R1 | 12 failed; actual fullscreen width mismatch; retained |
| Browser R2 | 24 passed, zero skips/failures/flakes/retries; visual text defect observed afterwards |
| Browser R3, final six source paths | 24 passed, zero skips/failures/flakes/retries; 47.18 seconds |
| Source stability throughout R3 | all six SHA-256 values unchanged |

R3 covers desktop 1440×900, tablet 820×1180, and mobile 390×844; English/dark and Chinese/light; tiny/fractional ticks; inline/table/empty transitions; open, resize, close and reopen measurement; unique literal tick labels inside SVG bounds; full text inside each fullscreen button; and absence of page overflow. One worker and retries=0 are explicit. The final PNGs include 24 precision images and 12 transition images.

Root inspected the six final tiny fullscreen images (all three viewports in both locale/theme combinations) plus the desktop English and mobile Chinese fractional inline images. Labels are legible and the earlier clipping/wrapping is resolved. This is actual local fixture-browser proof, not authenticated production or live-data acceptance.

## Retained history and reproducibility

Raw command logs are losslessly compressed as .log.gz. The full R1/R2 screenshot, trace and error-context directories are preserved in historical-browser-r1-r2.tar.gz with a per-file SHA-256 inventory; every archived member was read back and verified before consolidation. Original R1/R2 reports, execution records and source hashes remain directly readable.

The R2 prelaunch pause was a caller preflight mistake that treated a persistent Next lockfile as an active lock. The original PID was absent, the port was free and the installed Next lock owner documented OS-level release on process exit. No lock was deleted and no process was killed; the same Next owner acquired the lock normally. The reconciliation is retained. A later JavaScript tool-wrapper syntax error was rejected before dispatch; it had no host effect.

Commands use the existing package lock, Next/Vitest/Playwright configuration and local compatible Chromium. Numeric command: npm test -- lib/__tests__/svgChart.test.ts. Browser command: node node_modules/@playwright/test/cli.js test e2e/sector-cycle-lens.spec.ts --grep 'cycles tick precision survives fullscreen|cycles chart measurement survives' --workers=1 --retries=0 --reporter=list,json. The execution records retain exact commands, dates and output paths.

## Scope and custody

This implements the current-source precision follow-up identified in [#1249](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1249#issuecomment-6775303344) and complements the already merged [#1467](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1467) inline observer repair. The original #1249 Draft branch, publication refusal and broader real-history, basket and same-close acceptance remain separate.

The complete 73-PR overlap review found no published overlap for the core formatter/fullscreen source or new unit file; #1249 is the historical donor for the existing browser spec and stylesheet. Its donor CSS has no fullscreen selectors. The exact overlap receipts are retained here. No new CI workflow, queue, reviewer requirement, live service or production setting was introduced.

The manifest binds final source files and every retained proof file. It records evidence; it does not itself grant merge or deployment acceptance.
