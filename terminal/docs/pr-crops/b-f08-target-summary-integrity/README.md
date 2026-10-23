# Settings portfolio targets: successful-response integrity

Fresh evidence at integrated head `9573d60ab12ff593b6e6764e75e2cf0ec9e049cc`, containing reviewed repair `a20df4ea4` and Terminal master `0e8de334d`.

The existing Settings section keeps an unusable HTTP 200 targets summary unreadable and offers localized Retry. A subsequent valid empty response recovers to the empty readout through exactly one additional GET, with no target writes. The six browser cases also assert zero page errors and no horizontal document overflow.

This packet contains 12 fresh dark-only captures: EN/ZH at desktop 1440×900, tablet 820×1180 and mobile 390×844, each showing `unusable` and `recovered`. `evidence.json` binds source hashes, capture hashes/dimensions, commands and scope. Desktop EN and mobile ZH pairs were visually inspected.

Verification on integrated source:

- `npx next typegen`: exit 0.
- Full Terminal `npx tsc --noEmit`: exit 0.
- Existing `settings-targets-summary.spec.ts` in desktop/tablet/mobile projects: 6 passed, 0 failed, 0 flaky, exit 0.
- Prior 199 targeted checks reused after verifying that all five reviewed source/test files retain their exact accepted hashes.

Browser command from `terminal/`:

```sh
TERMINAL_E2E_PORT=3194 MO_SETTINGS_SUMMARY_CAPTURE_DIRECTORY="$PWD/docs/pr-crops/b-f08-target-summary-integrity" npm run test:e2e:responsive -- e2e/settings-targets-summary.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=list,json
```

The test uses the existing localhost fixture identity and intercepts portfolio-targets GET responses. It proves mounted UI and integration behavior, not live signed-in persistence, tenant acceptance or production delivery. The existing Terminal dark-only surface is retained; no light treatment, CSS or copy change is introduced. This is a new evidence packet; PR902-owned packets and their hashes are untouched.

## Recapture on E20 landing train 2

Train 2 merged a different `TerminalShell.tsx` and `globals.css`, both locked sources, so all twelve captures were regenerated on the merged tree (capture head `1bfb1c7f4`, Terminal master `2957bd64e` merged in). No PNG or hash was copied from either parent. The first recapture caught the desktop ZH `unusable` frame halfway through the section's entry animation, so the pane was blank. The capture now passes `animations: "disabled"`, which finishes that animation before the frame is taken; the test's assertions are unchanged. The repeat run passed 6 of 6 with retries off, and all twelve captures, EN and ZH, were viewed. `evidence.json` records the new hashes and keeps the previous capture under `priorCapture`.

## Recapture on E20 landing train 3

Train 3 merged a different `TerminalShell.tsx` (E16 itinerary and E19 capture wiring, plus the train 2 master sync), a locked source. All twelve captures were regenerated on the merged tree at capture head `523a7f117`, which includes Terminal master `85ad93866`. No PNG or hash was copied from either parent. The run passed 6 of 6 with retries off and `animations: "disabled"` unchanged. The other twelve locked sources keep their accepted hashes. Desktop ZH and EN `unusable`, tablet ZH `recovered` and mobile EN `recovered` were viewed. `evidence.json` records the new hashes and nests the train 2 capture under `priorCapture`.

### Recapture after the E05 master sync

E05 (#927) then landed on master, and train 3 merged Terminal master `857a5076f` at `bf767cbfd`. That merge changed `TerminalShell.tsx` again (E05's owner-scoped note and flag promotion, and the `WatchlistAnnotationSync` mount), so all twelve captures were regenerated once more on the merged tree at capture head `bf767cbfd`. No PNG or hash was copied from either parent. The run passed 6 of 6 with retries off in 53.4s, with `animations: "disabled"` unchanged. The other twelve locked sources keep their accepted hashes. Desktop ZH `unusable` and mobile EN `recovered` were viewed. `evidence.json` records the new hashes and the new `TerminalShell.tsx` lock, and nests the `523a7f117` capture under `priorCapture`.

### Recapture on fold round 2

Train 3 then folded E20 (#953, the command palette, which adds its dynamic import and trigger to `TerminalShell.tsx`), the #957 ledger docs and the E19 font-readiness repair (#952 @789f15847). `TerminalShell.tsx` is a locked source and changed again, so all twelve captures were regenerated on the folded tree at capture head `c8b7b5847`. No PNG or hash was copied from either parent. The run passed 6 of 6 with retries off in 39.1s, with `animations: "disabled"` unchanged. All twelve captures, EN and ZH, were viewed. `evidence.json` records the new hashes and the new `TerminalShell.tsx` lock, and nests the `bf767cbfd` capture under `priorCapture`.
