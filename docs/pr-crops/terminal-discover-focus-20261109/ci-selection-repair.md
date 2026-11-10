# Discover focus CI selection repair

Qualified 2026-11-09 12:41 UTC. This extends PR #1382 at prior head `cf0df925a2836b41190577cb48714f87a8e6a52e`; product runtime remains `e434de68834c78f370eb0ea4ffdcdc76061d2fb7`. Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`. The resulting commit is linked from the PR body.

## Observed hosted failure

Run [42605444305, attempt 1](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42605444305) tested merge `523256928f5f99508efec61630fe73b3f20395f9` (candidate cf0df925 into ceb4a7cd). Desktop-1 job 129123101509, tablet-1 job 129123102021 and mobile-1 job 129123101271 each failed only the two new Discover EN/ZH cases at their initial heading assertion. Ordinary responsive qualification does not enable Shared Shell; its existing chooser requires that opt-in. The original serial enabled qualification passed 17 cases with 4 intentional skips but its explicit two-file list omitted the new focus spec.

This is test selection/admission, not evidence that the focus implementation regressed.

## Complete correction

- The new focus spec uses the same `MMX_SHARED_SHELL === "1"` admission guard as the existing Shared Shell spec.
- Its exact filename is added to the existing enabled serial qualification command. The six focus bodies therefore remain covered.
- Its exact filename is added to the bounded reporter's finite file allowlist, so case identity, source binding and validation include the new consumer.
- The existing workflow-command assertion is updated and a discriminating six-case recorder/validator regression is added. Foreign files, projects, privacy projection, custody checks, limits and required gates retain their existing controls.

A guard alone would remove hosted coverage. Adding only the command would make the reporter refuse `SAFE_REPORT_CASE`. The new reporter regression reproduced that refusal before the allowlist correction: [before log](ci-selection-before.log).

## Qualification

| Check | Result |
|---|---|
| Existing safe-reporter suite plus Discover consumer | **17 passed**, including full frame/output/publish/custody controls; fixture Git identity is explicitly synthetic and was never used for source publication |
| Changed JS/TS test/tool lint | **0 errors/warnings** |
| Workflow parse and enabled command checks | PASS; all three projects, one worker, retries 0, existing GitHub and safe reporters retained |
| Disabled feature mode | **6 intentional skips**, exit 0 |
| Enabled combined three-file browser qualification | **23 passed, 4 intentional existing skips**, exit 0; includes all six Discover cases |
| Final browser process | 68660, exit 0, 142.41s; no Playwright retries |

[Browser log](ci-selection-browser.log) · [disabled mode](ci-selection-disabled.log) · [reporter/lint/workflow proof](ci-selection-unit.log) · [source checksum receipt](ci-selection-source.json)

The enabled pass uses the incumbent absolute globalSetup route warm-up, existing fixture transport, actual Next routes, Chromium, the existing three viewport projects, one worker and retries 0. The ad hoc local server uses webpack; the hosted job retains its original server command. This is isolated fixture proof, not a hosted CI result or live deployment.

The first local combined run omitted globalSetup and failed one existing desktop Analysis navigation assertion after five seconds; its trace retained the pending Analysis navigation request. It passed all six new Discover cases and 16 other existing cases. Restoring the incumbent warm-up produced the final 23-case pass without changing runtime, assertions, time budgets or retries. [Initial local log](ci-selection-initial-local.log). No flakiness or performance claim follows from that comparison.

## Exact candidate blobs

- `.github/workflows/ci.yml`: `ff75d2ad7b8fae53a40f4e6693c69f50725fa0f7`.
- `terminal/e2e/tools/sharedShellSafeReporter.cjs`: `54529a78b54152bb551970e6b1c67941b422415f`.
- `terminal/e2e/tools/sharedShellSafeReporter.test.cjs`: `8f7e916d0b982120bc2ded8a01af428abe3fe1ad`.
- `terminal/e2e/discover-focus-continuity.spec.ts`: `f7a3db7c686ac059ad506179455ffd4dbd58f86e`.

The candidate files were checksum-verified on the browser copy before execution and are checksum-verified again when uploaded to GitHub. Runtime qualification and images from the original product remain valid because no runtime source is changed by this repair.

## Ownership and continuation

Held #1223 at e34862900a09bfbcf124397ffe0db02a4f509a49 changes adjacent environment/trace arguments; its explicit spec list remains unchanged. Held #1244's separate Intelligence qualification, #1275's other jobs and #804's PostgreSQL job remain outside this diff. Their carriers and holds remain untouched. No required check, timeout, retry count, security rule or artifact validation was relaxed.

The existing native auto-merge enrollment belongs to this PR and must not be re-armed. New hosted qualification is still required on the updated head; merge, deployment and live acceptance remain separate outcomes.
