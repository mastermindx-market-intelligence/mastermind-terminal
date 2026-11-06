# D06 Terminal — paired Scripts copy routing

The Scripts copy dictionary contained all 56 matching English/Chinese keys, but hosted CI's forward-only plain-language guard could not recognize two distant locale maps as paired translations. [Run41823483280, job126552192106](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41823483280/job/126552192106) reported49 `missing_zh` findings in `terminal/lib/scriptEditorCopy.ts`.

This repair uses the existing real `pick(lang, en, zh)` pattern on each key's line. Both dictionaries are precomputed once, preserving stable per-language object identity. The exported function keeps the same accepted languages and all 56 keys. **All112 translated values remain exactly equal to the preceding source.** No UI wording, save/reconciliation logic, DOM, styling, guard, helper allowlist or waiver was changed.

Verification on the repaired source:

- Compiled the real TypeScript module and compared both runtime dictionaries to the original values:56 keys per locale,112 unchanged values, stable repeated-return identity.
- Ran the actual added-lines plain-language guard against hosted CI base `cd2a335f8f8fcf4fa947aa8a47f7dbf5748b2fdc`: exit0, no blocking findings. Existing informational diagnostics remain in the retained log.
- Ran the existing `pineEditorIdBuffer.test.tsx` consumer DOM suite: **20 tests passed**.
- Focused ESLint and `git diff --check`: exit0.

[Exact verification receipt](pr-crops/d06-copy-routing-20261104/verification.json) · [Artifact inventory](pr-crops/d06-copy-routing-20261104/manifest.json).

The prior [final layout/CI repair proof](d06-ci-20261104.md) remains unchanged at parent `496ab37cbbbb236d9fe17e55595cd4171f2ff222`. This isolated dictionary representation repair does not warrant repeating identical screenshot journeys. The containing immutable commit identifies the repaired source; a new hosted CI run remains separate from these local results.

Draft PR1270 stays on the original managed operation and branch. Ready/enqueue/merge/deployment and joint-shell rollout remain held.
