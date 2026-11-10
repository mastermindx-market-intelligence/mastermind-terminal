# PR #1425 — portable reopen fixture and migration readback comments

## Source and scope

Prepared and checked against Terminal `fbc0925d98a96f0911a84851cc136d6026b0dfe4`, under the [scoped recovery claim](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1425#issuecomment-6767879945). The original source owner's [PASS2 return](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1425#issuecomment-6765739858) remains the source of its earlier proof.

Only three source postimages change:

- Commit the exact current Lane1 page-one fixture under `terminal/lib/__tests__/fixtures/sector_generation_v11_page1.json`.
- Load it through a URL relative to the test module and correct the old sample attribution. All 14 existing cases and their assertions remain byte-identical after the fixture setup.
- Separate readback headings (iii) and (iv) from their existing SQL commands in migration 0053. Executable up SQL, the commented down block, function bodies, permissions, and all readback SQL tokens remain unchanged.

The fixture is 15,284 bytes, SHA-256 `dbb09959b4feaaf849ea369f667c34b2e390f3b12e5c509b1e86daedf8a49d80`, Git blob `392306d18958c10686d5254885510e313f488ab7`. It was produced by Macro `badb9ae1cfe458f98cef41fe8b988b627db36a07` and remained unchanged in returned successor `595fe6b75af2cd36ab447d4987e3c410abe4cca0`. Its producer uses injected identity/clock seams and a throwaway signing key. This is a transport fixture, not served-route, entitlement or deployment evidence.

## Verification

The unmodified all-migrations guard was first run against the actual full migration directory and reproduced the CI failure in 0053's heading (iii). After the two-line formatting repair, the same existing test passed.

| Check | Result |
| --- | --- |
| Existing `sectorInvestigationReopen.test.ts` suite | 14 passed; no skips or changed assertions |
| Existing all-migrations idempotence/legacy guard | 1 passed against every migration on disk |
| ESLint on the affected TypeScript test | Passed |
| `git diff --check` | Passed |
| Exact fixture bytes and three source postimages | Verified; see `source-receipt.json` |
| Executable up SQL, commented down SQL and readback SQL tokens | Preserved |

Local verification used Node v26.5.0, Vitest 2.1.9, Python 3.14.7 / pytest 9.1.1 as installed; `checks.json` records the actual Python string. Dependencies came from the unchanged package and lockfile through `npm ci`. The native host's alias named node@22 resolves to Node v26.5.0; this packet reports the executed version. Natural GitHub CI remains separate exact-head evidence.

The original unit failure is recorded by [run 42804241702](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42804241702), job 129792982125: the author's absolute `/tmp/si_plan` fixture path did not exist on the runner. The original ingest job 129792982653 also recorded the reproduced SQL-comment failure.

## Release boundary

PR #1410 must merge first. Its actual 0052 trusted-issuer/frozen-membership gate and this PR's expected PR-mode migration-namespace failure are not suppressed. `INVESTIGATION_V3_WRITES_OPEN=false` and v2-only parser admission remain unchanged. No migration APPLY, deployment, runtime activation or auto-merge enrollment was performed for this repair. These focused checks do not qualify the whole PR for release.

The files in this directory retain the baseline failure, dependency setup, successful focused outputs and exact source receipt. The existing migration guard and test runner are unchanged.
