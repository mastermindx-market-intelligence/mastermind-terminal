# Options matrix Saved Research contract — first vertical

Status: review candidate on existing Investigation PR #804. Save remains disabled.
This document freezes an integration contract; it does not admit an Options owner,
change a manifest validator, apply a migration or certify retained publication.
Root: `01a104c8-6e11-7e52-93c1-6b8dbc45bb9c`.

## Source and custody

- Investigation source before this delta: `0654cf7ad2fb6c5242fe1fc4ffaae3d48b912a7b`.
  Existing kernel/review/raw-ingress holds remain. Migrations 0028/0029/0030
  are untouched by this delta; 0030 remains unapplied.
- Research Lab PR #846 application: `6bd2852f7316865dff487fc159b0976e67f1ee6a`
  (observed PR head `c299a03d`). Its owner retains consumer implementation.
- Matrix proposal: producer root `01a10340-ddc1-7e41-9b42-9c8543c28c3d`,
  `fable-matrix-retention-20261008.md`; inspected Macro source
  `8aa1aca8c593982e722bbc666a221fdd82466f15`. Retention is SPEC_ONLY; the
  incumbent producer owns the #7861/#7293 source-custody reconciliation.
- Rights source inspected: Macro #7870
  `f12db8bff1d1a46a2c9fbf100bed8f6f3abc9ec9`,
  `engine/theme_graph/rights.py` and `config/theme_sources.yml`.
- Protected procedure for the candidate-shape continuation: Mastermind
  `f74e912d3efa3b67cae40ba04f9e558d579096e9` (same compatible Skillpack;
  required execution/reliability/delegation texts unchanged from the previous pin).

## Retention decision: one matrix payload, no separate manifest

For this bounded vertical, **a separately retained manifest is not required**.
This supersedes the matrix-plus-manifest requirement in earlier #804 contract
comment 6070251351. The immutable matrix bytes, reference below, validated payload
schema/root/session and authoritative subject binding establish the matrix
snapshot claim. They do not establish upstream dependency completeness, historical
source rights, first availability, replay correctness or point-in-time knowledge.
Any later vertical making those claims needs the producer's corresponding evidence.
An operational publication receipt is still required to qualify the producer; it
is not a second consumer store or an additional object needed for every read.

The proposed reference convention, awaiting the producer's implemented round-trip
fixture, is:

| Field | Exact first-vertical contract |
|---|---|
| owner | `options_structure.matrix` |
| object_type | `matrix_snapshot` |
| object_id | Canonical producer root, one safe path segment, bound to the Investigation subject by the authoritative underlying owner |
| mode | `pinned` |
| version_ref | `sha256:<64 lowercase hex>:bytes:<canonical positive decimal>:session:<YYYY-MM-DD or unknown>` |
| fingerprint | The same exact payload SHA-256 |

The resolver derives `options_structure/matrix/history/<ROOT>/<SHA256>.json`;
requests never provide a URL or storage key. It enforces a finite producer-agreed
stream byte limit before JSON parsing, then compares actual byte length and hash.
The producer must supply that limit with its runnable fixture; no unlimited read
is admitted in the meantime. Reference length remains at most 256 characters;
byte length must be a positive safe integer with no leading zeros, signs, fraction
or exponent. Extra segments, noncanonical root/date, path escapes and hash mismatch
are refused. Root grammar and authoritative root-to-subject mapping must come from
the producer/underlying owner before admission, not from ticker equality alone.

Payload schema must equal `options_structure.matrix/v1`; its root and validated
source session must match the reference. Producer #7861 at
`c63e9e289d269372ef951ded7a8eb3dbe06e2cbb` emits top-level `session` alongside
`_build_meta.asof_date`. Use a valid top-level session, falling back to the build
metadata only when the top-level field is absent/null; when both are supplied,
both must be valid and agree. `unknown` is allowed only when both session fields
are absent/null and the producer contract permits it. Malformed or contradictory
metadata is refused, never converted to unknown. `available_at` and OI session stay
null when unsupported. Top-level `asof` is build time, never a knowledge clock.
A null/empty matrix may have retained identity but cannot satisfy this vertical's
required primary-coordinate membership and therefore cannot enable Save.

