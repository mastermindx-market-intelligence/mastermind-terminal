# `supabase/migrations` — what this directory is, and what it is not

This directory is the **schema source of record** for the shared Supabase project
(`fsldfzlxyavsuwqbceod`). It is NOT a migration runner, and nothing in the deploy chain applies it.

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

Two hard-won rules (see root `HANDOFF.md` §5): strip `--` comments first — the endpoint splits on
`;` and chokes on a `;` inside a comment — and use `curl`, not python-urllib, which gets a
Cloudflare 1010 block.

Because application is manual and per-file, **the files here can be applied out of numeric order,
and have been.** Application status, re-censused 2026-08-21:

| file | object it creates | in production? |
|---|---|---|
| `0001`–`0007` | tables, RLS, policies, indexes | yes (recorded, largely no-ops) |
| `0008_chart_layouts_unique_name.sql` | `chart_layouts_user_name` | **yes** — applied 2026-08-21 |
| `0009_watchlist_symbol_unique.sql` | `wls_watchlist_symbol` | **yes** — applied 2026-08-19 |
| `0010_search_event_stats.sql` | `search_event_stats()` + `search_events_created_at` | **yes** — applied 2026-08-21 |
| `0011_analytics_eid.sql` | `analytics_events.eid` + `analytics_events_eid_uniq` (WS:COMMERCIAL-ACTIVATION CA1A) | **yes** — applied 2026-09-05 UTC via the Management API (see the file's own header) |
| `0012_thesis_objects.sql` | `theses`, `thesis_versions` + `apply_thesis_version_v1()`/`read_current_thesis_versions_v1()` | **yes** — applied 2026-09-06 (raw fallback, see note below) |
| `0013_alert_runs_outbox.sql` | `alert_runs`, `alert_outbox` tables + RLS (Market Ontology F08 packet B-F08-2) | reserved -> merged; **not applied — awaiting readback receipt** |

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
