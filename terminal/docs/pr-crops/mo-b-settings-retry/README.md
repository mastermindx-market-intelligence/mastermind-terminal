# Settings targets: explicit retry and owner-generation fence

Current native Settings modal, using its existing local fixture identity. Twelve captures cover English/Chinese × desktop 1440×900, tablet 820×1180, mobile 390×844 × unreadable/recovered-empty. The existing Terminal shell is dark-only; no new styling or theme system is introduced.

Reproduce from `terminal/`:

```sh
MO_SETTINGS_CAPTURE=1 TERMINAL_E2E_PORT=3597 npm run test:e2e:responsive -- e2e/settings-targets-retry.spec.ts --workers=2
```

All six browser cases passed. Targets requests remain GET-only; after all initial reads fail, explicit Try again issues exactly one additional GET and replaces the unavailable message with the valid empty response. The fixture preserves development StrictMode's possible abandoned initial GET. Each case verifies no horizontal overflow.

The 41 native component tests and TypeScript check pass, including owner A→B→A stale-readback retirement. Implementation reuses the independently accepted C2 proposal from PR #805 (comment 6077827461). Actual mounted browser proof is this pack; it does not restamp the earlier evidence or claim an authenticated production check.

Visual inspection found the retry control legible and reachable and the empty recovery state correctly laid out on desktop English and mobile English/Chinese. File identities are in `manifest.json`.