Publish A, then B: A's exact bytes must remain readable. A missing, oversized,
corrupt, wrong-root, wrong-session or unsupported-schema object returns
`HISTORICAL_UNAVAILABLE`, with no current-head, cached-value or nearest-date fallback.
The producer must retain and read back the exact serialized bytes before advancing
its current key; collision or unresolved publication effects remain its owner's
responsibility. This contract creates no publisher, timer or retention policy.

## Closed, versioned selection

A future `investigation_manifest.v3` command carries this closed selection on its
single Options matrix evidence reference. **Current v1/v2 validators continue to
reject it.** Do not encode it inside `selection.field`, continuation text, a layout
blob or the review baseline. All fields below are required and extra keys refused:

```json
{
  "schema": "options_matrix_selection.v1",
  "primary": { "expiry": "2026-10-16", "side": "call", "strike": "600" },
  "comparisons": [
    { "expiry": "2026-10-16", "side": "put", "strike": "600" },
    { "expiry": "2026-10-23", "side": "call", "strike": "605.5" }
  ],
  "view": {
    "lens": "chain",
    "metric": "volume",
    "side": "all",
    "expiry": "all",
    "display_mode": "3d"
  }
}
```

- One non-null primary, zero to three ordered comparisons. Comparison coordinates
  must be unique. The primary may occur once in comparisons: these are distinct UI
  roles and the current consumer intentionally supports that state. Do not silently
  deduplicate or reorder input. The array order determines comparison-card order.
- Root and generation are inherited exclusively from the enclosing pinned evidence
  reference, never overridden by a coordinate. Each coordinate must resolve to
  exactly one admitted cell/side in those exact retained bytes. Ambiguous duplicate
  source cells are refused; there is no nearest-strike/expiry matching.
- `expiry` is a real Gregorian date in canonical `YYYY-MM-DD` form;
  `side` is exactly `call` or `put`. `strike` is a positive canonical decimal string:
  at most 12 integral and 8 fractional digits, no leading zeros except `0.`, no
  trailing fractional zeros, sign or exponent. Grammar:
  `^(0|[1-9][0-9]{0,11})(\.[0-9]{0,7}[1-9])?(?![\s\S])`, with zero refused.
  Its value must match the producer coordinate exactly without rounding or
  approximation. Out-of-range/unrepresentable source coordinates cannot be saved.
  This bounds cross-language serialization without claiming an option-contract ID.
  A concrete retained-membership counterexample is the raw JSON numeric token
  `999999999999.12345678`: JavaScript and Python floating-point parsing produce
  `999999999999.1234`. The original decimal string passes the structural contract,
  but the rounded UI key is not that source identity. The producer/resolver must
  supply and qualify a lossless source representation or refuse that coordinate;
  constructing a purported original identity from the parsed Number is insufficient.
  Do not narrow this structural schema to conceal the loss. The producer owns this
  remaining representation/domain qualification alongside underlying identity.
- `view.lens` is `chain` only; `metric` is `volume`, `openInterest` or `deltaOi`;
  `side` is `all`, `call` or `put`; `expiry` is `all` or an admitted expiry in the same
  snapshot; `display_mode` is `3d` or `table`. No implicit defaults on stored reads.
- A filter can hide a selected coordinate without deleting it. Resolve selection
  against the full admitted snapshot, preserve the saved filters, and show the
  existing outside-filter notice. Axes use that full snapshot, not filtered rows.
  Missing coordinates cause an unavailable selection; do not silently drop them
  and claim an exact restore.
- Camera/pan/zoom, page index, focus element, renderer-failure state, language, IV,
  volatility lens, cross-generation comparison, flow packages and scenario/pricing
  inputs are excluded. Page starts at zero. If 3D cannot render, show the existing
  explicit table fallback while preserving the saved mode preference and selection;
  never silently mutate the saved Investigation to record a device fallback.
- The new envelope keeps v2's 128-KiB byte ceiling, 4,000-scalar question ceiling and
  existing bounded reference/argument counts; the selection itself is at most
  2,048 UTF-8 bytes. Existing v1/v2 rows retain their original read contracts.
  TypeScript, Python and SQL must share positive/negative fixtures before admission.

