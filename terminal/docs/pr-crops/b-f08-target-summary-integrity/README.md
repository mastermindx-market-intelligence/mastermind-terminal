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
