# Chart quick-settings verification

Product source tested: `c011b921112b77f4a05a31fd0f3b8006aff3b554` (PR #1363). The following evidence commit changes only documentation/images; product and test source remain identical to the tested commit.

## Results

- 56/56 focused Vitest tests pass: chartQuickSettings, chartSettingsUi, chartFrameBarClock and chartSettingsHydration.
- Full `tsc --noEmit --incremental false` passes with Node's `--max-old-space-size=4096`. The first isolated snapshot omitted fixtures; restored exact-base fixtures before this pass. No TS configuration was weakened.
- ESLint candidate/base comparison: the same five pre-existing no-explicit-any findings and one pre-existing set-state-in-effect finding in ChartFrameBar; both changed test files have no findings.
- Real `/terminal?symbol=NVDA` fixture route, desktop 1440x900 and touch tablet 820x1180: four browser tests pass. Commands select `quick settings support|chart settings own focus` from `e2e/chart-settings-ux.spec.ts`. Native keyboard toggles, disabled-item skipping, disclosures, Escape, full settings handoff and return focus all pass.
- Two additional visual assertions pass on those viewports: the expanded Labels popup's bounds stay inside the viewport; all enabled quick-settings buttons are at least 44px tall in the coarse-pointer tablet context.
- Screenshots inspected: desktop-quick-settings.png and tablet-quick-settings.png. Existing neutral popover styling, chart context and responsive layout are preserved. Tablet content scrolls to reach the bottom options; the real-route keyboard test reaches More settings successfully.

## Isolated test runner

An immutable GitHub archive of the tested commit was materialized under `/Volumes/STORAGE/mmx-evidence/terminal-ui-20261109-c1/source`; no existing checkout files or Git state were modified. The archive and source-receipt.json identify the exact commit. The existing matching Playwright/Next dependencies were reused read-only. External proof configuration inherits `terminal/playwright.config.ts`, disables only its unrelated route-wide warmup, selects desktop/tablet and one worker, uses port 41863 and the existing development-only fixture environment, and starts `next dev --webpack`. Product and CI configurations are unchanged.

Browser outputs: browser-proof.log (4 passed) and visual-proof.log (2 passed) in the same evidence directory. The visual probe opens Quick settings, expands Labels, checks x/y/right/bottom against the viewport, checks coarse-pointer control height, and captures the two committed images. No production credentials or data were involved.

## Limits and release

This is fixture consumer proof, not production acceptance. The attached user's Chrome session remains occupied by another extension UI and was not bypassed. GitHub protected CI and native queue enforcement still govern merge. Live deployment/production proof remains separately owed.
