# Lane 6 — Sector Intelligence investigation contract (2026-11-09)

Branch `claude/ssd-si-lane6-348496b978466f6e` (packet SI-P16-LANE6-INVESTIGATION-ADMISSION).
What this note freezes: the wire contract a Sector Intelligence reading uses to become a
durable Investigation v2, the actor fence that governs it, the distinct outcomes every
client must distinguish, migration `0052` (renumbered from 0049, which PR #1290 holds) (source only — **no migration has been applied
by this lane**), and the exact operator step still required.

The store is the EXISTING Investigation v2 stack — manifest, command/RPC/receipt tables,
immutable revision history, journal, evidence-diff, layout snapshot, annotations, watch and
alerts owners. Lane 6 added identity/admission pairs, fence semantics, action components
and probes only. No new store, queue, retry system or alert transport exists.

## 1. Command template (real field names)

Save a Sector Intelligence reading:

```http
POST /api/investigations
x-mm-investigation-owner: <authenticated user UUID>
content-type: application/json

{
  "id": "10000000-0000-4000-8000-000000000001",
  "operation_id": "20000000-0000-4000-8000-000000000001",
  "expected_revision": 0,
  "action": "create",
  "manifest": {
    "schema": "investigation_manifest.v2",
    "intent": {
      "title": "Financials leadership",
      "question": "Is the 63-session leadership supported by participation?",
      "subjects": [
        { "kind": "sector", "owner": "macro.sector", "object_id": "xlf" }
      ]
    },
    "layout_refs": [],
    "thesis_refs": [],
    "evidence_refs": [
      { "owner": "macro.sector", "object_type": "sector_observation",
        "object_id": "xlf", "mode": "pinned",
        "version_ref": "<macro.sector generation_id>",
        "fingerprint": "<content_sha256 of the native receipt>" }
    ],
    "continuation": {}
  }
}
```

Admitted identity/evidence pairs (packet §3.2, `INVESTIGATION_ADMISSION` in
`terminal/lib/investigations.ts`):

| Role | Owner | Kind / object_type | object_id grammar |
|---|---|---|---|
| Subject | `macro.sector` | `sector` | exact admitted native cohort id — the 11 ids `xlb xlk xlc xly xlf xli xle xlv xlp xlu xlre` (`SECTOR_INVESTIGATION_COHORT`); no ticker/name guessing |
| Subject | `theme_graph.identity` | `theme` | owner-resolved `theme:<slug>` (`theme:[a-z0-9][a-z0-9_]{1,62}`) |
| Subject | `theme_graph.identity` | `basket` | owner-resolved `basket:<suite>:<token>` where `<suite>` ∈ `baskets, baskets_china, baskets_china_ths, baskets_hk, baskets_canada, baskets_intl` (Finviz classifications are NOT baskets) |
| Subject | `theme_graph.identity` | `company` | `co:<market>:<token>` with market ∈ `us, cn, hk, ca, intl`, optional `#<n>` disambiguator (e.g. `co:us:AAPL`, `co:us:AAPL#2`) — never reinterpreted as security/issuer |
| Evidence | `macro.sector` | `sector_observation` | exact native subject id |
| Evidence | `macro.sector` | `basket_observation` | exact owner-resolved basket id |
| Evidence | `theme_graph.curation_assertion` | `curation_assertion` | `ev:<16hex>` |

Initial new evidence is **pinned-only**: `mode: "pinned"` with BOTH `version_ref` AND
`fingerprint` required; `selection` is omitted until a closed per-type selector vocabulary
exists; `thesis_refs` stays empty for saves; no JSON state hidden in
title/horizon/`selection.field`/`object_id`.

Pinned-version semantics per type:

- `macro.sector sector_observation` — `version_ref` = owner `generation_id`,
  `fingerprint` = native receipt `content_sha256`.
- `macro.sector basket_observation` — `version_ref` = the macro.sector generation token
  of the publishing projection, `fingerprint` = `content_sha256` of that real coherent
  published projection (never a static/label substitute).
- `theme_graph.curation_assertion curation_assertion` — `version_ref` = curation revision
  `gmirca_<32hex>`, `fingerprint` = native digest `sha256`.

Identity seam: finance-research `sector:financials` and native `xlf` are DISTINCT owners.
They join only through an explicit versioned owner crosswalk, never label/prefix
conversion; a `sector:financials` object_id under `macro.sector` is rejected by both the
TS and SQL validators.

## 2. Actor fence (§3.3)

