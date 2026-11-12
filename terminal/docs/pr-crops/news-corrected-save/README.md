# News — corrected save (Journey 6 / E5)

A review mark now captures the story's exact evidence basis as seen, written once and never
overwritten. When the source later presents a newer revision, a partial retraction, a re-keyed
report or a new rights receipt, the rail annotates the row while keeping the original basis
visible, and the current revision stays one action away through the existing ladder toggle.
An out-of-order (older) presentation is never an update and never touches the basis.

## What the saved record holds

Each marked story's `basis` entry in the existing `mm.newsReview.v1` localStorage envelope
(owner slot `account:<uuid>`/`guest`, per ticker) stores only feed references:

- `report_key` — `${source}:${source_item_id}` of the marked presentation
- `sequence`, `item_count` — the revision markers as seen at the mark
- `view_revision` — `editorial_view.revision` of that presentation (null when absent)
- `rights` — the snapshot's `rights_basis` copied field-by-field (null when absent)
- `at` — the row's source `received_at` (never the device clock)

No title, teaser, URL or body is stored. The classic `[sequence, item_count]` pair keeps its
E13 semantics (it moves on re-mark); the basis is captured at the first capturing mark and is
left byte-identical afterwards.

## What the two e2e runs prove

- **Run A (corrected save):** marking a story writes the five-field basis; after the source
  serves a partial retraction (sequence 5→9, item_count 3→2) under a new rights receipt, the
  "updated since you saved" annotation shows the ORIGINAL values (revision 5, 3 reports, the
  first receipt) and the Open-current button drives the existing ladder toggle — the story
  detail request renders the current members — while the stored basis still equals the first
  capture.
- **Run B (out-of-order):** after the mark, an OLDER copy (sequence 3) renders no annotation
  and the stored basis is unchanged.

Note on the classic review tag: `classifyStory` (unchanged by this lane) compares only the
pair, so an older out-of-order row still reads "updated" in the pre-existing tag. Journey 6's
out-of-order guarantee lives at the saved-basis layer.

## Crops

Crops are captured by the PROOF lane with `TERMINAL_CROPS=1` (this lane commits no PNGs).
Naming: `<project>-<run>-<step>-<lang>-<theme>.png` — run `a`/`b`, step `annotated` /
`out-of-order`, lang `en`/`zh`. The Terminal ships dark-only (D-W1; light is a specimen), so
`theme` is `dark`.

## Proof run 2026-10-31 (Fabric NEWS-ORCH4-PROOF)

Head `579cb2f425763a08cc3c83867d642bc60ebe2efa`, projects desktop (1440×900) + mobile
(390×844), `TERMINAL_CROPS=1 FLOW_FIXTURE=1` on a reserved port — 4 passed. The proof lane's
spec diff added the `a-before-save` crop step, the Run B `zh` loop, and read-only proof
prints; see EVIDENCE.yml `spec_changes_by_proof_lane`. Fixture identity only (`mm_e2e_wl`
under `FLOW_FIXTURE=1`); the snapshot/ladder routes are mocks, so production SSE delivery is
out of this run's reach.

| journey step | evidence | status |
|---|---|---|
| encounter/inspect (Run A first visit) | `desktop/mobile-a-before-save-{en,zh}-dark.png` | PROVEN |
| save — mark reviewed (Run A) | spec basis assertion + `basis.afterMark` store read in EVIDENCE.yml | PROVEN |
| correction arrives after save (Run A) | in-spec feed switch (route-mocked snapshot) | PROVEN (mocked delivery, not production SSE) |
| reopen — update discoverable, original basis intact (Run A) | `desktop/mobile-a-annotated-{en,zh}-dark.png` + annotation reads + `basis.deepEqual=true` | PROVEN |
| current revision one action away (Run A) | ladder request URL read + in-spec `aria-expanded` assertion | PROVEN |
| out-of-order older copy after save (Run B) | `desktop/mobile-b-out-of-order-{en,zh}-dark.png` + `savedBasis.count=0` + `basis.deepEqual=true` | PROVEN |
| nothing claims an update (Run B, saved-basis layer) | no `[data-news-saved-basis]` element in any Run B crop/read | PROVEN |
| nothing claims an update (Run B, classic pair tag) | classic tag still shows the revised-line (frozen `classifyStory`, spec header note) | UNPROVEN by design — pre-existing layer, unchanged by Journey 6 |
| open-current accessible name EN/ZH | `runA_open_current_aria_{en,zh}` reads | PROVEN |
| focus-visible affordance on the new control | `NewsCatchup.module.css:17` covers `.openCurrent:focus-visible` (stylesheet rule; computed style not asserted) | PROVEN |
| real Supabase sign-in | not exercised (fixture identity) | UNPROVEN |
| production SSE delivery of the correction | not exercised (route-mocked) | UNPROVEN |
| cross-device persistence | not exercised (single browser profile) | UNPROVEN |
| light theme | Terminal is dark-only (D-W1) | NOT APPLICABLE |

