# Prophet forecast-pulse chart marker — source/evidence repair

PR: https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1238
Original source head: `6065cc744e081083eeee61bd00cfa8e15442a34d`
Original managed operation: `prophet-chart-marker-20261102`

## Why the first CI run failed

GitHub CI run [41549617351](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41549617351) completed with successful TypeScript checking, 12/12 responsive E2E shards, CodeQL, Ingest, Quote Hub and PostgreSQL checks. Its `npm test` phase failed in `visualIntelligenceEvidence.test.ts:123` because `ChartPanel.tsx` had a different exact-source SHA after the icon change. The downstream `Terminal typecheck + tests` aggregate failed as designed. This was not a new Prophet E2E failure.

Only the two incumbent source evidence bindings were updated, not their assertions:
- `docs/pr-crops/terminal-visual-intelligence/EVIDENCE.yml`
- `docs/pr-crops/b-pl-6-batch-1/EVIDENCE.yml`

Both now bind `terminal/components/ChartPanel.tsx` to SHA-256 `09eb4b24955b7e71a4c6c356f1db6ca8876ec2ff3ceaee22318cced06ef5e631`.

## Fresh real browser recapture

Actual fixture Playwright run on the original managed PR workspace (uncommitted evidence manifests, unchanged functional source):
```
NODE_OPTIONS=--no-experimental-webstorage TERMINAL_E2E_PORT=39532 PLAYWRIGHT_JSON_OUTPUT_FILE=docs/verification/prophet-marker-20261102/visual-intelligence.json ./node_modules/.bin/playwright test e2e/visual-intelligence.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --reporter=line,json
```
**Result: 30 passed; 0 unexpected, 0 skipped, 0 flaky, 0 retries.** Runtime 605 seconds. The actual Playwright JSON is adjacent to this receipt, SHA-256 `bfebb3ca70634498fb96df12b4dad759f893bc08e835365eb8d5af04fc0d2854`.

All six EN/ZH desktop/tablet/mobile context captures were actually regenerated. Tablet and mobile captures (four images) were byte-identical to their prior accepted PNGs. Both desktop captures had different bytes; they were preserved as local diagnostic copies rather than silently replacing the accepted historic screenshots. The accepted six screenshot file hashes remain unchanged. This recapture confirms the context UI functional matrix, **not** that Prophet forecast receipts are present in the Visual Intelligence fixture.

## Independent ChartChrome recapture

The existing immutable PL6 evidence adapter captured all four ChartChrome combinations (1440 EN/ZH and 390 EN/ZH) with exact source snapshot through operation `prophet1238pl6`:
```
TERMINAL_PL6_EVIDENCE_OPERATION_ID=prophet1238pl6 CAPTURE_ONLY=ChartChrome TERMINAL_CROP_PORT=39533 node e2e/tools/capture_pl6_batch1.cjs
```
Result: 4/4 capture successes. `docs/pr-crops/b-pl-6-batch-1/prophet1238pl6--operation.json` records the immutable proof, SHA-256 `3b549136f4895640991c139761310af5efac8d5093420689a20c6acde8ca76ce`. Four actual PNGs, observations, source snapshot and execution report are kept alongside the operation. Prior accepted PL6 crops and hashes were not overwritten.

## Focused source-lock regression

```
./node_modules/.bin/vitest run lib/__tests__/visualIntelligenceEvidence.test.ts lib/__tests__/b_pl_6Batch1Evidence.test.ts
```
Result: **2 files / 14 tests passed**, including original bilingual responsive PNG integrity locks and exact-source checks. This is local qualification; new exact-head hosted CI remains required. Separate Prophet marker E2E asserts a rising trajectory inside a sapphire circular lens with no legacy P text and retains the original receipt tooltip/replay behaviors.

## Non-goals and release gates

No change to Prophet signal derivation, chart source authority, reversal-watch identity, retained accepted image digests or branch protection. The existing genuine non-author review request to `mastermindx-2` remains pending. New hosted CI on the updated PR head, submitted independent review, approved squash auto-merge and subsequent git-gated production/browser proof remain separate gates. Do not infer approval, merger or production proof from this record.
