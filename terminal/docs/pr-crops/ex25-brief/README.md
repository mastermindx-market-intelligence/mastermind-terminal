# EX-25 Intelligence Brief — empty states become concise

This scoped improvement changes the **actual Brief layout and its CSS**, not event intelligence or source rights. Empty insights and missing future-watchpoint sections use tighter header/body spacing while preserving their honest localized copy, layout semantics, source footer and every populated evidence action.

## Before/after results

The retained local component/browser harness checks **72** cases for each phase: classic dark/shared dark/shared light × 1440/820/390 px × EN/ZH × mixed/populated/empty/long content. All 72 after cases passed, with no document overflow or missing source footer. Paired actual browser measurements found **126/126 empty panel instances shorter** (mean 37.5 px reclaimed) and **162/162 populated panels at their original height**. Existing expanded content still wraps, evidence/fact buttons retain real selection callbacks, and the component unit tests assert the new explicit data-empty state.

`evidence.json` binds the exact source and test SHA-256 hashes, both machine receipts, capture script and 36 scoped before/after screenshots. `before/receipt.json` was recorded against source `7accf09a...`; the after capture executed on the same clean owner workspace after the source changes, before its eventual publication. The repository code/data provenance remains canonical and unmodified.

## Reproduce

From `terminal/` with lockfile-identical Node dependencies:

```bash
NODE_OPTIONS=--no-experimental-webstorage node docs/pr-crops/ex25-brief/capture.cjs . after
NODE_OPTIONS=--no-experimental-webstorage npx vitest run lib/__tests__/companyIntelligenceBriefLayout.test.tsx
```

This test bundle serves **synthetic props via loopback only** and uses real DOM/CSS/browser layout. It is not a public live/full-auth/UI shell test. Hosted CI, protected merge and live authenticated source/Brief acceptance remain separate release gates.

## Capture harness security repair (24 October)

CodeQL alert 37 correctly identified request-controlled language/theme strings reflected into HTML attributes. The capture server now selects literal `en`/`zh` and `dark`/`light` output values. A test executes the actual fixed handler from the repository script: hostile language and theme payloads failed before repair; all six profile/security cases pass afterward. No alert was suppressed. All 72 after-capture cases were rerun using the repaired harness. The before captures remain historical, bound to their original harness digest in `capture_harness_provenance`; they were not falsely restamped as newly captured. Hosted CodeQL must independently confirm closure.
