# F01 directory focus correction — actual source and browser evidence

## Result and scope

This is the existing F01 receiver's bounded correction to the two focus findings on merged Terminal #1264, plus the clipped focus outline found during visual self-QA. Source base: e48170b609dddf3b5b4eba1c047620d5d017290f. Original authored input f9070aebf61ad88883dad441b195e1060c7671b5 was merged as f528a219cc5d73e94e058575e3df83d689632bf9. Those lifecycle actions were external to this continuation; no authority for them is inferred here.

The correction rejects BODY/HTML as return targets, preserves legitimate programmatic invokers, tries the next existing visible target when focusing an obsolete invoker is a no-op, and gives only named heading/main fallbacks a new tabindex. Show all keeps query/results and focuses All while scrolling only its category strip. Five pixels of top clearance preserve the actual two-pixel focus outline and three-pixel offset.

The incumbent matcher, aliases, ranking, seven categories, routes, access fields, query/expansion behavior, Escape/IME association, company-search handoff and Next Link behavior are retained. The separate four-ID Options facet is not part of this frozen correction input.

## Discriminating evidence

| Check | Observed result |
| --- | --- |
| Component regressions before repair | 22 pass / 2 fail: BODY opener and formerly focusable invoker |
| Real shortcut regression before repair | Mounted actual shell opens from BODY; Escape fails the visible-opener focus requirement |
| Real category regression before repair | All is focused but left edge is -168px against visible boundary11px |
| First correction | 87 component/neighbor passes;25 Chromium passes;2 intentional tablet/mobile modified-new-tab skips |
| Visual self-QA | Actual screenshot revealed top outline clipping despite button containment |
| Stronger outline regression before CSS repair | FAIL: outline top201.96875px against clip top206.96875px |
| Final R2 browser matrix | 25 pass / 0 fail / 2 intentional skips / 0 flaky; full button and outline containment |
| Source checks | TypeScript exit0; scoped ESLint exit0 with zero warnings |
| #1244 compatibility | Conflict-free single-file virtual composition with exact624dbc0; its Intelligence title-map import/lookup and this correction both retained |

The24 directory component cases and63 existing contract/presentation/route/region cases passed on the unchanged TSX and test inputs. Subsequent R2 changes were CSS clearance and stronger browser assertions; [source checks](SOURCE_CHECKS.json) and [exact inputs](SOURCE_INPUTS.json) bind that reuse. The #1244 proof is **one file only**, not full-PR integration, CI or release acceptance; its owner and unpublished work remain untouched.

[Per-case results and browser observations](RESULTS.json) · [baseline/startup diagnostics](BASELINE_DIAGNOSTICS.json) · [environment](ENVIRONMENT.json) · [61-member raw archive](raw-evidence.zip) · [member hashes](raw-evidence-manifest.json) · [#1244 composition](OWNER_1244_COMPOSITION.json).

## Visual self-QA

[Desktop keyboard return](shortcut-focus-desktop.png) shows the visible All tools focus ring after dismissal. [320px category recovery](category-focus-320.png) shows the complete All button and outline inside the scrolling strip. [320×420 Chinese light state](short-320-zh-light.png) retains Close, search, recovery, results and company search. All21 final screenshots are in the archive. The root inspected the original failed focus-outline capture and the corrected actual PNG; this is self-QA, not fabricated independent acceptance.

## Harness and honest limitations

Actual Next AppShell/Directory/Link and company picker execute in Chromium. The incumbent development identity seam and controlled AAPL manifest are fixtures, not authenticated beta/production proof. Viewports are1440×900,820×1180,390×844,320×844 and320×420; existing EN-dark/ZH-light controls and resize paths execute. This is representative coverage, not every locale/theme/input combination. Actual OS IME, assistive technologies, other engines and complete zoom qualification remain open. All86 complete programme specifications remain NOT_RUN.

The first cold harness startup timed out at its unchanged120-second limit while /terminal was compiling. A bounded owned-server diagnostic then became ready in997ms and returned /terminal200 in13.68s. Later harness-owned runs started normally; no timeout was increased. The first shortcut attempt acted after an SSR heading but before proven global-listener readiness. The discriminating test now establishes the mounted runtime via an actual open/close before BODY shortcut activation; it does not claim cold pre-hydration shortcut qualification. The original attempt remains in the raw report.

**Browser network/console is not clean.** The exact missing development asset /_next/static/chunks/components_1i7frpt._.js produces404/ERR_ABORTED on the unchanged baseline, BODY-red and final R2 runs. No uncaught page errors occurred. This comparison bounds the directory correction; it is not a production serving diagnosis or waiver of an authenticated live-path requirement.

## Reproduction

From terminal/ in the exact source workspace:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm test -- lib/__tests__/sharedShellDirectoryConformance.test.tsx lib/__tests__/sharedShellPublicPresentation.test.tsx lib/__tests__/sharedShellContracts.test.ts lib/__tests__/sharedShellRouteIdentity.test.ts lib/__tests__/sharedShellRegionNavigation.test.ts
NODE_OPTIONS=--no-experimental-webstorage TERMINAL_E2E_PORT=3139 MMX_SHARED_SHELL=1 TERMINAL_VISUAL_EVIDENCE_OPERATION=<unique-owned-operation> npm run test:e2e:responsive -- e2e/shared-shell-directory-hardening.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/eslint components/chrome/shared-shell/ShellDirectory.tsx lib/__tests__/sharedShellDirectoryConformance.test.tsx e2e/shared-shell-directory-hardening.spec.ts --max-warnings=0
```

Run typecheck after the owned Next server stops so generated development type files are stable. Node26 uses the explicit webstorage compatibility flag; hosted Node20 CI is separate. No product storage shim or alternate renderer was added.

## Custody and release

Owner: mastermidx4 / existing F01. Managed operation: f01-directory-focus-correction-20261104-c4. Branch: sol/web-f01-directory-focus-correction-20261104-c4. The original completed workspace/branch is preserved. This source is SELF_REVIEWED with optional read-only reasoning advice, not formal nonauthor APPROVED. The user hold remains: no merge, Ready/un-draft, enqueue, held-PR relabel or deploy. Original Paper effects and complete native/RIG/product qualification remain separate. Code publication and CI do not establish live acceptance.
