# Sector Intelligence R3 — qualification and open gates

Capability: group discovery into the existing native overview/company-research workflow. DRAFT / BUILT_NOT_PROVEN. No production, current-data or independent usability acceptance.

## Published predecessor

R2 was committed and pushed through the original Studio Direct worktree to existing Terminal PR #754 at `f6798dcbc569ce29519133b7908a8aa1d8d92b27`. GitHub head readback confirmed that exact commit. The previously blocked original staging/added-lines action succeeded after a changed tunnel session and fresh resource/state reconciliation. Its plain-language check found zero blocking findings; no old evidence hashes or assertions were weakened.

## R3 implementation

The source-group selector opens the existing shared MobileSheet component, rather than introducing another modal controller. It supports English/Chinese name and key search, exact group selection, selected-state marking, source-order preservation, initial 30-row rendering with explicit expansion, empty/loading/access/error states and shared board appearance tokens. Selecting a different group clears only company-specific context; selecting the same group preserves context. Groups remain independent of the selected sector; no unverified sector/group or economic-exposure relationship is created.

A cross-engine diagnostic found that the opening pointer activation did not reliably leave the trigger as the sheet's return-focus target. The trigger now explicitly receives focus before the existing sheet opens. No shared-modal implementation was changed.

## Observed qualification

- Final full Vitest suite on the R3 source after the trigger-focus change: **392 test files passed; 6,300 tests passed; 4 todo**. Command `npm test`; observed process 5397 completed the test/typecheck/lint chain with exit 0.
- Final `npx tsc --noEmit --incremental false`: **PASS**.
- Final scoped ESLint for the new group component, integrated workspace, feature lexicon, group unit tests and group browser spec: **PASS**.
- New group unit tests: **15 passed**. Existing comparison tests: **14 passed**.
- Persistent responsive company + group workflow suite: **25/27 passed**, with **two open timing failures**. This run preceded the later trigger-focus change. The existing 12 company-workflow cases and 13 group cases passed. The desktop/mobile bounds checks measured the modal during its 260ms entering animation. They have NOT been repaired or waived.
- Actual animation diagnostic: mobile initial bottom `1091.332` while entering; after animation completion bottom `836` within an `844`-pixel viewport, with bottom inset `8` and zero vertical transform. This explains the timing error; it does not turn the failed regression run green.
- `group-browser-diagnostic.json`: initial diagnostic failed WebKit desktop return-focus; preserved, not overwritten.
- `group-browser-diagnostic-v2.json`: after the trigger-focus repair, **25/25 diagnostic checks passed**, four captures, zero page exceptions. Chromium desktop/mobile light, WebKit desktop dark and mobile Chinese light. Settled bounds, exact search, focus return, selected-company preservation and scroll restoration were checked.

The diagnostic fixture combines the historical Semiconductor records with one explicitly synthetic Hardware test group. It is NOT evidence of current source membership or positive authenticated upstream transport. WebKit engine checks are not production Safari acceptance. The independent human-comprehension review remains outstanding.

## Unapplied / blocked changes

The platform blocked a compound correction request before dispatch. None of that request's changes applied: waiting for animation completion in the persistent test, singular `company` wording, automatic group-dialog closure on browser history navigation, or the optional output-directory parameter for the older R2 capture helper. Do not infer their presence from this document. The subsequent trigger-focus correction addressed a separately discovered WebKit failure and did apply.

A current Macro tree/parent-delta lookup and a separate compound source-digest/proof-inventory/watch-component lookup were also blocked before dispatch. They were not rephrased or replayed through another carrier. No final full-source digest manifest was produced in this turn; Git commits bind the published source/artifact bytes. Older refused source-validator, transport-finalizer, compact-header, ordering and clock patches remain unapplied unless their existing owner later returns a permitted accepted revision.

## Release gate and next action

Keep PR #754 draft and unmerged. Close the actual persistent timing gate through a permitted same-carrier successor after demonstrated recovery, finish the open group-dialog history/copy details, then rerun the exact candidate regressions. Consume the existing parent's consolidated-design contract and existing Technology dossier producer rather than rebuilding them. Actual current owner-schema and authenticated data binding, canonical dossier/exposure/CPU identity, Business Pulse, strategy/horizon availability, PIT/corrections, and canonical save/alert persistence remain incomplete.

No Paper write, production publication, worker, watcher, duplicate store or runtime control plane was created. The screenshots were visually inspected by the implementing session only. Browser proof is not independent design acceptance.
