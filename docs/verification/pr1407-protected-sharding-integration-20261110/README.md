# PR #1407 protected mobile-shard integration

## Source composition

The original managed publisher remains terminal-experience-refinement-20261109-sol-01. A normal no-commit merge combines original head c0810319e70ab04da776b651580c7f35873088df with actual protected master 04989d7a9b4e235b9a4c056c9f2f60c5d5008d39. It completed without conflicts. No new product implementation or test expectation was added in this phase.

Protected #1418 splits the complete mobile browser allocation into five shards under the unchanged one-hour cap. This consumes the actual protected repair for the prior mobile-third cancellation. It does not clear the two separate hosted browser-install timeouts in old CI run 42765252631; a new composed-head run must establish its own result.

All thirteen owned product/test paths are byte-identical to prior actual hosted CI merge 55b3f1cc395e75eb9af226a8a9de42313d17f317. Of the original 204 owned paths, 203 are unchanged. The sole composed path is TerminalShell, preserving the protected conditional LayoutMenu mount with this PR's CSS-module ownership. Global CSS remains protected blob 10f2df3f3e04f291f028c345b50a1967ba158cb2. All 162 tracked files in the two prior proof packages remain byte-exact.

## Actual qualification

- 243 existing focused product and evidence tests passed, with zero failures or pending tests. These include the strict EOD/GEX/Options packet readers and the Chart Layers evidence guard.
- Full Next route type generation and TypeScript checking passed after the bounded generated-cache recovery documented below.
- All 2,006 tracked source-snapshot entries remained unchanged throughout qualification.
- The earlier browser captures retain their original source maps and identities. They are not presented as captures from this new integration. The exact owned-input comparison, current guards/typecheck, and forthcoming native CI provide the new composition's qualification.

The initial TypeScript attempt failed on three syntax errors in the ignored generated .next/dev/types/validator.ts. The file contained a stale suffix beginning with `>> = Specific` after a complete layout block. The exact failed file was archived here. Same-host checks found no file/CWD holder and no Next lock. Only that malformed generated file was removed; existing next typegen regenerated route types, and the full typecheck then passed. No tracked application source or test assertion was altered. The initial failed record remains intact.

Local Vitest runs disabled Node26's experimental WebStorage getter so jsdom owns localStorage, consistent with the project's Node20 CI environment. This is a local process setting, not a project source change.

## Delivery boundary

Publish only through the original typed native operation, fenced by original HEAD, actual protected parent and the prepared tree. Keep the PR unarmed under the existing missing approval-enforcement evidence boundary. This package is not a GitHub approval, merge result, deployment, or post-merge production-browser acceptance.
