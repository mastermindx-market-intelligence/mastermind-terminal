# Terminal chart settings and tablet control access — 2026-09-21

## Scope and custody

Parent commission: improve Terminal chart usability, visual quality, bugs, smoothness and performance without replacing a superior chart implementation or losing functionality.

This bounded implementation upgrades chart settings and fixes an independently reproduced tablet control collision. It does not claim completion of the full charting program, renderer throughput, data-pipeline optimization, or production delivery.

- Rule source: `mastermindx-market-intelligence/Mastermind@0125a2c912d319dff1b60f3e3a6e3988d838a3ab`.
- Loaded skillpack: `mastermind.sol_skillpack.v1` / `1.0.1`; INDEX, COLD_START, ACTIVE_EXECUTION, WEB_CEO_DELEGATION, RECONCILE_STATE, CLOSEOUT.
- Source base: `mastermindx-market-intelligence/mastermind-terminal@749576c537284df43772d3cfd3fdd75ad7194a2d`.
- Branch: `claude/terminal-chart-settings-ux-20260921`.
- Native modification carrier: Studio Direct, isolated canonical-repository worktree. An earlier ambiguous import-only edit was read back and reverted before this implementation. No alternate-carrier source mutation was accepted.
- No worker, watcher, new AgentOS workstream, second settings store, new dependency, global stylesheet rewrite, direct production file copy, or deployment was created.

## Capability delta

Before: chart settings exposed unnamed inputs, invalid CSS color strings to native color pickers, hard-clamped numeric edits, a render-path template-storage read, and no modal focus ownership. Mobile section labels and Reset were hidden. At tablet widths the floating drawing dock intercepted real clicks on the settings gear.

After: settings retain every existing option and the existing preference owner, but use a native modal with scoped styling, named controls, keyboard tabs, visible mobile navigation and Reset, valid native color values, editable numeric drafts, and cached template reads. The web tablet dock has a dedicated safe-area-aware strip once per workspace, leaving chart controls usable. Native-shell and phone dock geometry are unchanged.

The UI continues to respect the Terminal dark-only contract. Using theme tokens does not introduce or claim a supported light mode.

## Implementation and negative proof

`ChartSettingsModal.tsx` retains the existing `ChartSettings` type, opening snapshot, live-preview updates and `mm:settings-tab` parent event. Cancel, close and Escape restore the opening snapshot; OK keeps the previewed preferences. A hidden origin marker selects the local chart's return-focus target while the visible dialog remains portalled outside pane clipping.

A bounded, cancellable animation-frame handoff repairs focus lost when a pointer-opened chart context menu finishes dismissal. It only runs once on opening and only when focus is outside the dialog. No global focus listener or ongoing polling loop was added.

`chartSettingsUi.ts` normalizes RGB/hex values for opaque native color controls while preserving alpha in swatches; numeric preview ignores incomplete/out-of-range input and commits finite clamped values on blur; template parsing rejects malformed roots, arrays, unknown fields, incorrect types and non-finite numbers. User template names are namespaced in the select so names such as `__save` do not invoke commands.

The settings CSS module replaces dialog-local blur with a scrim, improves section hierarchy and focus indicators, expands color targets to 44px, and supports reduced motion. The drawing module reserves space only at web widths 641–860px; it does not add per-pane blank space.

Performance proof is deliberately narrow: the real browser test observes no additional reads of `mm.chartSettingTemplates` across twelve live-preview changes after opening. No claim of improved FPS, overall first-load latency, API performance or network volume is made.

## Regression discoveries and repairs

The real-browser pass exposed and repaired three issues rather than weakening tests: lost focus on desktop dismissal of a transient settings menu; tablet drawing-dock overlap; and lost initial focus following phone chart-context-menu dismissal. No force-clicks, expanded timeouts, retries or simulated replacement component were used to turn those failures green.

The pre-existing Visual Intelligence journey now selects Canvas by its correct `tab` role rather than the superseded `button` role. Its chart-state and persistence assertions remain intact. Shared visual evidence is recaptured, not accepted by changing a source hash alone.

## Recovered continuation — 2026-09-21

Current Chairman instruction: continue the interrupted chart-upgrade task and report status. Current protected procedure was reloaded at `Mastermind@05450845911bc4e67afd16555f25daee6d77388b`; INDEX and all five required skill blobs match the previously read compatible v1.0.1 content exactly.

The original worktree contains the full implementation, six settings screenshots and the recaptured Visual Intelligence evidence. Recovery found no PR, no live preview, and no active process on this worktree. The import edit and later implementation are present; no missing-effect assumption or replay was used. Source base and current Terminal master remain `749576c537284df43772d3cfd3fdd75ad7194a2d`.

Studio Direct is not exposed in the current connection. The same authorized Mac Studio and exact worktree were read through Remote Desktop Commander. Its current source matches the content-addressed browser evidence. Subsequent packaging/verification uses that available native connection without moving the branch/worktree or restarting any unknown modifier.

Fresh recovery checks: `chartSettingsUi` (45), `chartSettingsHydration` (4), `visualIntelligenceEvidence` (3): **52/52 passed**. `tsc --noEmit` and scoped ESLint both passed. Desktop EN, phone EN and tablet ZH screenshots were visually reviewed. Original chart options, data and indicator math remain unchanged.

Direct continuation rationale: `LOWER_TOTAL_OVERHEAD` and `CRITICAL_PATH_SHORTCUT`; the completed candidate needs verification and delivery, not another worker reconstructing the work. No worker or autonomous return path is claimed.

Current capability: `BUILT_NOT_PROVEN`. Mission complete: **false**. The full-chart performance programme remains open; these changes do not establish a frame-rate, startup, API or renderer speedup.

Next action: preserve this exact candidate remotely, run the real settings/context/price-label browser matrix, consume required CI, and only then use the existing protected merge and git-gated deployment chain. Do not redo the redesign, repeat the initial import edit, overwrite other chart PRs, or interpret screenshots/green tests as production proof.

## Fresh exact-candidate browser result

Source `4b07375a9e487631d3d3239f0cb3cf421332120e` completed the real settings / Visual Intelligence / price-label matrix: **73 passed, 8 existing viewport-specific skips, zero failures**, with one worker and no retries. English and Chinese settings screenshots and the Visual Intelligence crops were recaptured; their content digests are retained in the existing evidence directories. This verifies the responsive browser path, not an authenticated production release.

Separate independent performance follow-on: `claude/terminal-chart-clock-isolation-20260921` isolates the footer wall clock. It does not change this PR's settings or drawing-source paths.
