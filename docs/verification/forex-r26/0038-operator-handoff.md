# Forex 0038 — reviewed operator apply packet

Status: **source ready; incumbent production operator context unresolved; no apply attempted**.

The user approved continuing this program. This is an owner-context dependency, not a new user approval requirement. The binding migration procedure remains `supabase/migrations/README.md` rule (d): the existing operator / Meta-CEO performs the out-of-band named-file application and posts pre/post receipts before the ledger is marked applied.

## Exact source

- Repository: mastermindx-market-intelligence/mastermind-terminal, PR #1100.
- Independently reviewed implementation head: `5969bf5408c16626487831496d0083ce2fe31deb`.
- Migration: `supabase/migrations/0038_forex_inactive_conditions.sql`.
- SHA-256: `f7f2e50b11fd863f107abc8406c04d35ffa67f52bca6c885281340d6aff4adee`.
- One atomic DO application statement; five invoker functions and one INSERT/UPDATE trigger.
- Independent storage review: 69 PostgreSQL tests passed in 8.87s, including the repaired retained-snapshot counterexample. Independent API/UI review: 110 tests passed in 2.24s.
- The managed applier structurally dry-ran this exact migration: exit 0; 1 apply statement, 3 readbacks, 6 expected objects, no idempotency findings. **Project binding was not checked** because that managed process did not resolve the required credential/project pair. See `0038-owner-dry-run.json` and its log.

The registered primary is still `/Users/chriswong/Documents/Cluade/charting-app`; its named applier/procedure files are absent. One bounded metadata reconciliation found no qualified relocation. Other registered copies do not establish protected operator context. Credentials were not searched; this does not assert their absence.

## Existing operator action

Bind the incumbent protected credential/project context to the exact reviewed source. The missing old-primary applier does not require recreating a checkout. Use the reviewed unchanged managed copy of the incumbent applier, with credentials resolved by its normal protected environment. Populate `FOREX_EXPECTED_PROJECT_REF` from the existing migration ledger and compare it to the operator's resolved project before any network mutation. Do not copy credentials into this worktree or receipt.

```bash
FOREX_MIGRATION='/Volumes/Mastermind 2/agent-workspaces/terminal/web/forex-r26-account-owner-20261021-sol-002/supabase/migrations/0038_forex_inactive_conditions.sql'
FOREX_APPLIER='/Volumes/Mastermind 2/agent-workspaces/terminal/web/forex-r26-account-owner-20261021-sol-002/scripts/supabase_apply.py'

python3 "$FOREX_APPLIER" "$FOREX_MIGRATION" --dry-run \
  --project-ref "$FOREX_EXPECTED_PROJECT_REF"
```

Require a checked, matching project guard and the exact migration hash. Refresh the existing read-only production catalog preflight at the time of application; the stored observation at 2026-10-21T13:09:56.177473+00:00 is historical. Reconcile any newly present objects before modifying anything.

Then use the same named-file owner once:

```bash
python3 "$FOREX_APPLIER" "$FOREX_MIGRATION" --apply \
  --project-ref "$FOREX_EXPECTED_PROJECT_REF" \
  --receipt /tmp/forex-r26-0038-apply/0038-apply-receipt.json --timeout 120
```

Do not use legacy/unverifiable overrides, another migration ledger, db push, or generic SQL DDL as an alternate owner. A transport timeout leaves the effect unknown; reconcile actual objects and the retained receipt before any further action. Rerunnable SQL is not permission to replay an uncertain apply.

## Acceptance of the actual effect

Require receipt status applied, exactly one completed application statement, the exact source SHA, and an empty missing-after set. Inspect actual function bodies, argument identities, grants and trigger definition; object names alone are insufficient.

Expected MD5 of `pg_proc.prosrc`:

| Function | MD5 |
| --- | --- |
| canonical_forex_watch_rule | 35b3dd9cddd026c11d118731538b2222 |
| validate_forex_watch_row | 70907c0426411a16cac6314cc324c084 |
| guard_forex_watch_write | c1a96a7d3a55d250136c8035f848d105 |
| save_forex_watch | e45cda6cb21b119c35dde46a3b083410 |
| delete_forex_watch | bfcfe2737676c0680396e40f28e1adf5 |

All five functions must remain invoker functions with fixed pg_catalog search paths. Anonymous and service-role execution must be false; authenticated execution is granted to the validation/helpers and RPCs, but not the trigger function. The alerts trigger must be enabled in ordinary mode and fire BEFORE INSERT OR UPDATE. Existing alerts RLS, owner policies and table grants must match the preflight.

Post the pre/post receipt on PR #1100 **before** updating the application ledger. Keep source CI, deployed authenticated save/reload/edit/delete, feed admission, evaluation and notification acceptance distinct. The packet grants no activation or delivery claim.
