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
- [ ] Add browser regression tests and observe expected red against the existing pane.
- [ ] Update `terminal/components/settings/SettingsPanel.tsx` navigation, focus and chrome only; retain owner/data/refresh logic.
- [ ] Update `terminal/components/settings/SectionTerminal.tsx` presentation only; retain `useAccountPrefs`, home lock, `DeliveryNote`, retry and canonical timeframe order.
- [ ] Replace shell rules in `terminal/app/settings.css`, scope Terminal controls, preserve other sections and reduced motion. Add bilingual copy to `terminal/lib/i18n.tsx`.
- [ ] Run focused and full unit tests, TypeScript/lint and actual-browser desktop/tablet/mobile checks, including keyboard, narrow/short viewports, EN/ZH and available themes.
- [ ] Publish own finished branch/PR and follow actual CI/release gates; no bypass or production claim without proof.

## Boundaries / review focus
No changes to auth, persistence, billing, chart engine or account ownership. No second settings store. Do not mutate active PRs #755/#756 or their workspaces. No static “synced” or “saved” claim without acknowledged delivery. Disabled home market remains discoverable and cannot be deselected; all 13 sections remain reachable at narrow sizes; failed delivery keeps its retry; focus returns on close and stays within the modal; display language and price-color convention remain independent.

## Verified implementation frontier

All 14 focused Chromium browser tests pass, including the actual Terminal dashboard consumer and every account section at a short desktop viewport. TypeScript passes. Full unit run: 8,843 pass; 15 assertions require refreshed source-bound screenshot evidence (14 packs), not functional behavior failures. One existing SettingsPanel team-reader `react-hooks/set-state-in-effect` lint finding reproduces on the untouched base; no owner logic changed.

The exposed typed publisher is the legacy Mastermind-only schema, with no repository parameter. Its read returned `TYPED_GIT_PRECHECK_REFUSED/NOT_APPLIED`: the default Mastermind registry has no such operation. The exact Terminal registry independently confirms this owned workspace/branch via `mmx-workspace status --repository terminal`. The protected multi-repository runbook explicitly distinguishes old non-opted-in profiles. No installation/configuration was changed and no denied Terminal write was retried. Ordinary source Git operations use this existing qualified Terminal workspace and canonical HTTPS origin, not the mismatched Mastermind publisher.

Next: commit source candidate; recapture actual affected settings states with the existing local fixture scripts; reconcile additive-only unrelated LEX locks honestly; run final verification and publish. No merge, deployment or production acceptance has occurred.
