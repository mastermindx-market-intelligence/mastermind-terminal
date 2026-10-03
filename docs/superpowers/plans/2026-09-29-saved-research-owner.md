# Saved Research Owner/API Vertical Implementation Plan

> **For implementers:** Execute test-first in this worktree. Do not apply the migration or deploy this vertical until the authenticated runtime and real-browser proof phase explicitly clears those effects.

**Goal:** Bind International Markets Boards 121–130 to one authenticated Terminal-owned Saved Research identity and write-effect authority, without persisting rendered conclusions, provider payloads, or creating a second evidence, alert, monitor, task, trade, history, or retry plane.

**Architecture:** Add one owner-scoped Saved Research head table plus one immutable mutation-receipt table in the existing Terminal Supabase user-state authority. One security-definer RPC performs canonical validation, optimistic versioning, soft remove/restore, explicit evidence-generation acknowledgement, and transactionally durable idempotency receipts. A Next.js route exposes owner-derived list/detail reads and explicit bounded writes. Evidence qualification and changed-evidence computation remain with the existing International evidence owners; this vertical stores only the last successfully acknowledged qualified generation reference needed for a future diff.

**Source pins:**
- Mastermind protected law: `1405c634d8a0b0d3b05305fdd8d62e7b0b520e93`
- Skillpack INDEX blob: `94d1af402598894372858793a5b1931019c5fa77`
- Terminal source base: `c35b9a1d50ca4960c361645f0300fa9f95158a4e`
- Paper file: `01M3P1TW5Y3XWQC37ADDS8K5AG`, page `p-5-0`, token hash `55dd37b7`
- Paper architecture: Board 124; responsive/theme/locale specimens: Boards 121–130

**Effect boundary:** Repository source, tests, branch, and draft PR only. Migration `0028` ships **UNAPPLIED**. No Supabase apply, production deploy, provider call, alert, monitor, task, trade, or browser-state mutation is authorized by this plan.

---

## Product contract

### Stable saved record

A Saved Research record persists only:

- caller-generated stable UUID record ID;
- user question;
- canonical research context: market scope, tool group, selected measure IDs, period, currency, bounded filters, locale, current view, and return context;
- optional reference to the last successfully acknowledged qualified evidence generation;
- owner-derived lifecycle/version/timestamps.

It must never persist a rendered conclusion, synthesized answer, provider response, entitlement-bearing payload, chart image, or live investment signal.

### Explicit write actions

- `create`: create caller-supplied record ID at version 1.
- `edit`: replace question/context/generation baseline on the current active version.
- `acknowledge`: update only the last-viewed qualified generation reference after an explicit user review.
- `remove`: soft-remove an active record.
- `restore`: restore a removed record.

Every write carries `clientRequestId` and `expectedVersion`. Exact retries replay from the immutable receipt. Reusing a request ID with different canonical content returns `idempotency_conflict`. Stale versions return `version_conflict`; no retry can create a duplicate record.

### Read semantics

- List returns only active owner records, newest first, with a hard bound.
- Detail reads the exact owner record, including a removed record needed for undo.
- Missing and foreign IDs share one 404 response.
- Empty inventory, invalid query, unauthenticated session, and unavailable store remain distinct.
- GET/list/filter/detail never mutate a record or mark evidence reviewed.

---

## Canonical JSON contracts

### `mastermind.saved-research-context/v1`

Exact keys:

- `schema`
- `marketScope`: visible single-line text, 1–64 code points
- `toolGroup`: visible single-line text, 1–64 code points
- `selectedMeasureIds`: 0–24 distinct visible single-line IDs, each 1–128 code points
- `period`: null or visible single-line text up to 64 code points
- `currency`: null or 3–8 uppercase ASCII letters/digits
- `filters`: 0–24 distinct-key `{ key, value }` rows; key 1–64, value 0–256 code points
- `locale`: `en | zh`
- `view`: exact `{ route, inventoryFilter, scrollY, focusTarget }`
  - route is a same-origin absolute path beginning `/`, max 512
  - inventory filter is `all | changed | needs_review`
  - scrollY is an integer from 0 through 10,000,000
  - focusTarget is null or a logical target ID up to 128 code points
- `returnContext`: exact `{ route, query }`
  - route is a same-origin absolute path beginning `/`, max 512
  - query is empty or begins `?`, max 1,024

### `mastermind.evidence-generation-ref/v1`

Exact keys:

