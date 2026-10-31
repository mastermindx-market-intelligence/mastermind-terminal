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
