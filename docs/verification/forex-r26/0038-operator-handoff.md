# Forex 0038 — production application and release continuation

Status: **APPLIED; production catalog verified. Do not reapply.**

Migration 0038 was submitted once through the existing authenticated Supabase SQL editor, the explicit route in `supabase/migrations/README.md` binding rule (d). The named production project was verified against the existing ledger. The full pre/post receipt was posted on PR #1100 and read back exactly at **2026-10-21T17:41:57Z**, before the application ledger was updated.

## Exact source and actual application

- Repository: mastermindx-market-intelligence/mastermind-terminal, PR #1100.
- Applied candidate: `813b36c869fa649c1b0e17693da73b0882181e8b`.
- Independently reviewed storage implementation: `5969bf5408c16626487831496d0083ce2fe31deb`.
- Migration: `supabase/migrations/0038_forex_inactive_conditions.sql`.
- SHA-256: `f7f2e50b11fd863f107abc8406c04d35ffa67f52bca6c885281340d6aff4adee`.
- All 16,582 characters copied from the editor matched the exact reviewed source immediately before submission.
- One confirmed atomic DO application; the editor returned **Success. No rows returned**.
- Fresh pre-catalog: `2026-10-21T17:39:00.792731Z`; post-catalog: `2026-10-21T17:40:22.148275Z`.
- Complete receipt: [0038-apply-receipt.json](0038-apply-receipt.json). It records the actual SQL-editor carrier and is not represented as a `supabase_apply/1` wrapper receipt.
- No remote migration-history schema was created. The applied SQL, including its historical authoring comments, remains byte-identical.

## Verified production effect

All eight catalog checks passed: exact function count and bodies, invoker/search-path settings, execute privileges, unchanged alerts table attributes/grants, unchanged owner policy, enabled INSERT/UPDATE trigger, and absence of a new migration-history schema.

| Function | MD5 of actual `pg_proc.prosrc` |
| --- | --- |
| canonical_forex_watch_rule | 35b3dd9cddd026c11d118731538b2222 |
| validate_forex_watch_row | 70907c0426411a16cac6314cc324c084 |
| guard_forex_watch_write | c1a96a7d3a55d250136c8035f848d105 |
| save_forex_watch | e45cda6cb21b119c35dde46a3b083410 |
| delete_forex_watch | bfcfe2737676c0680396e40f28e1adf5 |

All five functions are invoker functions with fixed `pg_catalog` search paths. Anonymous and service-role execution are false; authenticated execution is granted to validation/helpers and the RPCs, not the trigger function. The ordinary enabled trigger fires BEFORE INSERT OR UPDATE. Existing alerts RLS, owner policy and table grants match the preflight exactly.

## Historical operator-context investigation

The earlier managed-wrapper dry-run and registered-primary reconciliation remain historical evidence in `0038-owner-dry-run.json` and `0038-operator-context.json`. That wrapper did not resolve its credential/project pair, and the stale registered primary lacked the applier. Neither observation established that the production SQL-editor route was unavailable.

The binding procedure explicitly permits the SQL editor. An independent route review confirmed that the wrapper is not exclusive. The existing authenticated operator session supplied a verified production-project context; no credentials were searched or copied. This resolved the application dependency. There is no outstanding request for a different operator or permission to replay the migration.

## Release continuation

Terminal hosted CI [39637491057](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/39637491057) completed successfully at 17:31:34Z on exact candidate `813b36c`; all 16 jobs passed, including the actual Forex PostgreSQL suite. The subsequent ledger/receipt delta changes no executable SQL or application source.

The independent storage review passed 69 PostgreSQL tests, including the retained-snapshot cap counterexample. API/UI review passed 110 tests. These source checks and the production catalog receipt support release evaluation; they do not claim a deployed authenticated journey.

PR #1100 landed alone as squash `5f14b35c18d8f9f70e8f0d381963dee98e59a521` at 2026-10-21T19:11:55Z, after final-head CI and independent source/effect reviews. PR #1103 (`eb752cd653f3add2aa67cdcc7b588dae13c86843`) already recorded the actual merge in the shared ledger; this documentation follow-up retains its ledger and README unchanged, including reservation 0039. No SQL is changed or reapplied. Next: complete the follow-up's normal hosted checks, deploy the accepted application through the git-gated owner, and verify signed-in save/reload/edit/delete. Macro PR #9866 remains the paired frontend carrier. Finalized 4H source admission, evaluation, activation and notification delivery retain their separate outstanding gates.
