# Transcript copy feedback — beta UI proof

## Reproduced issue

At protected base `1377853d02fdb0295c0848d7127fdee4ca36714b`, rejecting `navigator.clipboard.writeText` left the transcript reader with no failure message. The 320 × 568 baseline journey failed because no toolbar status existed; `before-silent-failure-320.png` preserves that state.

## Implemented result

A persistent polite/atomic status region in the existing toolbar shows “Couldn’t copy. Try the copy button again.” or “复制失败，请再次点击复制按钮。” when copying fails. The user retries through the same Copy link or Copy segment button. Focus stays on that action. Empty status takes no toolbar row, and the visible message wraps on a narrow phone.

Each manual attempt owns its feedback and timer. A late failure cannot replace a newer success; repeated success on the same action keeps the full existing 1,600 ms indication. Timer/attempt cleanup and the existing keyed reader prevent a dismissed or replaced transcript from receiving stale feedback.

Copy-link URL construction and exact source-segment payload construction are unchanged. The test checks the full copied URL, all original query parameters, the selected call ID, and the exact supplied speaker, role and passage. Synthetic clipboard failures are browser-test fixtures, not an explanation of any user's real clipboard permissions.

## Verification

- **7 new browser tests passed; 2 duplicate timing variants skipped.** English/dark and Chinese/light run on desktop, tablet and a 320 × 568 phone. Actual `html` language/theme attributes are asserted.
- Both link and segment failure/retry paths, focus retention, message containment, and exact clipboard payloads passed.
- One desktop timing case covers overlapping deferred attempts, same-button success expiry at 1,600 ms, dismissal, source-button focus return, and reopening without stale feedback.
- The existing desktop exact source-jump/filter consumer journey passed separately.
- TypeScript, affected-file ESLint and `git diff --check` passed.
- Four final desktop/phone EN/ZH screenshots were recaptured into a dedicated output directory after the existing consumer test and copied into this evidence folder.

Commands, from `terminal/`:

```sh
MMX_SHARED_SHELL=1 TERMINAL_E2E_PORT=3299 npm run test:e2e:responsive -- e2e/transcript-compare.spec.ts --grep 'Transcript drawer copy feedback' --workers=1
MMX_SHARED_SHELL=1 TERMINAL_E2E_PORT=3299 npm run test:e2e:responsive -- e2e/transcript-compare.spec.ts --project=desktop --grep 'keyboard topic search filters' --workers=1
npx tsc --noEmit
npx eslint components/fin/TranscriptDrawer.tsx e2e/transcript-compare.spec.ts
```

The archive uses the existing E12 synthetic-call fixtures and canonical revision checks. Tests establish accessible status semantics; they do not claim a manual screen-reader session. The visible phone EN/dark and ZH/light captures were inspected.

## Design, ownership and delivery

Paper reference is SharedShell Integration Reference R1, file `01M6Y2GT8S3YP4TK052PPESZEC`, page `p-2-0`, company Analysis `2RK-0`. This repair keeps the existing source-reader path and toolbar. It does not add a new Paper design or change corpus text.

Current open-PR ownership excluded this drawer, new module and existing E12 test file. Global `fin.css` stays with its existing owners. The production caller in `MegaPane.tsx` keys the reader by symbol, call, segment, revision and query; no second clipboard service or retry queue is introduced.

This folder proves the local consumer behavior for the PR. Native CI, queue acceptance, merge, deployment and live beta proof remain separate delivery states.


## Browser shell-mode qualification

A bounded audit after the 404/Alert-detail CI failures found the same unconditional beta light-theme assumption in this new spec. At original head `511206135397247176b1f0e6d0e578e029bff889`, the Chinese desktop case reproduced the mismatch on an explicitly default-shell server: expected html light, received dark. The transcript drawer and Chinese content had mounted; the failure preceded copy actions.

The spec now derives one expected theme from the actual server mode and uses it consistently for preference setup and the document assertion. Both languages stay covered in ordinary CI. Explicit beta retains English/dark and Chinese/light. Copy failures, exact payloads, manual retry, focus, status semantics and containment assertions are unchanged. No product code, timeout, workflow or test-wide skip changed.

**6 retry cases passed in default mode and 6 in beta mode**, across desktop, tablet and 320px phone. The unchanged timing/source-jump cases and original beta screenshots retain their earlier proof. TypeScript, focused ESLint and diff checks passed after the existing `next typegen` command regenerated a malformed local development route-type artifact; no generated file or product change is included.

```sh
env -u MMX_SHARED_SHELL CI=1 TERMINAL_E2E_PORT=3307 npx playwright test e2e/transcript-compare.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --grep 'failed copy offers a manual retry' --reporter=list --output=test-results/transcript-copy-legacy-final
MMX_SHARED_SHELL=1 CI=1 TERMINAL_E2E_PORT=3307 npx playwright test e2e/transcript-compare.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --grep 'failed copy offers a manual retry' --reporter=list --output=test-results/transcript-copy-beta-final
```