The Research Lab owner accepted the bounded roles/view scope for coordination and
is repairing comparison display order on its own carrier. This is not acceptance
of a deployed save/restore path. The exact strike encoding still needs the joint
round-trip fixtures alongside the producer reference.

## Current authorization: implemented product seam, missing source-use interface

`terminal/lib/entitlement.ts` now exports `hasLiveOptionsFresh()`. It obtains the
current request's verified authentication via existing `billingAuth()`, calls
Macro `/api/me` with `cache: no-store`, and applies the unchanged
`terminal_live_options` feature / private `unlimited` tier predicate. It bypasses
both the 45-second positive cache and its in-flight promise, and does not seed
that cache. Missing/rejected auth, auth failure, non-2xx, malformed JSON or billing
failure returns false. Existing current-Options read caching is unchanged.

This helper is deliberately not wired to a retained Options route yet. It grants
product access only, not source-use rights, snapshot existence or permission to
export. Its successful unit tests do not prove browser revocation or deployment.

The inspected rights owner offers `load_registry_snapshot()` (fresh bytes and
revision) plus `assert_current_emission_allowed(families, snapshot=...)`. Its
`SOURCE_PREFIX_FAMILY` and registry have no Options matrix/source family. Its gate
models public emission, not a principal-bound snapshot/action decision. An empty
family set is a no-op and MUST NOT be used to turn an unmapped Options source into
a grant. The cached `rights_class()` path is unsuitable for a fresh rights check.
SEC/Earnings public-context permissions do not authorize vendor Options data.
This is a scoped interface finding at the stated pin, not an estate-wide absence
claim or a demand to create a new rights registry.

**Exact missing upstream interface:** the incumbent source-use rights owner must
provide a server-callable decision that accepts authenticated principal context,
the exact producer owner/schema/root/digest (with an authoritative source-family
binding), and action `display` or `export`. The response must bind that request and
return `allowed`, `denied` or `unavailable`, a policy identity/revision, decision
time and applicable registry revision. Missing fields, unknown family, mismatched
principal/snapshot/action, denied or unavailable must fail closed. Display rights
cannot imply export rights. No browser-supplied decision/receipt is authority.

The future resolver must evaluate fresh product entitlement and that source-use
decision before returning matrix values, selection or any export. Authorization
failure withdraws prior displayed values and selection and uses the existing
precise refusal, with `private, no-store` and principal partitioning. Do not call
an authorization failure a missing-history success, and do not reuse a previous
allow. Until the interface is actually supplied and tested, Options evidence is
unadmitted and Save remains disabled; no always-allow or synthetic rights stub is
introduced here.

## Integration order and acceptance

1. Producer returns one implemented immutable reference, exact bytes/readback,
   agreed bounds/root mapping and encoding fixture on its existing carrier.
   Rights owner supplies the exact current decision interface above.
2. Existing Investigation writer implements the explicit v3 contract and Options
   resolver with shared TS/Python/SQL vectors. Allocate an additive migration after
   held 0030 against the actual integration head; do not rewrite 0028/0029/0030.
   Preserve the one store, ownership, CAS, revision lineage and reconciliation.
3. Consumer binds save/reopen only after backend admission/install qualification.
   Keep `apply_investigation_revision_v2`, `read_investigation_operation_v2`,
   `reconcile_investigation_operation_v2` and `read_investigation_v2` as their existing
   owners' interfaces unless that owner explicitly versions an interface. Lost or
   ambiguous responses never justify another operation ID without terminal
   non-applied reconciliation. Reopen does not write a revision or run a producer.
4. Independent review, required CI, merge, installation and authenticated production
   save/reopen/withdrawal proof are separate remaining gates.

Required integrated cases: publish A/save/publish B/reopen A exactly;
missing/corrupt/oversized A; wrong root/schema/session/subject; duplicated source
coordinate; zero/four comparisons, repeated comparison, primary-in-comparisons;
reverse comparison order; hidden selection; unknown view key/unsupported lens;
noncanonical decimal; cached prior entitlement plus current revocation; denied,
unavailable or differently bound source rights; allowed display with denied export;
account switch; lost response; concurrent revision; and read-only reopen. Preserve
zero versus null and aggregate-dollar GEX semantics. No complete G1/G6/G0–G9 claim
follows from this contract or the product-gate tests.

