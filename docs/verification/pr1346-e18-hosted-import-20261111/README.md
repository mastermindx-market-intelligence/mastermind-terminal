# PR #1346: import genuine hosted E18 review/results evidence

This artifact-only follow-up imports the complete 12-image E18 capture produced by the repaired workflow on PR source head `1b9273093e868b49007965177a4810f4a0151728`. It does not edit the alert feature or capture producer.

## Canonical hosted proof

- Workflow run: https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42974801855
- Successful unit job: https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42974801855/job/130371910733
- Artifact: `unit-evidence-42974801855-1`, ID `13836430747`.
- Downloaded ZIP SHA-256: `b29f730c9266951d3f79730c37771b7d883608cd89e406e2be2a7b63b257b823`.
- Actual checkout: `e71dcd53e21ae632bed69b2cd40eff630adc1894`, tree `67a54c99256c8d4e80d0bdd4ffc438eb82c36bbf`. Its canonical parents are protected `ffcc39bcdf89cb19b08444b8bb64cadbc1a3a5ec` and the PR source head. The event's older base projection is reconciled in `import-receipt.json`; the eight upstream host-slot/runbook changes do not touch any E18 input.

The manifest retains the actual capture checkout. It has not been relabeled as the later artifact-import commit. Every recorded layout-source hash matches the source branch, and the staged capture and promoted canonical packet are byte-identical. All 12 PNGs fully decode to their recorded desktop, tablet or mobile viewport size. English and Chinese review/results cases are complete.

The producer proof confirms review validation, exactly four requested pause operations, and separate acknowledged, unknown, refused and skipped outcomes. The JSON proof and checkout receipt are retained verbatim. Four representative screenshots were visually inspected across both languages, both states and all three viewport classes; the review counts, localized copy, uncertain-state wording and actions are readable.

## Validation and remaining scope

The hosted capture step, type generation, TypeScript, immutable-orchestration checks, shared exporter, unit suite and plain-language guard succeeded. The unit suite reported 23,028 passed, 50 skipped and 3 todo. After import, the three affected alert/evidence suites passed all 69 tests against the exact source snapshot and packet. This is an author self-check, not a native independent approval.

This commit makes the genuine packet durable. Required CI on the new import head, native merge admission and all existing release holds remain separate. No deployment, production acceptance, permission change, new auto-merge enrollment or hold removal is claimed. Historical verification records remain unchanged.