`x-mm-investigation-owner` is an **expected-actor concurrency fence, not authentication**.
The authenticated session stays the sole owner authority:

- A present header must name the authenticated UUID (trim-tolerant), else `owner_mismatch`
  (HTTP 412) with **no database I/O**.
- Sector/GMI use — any `macro.sector`, `theme_graph.identity` or
  `theme_graph.curation_assertion` owner in subjects, evidence or review baseline —
  **requires the header outright**. Legacy first-party clients that never send it keep
  compatible behavior.
- `owner_mismatch` never joins the definitive-save-failure set. After an earlier lost
  save it stays **uncertain**; the original actor's journal is retained and reconciled
  when that actor returns. A different actor's `recover` returns nothing.

## 3. Outcome table (all outcomes are tested — suite / test names)

Definitive failure set (a rejected save, safe to surface as failure):
`invalid_payload, version_conflict, idempotency_conflict, invalid_transition,
reference_unavailable, layout_conflict, limit_reached`.

| # | Outcome | Classification | Suite test |
|---|---|---|---|
| 1 | Lost reply (transport error on save) | uncertain — never "failed"; exact sent command retained | `investigationSectorSave` "a lost reply and a later status not_found both stay uncertain, retaining the exact sent operation" |
| 2 | Status `not_found` after lost response | uncertain (the save may still land later) | same test + `sectorIntelligenceActions` "keeps a lost save unconfirmed … settles on the committed receipt" |
| 3 | `version_conflict` | rejected (definitive), current revision visible | `investigationSectorSave` "version_conflict rejects definitively with the current revision visible" |
| 4 | Actor switch: `owner_mismatch` after earlier lost save | uncertain — earlier operation unproven; original actor's journal kept; other actor's recover = null | `investigationSectorSave` "owner_mismatch after an earlier lost save stays uncertain and never proves the earlier operation failed" |
| 5 | Same-actor access loss (`unavailable` / `auth_expired`-shaped / malformed reply) | uncertain; same-principal partition keeps state | `investigationSectorSave` "same-actor access loss keeps the state; unavailable, timeout-shaped and malformed replies are all inconclusive" |
| 6 | Partial note/watch success | each effect independent: note "Saved" AND watch "Alerts unavailable" both visible | `sectorIntelligenceActions` "keeps note and watch independent … (partial success stays visible)" |
| 7 | Installed-SQL preimage mismatch | migration refuses to run (md5 guard) | `investigationSectorAdmissionMigrationContract` "guards on the exact 0047 body before touching anything, refusing the installed 0040 and the 0042 shape" |
| 8 | Invalid generic admission probe (Options-shaped placeholder for a Sector pair) | probe invalid — NOT proof of service absence | `investigationSectorAdmissionMigrationContract` "carries a valid minimal example for each new type, cross-checked against the TS validator" |
| 9 | Native `xlf` vs `sector:financials` seam | rejected as subject/evidence mismatch | `investigationSectorAdmission` "sector and theme-graph subjects validate on their owner-resolved id grammars" (seam case) + migration contract cross-check |

Fence truth table and closure (never a rejection from fence/availability):
`investigationSectorAdmission` "decides the fence truth table…" and "classifies the fence
owners and never authenticates"; `investigationSectorSave` "keeps the definitive-failure
set closed: no fence or availability status can reject a sector draft".

The UI keeps a **"Check save status"** control and deliberately has **no Replay button** —
the receipt is the sole retry authority.

## 4. Action components (path-disjoint, props-only)

`terminal/components/sector-intelligence/actions/` —
`SaveInvestigationButton`, `CheckSaveStatusButton`, `ArmWatchControl`, `SymbolNoteField`
(+ `actions.module.css` on shared tokens). Props-only interface: no LEX import; all
strings arrive via `copy: Record<"en" | "zh", …Copy>` props; `lang` prop selects. Save
availability requires actual schema/admission readback (below) — a generic placeholder
returning false is not proof of service absence.

Wire reuse (no new owners):

- **Save / status** — `POST /api/investigations` and
  `GET /api/investigations?operation_id=<uuid>`, both carrying
  `x-mm-investigation-owner`.
- **Watch** — `POST /api/alerts` with `{ symbol, condition: { type: "price", op, value,
  evidence: { investigation_id, revision } } }` via the incumbent pure builder
  (`buildWatchCondition`). Only `price_touch` is offered; **new Sector alert predicates
  are UNAVAILABLE**. Watch membership, investigation save, trigger and delivery are
  separate effects.