## Source validation for this delta

- Entitlement suite: 27 passed, including 14 added fresh-gate cases. The new cases
  failed before the helper existed, then passed with the implementation. They cover
  cached and in-flight older grants, revocation, principal change, auth failure,
  billing failures, positive recovery, predicate parity and no cache seeding.
- Investigation contract/parity/owner/v2 suites: 181 passed across the focused runs.
  The added boundary case proves that a fixture-only owner allowlist cannot admit
  the proposed selection into v2, and current validation rejects v3.
- TypeScript checking and `git diff --check` passed. The first typecheck found an
  obsolete generated route from the previously selected branch. With no dev server
  using this checkout, those generated types were preserved outside the checkout
  and regenerated through `next typegen`; source route files were not altered.

These checks qualify the new helper and the unchanged admission boundary locally.
No Options source-rights callable was available to test, and no source-rights
success is claimed. Independent review, hosted CI and live integration remain open.

## Candidate-shape qualification after producer agreement

The producer owner accepted the digest/length/session reference and matrix-only
no-separate-manifest scope, with the two-session-field consistency rule above.
This is contract agreement; actual retention, byte limits, root-to-underlying
binding and current source-use rights still require the producer's exact return.

`contracts/options_matrix_selection.v1.schema.json` is the closed candidate shape,
exercised against the same 76 vectors in TypeScript/Ajv and Python/jsonschema.
Both suites pass 77 cases including corpus identity; the existing v2 suite's 16
cases also pass. No input coercion, default insertion, comparison reordering or
silent deduplication is permitted. The schema is consumed by qualification tests
only. It is not imported by a runtime route, and does not establish retained-byte
membership, subject identity, authorization or database admission. SQL parity
remains a later gate for the additive v3 implementation.

The parent reproduced one cross-language defect before fixing it: Python's `$`
regex anchor accepted a final newline in a strike that Ajv refused. The contract
now requires true end-of-input with `(?![\s\S])`; the same counterexample passes
in both languages. The parent also added missing-field, alternate-key-order
duplicate, decimal-limit, Gregorian-century and character-boundary cases.

Fabric leaf `iw2-options-selection-vectors-20261008` supplied 34 of the vectors;
the parent inspected them and added 42 cases. GLM was preferred; the incumbent
router admitted `deepseek-v4.1-flash` on Ubuntu1 under the unchanged root and
C1 mechanical task class. Its retained run receipt proves launch, COMPLETE,
settlement and zero residual processes. Deterministic acceptance was recorded
through the existing adapter after both executable suites passed. The worker
correctly claimed fixture authorship only, with no test execution or descendants.

## Pure reference and source-session decoder

`terminal/lib/investigationOptionsReference.ts` now implements the agreed syntax
and clock consistency as pure functions within the existing Investigation owner.
`parseOptionsMatrixVersionRef` requires exact lowercase digest/fingerprint equality,
canonical positive safe byte length within an explicit producer-supplied bound,
and a real Gregorian session or the exact unknown marker. Extra characters,
whitespace, overlong references, unsafe counts and unsupported date forms refuse.
`readOptionsMatrixSourceSession` refuses malformed or contradictory clocks,
distinguishes absent/null from malformed fields, and inspects the relevant own data
properties without invoking getters. Neither helper performs I/O or certifies the
rest of the payload, source identity, coordinate membership or current rights.

Fabric leaf `iw2-options-reference-codec-20261008` supplied the implementation on
the admitted DeepSeek Flash/Ubuntu1 route, preserving the original root. Parent
wrote the independent tests first, inspected the returned source, and integrated
it only into the existing #804 checkout. All 64 decoder tests pass; the combined
decoder, candidate-shape and existing v2 run passes 157 tests. The earlier Python
candidate-shape suite remains 77 passed. Runtime admission, byte acquisition,
producer limits/root bindings, lossless coordinate identity, current source-use
rights, SQL parity and installation remain separate gates.
