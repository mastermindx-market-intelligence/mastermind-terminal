# Session Flow: signed premium and archive return

## Scope and source

- Parent programme: Terminal Options Suite completion; C3 flow/replay correctness.
- Original operation: `options-session-flow-sign-20261114-c3`.
- Carrier: Studio Direct C3 managed Terminal publisher, branch `sol/web-options-session-flow-sign-20261114-c3`.
- Protected base: `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`.
- Governing source: Mastermind `199fd4f91ecc426b1d974eb3bf47f5162476cf24`.
- Source postimages and capture SHA-256 values: [manifest.json](manifest.json).

The actual SessionFlowPane consumer discarded premium signs in its price formatter and raw totals. It now preserves the sign at dollar, thousand, million and billion scales, including negative call observations. Values rounding to zero remain plain `$0`.

A separate reproduced lifecycle defect left the live chart absent after an archived session was withdrawn when the minute-array identity had not changed. The existing chart effect now follows the workspace replay archive state, cleans up the withdrawn chart and creates the returning live chart. This uses the existing reader, transformations and replay bus.

## Verification

| Proof | Observed result |
| --- | --- |
| Before-change component regression tests | All 5 new cases failed on the original product: signed formatting/totals and both archive-return paths. [unit-before.json](unit-before.json) |
| Final component and Surface contract tests | 98 passed, 0 failed, 0 skipped; 2 source test files. [unit-after.json](unit-after.json) |
| Focused ESLint and full TypeScript check | Exit 0. Initial qualification process 15082 completed; final lint/typecheck/diff check process 48465 completed with exit 0. |
| Desktop Tide Session, English and Chinese | 2 passed in the initial desktop run. [browser-desktop.log](browser-desktop.log) |
| Desktop Surface Session | 1 passed after correcting the test's archived-heading selector. [browser-desktop-surface.log](browser-desktop-surface.log) |
| Tablet and mobile, Tide EN/ZH plus Surface | 6 passed, 0 skipped. [browser-responsive.log](browser-responsive.log) |
| Browser acceptance total | 9 distinct cases passed across desktop, tablet and mobile. |
| Visual inspection | Principal inspected current desktop Tide EN and mobile Tide ZH, Surface replay, archive withdrawal and return-to-live crops. Signed chart axes/totals remain readable; controls wrap on mobile. |

The unit run selected `lib/__tests__/sessionFlowPane.test.tsx` and `lib/__tests__/surfaceContract.test.ts`. Its command also named a nonexistent replayBus test filter; Vitest executed only the two files recorded in the JSON. No separate replayBus suite is claimed. The new pane tests exercise the real replay bus and transformations, with only chart rendering plumbing and language selection mocked.

The initial desktop browser run had two passes and one test assertion failure: the archived heading includes its date in a child span. The final assertion checks the actual Session container for both the withdrawal message and exact archive date. Product source did not change between those browser runs. The failed diagnostic log is retained; its failed screenshot is not included among current captures.

## Exercised consumer behavior

The browser tests open the real `/options?tab=tide` and `/options?tab=surface` routes with the existing registered fixture authentication owner and the real canvas renderer.

- Signed raw totals remain calls `$400.0M`, puts `−$90.0M` through per-minute and Absolute display toggles.
- The unit consumer also verifies off-open composition and restoration of negative plotted values; Absolute affects the plot without rewriting the observed totals.
- Scrubbing the live Surface to 09:31 cuts both data and totals to `$250.0M` and `−$120.0M`.
- Selecting the archived date withdraws unsupported premium observations and identifies that date.
- Returning live restores the chart and current signed totals.
- Every final browser case checks page errors and document-width overflow.

Browser fixtures disable EventSource only inside the test page to exercise the existing HTTP fallback deterministically. Provider output, production authentication, entitlement and transport code are unchanged. The Surface fixture uses SPY solely to drive the existing replay consumer.

## Reproduction

From `terminal/`, the existing test owners are:

```sh
npx vitest run lib/__tests__/sessionFlowPane.test.tsx lib/__tests__/surfaceContract.test.ts
npx eslint components/surface/SessionFlowPane.tsx lib/__tests__/sessionFlowPane.test.tsx e2e/options-session-flow-signed.spec.ts
npx tsc --noEmit
TERMINAL_E2E_PORT=3188 TERMINAL_VISUAL_EVIDENCE_OPERATION=options-session-flow-sign-20261114-c3 npx playwright test e2e/options-session-flow-signed.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
```

The recorded browser proof ran desktop, corrected desktop Surface, then tablet/mobile separately, using dedicated port 3188 and the same operation. Existing evidence mode prohibits reuse of an unrelated dev server.

## Acceptance boundary and continuation

This is local implementation and consumer proof. Hosted CI, protected merge, installed revision and entitled production-browser proof remain separate obligations. The parent full Options programme remains active; these tests do not claim options-suite completion, historical Tide availability, live provider quality, saved-investigation acceptance or Paper-wide parity.

Reuse accepted Plan/Compare work and existing held carriers. D08B's unknown publication remains scoped to its original operation and is not retried or replaced by this branch.
