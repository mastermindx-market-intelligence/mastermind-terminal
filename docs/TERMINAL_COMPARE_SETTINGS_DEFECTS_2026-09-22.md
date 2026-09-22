# Comparison settings: verified defects, implementation held

Mission: extend the Chairman's Terminal chart quality and usability programme to the existing comparison-line settings. This is a bounded follow-up, not a replacement chart, preference store or translation system.

Authority/source: current Chairman continuation; compatible Skillpack Mastermind@9a7ed19091dd82609f8ee405687f16c861c4d8c1. Base Terminal@66f26abc5eb88880cbc8dc23851328ef73bb3353. Native carrier: Remote Desktop Commander on the authorized Mac Studio; branch claude/terminal-compare-settings-ux-20260922. No overlapping CompareSettings/compareSettings/chartSettingsUi PR or named worktree was found. Direct rationale: LOWER_TOTAL_OVERHEAD for this small existing control.

## Proven on the actual existing component
`npm test -- lib/__tests__/compareSettingsUx.test.tsx`: seven failures, one pass. Failures witness RGBA and eight-digit hex displaying grey rather than their actual RGB, shorthand hex being passed invalidly to the native color input, inability to clear/retype thickness, premature clamping during editing, no named native dialog or keyboard-operable Close button, and untranslated/non-semantic line-style choices. The existing RGBA opacity preservation case passes and must remain preserved.

The earlier missing @vitest/utils error came from running before the dependency clone completed; it is not a product defect. A subsequent real test run completed and produced the seven discriminating failures above.

## Blocker and effect reconciliation
The first attempted rewrite of CompareSettings.tsx through Remote Desktop Commander write_file was blocked by OpenAI with "couldn't determine the safety status of the request". Same-carrier readback confirms the original 79-line source remains unchanged. No source edit, alternative tool/carrier write, retry or production change was performed. Treat this exact source-write action as held pending a material tool/permission recovery; do not route around it.

## Proposed repair boundary (not implemented)
Reuse existing chartSettingsUi colorInputHex/previewNumber/commitNumber and native dialog lifecycle. Preserve existing comparison callbacks and live-save semantics; retain alpha when selecting colors; make numeric drafts editable; use existing LEX drawingDashSolid/Dashed/Dotted and cmp labels; add named groups and selected-state exposure. Keep 44px touch controls, original palette and existing theme tokens. No new dependency or data/renderer/math changes.

Implementation and production proof remain owed. Any later allowed repair must add real desktop/tablet/mobile comparison journeys and preserve a baseline screenshot before selecting final styling. The attempted live-browser capture did not complete (first missed the price/percent chooser; second left the search scrim open); neither is product-red evidence or a visual baseline. No public market values are used as test facts.

The expected-red component test is retained on this branch only. No merge-ready PR or CI success is claimed. Next action: after the exact source-write gate is materially resolved, implement this bounded repair on this same carrier, pass the existing regression contracts and add real-path browser evidence. Otherwise leave this lane held and advance #713/#707 through their existing owners.
