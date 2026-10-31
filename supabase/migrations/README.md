# `supabase/migrations` — what this directory is, and what it is not

This directory is the **schema source of record** for the shared Supabase project
(`{ref}`). It is NOT a migration runner, and nothing in the deploy chain applies it.

**Before you add a file here, claim its number.** See [Numbering and reservations](#numbering-and-reservations) at the foot of this file for the allocation rule and the current list of open claims.

## There is no remote migration history

Censused read-only against production on **2026-08-20** via the Management API
(`POST https://api.supabase.com/v1/projects/<ref>/database/query`):

```
select nspname from pg_namespace where nspname = 'supabase_migrations';  ->  []
select version, name from supabase_migrations.schema_migrations;
    ->  ERROR 42P01: relation "supabase_migrations.schema_migrations" does not exist
```

**The `supabase_migrations` schema does not exist.** The Supabase CLI has never been run against
this project — there is no `config.toml`, no CLI on the Mac or the VPS, and no `db push` has ever
executed. So there is no remote history table, no applied/pending ledger, and nothing for a local
filename to be "out of sync" with.

That matters because the usual Supabase reconciliation advice — repair remote history, align
timestamps, `db push` — assumes a ledger that is not there. **Do not run `supabase db push` against
this project without reading the next section first.**

## How DDL actually lands

Applying a migration is an **operator action, out of band**, either in the Supabase SQL editor or
through the Management API with the PAT in `charting-app/.env`:

```bash
curl -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" --data '{"query":"<sql>"}'
```

A reviewed wrapper around this call, with pre/post catalog receipts, is `scripts/supabase_apply.py` (see `scripts/README_supabase_apply.md`).

Two hard-won rules (see root `HANDOFF.md` `5): strip `--` comments first — the endpoint splits on
`;` and chokes on a `;` inside a comment — and use `curl`, not python-urllib, which gets a
Cloudflare 1010 block.

Because application is manual and per-file, **the files here can be applied out of numeric order,
and have been.** Application status (baseline census 2026-08-21; the `0011`, `0012`, and `0013`
rows each record their own date — `0011`'s DDL was applied 2026-09-05
(readback receipt posted 2026-09-06); `0012`'s DDL was applied 2026-09-06; `0013`'s DDL was applied
2026-09-07 (merged to `master` as `be898be5` on 2026-09-06 via PR #513)):

| file | object it creates | in production? |
|---|---|---|
| `0001`–`0007` | tables, RLS, policies, indexes | yes (recorded, largely no-ops) |
| `0008_chart_layouts_unique_name.sql` | `chart_layouts_user_name` | **yes** — applied 2026-08-21 |
| `0009_watchlist_symbol_unique.sql` | `wls_watchlist_symbol` | **yes** — applied 2026-08-19 |
| `0010_search_event_stats.sql` | `search_event_stats()` + `search_events_created_at` | **yes** — applied 2026-08-21 |
| `0011_analytics_eid.sql` | `analytics_events.eid` (nullable unique UUID column) + `analytics_events_eid_uniq` unique index (WS:COMMERCIAL-ACTIVATION CA1A) | yes — DDL applied 2026-09-05; readback receipt posted 2026-09-06 (PR #507 comment `5557754941`) |
| `0012_thesis_objects.sql` | `theses`, `thesis_versions` + `apply_thesis_version_v1()`/`read_current_thesis_versions_v1()` | yes — applied 2026-09-06 (Meta-CEO B; project {ref}; post-apply readback: both tables relrowsecurity=true, policies theses_select_own + thesis_versions_select_own, SELECT-only grant to authenticated, functions apply_thesis_version_v1 (security definer) + read_current_thesis_versions_v1 (security invoker), indexes theses_owner_updated_idx/theses_owner_subject_idx/thesis_versions_owner_thesis_idx) |
| `0013_alert_runs_outbox.sql` | `alert_runs`, `alert_outbox` tables + RLS (Market Ontology F08 packet B-F08-2) | yes — applied 2026-09-07 via a direct Management API query (curl method above); readback receipt on PR #513 comment `5563321750` |
| `0014_tenancy_foundation.sql` | `teams`, `team_members`, `team_invites` tables + `is_team_member()`/`team_role()`/`handle_new_team()` + RLS | yes — applied 2026-09-08 (Meta-CEO B; readback receipt on PR #514 comment `5592694274`) |
| `0015_team_roles_invitations.sql` | `workspace_settings` table + `accept_team_invite()` + RLS | yes — applied 2026-09-08 (Meta-CEO B; readback receipt on PR #514 comment `5592697055`) |
| `0016_account_lifecycle_requests.sql` | `account_lifecycle_requests` table + RLS | yes — applied 2026-09-09 (Meta-CEO B; readback receipt on PR #527 comment `5594233632`) |
| `0017_personal_accuracy_ledger.sql` | `user_claims` table + RLS (personal accuracy ledger, packet B-F13-5) | yes — applied 2026-09-10 (Meta-CEO B; readback receipt on PR #547 comment `5625342890`) |
| `0018_webhook_delivery.sql` | `webhook_endpoints`, `webhook_deliveries` tables + `enqueue_test_webhook_delivery()` + RLS | yes — applied 2026-09-10 (Meta-CEO B; readback receipt on PR #549 comment `5625353856`) |
| `0019_team_role_changes.sql` | `team_role_changes` table + `log_team_role_change()` / `team_member_names()` + replaced `tm_insert_admin` / `tm_update_admin` / `tm_delete_admin` / `ti_insert_admin` | yes — applied 2026-09-11 (Meta-CEO B; merged as `3cdcd746` in PR #550; readback receipt on PR #550 comment `5630176327`) |
| `0020_team_ownership_transfer.sql` | `transfer_team_ownership(uuid, uuid)` — atomic demote-then-promote ownership transfer | yes — applied 2026-09-11 (Meta-CEO B; merged as `3cdcd746` in PR #550, originated in PR #557; readback receipt on PR #550 comment `5630176327`) |
| `0021_resource_grants.sql` | `resource_grants` table + `has_active_grant()`/`owns_watchlist()`/`resource_grants_guard()` + RLS on `watchlists`/`watchlist_symbols` (explicit grants, packet B-F12-B5-1) | yes — applied 2026-09-11 (Meta-CEO B; merged as `bad423f5` in PR #548, after `0019`/`0020` in ledger order; readback receipt on PR #548 comment `5630176531`) |
| `0022_chart_layouts_team_sharing.sql` | adds `team_id` + `visibility` columns + `chart_layouts_visibility_ck` + `chart_layouts_share_shape_ck` constraints + `chart_layouts_team` + `chart_layouts_team_name` indexes + 6 RLS policies (`chart_layouts_team_read/update/delete` + `chart_layouts_share_insert/update/delete_guard`) on `public.chart_layouts` (team-shared saved workspaces, packet B-F12-B5-2) | yes — applied 2026-09-13 (Meta-CEO B; merged as `6cdbaa0a8` in PR #555, after `0019`/`0020`/`0021` in ledger order; readback receipt held in the seat's handoff kit at `ddl/receipt_0022.json`; the project ref is never written) |
| `0023_portfolio_targets.sql` | `portfolio_targets` table + RLS + `portfolio_targets_user` index + 4 RLS policies (`portfolio_targets_select/insert/update/delete_own`) (portfolio target weights + bands, user-typed, packet B-F08-B5-1) | yes — applied 2026-09-13 (Meta-CEO B; merged as `9022e0138` in PR #552, after `0019`/`0020`/`0021`/`0022` in ledger order; readback receipt held in the seat's handoff kit at `ddl/receipt_0023.json`; the project ref is never written) |
| `0026_webhook_rotation_alert_fires.sql` | rotation columns + widened event_filter vocabulary + `webhook_alert_optins` + enqueue/rotation/redrive RPCs + alert-fire projection trigger (packet B-F12-11, MO-PAID-056 + MO-DELTA-038; PR #582, merged `d20dc37e287d03cf4eaa394e0c38ee4a861c6346`) | yes — applied once 2026-10-19 at 16:20:38 UTC; native applier 32/32 statements and six readbacks passed. Receipt `resume-20261018/582-0026-native-apply-20261019.json` in the B checkpoint, SHA256 `74496eae863c4230034c4c1bd6683d5c28b72d5be69c27035288c4fe5c9143b5`; authorization readback confirmed fixed search paths, RPC grants and secret-column exclusion. No endpoints or opt-ins created. |
| `0031_drawings_atomic_replace.sql` | invoker `validate_drawing_replace_input()` / `read_drawings_collection()` / `replace_drawings_collection()` on the existing `drawings` table (drawing snapshot revision + transactional replace) | yes — applied 2026-10-19 at 04:57 UTC from PR #858 as one atomic Management API request; the post-apply owner census found 8 empty legacy collections failing `22000`, so the corrected `read_drawings_collection` body was re-applied at 05:07 UTC and the census reread 18/18 ok ([apply and catalog receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/858#issuecomment-6260582227)). No table, RLS, policy or row change; `0030` remains unapplied. |
| `0032_thesis_proposal_state_qualification.sql` | alias-qualified `set_thesis_amendment_state(uuid,text)` proposal transition function | yes — applied 2026-10-11 at 19:04 UTC from PR #946 merge `2957bd64`; one function replacement with exact pre/post body and unchanged owner, ACL, security mode and search path ([catalog receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/946#issuecomment-6112592004)). No table, grant, policy or user-data change. |

**Which prefixes carry a vitest ledger pin.** Every prefix from `0017` to `0027` now has a vitest contract under `terminal/lib/__tests__/` that reads `RESERVATIONS.json` and asserts its row's `state`, `pr`, `pr_state`, `merged_sha` and applied fields, plus the agreement between that row and the `-- Ledger row:` header line of the `.sql` it names: `0017` in `personalAccuracyMigrationContract.test.ts`, `0021` in `resourceGrantsMigrationContract.test.ts`, `0018`, `0019`, `0020`, `0022`, `0023`, `0024`, `0026` and `0027` in the `*LedgerContract.test.ts` files added beside them. They are a second reader, not the authority: `tests/test_supabase_migration_namespace.py` remains the **primary** pin — it is what CI's python job runs, it carries the STRICT / PULL_REQUEST / LENIENT scope rules described below, and it covers every prefix in this ledger, including the ones below `0017` that no vitest file names.

**Raw-fallback note (terminal PR #516):** `scripts/supabase_apply.py` only
becomes the reviewed applier for files in this directory once that PR merges
— until then, an apply is still the bare curl call in "How DDL actually
lands" above, run directly by Meta-CEO B out of band. The `0012` apply
recorded above used that raw fallback, not `--apply`, because at the time it
ran the tool's own readback-block parser had a bug that aborted the strict
`--apply` path for that exact file (`HTTP 400 … syntax error at or near
"Post"` — see PR #516's Round-4 section for the incident and its fix). Any
`0012`/`0013` apply Meta-CEO B runs before PR #516 merges is, by the same
reasoning, a raw-fallback apply and not a `--apply` run through this tool;
`0013`'s row above is not changed by this note — it still awaits its own
readback receipt.

`0009` was applied two days before `0008`. The numbering records *when the DDL entered the repo*,
not when an operator ran it — so **never infer application status from file order.** Ask the
database:

```sql
select indexname from pg_indexes where schemaname = 'public';
select proname, prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
```

Verifications recorded at the time of applying, so a later session need not re-derive them:
`search_event_stats` is `prosecdef = false` (INVOKER), `has_function_privilege` is false for both
`anon` and `authenticated` and true for `service_role`, and the same call through PostgREST answers
200 with the service key and `401 42501 permission denied for function` with the anon key.

## Version prefixes must be unique

`0008` was held by two different files at once — `0008_chart_layouts_unique_name.sql` (PR #427,
merged 13:43Z) and `0008_watchlist_symbol_unique.sql` (PR #426, merged 18:02Z) — because the two
PRs were authored in parallel off the same base and neither could see the other's number. The
later-merged file was renamed to `0009`, by merge time: an immutable fact recoverable from git,
unlike application status, which changes the moment an operator runs a file.

`tests/test_migration_ledger.py` now fails CI if two files ever share a prefix again.

## Every file must stay re-runnable

Since there is no ledger, a future session that adopts the CLI would find an empty history and try
to apply **everything** from `0001`. That is survivable only because every file here is idempotent:
`create table if not exists`, `create index if not exists`, `create policy` wrapped in
`duplicate_object` handlers, `drop trigger` before `create trigger`. `0009`'s duplicate-reconcile
`delete` is likewise a no-op once the unique index exists.

**Keep it that way.** A migration that is not safe to re-run is a migration that cannot be applied
in this estate, because nothing here records that it already was.

## Numbering and reservations

Ruled 2026-09-06 by Meta-CEO B. The DEC record is committed on the Meta-CEO B branch and lands
on macro `main` through macro PR #6903; until that merge this README is the only public copy of
the ruling text.

### Ruling text (binding, DEC-SUPABASE-MIGRATION-NAMESPACE-TERMINAL-LEDGER-2026-09-06)

Four rules, in plain words:

**(a) One forward ledger.** This directory is the only forward migration ledger for the shared
Supabase project `{ref}`. The Macro repo's `scripts/deploy/000N` series is frozen as
a historical record: it is never extended, and any Macro-side DDL need becomes a pull request in
*this* directory instead.

**(b) A number is claimed when a pull request opens.** The next free number is
`max(number on master, numbers claimed by open pull requests) + 1`, recorded in a Reservations
table in this README in the same pull request. A collision resolves in favour of the
earlier-opened pull request; the later one renumbers before merging.

**(c) The initial seed is a one-time ruling exception to (b):** `0011` stays with #507 because it
is a one-file Ready PR whose DDL is already applied live, while #502 is a 25-file Draft that must
rebase regardless; no future exception to (b) without a DEC amendment. (As of 2026-09-06, when
this exception was ruled, #502 was a 25-file Draft that had to rebase regardless; it merged later
that same day as `d4556962`.)

**(d) Every file stays re-runnable, and applying it stays out of band.** Each migration is
idempotent, carries a `-- down:` comment block saying how to undo it, and carries a `-- readback:`
catalog query that answers whether it is live. Applying it remains an operator / Meta-CEO action
performed by hand, out of band, and the pre/post catalog readback is posted on the pull request
before the README application table is updated.

### Operating notes (README author extension, not part of the ruling)

These describe how this README author is implementing rules (a)-(d) above, plus one illustrative
fact about rule (a). None of this is itself ruled text — a future change to any of it needs no DEC
amendment, only a README edit.

- **Numeric collision with Macro's frozen series.** Macro's frozen `scripts/deploy/000N` series
  carries its own `0004`–`0008`, which collide numerically with the files here and mostly describe
  different objects — those numbers are history, not addresses, and nothing should ever be matched
  across the two series by number.
- **Meta-CEO B pre-reservation channel.** Meta-CEO B may reserve a number directly, ahead of any
  pull request opening — as done for `0013`/`0014`, which had no open pull request at the time
  they were first reserved. Such a pre-reservation is written into the table by the ruling record
  that creates it, not by a pull request; the pull request that later claims that number updates
  the table's owner and status columns rather than adding a new row.
- **Formula fold-in.** The `max()` in rule (b) is read here as counting the reservations table
  below as well as open pull requests — not something derived after the formula — precisely so a
  Meta-CEO B pre-reservation with no open pull request (like `0013`/`0014` were, before #513/#514
  opened) is never invisible to the next claimant.
- **Release path.** A reservation is released — its owning claim stood down — the moment its
  pull request closes without merging, or (for a pre-reservation) the moment Meta-CEO B stands it
  down; the row is not removed. Its status changes to `released` in place, replacing `open PR`
  (or `reserved` for a number never opened as a PR), so the table stops reading it as an active
  claim. Because the formula fold-in above counts
  every row in this table regardless of status, a released row's number keeps counting toward
  `max()` like any other row — `released` marks the claim as abandoned, it does not free the
  number for reissue. `released` is a status this README defines to implement the release path
  above; it is not one of the ruling's enumerated statuses. No number below has been released.
  `RESERVATIONS.json` and `scripts/check_supabase_migration_namespace.py` now both know the word:
  `released` is a valid ledger `state`, it must carry no `file`, the guard fails loudly if a `.sql`
  ever appears at a released prefix (`RELEASED_PREFIX_OCCUPIED`), and the contiguity walk counts a
  released number as occupied. Until Terminal PR #543 the script's `VALID_STATES` had no
  `released` at all, so following this very paragraph would have turned the ledger permanently red
  (`RESERVATION_SCHEMA` on the word, `RESERVATION_GAP` on the number) with no honest way out.

### Reservations

Forex R26 claim (2026-10-21): draft **PR #1100**, opened at 12:17:40Z and read back at `b44b0552`, claims **0038**, `0038_forex_inactive_conditions.sql`. The complete open-PR file census found incumbent **0037** on #1084 (`0037_medtech_watches.sql`); it remains with that earlier owner. SQL and the own-PR ledger row follow this verified open claim. Production DDL was applied once through the existing authenticated SQL editor between 17:39:00Z and 17:40:22Z on 2026-10-21. The full pre/post catalog receipt was posted and read back on [PR #1100](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1100) at 17:41:57Z before this ledger update; its retained copy is `docs/verification/forex-r26/0038-apply-receipt.json`. All five function bodies/privileges and the trigger match the reviewed source, and existing alerts RLS, grants and owner policy are unchanged. The SQL SHA-256 remains `f7f2e50b11fd863f107abc8406c04d35ffa67f52bca6c885281340d6aff4adee`; preserve its historical authoring comments. No remote migration history was created. PR #1100 squash-merged to master as `5f14b35c18d8f9f70e8f0d381963dee98e59a521` at 2026-10-21T19:11:55Z; its ledger row was flipped to merged in the first master merge after it (the #1103 branch refresh), as the immediate follow-up rule requires. Application does not claim deployed account acceptance. Do not reapply.

| number | name | owner (PR / packet) | status |
|---|---|---|---|
| `0011` | `analytics_eid` | PR #507 (DDL applied 2026-09-05; readback receipt posted 2026-09-06: https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/507#issuecomment-5557754941) | applied |
| `0012` | `thesis_objects` | PR #502 (merged as `d4556962`; DDL applied 2026-09-06, readback receipt taken at apply time but **no receipt comment found on the owning PR** — searched #502's comments 2026-09-09) | merged + applied 2026-09-06 |
| `0013` | `alert_runs_outbox` | PR #513 (merged as `be898be5` on 2026-09-06, packet B-F08-2) | applied 2026-09-07 via a direct Management API query (the curl method described above in "How DDL actually lands"), used instead of the apply script `scripts/supabase_apply.py` (PR #516) because of a readback-parser bug in that script; readback receipt posted on PR #513 (Meta-CEO B comment https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/513#issuecomment-5563321750) |
| `0014` | `tenancy_foundation` | PR #514 (merged as `cff58ee8` on 2026-09-08, packet B-F12-1) | merged + applied 2026-09-08 |
| `0015` | `team_roles_invitations` | PR #514 (merged as `cff58ee8` on 2026-09-08, packet B-F12-3; authored on stacked PR #526 squash `83424c63`) | merged + applied 2026-09-08 |
| `0016` | `account_lifecycle_requests` | PR #527 (merged as `68bbe8ea` on 2026-09-09, packet B-F12-4) | merged + applied 2026-09-09 |
| `0017` | `personal_accuracy_ledger` | PR #547 (merged as `b7aa0981` on 2026-09-10, packet B-F13-5) | merged + applied 2026-09-10 (readback receipt on PR #547 comment `5625342890`) |
| `0018` | `webhook_delivery` | PR #549 (merged as `cd1269fe` on 2026-09-10, packet B-F12-7 — the seat's **re-scoped Terminal signed-webhooks** packet of 2026-09-09 (branch `claude/mo-b-f12-7-signed-webhooks`), **not** the refused public-API packet recorded against macro #6925 under the same id) | merged + applied 2026-09-10 (readback receipt on PR #549 comment `5625353856`) |
| `0019` | `team_role_changes` | PR #550 (merged as `3cdcd746` on 2026-09-11, packet B-F12-8; owner / administrator / member roles v1) | merged + applied 2026-09-11 (readback receipt on PR #550 comment `5630176327`) |
| `0020` | `team_ownership_transfer` | PR #550 (merged as `3cdcd746` on 2026-09-11, packet B-F12-9; atomic ownership transfer v1; originated in PR #557 and squash-merged into #550's branch at `29257a43`). Seat ruled 0020; the spec's claim of 0019 is superseded because 0019 is B-F12-8. | merged + applied 2026-09-11 (readback receipt on PR #550 comment `5630176327`) |
| `0021` | `resource_grants` | PR #548 (merged as `bad423f5` on 2026-09-11, packet B-F12-B5-1 explicit grants; prefix ruled by the seat 2026-09-09) | merged + applied 2026-09-11 (readback receipt on PR #548 comment `5630176531`) |
| `0022` | `chart_layouts_team_sharing` | PR #555 (merged as `6cdbaa0a8` on 2026-09-09, packet B-F12-B5-2) | merged + applied 2026-09-13 (readback receipt held in the seat's handoff kit at `ddl/receipt_0022.json`; the project ref is never written) |
| `0023` | `portfolio_targets` | PR #552 (merged as `9022e0138` on 2026-09-10, packet B-F08-B5-1) | merged + applied 2026-09-13 (readback receipt held in the seat's handoff kit at `ddl/receipt_0023.json`; the project ref is never written) |
| `0024` | `brief_subscriptions` | PR #579 (merged as `82bee14b`, packet B-F11-7, MO-PAID-032 Terminal half; two nullable FK columns `target_thesis_id`/`target_watchlist_id` and a CHECK-constrained pair enforcing exactly-one alignment with `target_kind`; API enforces ownership before insert per constraint 1) | merged + applied 2026-09-19 (readback receipt held in the seat's handoff kit at `ddl/receipt_0024.json`; the project ref is never written) |
| `0025` | `thesis_amendment_proposals` | PR #577 (merged as `4169e0cf` on 2026-09-19, packet B-F11-5, MO-PAID-054 write-back) | merged + applied 2026-09-19 (readback receipt held in the seat's handoff kit at `ddl/receipt_0025.json`; the project ref is never written) |
| `0026` | `webhook_rotation_alert_fires` | PR #582 (merged `d20dc37e287d03cf4eaa394e0c38ee4a861c6346`, packet B-F12-11, MO-PAID-056 + MO-DELTA-038) | merged + applied once 2026-10-19 at 16:20:38 UTC; native application/readback receipt cited above. Metadata reconciliation only; do not reapply. |
| `0027` | `api_keys` | PR #581 (merged as `c9381593` on 2026-09-19, packet B-F12-10, personal read-only API keys) | merged + applied 2026-09-19 (readback receipt held in the seat's handoff kit at `ddl/receipt_0027.json`; the project ref is never written) |
| `0028` | `0028_investigations.sql` | `IW2-G1-INVESTIGATION`, converged from `INTL-R10-SAVED-RESEARCH`, #777 | applied 2026-10-04; [catalog receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/777#issuecomment-5977275494) |
| `0029` | `investigation_thesis_refs` | existing PR #804, IW2-G5 | open PR; its own applied receipt remains authoritative |
| `0030` | `investigation_kernel` | existing PR #804, IW2-G1 repair | open PR; not applied |
| `0031` | `drawings_atomic_replace` | PR #858 (merged as `abfedf79e` on 2026-10-20), TERMINAL-AUDIT20-A04 | merged; applied 2026-10-19 before merge, corrected body re-applied the same morning ([apply and catalog receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/858#issuecomment-6260582227)) |
| `0032` | `thesis_proposal_state_qualification` | PR #946, B-F11-PROPOSAL-STATE-SQL | merged `2957bd64`; applied 2026-10-11 ([catalog receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/946#issuecomment-6112592004)) |
| `0033` | `watchlist_annotations` | packet E05 (program `terminal-enhancements20-20261011-opus`, #916), PR #927; numbered by rule (b) above `0029`–`0032`, which PRs #804, #858 and #946 hold | merged `857a5076`; applied 2026-10-11 21:52Z through `scripts/supabase_apply.py` ([catalog receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/927#issuecomment-6114211528)): RLS on, four own-row policies, anon select = f; row flipped to merged on master by #955 (which reconciled the ledger row in passing); #957 aligns the SQL header and this table |
| `0034` | `api_watchlist_write` | packet B-F12-WATCHLIST-WRITE, PR #1018; opt-in personal watchlist additions and atomic replay receipts | merged `00c5f725`; applied once 2026-10-15 21:05Z via the native runner (one atomic statement); RLS/service-only RPC and unchanged existing key/auth authority verified ([catalog receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1018#issuecomment-6202285065)) |
| `0035` | `saved_view_guard` | earlier-opened draft #778 at `88f2919a5c2222bcf05f452f2549b9af180dcae6` | incumbent open claim; SQL absent from this candidate; production not applied |
| `0036` | `portfolio_entry_currency` | PR #1044, TERMINAL-PORTFOLIO-WORKSPACE; forward replacement of pending #866; precedence resolved by Macro decision 9593 (DEC-PORTFOLIO-CURRENCY-FORWARD-DISPOSITION-2026-10-18) | merged as `8f00622096d0dc574458c134516e802ce78907ae`; applied in production once 2026-10-19 01:13Z before merge ([original application receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1044#issuecomment-6283607982); byte-exact copy `terminal/docs/verification/portfolio-workspace/0036-production-receipt.json`) |
| `0038` | `forex_inactive_conditions` | PR #1100 / FOREX-R26-INACTIVE-CONDITIONS | merged as `5f14b35c18d8f9f70e8f0d381963dee98e59a521` (2026-10-21 19:11Z); production DDL applied once 2026-10-21 17:39–17:40Z before merge, full pre/post receipt on owning PR and in `docs/verification/forex-r26/0038-apply-receipt.json` |
| `0039` | `investigation_options_evidence` | PR #1103 / OPTIONS-R1-W2C; widens `valid_investigation_manifest_v2` to the Terminal evidence registry | merged as `eb752cd653f3add2aa67cdcc7b588dae13c86843` (2026-10-21 20:32Z); applied in production once 2026-10-22 01:20Z after merge via `scripts/supabase_apply.py --apply --receipt` ([receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1103#issuecomment-6330358798); byte-exact copy `docs/verification/options-r1/0039-apply-receipt.json`) |
| `0040` | `investigation_review` | PR #1104 / OPTIONS-R1-W3C; admits the optional top-level `review` block, authored from the 0039 body | merged as `0aecf8e95dd7888b3453834d75f3e072e464bb6e`; applied **2026-10-22 13:40:13Z** via `scripts/supabase_apply.py --apply --receipt`, using PR #1125's qualified catalog readback (executable SQL unchanged). [Owning-PR receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1104#issuecomment-6343024596); [byte-exact receipt](../../docs/verification/options-r1/0040-apply-receipt.json) and [independent production qualification](../../docs/verification/options-r1/0040-production-qualification.json). |
| `0041` | pinned Investigation revision handoffs on existing `resource_grants`; immutable revision discriminator, fixed DTO and four scoped RPCs | yes — applied once **2026-10-23 04:35:10 UTC**, after PR #1139 merge `61c504a472120935458874db04757f6064b91e6f` and compatible app-first installation. All 25 statements returned successfully (statement-at-a-time). Raw helper exit 6 / `failed_readback` solely reflects omitted `resource_grants_guard` in the built-in readback; [owning-PR receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1139#issuecomment-6357486989), [unchanged raw receipt](../../docs/verification/pinned-research-handoff/0041-native-apply-receipt.json) and [separate catalog qualification](../../docs/verification/pinned-research-handoff/0041-effect-qualification.json) preserve that verdict and establish the exact installed guard/body/ACL/constraint/policy state separately. No replay or recipient grants; authenticated two-account acceptance remains separate. |
| `0041` | `pinned_research_handoffs` | B-F12-PINNED-RESEARCH-HANDOFF; [PR #1139](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1139), merged `61c504a472120935458874db04757f6064b91e6f` | merged + applied once **2026-10-23 04:35:10 UTC** after compatible app-first install; [owning-PR receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1139#issuecomment-6357486989). Raw helper `failed_readback` (sole omitted guard) retained; separate catalog qualification confirms application without replay. No recipient grant or authenticated consumer proof. |
| `0042` | `investigation_scenario_reference` | B-F12-SAVED-SCENARIO-CAPTURE; [PR #1144](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1144), opened 2026-10-23 15:23:54Z after complete current claim census | open source claim; **UNAPPLIED**, no production binding enabled |

`0001`–`0007` and `0010` are **historical**: they predate this ledger, their creating pull
requests were never recorded in-repo, and so their `pr` and `pr_state` fields in
`RESERVATIONS.json` are `null` **by design** — null meaning "not recorded", never
unknown-and-guessed. Do not backfill them with inferred pull-request numbers; the guard and
`tests/test_supabase_migration_namespace.py` both pin that nullity so a later tidy-up cannot
invent provenance for them.

What the statuses mean: **reserved** — the number is claimed (for example, by a Meta-CEO B
pre-reservation) but no pull request carrying its file is open yet; **open PR** — a pull
request carrying the file for this number is open and not yet merged; **merged** — the file
is on `master`; **applied** — the file is on `master` **and** its DDL has been run against the
production project with a readback receipt. `merged + applied <date>` (used by `0012` above) is
the same "applied" meaning, spelled out with the merge fact alongside it because the row's own
history (merged first, applied later) is otherwise lost. (**released** is an operating-note-only
status — see "Release path" above — for a claim that was stood down; it is not one of the
ruling's own status words and no row currently carries it.)

`0017` (personal accuracy ledger, packet B-F13-5) and `0018` (signed webhooks, packet B-F12-7)
have both merged and been applied: `0017` reached `master` as `b7aa0981` and its DDL was applied
2026-09-10 (readback receipt on PR #547, comment `5625342890`), and `0018` reached `master` as
`cd1269fe` and was applied the same day, after it (readback receipt on PR #549, comment
`5625353856`). `0019` (team roles, packet B-F12-8) and `0020` (ownership transfer, packet
B-F12-9) rode PR #550 to `master` in one squash, `3cdcd746` (2026-09-11T05:42:28Z), and the seat
applied both that morning in ledger order — `0019` at 05:58:15Z, `0020` at 05:58:34Z — under a
single readback receipt (PR #550, comment `5630176327`). `0021` (explicit grants, packet
B-F12-B5-1) merged to `master` as `bad423f5` on 2026-09-11 and was applied straight after them at
05:59:15Z (readback receipt on PR #548, comment `5630176531`). `0022` (team-shared saved
workspaces) and `0023` (portfolio targets) merged before `0021`; on 2026-09-13 the seat applied
them in ledger order — `0022` at 06:57:09Z, `0023` at 06:57:13Z — under readback receipts held in
the seat's handoff kit (`ddl/receipt_0022.json`, `ddl/receipt_0023.json`); the project ref is never
written. `0027` (personal API keys, packet B-F12-10, PR #581) is an open pull request and is also
**not applied**. That is what separates
`reserved` from `taken` — `taken` means a real file exists (in this checkout or in an open PR);
`reserved` means only the number and the owner are settled. As
with every prefix in this ledger, the seat applies DDL **in ledger order** — never ahead of a
lower, still-unapplied number — and never without a pre/post catalog-readback receipt posted on
the owning pull request first (rule (d) above); `0014` and `0015` applying strictly in that order
on 2026-09-08, and `0016` only after both, on 2026-09-09, is the worked example on the real tree.
`0021` is the worked example at the newer end: it had been on `master` since 2026-09-11T02:00:51Z
but could not be applied until `0019` and `0020` had landed and been applied, which is why its
apply stamp sits 41 seconds after `0020`'s.

`0001`–`0023` have reached production (DDL applied): `0001`–`0010` per the application-status
table above, `0011` via its corrective DDL applied live on 2026-09-05 via the management API
(readback receipt posted 2026-09-06, recorded on PR #507, ahead of `0011`'s own file landing on
`master`), `0012` merged to `master` as `d4556962` with its DDL applied 2026-09-06 (Meta-CEO B,
readback receipt), `0013` (PR #513) merged to `master` as `be898be5` on 2026-09-06 with its
DDL applied out of band on 2026-09-07 via a direct Management API query (the method described
above in "How DDL actually lands"), used instead of the apply script `scripts/supabase_apply.py`
(PR #516) because of a readback-parser bug in that script (readback receipt posted on PR #513,
comment `5563321750`) — merged = yes, applied = yes. `0014` (PR #514) merged to `master` as
`cff58ee8` on 2026-09-08 with its DDL applied 2026-09-08 (readback receipt on PR #514 comment
`5592694274`; summary comment `5592731536`). `0015` (authored on stacked PR #526 squash
`83424c63`, reached master inside `cff58ee8`) had its DDL applied 2026-09-08 strictly after
`0014` (readback receipt on PR #514 comment `5592697055`). `0016` (PR #527) merged to `master`
as `68bbe8ea` on 2026-09-09 with its DDL applied 2026-09-09 (readback receipt on PR #527 comment
`5594233632`) — merged = yes, applied = yes. `0017` (PR #547) merged to `master` as `b7aa0981`
on 2026-09-10 with its DDL applied the same day (readback receipt on PR #547 comment
`5625342890`), and `0018` (PR #549) merged as `cd1269fe` and was applied straight after it
(readback receipt on PR #549 comment `5625353856`) — merged = yes, applied = yes for both.
`0019` and `0020` (both PR #550; `0020` originated in PR #557) merged to `master` in one squash,
`3cdcd746`, on 2026-09-11 and had their DDL applied the same morning — `0019` at 05:58:15Z, then
`0020` at 05:58:34Z, under one readback receipt (PR #550 comment `5630176327`) — and `0021`
(PR #548, `bad423f5`) followed at 05:59:15Z (readback receipt on PR #548 comment `5630176531`);
merged = yes, applied = yes for all three. `0022` (PR #555, `6cdbaa0a8`) and `0023` (PR #552,
`9022e0138`) had their DDL applied on 2026-09-13 — `0022` at 06:57:09Z, then `0023` at
06:57:13Z, under readback receipts held in the seat's handoff kit (`ddl/receipt_0022.json`,
`ddl/receipt_0023.json`); the project ref is never written; merged = yes, applied = yes for both.
The "in production?" table and the Reservations table above now agree on `0013` through `0023`.

This table is re-verified at merge time, not just at the moment this pull request opened. A later
reader should re-run the same open-pull-request query rather than trust these owner cells past
that point:

```
$ gh pr list --repo mastermindx-market-intelligence/mastermind-terminal --state open --limit 60 \
    --json number,createdAt,files --jq '.[] | . as $p | ($p.files[].path | select(startswith("supabase/migrations/"))) as $f | [$p.number,$p.createdAt,$f] | @tsv'
```

### What the namespace guard enforces, and in which run

`scripts/check_supabase_migration_namespace.py` (driven by
`tests/test_supabase_migration_namespace.py`, which is what CI actually runs) joins the `.sql`
files present in a checkout against this ledger. Its central rule — *a prefix whose file is
present cannot still be recorded `pr_state: "open"`* — is scope-dependent, so the guard picks one
of three modes from what the environment **proves**, and prints which one it used:

| mode | earned when | a present file whose row says `open` is… |
|---|---|---|
| **STRICT** | `GITHUB_EVENT_NAME=push` **and** `GITHUB_REF_NAME=master` (or `--strict` locally) | always stale — the file being on `master` proves its pull request merged (`OPEN_PR_STATE_WITH_FILE_PRESENT`) |
| **PULL_REQUEST** | `GITHUB_EVENT_NAME=pull_request` **or** `workflow_dispatch`, **and** `PR_NUMBER` carrying a positive pull-request number | legitimate **only** for that pull request; any other is stale (`OPEN_PR_STATE_STALE`) |
| **LENIENT** | anything else — a local run, or a `workflow_dispatch` ordered without a `pr_number` input | required only to be `state: "taken"` with a pull-request number (`OPEN_PR_STATE_WITHOUT_OWNING_PR`) |

The PULL_REQUEST mode exists because no workflow in this repository has an `on: push` trigger:
`.github/workflows/ci.yml` runs on `pull_request` and `workflow_dispatch` only. Without it the
strict rule was correct and unreachable — it fired in no configuration CI could run, so replaying
the exact staleness this ledger was corrected for produced no finding at all (Terminal PR #543,
review round 3). `PR_NUMBER` is wired into the `python` job's pytest step in that workflow; it is
a pull-request number, not a credential, and it comes with no change in workflow authority. The
converse rule — `pr_state: "merged"` while the file is absent — needs no scope and runs in all
three modes.

`workflow_dispatch` earns the same PULL_REQUEST mode because of one specific run.
`scripts/merge_on_green.py` refreshes a stale branch with `GITHUB_TOKEN`. GitHub records the new
head's `pull_request` run as held, and the controller re-runs that held run, which then carries the
pull-request number itself (#874). When no `pull_request` run appears for the refreshed head, the
controller falls back to dispatching this workflow — and on that path the dispatched run may be the
**only** CI run that has executed for that sha, although its checks alone do not satisfy the pull
request's required-check rollup. `github.event.pull_request.number` is empty on a dispatch, so such
a run used to fall to LENIENT and this ledger's one enforcement rule was inert on that head
(Terminal PR #543, review round 4). `ci.yml` now declares an optional
`workflow_dispatch` input `pr_number`, the pytest step reads
`${{ github.event.pull_request.number || inputs.pr_number }}`, and the controller passes the
number it already knows. A dispatch ordered by hand without the input is **not** broken — it stays
LENIENT, and the printed mode line names that case specifically rather than reading like an
ordinary local run.

Every prefix whose `.sql` is in the checkout must also carry both `applied_in_production` and
`applied_date` **keys** (`APPLIED_FIELDS_MISSING`). What is required is that the row *answers* the
question, not that the answer is yes: where nothing in this repository records the fact, the
correct entry is an explicit `null` with a note saying it was not recorded. `0001`–`0007` carry
`applied_in_production: true` with `applied_date: null` for exactly that reason — the application
table above records that they are in production but records no date, and a guessed date would be
worse than the gap it fills.

The two keys must also agree with **each other** (`APPLIED_FIELDS_HALF_FILLED`). Two shapes are
half-filled: `applied_in_production: true` beside `applied_date: null` **with no note** — the
combination is legitimate, which is why `0001`–`0007` pass, but only when the row says *why* the
date is unknown, since an unexplained null is indistinguishable from a forgotten one; and an
`applied_date` carried while `applied_in_production` is anything but `true`, which is a row that
contradicts itself and that no note reconciles.

### 0028 — Investigation convergence (#777)

The former Saved Research reservation owns `0028_investigations.sql`, packet
`IW2-G1-INVESTIGATION`, on the existing PR #777. The per-file wrapper applied all
39 statements at 2026-10-04T06:17:18Z. Its initial `failed_readback` came from
incomplete readback queries; independent catalog reads verified all 19 objects,
four RLS tables, SELECT-only authenticated table grants and private helpers.
No DDL replay occurred. The source now includes complete readback queries, with
executable statements unchanged from the independent review.

Receipt: [#777 migration readback](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/777#issuecomment-5977275494). Sanitized apply/catalog
receipts are in `terminal/docs/verification/iw2-g1/`. Application deployment and
real authenticated acceptance are separate gates. Rollback revokes the mutation
RPC grant and retains heads, revisions, receipts and captures. Current layouts
are not changed by the migration.

### 0031 — Audit20 drawing snapshot and atomic replacement

Reserved for `TERMINAL-AUDIT20-A04`, root `01a10f92`. Prefixes 0029 and 0030 remain with #804. Source qualification and any production application have separate receipts.

`0031_drawings_atomic_replace.sql` adds three invoker functions on the existing `drawings` table, with no table or RLS changes. GET returns an opaque revision for one coherent owner/symbol snapshot. PUT compares that revision inside the replacement transaction and keeps at most 32 prior operation receipts. Legacy rows are never assigned invented receipts. A table write fence covers old direct INSERTs; this serializes drawing writes across accounts while reads remain available.

Readback: the `-- readback:` block at the end of `0031_drawings_atomic_replace.sql` is the canonical readback (it also checks RLS and the table write fence). Its function query is `SELECT p.oid::regprocedure, p.prosecdef, p.proconfig, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute, has_function_privilege('anon', p.oid, 'EXECUTE') AS anonymous_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('validate_drawing_replace_input','read_drawings_collection','replace_drawings_collection');` Verify all three are invoker (`prosecdef=false`), with `search_path=pg_catalog`, EXECUTE for authenticated and not for anon (service_role keeps its default grant, as in 0028), and `public.drawings` still has RLS enabled. Application status: **applied** 2026-10-19 (04:57 UTC, corrected `read_drawings_collection` body re-applied 05:07 UTC) with pre/post catalog, smoke, PostgREST and owner-census receipts on PR #858 ([receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/858#issuecomment-6260582227)). An empty legacy collection must read as an empty snapshot: `jsonb_agg` over zero rows is `NULL`, so the body coalesces it to `'[]'`. Rollback drops only these functions after rolling back the API; drawing rows are preserved.

### 0036 — Merged Portfolio entry-unit receipt

PR #1044 introduced `0036_portfolio_entry_currency.sql` as the forward replacement for pending #866's `0032_portfolio_entry_currency.sql` at `60fd6d997df52d2d8331de85ab63014446e16ef9`. A fresh census at 2026-10-18T06:58:50Z covered 168 open PRs, including all paginated file lists for ten full first pages. Earlier-opened #778 at `88f2919a5c2222bcf05f452f2549b9af180dcae6` now claims `0035_saved_view_guard.sql`. Portfolio moved its pending proposal from 0035 to 0036 and leaves #778’s claim intact. Only #1044’s own row is carried in RESERVATIONS.json; #778’s file remains on its incumbent branch.

The applied #946 file `0032_thesis_proposal_state_qualification.sql` and its reservation remain unchanged. The disposition of #866's pending claim is resolved by the accepted canonical Macro decision 9593 (`DEC-PORTFOLIO-CURRENCY-FORWARD-DISPOSITION-2026-10-18`); superseded #866 remains historical evidence and is never rerun. The #1044 row records its actual solo squash `8f00622096d0dc574458c134516e802ce78907ae` and the application fact below. Deployment and authenticated production acceptance are recorded separately. Incumbent 0029/0030 remain with held #804 and 0031 with #858 until their actual release contracts are reconciled; numeric order, source review, application qualification and production acceptance remain separate.

`0036_portfolio_entry_currency.sql` adds nullable `entry_currency` and `entry_currency_basis` on the existing owner/RLS-scoped `portfolio_positions`. The explicit declaration is tied to the exact ticker and entry price. An older writer changing either invalidates both receipt columns; changing back cannot resurrect a unit. Status/share/notes-only writers preserve the declaration. Legacy rows remain unknown. No current-quote inference, historical backfill, FX conversion, new table, privilege or RLS change is made.

The source refuses absent table/RLS, conflicting column types, non-null/defaulted unit columns and a same-named incompatible constraint. Its invoker receipt trigger pins `search_path`; the file carries executable readback and application-only rollback guidance that retains recorded data and the compatibility fence. Native PostgreSQL qualification is isolated fixture evidence, never production application. Historical #866 proof remains historical evidence.

**Application fact (recorded 2026-10-20, reconciling the earlier UNAPPLIED wording above):** the original applier (`scripts/supabase_apply.py`, tool `supabase_apply/1`, statement-at-a-time) applied exactly one statement at **2026-10-19T01:13:16Z**, before any merge — `statements_n=1`, status `applied`, all five post readbacks present, `missing_after` empty, `error` null. The original application receipt (SHA256 `511faa4788ca35b8946070bdc8420057fcd0bd62be96fa289c058609e3fe3ff1`, 4,419 bytes) is published complete on [PR #1044 comment 6283607982](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1044#issuecomment-6283607982) and stored byte-exact at `terminal/docs/verification/portfolio-workspace/0036-production-receipt.json`. The executable SQL hash `9c09540e7b4e451e55a39d8229b3a73eb93c997578f3dadfdc3f24b47a7f7f4c` is unchanged from application head `75eaabd1`; the separate estate-preservation receipt binds the same runner (`938349bba26a848508a579835245d77a70c01baa7e9b641d9163d4f3c8ec0b55`) with before `01:13:11.882652Z` / after `01:13:16.774276Z` and ACL, RLS and all policy rows equal. An independent SELECT-only catalog read at 2026-10-20 04:42–04:44 UTC confirmed the applied objects unchanged. **Do not reapply 0036 or the superseded #866 currency migration.** PR #1044 merged as `8f00622096d0dc574458c134516e802ce78907ae`. This immediate follow-up records `pr_state: merged` and that actual `merged_sha` under `DEC-TERMINAL-MIGRATION-PR-LANDS-SOLO-WITH-LEDGER-FOLLOWUP`; deployment and authenticated production acceptance remain separate.

**0036 SQL header preservation:** the already-applied SQL and original application receipt remain byte-exact. The SQL's historical Ledger-row and UNAPPLIED comments are preserved because the applier hashes the entire file, including comments. Current merged and applied status is recorded here and in `RESERVATIONS.json`, following the narrow [recovered-application ruling](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1044#issuecomment-6287989702). Do not restamp or reapply the SQL.

### 0042 — Exact saved Exposure scenario references

PR #1144 claims 0042 for the input/reference-only scenario extension through the existing canonical Investigation and pinned-grant lifecycle. The complete 162-open-PR file census found no claim above protected/reserved max 0041; the final incremental head check found only this new PR. Earlier claims 0035/#778 and 0037/#1084 remain untouched. Originally copied reviewed SQL SHA-256 `518b1223386b37eed53f54ba991ff16a5a41749fe59976bf9391e124749d004b`. Current file SHA-256 `2eb41ee7bbfa3b0601e05b211b09a15c3418d1ee0fe7d9b57e7f096e98cb1682` changes rollback guidance only: prose punctuation and an explicit read-only query of the currently installed function bodies, required before a targeted restoration plan and by the existing down-block guard. No automatic restoration is prescribed. Every executable migration statement remains byte-identical to the reviewed candidate.

**Not applied.** This source reservation does not authorize Management API execution, retention, production source-use/destination bindings or recipient grants. Compatible backend and Terminal source ship first with absent bindings refusing protected IO. Any future schema application requires separately qualified authority, exact prerequisites/target/current catalog, the original statement-at-a-time helper receipts and partial-effect reconciliation. Do not replay 0041 or blindly replay this file after ambiguity. Real Save A → inspect B → reopen A and authorized recipient acceptance remain separate.

### Portfolio role label — 0044 / PR #1173 (applied 2026-10-24)

Complete 169-open-PR filename and reservation-ledger census on 2026-10-24 found protected max0042 and incumbent0043 on #804. #1173 claims **0044**, `0044_portfolio_target_role.sql`, for MO-DELTA-003. #804 retains0043; its pending file is not copied here. This additive nullable private label uses the existing portfolio_targets owner policies and grants. It changes no weight, band, holding, drift, alert or execution behavior. The atomic statement accepts the identical catalog shape and refuses conflicting shapes. Application-only rollback retains user text. At source publication SQL was **UNAPPLIED**; the application fact below supersedes that state. Schema application, deployed account and authenticated browser acceptance are separate. Never replay unknown effects or superseded #866/0032.

**0044 application fact:** after protected #1173 merge `424ed4a2c700955dc35354d597611219d8ef6980` and compatible app-first installation, the exact SQL was applied **once at 2026-10-24T20:43:40Z** through the unchanged `supabase_apply/1` helper. Its original receipt is **status `unverified`, exit6, one statement, error null**, with four pre- and four post-readbacks. The helper does not discover ALTER column/constraint objects; this raw verdict is preserved, not rewritten as `applied` or rerun. Original receipt SHA256 `41f412f4aefb96b5349d7f04eb19b8b79f488a706ecca142559aac944e2cdeaa`. The [owning-PR receipt](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1173#issuecomment-6389324788) and [explicitly redacted receipt derivative](../../docs/verification/portfolio-role/0044-apply-receipt-redacted.json) redact only the project reference; the original remains retained unchanged.

[Separate read-only production qualification](../../docs/verification/portfolio-role/0044-production-qualification.json) confirms the exact nullable text/no-default/non-generated column and validated check constraint, with existing columns, constraints, table ownership, RLS, ACL, all policies and triggers unchanged. [Preflight](../../docs/verification/portfolio-role/0044-preflight.json) and [post catalog](../../docs/verification/portfolio-role/0044-post-catalog.json) retain the comparison. The first separate qualification SELECT had a construction-parenthesis error (HTTP400); its corrected SELECT passed without replaying the migration. No owner labels,0030/0042 application, grants, policies, activation or browser actions were performed. Owner Save/read/edit/clear and account-isolation acceptance remain separate and open. The SQL header and bytes retain historical UNAPPLIED wording because the original helper receipt hashes the whole file; this application fact supersedes that historical state, without editing SQL or reapplying it.

### P09 frozen-runtime source reservation

Complete October24 census of 169 open PRs (including all file pages and changed reservation ledgers) preserves 0043 for #804 and 0044 for #1173. [PR #1175](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1175) source merged as `aaa4801db5a7e467c52dd94b4e7aea217be50b23` at **2026-10-24T23:38:23Z**, claiming prefix 0045 for OPTIONS-EXPOSURE-P09-FROZEN-RUNTIME. The accepted lifecycle, atomic hit and prepared intent units are packaged in one atomic statement, with scoped independent review and protected CI passed. **Not applied:** production application, runtime admission and activation remain separate; this merge records no application date.


### 0046 — Source-only exact-attempt frozen enrollment

Follows immutable0045. **UNAPPLIED**: application is false and date is null.
Existing draft1182 retains the0046 reservation. [PR #1182](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1182) source merged as `b1ba8e7c21e8864a0f11f87c4ae6aaab7bb54133` at **2026-10-31T06:31:38Z**; this merge records no application date. The atomic package embeds the
accepted intent-revision unit unchanged, then installs the exact-attempt protocol.
Final schema has ONLY the seven-argument existing arm name; both old five/six-
argument initial-arm bypasses are absent. Initial-only rearm fails closed; existing
state-only generation/revision CAS remains unchanged. No public caller is wired.

The one retained envelope lives on owner-RLS alerts, never authenticated-wide
alert_runs. Other attempts cannot replace/evict it. Owners can read their own pin;
unprivileged writers/JWT role claims cannot forge it. Retained receipts refuse
id/user_id transfer, while deletion loses the receipt and remains UNKNOWN.
Actual service_role trust is unchanged; this is not protection from arbitrary
trusted SQL and adds no definer, role/grant expansion or new store/RPC family.

Only the PREPARE creator may dispatch ARM. Runtime+exact acknowledgment commit in
one transaction. RECONCILE is READ ONLY: absent/PREPARED stays UNKNOWN and cannot
cancel or arm. A DISTINCT explicit FENCE may close only an existing exact PREPARED
slot under the arm lock, including after same-owner edits; absence is not fenced.
Current Auth/account/exact-source checks gate every server action/read. Recovered
COMMITTED outcomes retain original historical runtime, never infer current active
state from current runtime or conflate a later generation with the original ack.

Source tests use only synthetic transport and disposable socket-only PostgreSQL.
They do not apply production SQL or resume/replay an October26 pilot/UNKNOWN effect.
Rollback begins with caller disablement and preserves revisions/runtime/receipts;
never restore an unreceipted arm or replay uncertain execution.