- **Note** — `POST /api/watchlist/annotations` with
  `{ writes: [{ symbol, field: "note", value, baseRevision }] }` and
  `x-mm-annotation-owner`; conflict shows the other text, transport failure keeps the
  draft pending.

## 5. Migration `0052` — source only, UNAPPLIED

File `supabase/migrations/0052_sector_intelligence_investigation_admission.sql`;
reservation `0052` / packet `SI-P16-LANE6-INVESTIGATION-ADMISSION` in
`supabase/migrations/RESERVATIONS.json` (state `taken`, `pr_state open`, PR number
backfilled at PR creation; `applied` false — **no application has occurred, so the applied
date is not recorded**).

Composition and preimage assertion: the migration widens the installed
`valid_investigation_manifest_v2(jsonb)` by exactly three deltas over the **actual 0047
body** — (a) four subject pairs (macro.sector `sector` with the exact 11-id native cohort
in-list; theme_graph.identity `theme`/`basket`/`company` grammars), (b) the evidence
allow-list additions `macro.sector {sector_observation, basket_observation}` and
`theme_graph.curation_assertion {curation_assertion}`, (c) per-type pinned-only rules
(`version_ref` AND `fingerprint` required for the three new types; `selection` omitted).
It also ships per-type minimal probe examples for
`investigation_evidence_admitted_v2` and a new `investigation_subject_admitted_v2`, plus
authenticated-only grants and guarded `service_role` revokes. No table/policy/row DDL; one
`begin`/`commit`; guarded down block restoring the exact 0047 bodies.

Preimage md5 pins (prosrc, whitespace-collapsed recompute — pinned in
`investigationSectorAdmissionMigrationContract.test.ts`):

| Validator body | md5 |
|---|---|
| 0042 shape (refused) | `1e130e4c930163ecc4d3e6c17b5c8395` |
| 0047 body (required preimage) | `a554c15c1ae58dfbd34d04bcda9b5e48` |
| 0052 widened body (this migration) | `75f2b7feba6b3c9f177f4cda6c3605e9` |

The guard refuses the installed production 0040 body and the 0042 shape; recomposition
over any other preimage requires a new prefix.

**Exact operator step still required (no migration has been applied by this lane):** on
the installed production ledger (0040 applied; 0042 and 0047 merged but UNAPPLIED), the
operator applies **0042, then 0047, then 0052 — each explicitly, one request per file**.
Never apply the entire migration directory, never edit or reapply 0028, and never two
files in one request. Readback receipt after applying 0052 (queries are embedded as
comments in the file): the three function replacements, `stable security definer
search_path=''` on both probes, authenticated-only ACLs, both md5 readbacks, and the two
refusal probes (`sector:financials` object_id, `selection` on a pinned-only type) still
rejecting. Emergency rollback is the file's guarded down block, in one transaction.

Until 0052 is applied, both probes honestly report unavailable —
`GET /api/investigations?admission=macro.sector:sector_observation` returns 503
`unavailable`, and the new `GET /api/investigations?subject_admission=macro.sector:sector`
likewise 503. UI save availability must key on these readbacks, not on assumption.

## 6. Parity and tests

TS (`terminal/lib/investigationContracts.ts`) and Python
(`api/investigation_manifest.py` via `api/investigation_contracts.py`) validators are
pinned by the SAME corpus
`terminal/lib/__tests__/fixtures/investigation_manifest_vectors.json` (80 vectors);
v1 rejects all v2-only kinds in both suites. Suites: `investigationManifestParity`,
`investigationSectorAdmission`, `investigationSectorAdmissionMigrationContract`,
`investigationSectorSave`, `sectorIntelligenceActions`, plus the incumbent
`evidenceOptionsAdmission` / `optionsSelectionMigrationContract` regression guards and
`tests/test_investigation_manifest.py` / `tests/test_supabase_migration_namespace.py`
(Python).

Former divergence CLOSED (v1.1 delta): `api/investigation_contracts.py` now admits the optional
top-level `review` object with the TS/SQL rules (closed assessment `confirmed|contradicted|inconclusive`,
optional 64-lowercase-hex `fire_event_id`, optional single-purpose `note` up to 2000, no other keys)
and the shared corpus gained nine `review` vectors (admit, v1-shape reader, and six refusals) that both
suites execute. `review` stays distinct from Prophet's `user_decision` (Pass is never `review`).
