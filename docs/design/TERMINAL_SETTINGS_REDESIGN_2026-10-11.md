# Terminal user-pane redesign — implementation contract

Goal: make the shared account/settings pane feel native to Terminal, preserving its thirteen destinations and all account behavior.

Source: Terminal master `0e8de334d3a772d3c8b035a1ce01d04b1316274a`; Mastermind procedure `d844b51586ffd061a97b9789028201852379c6a6`.
Paper: https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-1C-0
Desktop artboard `61ON-0`; mobile full-scroll study `61TU-0`. Exact JSX and computed styles inspected after screenshot review. The backdrop in Paper is illustrative, not live market data.

## Design
Solid source-token slate panel: max 1000 × 660px, 208px navigation, 12px shell radius, thin borders, restrained selection. Remove the aurora, saturated avatar and excessive blur. Desktop typography 20px title / 14px subhead / 13px body / 12px helper. Group navigation into Account, Workspace and Connections without losing destinations. One market list, 50px rows, trailing checks. Canonical 18 timeframes in six columns; current chart unaffected. Two equal candle-convention controls with text and selected check. Mobile retains a visible close/sign-out header, native section picker, one scrolling content pane and 44px controls. Keep the dashboard visible behind the modest scrim. Theme tokens remain owned by globals.css.

## Implementation plan
- [x] Inspect protected procedure, source, ownership and Paper; acquire isolated managed workspace.
- [x] Design desktop and mobile; inspect screenshots and exact exported styles.
- [x] Add browser regression tests and observe expected red against the existing pane.
- [x] Update `terminal/components/settings/SettingsPanel.tsx` navigation, focus and chrome only; retain owner/data/refresh logic.
- [x] Update `terminal/components/settings/SectionTerminal.tsx` presentation only; retain `useAccountPrefs`, home lock, `DeliveryNote`, retry and canonical timeframe order.
- [x] Replace shell rules in `terminal/app/settings.css`, scope Terminal controls, preserve other sections and reduced motion. Add bilingual copy to `terminal/lib/i18n.tsx`.
- [x] Run focused and full unit tests, TypeScript/lint and actual-browser desktop/tablet/mobile checks, including keyboard, narrow/short viewports and EN/ZH in Terminal’s supported dark theme.
- [ ] Publish own finished branch/PR and follow actual CI/release gates; no bypass or production claim without proof.

## Boundaries / review focus
No changes to auth, persistence, billing, chart engine or account ownership. No second settings store. Do not mutate active PRs #755/#756 or their workspaces. No static “synced” or “saved” claim without acknowledged delivery. Disabled home market remains discoverable and cannot be deselected; all 13 sections remain reachable at narrow sizes; failed delivery keeps its retry; focus returns on close and stays within the modal; display language and price-color convention remain independent.

## Verified implementation frontier

Rendered source: `fe1b5da159071050279ef2591ae18c98f81a3a76`, based on protected Terminal `9bc8a12b8e869a699d9bd3f0f90b160323d212b6`. All thirteen sections remain reachable. Full unit suite: 543 files and 8,914 tests pass (four existing todos). Fourteen focused browser tests, three existing native responsive journeys, TypeScript, and local production build pass. Nine source-bound capture tools refreshed 106 screenshots. Source, measurement and image evidence: `terminal/docs/pr-crops/terminal-settings-redesign/README.md`.

One existing SettingsPanel team-reader ESLint finding reproduces on the untouched base; no owner logic changed. No independent agent review is claimed: the current Executive projection exposes no addressable Claude reviewer, and no Codex session or credits were started.

The exposed typed publisher is the legacy Mastermind-only schema, with no repository argument. Its status read returned `TYPED_GIT_PRECHECK_REFUSED/NOT_APPLIED` because the default Mastermind registry has no such operation. The Terminal registry independently confirms this owned workspace/branch with `mmx-workspace status --repository terminal`. Protected procedure explicitly distinguishes non-opted-in profiles. No gateway configuration, registration, or install was changed. Normal Git operations use this qualified Terminal workspace and its canonical HTTPS origin; the initial source commit is pushed and read back.

Next: publish the verified evidence commit and ready PR; consume current protected CI; follow the existing merge-on-green and git-gated release path when gates clear. Preserve this one branch/carrier. No merge, deployment or production acceptance has occurred at this frontier.
