# `scripts/supabase_apply.py` — how to apply a migration with receipts

## 1. What this is and is not

This is a **reviewed wrapper** around the one Management API call documented in
`supabase/migrations/README.md` (the `POST …/database/query` curl). It is **not**
a migration runner: it does not track which files have been applied, it applies
exactly one named file per invocation, and it grants no authority on its own to
run `--apply` — applying DDL against the shared project remains an out-of-band
Meta-CEO act per `DEC-SUPABASE-MIGRATION-NAMESPACE-TERMINAL-LEDGER-2026-09-06`.
This tool exists to make that one manual act safe and receipted, not to replace
the decision of when to make it.

## 2. The two hard-won rules it encodes (root `HANDOFF.md` §5)

1. **Strip `--` comments before sending SQL to the endpoint.** The endpoint
   splits the query on `;`, and a `;` sitting inside a comment corrupts that
   split. `strip_sql_comments` / `split_statements` are quote- and
   dollar-quote-aware so this never mangles a string literal or a function
   body.
2. **Talk to the endpoint with `curl`, not `urllib`.** `python-urllib` trips a
   Cloudflare 1010 block on this host; `CurlRunner` shells out to `curl` via
   `subprocess` instead, with the token passed on stdin via `--config -` so it
   never appears in `argv` (world-readable via `ps` on a shared host).

## 3. The receipt protocol — never update the README table first

```
python3 scripts/supabase_apply.py supabase/migrations/00NN_x.sql --dry-run
python3 scripts/supabase_apply.py supabase/migrations/00NN_x.sql --apply --receipt /tmp/00NN_receipt.json
```

1. Run `--dry-run` first. Paste nothing yet — this step has made no network
   call and proves nothing landed.
2. Run `--apply --receipt <path>`. Paste the **receipt JSON** on the PR — it
   carries the pre-apply and post-apply catalog readback, not just a claim
   that the apply "worked".
3. **Only after the receipt is posted**, update the application table in
   `supabase/migrations/README.md`. Never the other order — the receipt is the
   evidence the README row exists to summarize.

## 4. What the guards refuse, and why

There is no `supabase_migrations` ledger (`DSC-TERMINAL-HAS-NO-MIGRATION-LEDGER`):
nothing records which files already ran, so every file must answer that
question about itself, every time it is applied. The guards enforce that:

- **`CREATE TABLE`/`INDEX`/`POLICY`/`TRIGGER` without an `IF NOT EXISTS` /
  `duplicate_object` / `DROP … IF EXISTS` guard** — refused. Without a ledger,
  a second run of the same file must be a no-op, not an error.
- **No `-- down:` block** — refused. A file that does not say how to undo
  itself cannot be safely retried either.
- **No `-- readback:` block, or an empty one** — refused. Without a query that
  proves the objects exist, there is nothing for `--apply` to check against.
- **`--allow-legacy` outside `0001`–`0010`** — refused. The waiver exists only
  for the files that predate this convention.

## 5. `--project-ref` — the stale-`.env` guard

Both `--dry-run` and `--apply` accept an explicit `--project-ref <ref>`. It is
never the only source of truth: `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`
(env, or `charting-app/.env`) still have to resolve to a real token and ref,
and the override must **match** the resolved ref or the run is refused —
`--project-ref wrongref does not match the resolved ref 'realref' -- refusing
(stale .env guard). Nothing was sent.` This exists so a stale `--project-ref`
typed at the command line can never silently target the wrong Supabase
project — the resolved `.env`/env pair is what actually gets used, and a
mismatch is a hard refusal, not a warning. `--dry-run` honours the same check
(round-3 minor 3) even though it makes no network call, so both modes behave
identically for this flag. If `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`
are not both set at all, `--dry-run` still proceeds (it needs no credentials)
but prints a `note:` line saying the override could not be checked against
anything — that is not the same as a passed guard.

## 6. The 401 playbook

A Supabase Management PAT expires roughly 30 days after it is minted
(`DSC-SUPABASE-MANAGEMENT-PAT-EXPIRES-AT-30-DAYS`). An HTTP 401 here means
**rotate the token**, not debug this script or the migration: mint a fresh
`sbp_…` value and update `charting-app/.env`.

## 7. Transaction-wrapped files

A file that opens with `begin;` and closes with `commit;` (e.g. `0014`) is
still sent to the Management API **one statement at a time, same as any other
file** — `--apply` never wraps multiple statements into a single POST. The
Management API splits the query body on `;` on its own, so a single POST was
never actually one transaction either way, and sending the whole file as one
request would also make a mid-file failure unreportable (there would be no
way to say which statement inside it failed). `apply_mode` in the receipt
always reads `statement-at-a-time`; it never claims an atomicity the tool
does not provide. The `begin;`/`commit;` wrapper itself is still sent as
ordinary statements — it is a no-op against a connection that only ever sees
one statement per request, and it costs nothing to leave in the file.

## 8. Worked example (`FIXTURE_0013` from `tests/test_supabase_apply.py`, `--dry-run`)

There is no `0013_alert_runs_outbox.sql` on disk yet (migrations on disk stop
at `0010`) — this repo's own idempotent 0013-shaped test fixture is written
to a temp file and run through the real CLI below. Anyone can reproduce this
exact transcript at this file's current head; nothing here is hand-typed.

```
$ python3 - <<'PY'
from pathlib import Path
from tests.test_supabase_apply import FIXTURE_0013
Path("/tmp/mo_readback_fixture.sql").write_text(FIXTURE_0013)
PY
$ python3 scripts/supabase_apply.py /tmp/mo_readback_fixture.sql --dry-run
supabase_apply -- /tmp/mo_readback_fixture.sql
project: <unresolved: no credentials -- dry-run does not need them>    mode: dry-run
sha256:  01d9fcd4f57b9f988c867336f02c7ba1944312617e76d3664c610a7a6c18a151
guards:  re-runnable OK · down block OK · readback block OK
apply mode if run: statement-at-a-time

statements that WOULD run (3):
  [01] create table if not exists public.alert_runs ( id bigint generated always as identity primary key, c …[truncated, full statement in receipt/-- readback --]
  [02] create unique index if not exists alert_runs_id_key on public.alert_runs (id)
  [03] do $$ begin create policy alert_runs_read on public.alert_runs for select using (true); exception wh …[truncated, full statement in receipt/-- readback --]

readback query that WOULD run (3 statements):
  [01] select c.relname from pg_class c where c.relname = 'alert_runs'
  [02] select c.relname from pg_class c where c.relname = 'alert_runs_id_key'
  [03] select polname from pg_policy where polname = 'alert_runs_read'

objects this file should create (3): table alert_runs · index alert_runs_id_key · policy alert_runs_read

no network call was made.
```

`sha256: 01d9fcd4f5…` is `hashlib.sha256(FIXTURE_0013.encode()).hexdigest()` —
anyone can check this transcript is genuine by hashing that same string.
`project:` shows `<unresolved: …>` (not a real project ref) because this
session has no `SUPABASE_ACCESS_TOKEN`/`.env` configured, which is exactly
what frozen rule (b) requires: `--dry-run` never needs credentials and never
makes a network call.

Statement `[03]` keeps its `do $$ begin … end $$;` wrapper intact byte for
byte — the scanner is dollar-quote-aware end to end (round-1 blocker fix).

See the PR body for a real transcript run against a file actually on disk,
the `0010_search_event_stats.sql` refusal (it has no `-- down:`/`--
readback:` block — a correct exit-3 demonstration of the guard, not a bug).