- `schema`
- `generationId`: visible single-line opaque ID, 1–128 code points
- `evidenceSetHash`: 64 lowercase hexadecimal characters
- `qualifiedAt`: canonical UTC timestamp with millisecond precision

This is a reference only. Field-level evidence clocks, rights, coverage, qualification reasons, and source payloads remain with the evidence owner.

---

## Task 1: Reserve migration prefix 0028 before writing SQL

**Files:**
- Modify: `supabase/migrations/RESERVATIONS.json`
- Modify: `supabase/migrations/README.md`

1. Add prefix `0028` as `reserved`, with no file/PR yet, packet `INTL-R10-SAVED-RESEARCH`, explicit unapplied fields, and a note naming Boards 121–130 / Board 124.
2. Run the namespace guard and migration-ledger tests.
3. Commit the reservation separately, push, and open a draft PR so the later SQL header and ledger row can carry the real PR number.

## Task 2: Write RED contract and service tests

**Files:**
- Create: `terminal/lib/__tests__/savedResearch.test.ts`
- Create: `terminal/lib/__tests__/savedResearchRoute.test.ts`
- Create: `terminal/lib/__tests__/savedResearchMigrationContract.test.ts`
- Create: `terminal/lib/__tests__/savedResearchLedgerContract.test.ts`

Cover:

- exact context/generation canonicalization and hostile shapes;
- create/replay/idempotency conflict/version conflict/transition conflict;
- list/detail owner boundaries and malformed database response refusal;
- route 401/400/404/409/422/503 mappings and bounded JSON;
- proof that GET paths never call the mutation RPC;
- two-table/one-RPC migration shape, RLS/grants/search path/auth ownership, receipt-first replay, record lock/CAS, soft lifecycle, no conclusion/provider fields, down/readback blocks;
- exact `0028` ledger/header agreement.

Run the targeted test command and capture expected failures for missing implementation/migration.

## Task 3: Implement the TypeScript owner and route minimally

**Files:**
- Create: `terminal/lib/savedResearch.ts`
- Create: `terminal/app/api/saved-research/route.ts`

Implement only what the RED tests require:

- exact canonicalization and wire parsing;
- `applySavedResearchMutation`, `readSavedResearchRecord`, and `listSavedResearchRecords`;
- cookie-session ownership from `createClient()` only;
- bounded GET detail/list and POST mutation route;
- exact top-level request-key validation per action;
- no shared fixture-store edits and no implicit write on reads.

Run targeted tests until green.

## Task 4: Implement migration 0028, still unapplied

**Files:**
- Create: `supabase/migrations/0028_saved_research_records.sql`
- Modify: `supabase/migrations/RESERVATIONS.json`
- Modify: `supabase/migrations/README.md`

After the draft PR supplies its number:

1. Flip `0028` to `taken`, set its filename, PR number, `pr_state: open`, and unapplied status.
2. Add required ledger/rollback headers.
3. Create `saved_research_records` and `saved_research_mutation_receipts` idempotently.
4. Enable RLS; owner-only SELECT for records; revoke direct writes and direct receipt reads from `anon/authenticated`.
5. Add `apply_saved_research_mutation_v1` with fixed search path, `auth.uid()` ownership, request and record advisory locks, receipt replay before mutation, `FOR UPDATE` head lock, canonical JSON reconstruction, optimistic version checks, legal transitions, transactional receipt insert, and canonical result rows.
6. Add explicit commented `-- down:` and `-- readback:` blocks.
7. Keep the migration unapplied.

Run migration contract and namespace tests until green.

## Task 5: Verify, persist, and return for review

1. Run targeted Vitest suites.
2. Run all migration namespace/ledger Python tests.
3. Run full Terminal Vitest.
4. Run lint and build/type validation; record exact environmental blockers rather than bypassing them.
5. Inspect `git diff --check`, source diff, and no-secret/no-generated-file status.
6. Commit and push implementation.
7. Update the draft PR body with Paper board references, exact test receipts, unapplied-DDL boundary, and remaining real-browser proof.
8. Request code review before any merge decision.

## Deferred phase boundary

Not part of this vertical:

- applying migration 0028;
- UI implementation of Boards 121–130;
- live provider/evidence-generation integration;
- changed-evidence added/revised/excluded/removed computation;
- authenticated real-browser restoration, accessibility, and timeout proof;
- production merge/deploy/acceptance.

Those remain the next phase after this owner/API source vertical is reviewed and the DDL application gate is explicitly reconciled.
