# MedTech R14 personal watches

This backend supplies account persistence for the [R14 Watchdesk and Event workflow](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-1K-0). The source and regulatory-action meaning remain owned by Macro's `/api/medtech` read API.

## Account behavior

A watch targets one exact FDA event or one PMA application and its supplements. It does not reuse a stock symbol row, workspace preference blob or a general alert symbol. The source API verifies a new subject at the user's selected snapshot before persistence.

The database stamps the baseline at creation. Retrying the same watch preserves that baseline even after the source generation advances. The HTTP API requires the expected watch version for edits and deletes, so a stale tab cannot overwrite a newer edit. Each account is limited to 50 watches; a PostgreSQL advisory transaction lock enforces the final slot under concurrent insertions.

A review acknowledgment names one exact event/revision in a current, subject-scoped source response. It cannot silently acknowledge every future change. A later revision remains unread. This backend provides an on-demand update feed; it does not claim email, push or commercial-event delivery.

The tables store personal selections and review intent. An authenticated owner can write its own well-formed reference hashes directly through Supabase; these remain untrusted personal input. The update feed attaches review intent only to exact event/revision pairs returned by Macro. SQL enforces ownership, event/family membership, clocks and immutability. Regulatory facts and valid source revisions come from Macro's published evidence.

## API

Browser writes use the canonical `https://app.mastermind-x.com` origin declared by the existing Caddy deployment. A Next.js loopback request URL does not reject a valid browser request, and request/forwarded host headers cannot add trusted origins. Exact loopback origins are accepted only outside production. The upstream defaults to `https://www.mastermind-x.com`; the exact legacy apex alias is canonicalized before sending the verified bearer. Redirects remain forbidden.

| Endpoint | Behavior |
| --- | --- |
| GET /api/medtech/events and /events/{id}[/changes] | Bounded authenticated proxy to the existing paid Macro boundary |
| GET /api/medtech/health | Source capability/availability read |
| GET /api/medtech/watches | The verified account's watches |
| POST /api/medtech/watches | Create subject_type,subject_id,triggers,snapshot_id |
| GET/PATCH/DELETE /api/medtech/watches/{id} | Read; edit triggers with version; delete with version |
| GET /api/medtech/watches/{id}/updates | Updates after the saved baseline, with exact revision review state |
| POST /api/medtech/watches/{id}/reviews | Acknowledge event_id,revision_id,snapshot_id |

Writes require a matching Origin and JSON content type. Caller Authorization/cookies are not forwarded to Macro: the BFF verifies the exact existing server session token with Supabase and uses that token. Source responses, query surfaces, request bodies and timeouts are bounded. Errors are coarse and private/no-store. Failed saves/reads are 503 states, not a successful empty watch list.

The consumer must keep its last displayed state on an unavailable response, refetch a coherent list/detail generation on 409, and present review state only after acknowledgment succeeds. The UI itself is separate from this backend addition.

## Database

`supabase/migrations/0037_medtech_watches.sql` adds only:

- `public.medtech_watches`: typed subject, triggers, immutable baseline references/time, edit version.
- `public.medtech_reviewed_changes`: exact event/revision review receipt, attached through an owner-matching composite foreign key.

Both tables force RLS. The migration clears all prior/default grants for anonymous and authenticated roles, then grants the intended account operations. Authenticated users have no TRUNCATE, REFERENCES or TRIGGER privileges, and cannot UPDATE review receipts. No service-role key or new authentication scheme is introduced. The whole migration is one idempotent DO statement, compatible with the existing statement-at-a-time Management API applier.

The refreshed namespace census at 2026-10-20T02:22:56Z covered all 160 open PRs, 5,388 changed paths and all seven changed ledgers at exact heads. Master e66b4cb73193a8715440cb10d1f70ab9d50751fd retained the same migration ledger and maximum 0034. No open claim used 0037; this migration is owned by PR1084. Existing 0035/#778 and 0036/#1044 claims are preserved verbatim; this work does not alter their release conditions.

Production application is separate from source merge. The existing procedure is `scripts/supabase_apply.py` dry-run, authorized apply, then exact pre/post catalog receipt before marking the application ledger. No `supabase db push` or whole-ledger migration replay is used.

## Verification

- `cd terminal && npx vitest run lib/__tests__/medtechServer.test.ts lib/__tests__/medtechWatches.test.ts`
- `python3 scripts/qualify_medtech_watches.py`
- `python3 scripts/supabase_apply.py supabase/migrations/0037_medtech_watches.sql --dry-run`
- `python3 scripts/check_supabase_migration_namespace.py`
- The existing TypeScript/Next build and CI gates.

The SQL qualifier creates a disposable local PostgreSQL cluster with synthetic account IDs, no network listener, and no inherited PostgreSQL target/credentials. It installs broad default table grants, applies the actual migration, restores broad grants and reapplies the migration. It proves privilege narrowing and refusal of TRUNCATE, RLS, immutable baselines, version conflict behavior, event/family review scope and deletion cascades; it also races separate connections for the 50th watch. It stops/removes its own cluster on completion. This is not a production application receipt.

The [gateway qualification receipt](evidence/medtech-r14-gateway-qualification-20261020.json) records 28 passing focused tests, full TypeScript checking, and five old-code regression failures for origin and gateway behavior. The [local SQL qualification receipt](evidence/medtech-r14-sql-qualification-20261020.json) records 25 passing checks and the exact migration/qualifier hashes. A negative control using the earlier migration fails at the strengthened privilege check. The migration namespace suite passes all 97 tests in PR #1084 mode.

The source qualification used 57 real FDA baseline records. Synthetic source changes prove deduplication and revision behavior; they do not prove a new live FDA correction occurred during this session.

## Remaining release proof

Connect this account consumer only to a deployed compatible Macro read API. Confirm authenticated paid-account reads and save/reload/review on the deployed Terminal. Persistent source refresh, preserved saved briefs and delivered alerts each require their own completed consumer proof; none is implied by creating these tables.
