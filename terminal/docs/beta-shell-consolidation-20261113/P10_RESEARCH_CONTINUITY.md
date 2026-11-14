# P10A — Research revision and market continuity

Date: 2026-11-14. Assigned owner: ChatGPT2. Status: implemented candidate;
hosted browser, deployed research and the complete P10 family remain open.

## User outcome and bounded scope

A reader can change the shell's market without losing a selected report,
passage, source evidence or local reading position. A deliberate new report,
revision or text window still starts its own verified read. Facet clearing
returns useful results without discarding the submitted search or reloading
private text. Saved questions and Today retain the current market context.

The accepted editorial reader, source-page sheet, source evidence, library
facets, entitlement checks and revision contracts remain their existing
owners. This slice adds no research store, body cache, account synchronization,
public archive, News feed, memory system, authentication or progress lifecycle.
The original PDF continues through its query-free current-original route; it
may differ from the selected text revision and checks access again.

## Inputs, existing design and custody

Mastermind law remains `8323d7a774a72da20d0e4db21c9080398da185e7`.
Protected Terminal inspection remains
`c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`. Relevant original blobs:

| Owner | Source blob |
|---|---|
| ResearchWorkspace | `9357eb9fc5835ba2141047f2b004e682e358826c` |
| Research CSS | `05883986a6dbf2c89ff3c3cd8c2442642eb871cf` |
| member Research route | `0fbd63e747e6df078ef7621a4ac54a6770c50249` |
| readingContracts | `78405575aa380b36bd79f2b61aad2b5f93246f92` |
| readingProgress | `64b656be584c2a01e563ea085aa551f02c295eb3` |
| readingPayloads | `fab994e9fb1c82d2d7d75b0ab4994c6b7272b327` |
| researchLibrary | `7e1614ef0a71ac5cdcb120fbef36c714a68b3fd4` |
| researchOutline | `a10c59d9913df24bc7f5cc30a42c15222941789a` |

Retain the owned stack's newer useReadingScope
`75981ccafc0cab63854812ae73b6a23678784794` and readingProxy
`c54678d7adecaad3c10434a6fbc7c70aa78ab0d5`. Neither is replaced by an older
protected copy. Retain P5's existing Today expectations in the shared test file.

The existing Research design is recorded in Paper file
`01M2WGNCX9475G79JRKJTCM08P`: desktop board reference1QF6 / page p-1U,
phone1QN9-1, token cfd3d65c. The recorded abbreviated desktop identifier is
not expanded into an invented node ID. The shared-shell file
`01M6Y2GT8S3YP4TK052PPESZEC`, page p-2-0, board1RW-0 also contains the
SS04 revision-aware library reference. Root inspected the accepted repository
captures under `terminal/docs/pr-crops/shared-shell-b2-research-editorial-20261104`:
`b2-library-1440-dark-en.png` and `b2-library-390-light-zh.png`. The existing
eight-image synthetic packet and119-test receipt are historical design evidence,
not a new production claim. Keep its editorial composition. The only new CSS
is the library heading's existing-token focus-visible treatment.

### Current Paper boundary

The exact-file Paper read returned UPSTREAM_UNAVAILABLE, retry_allowed=false:
Paper must be running with a file open; login state was unknown. One published
`paper_prepare` through that same carrier attempted to open the known file and
returned PAPER_DOCUMENT_TRANSITION_UNCONFIRMED, retry_allowed=false. No design
mutation occurred and no alternate carrier or repeat was attempted. The
transition remains unconfirmed. This is not proof of a global Paper outage.
New live Paper compositions are deferred; this correctness and filter-recovery
slice uses the accepted design. Larger entry/resume redesign is not claimed.

### Live work remains owned

- Terminal1312 at `e931e69ab8a2acb7138cb99846e022baf94a94d9` owns the
  held retained-page selection repair. Labels merge-on-green and merge-blocked
  retain the migration0051 frozen-membership/namespace release hold. Its
  Research component blob is `a08d8b44d7ea0857dfeef5a894ee97877fdf704c`.
  No held cohort, migration, namespace or release effect is adopted here.
- Terminal1507 at `171b266be7e77efe2d1f02be691c2744d6779f9d` owns the
  public editorial `/research/reports` archive and its Macro11252/Terminal1501
  dependencies. Do not link an uninstalled route or create another archive.
- News1210, Analysis1494's ResearchWorkspaceNav and held Investigation804
  retain their original owners. No News transport, SSE, investigation save or
  chart memory is merged into reading progress. Market Memory keeps its
  existing `/market_memory.html` destination pending a complete owner mapping.

## Implementation decisions

The former route observer compared every query byte. Shell market changes and
equivalent parameter reordering therefore looked like a new private reading.
An accepted request could also publish an older market context after the user
changed it while waiting. The observer now derives a semantic reading identity
through the incumbent raw validation and readingHref contract.

1. Validate raw reading fields before deduplicating. Duplicate pins and malformed
   segment positions remain invalid; a missing/empty document keeps the existing
   library behavior. Never canonicalize an invalid link into an accepted read.
2. The valid identity contains document ID, both hashes, extractor version,
   segmenter version and numeric segment start. Market/unrelated query fields
   and equivalent query ordering do not invalidate it.
3. Publish an accepted reading with the market from the current URL at response
   acceptance. Mark its semantic cursor before pushState/replaceState. Persist
   only the existing market-neutral revision and position tuple.
4. Keep the original request sequence, scope abort, member gate, subject-keyed
   session, response validation and account withdrawal. Catalog and selected
   text continue to be separate reads.
5. Apply the same semantic identity to the mobile source-page focus guard. Keep
   the existing Reader.start and source-page loaded-window behavior unchanged.
6. Clear filters resets topic, institution and visible count to eight. Preserve
   typed/submitted search, ordering, loaded catalog, selected reader and progress.
   Focus the persistent library heading before the conditional button disappears.
7. Decorate only the native Saved questions and Today continuations using the
   existing market helper. Keep the legacy screener and current PDF meanings.

### Required later composition with1312

1312 separates loaded-window `start` from selected-passage `position`. When its
own held cohort becomes eligible, retain both fields: pagination uses start;
the semantic route/focus guard uses position. Its new already-loaded-page
history write must call this context-preserving publisher and mark the semantic
cursor before writing history. Preserve its position progress, evidence clearing,
current-page marker and body identity. A market change changes neither field and
does not reread text. The joined proof must select a second already-loaded passage,
change market, traverse Back/Forward and verify exact pins/position with no body
request. This records a concrete merge obligation, not an invented review gate.

## Verification and honest limits

The initial targeted run reproduced five failures before the product fix:
market-only reread, in-flight acceptance losing context, reordered-pin reread,
and missing Clear filters in EN/ZH. Seventy-one existing cases passed, including
genuine revision changes and duplicate rejection. After repair, all76 cases
passed; all76 passed again after the original synthetic body/catalog/filter
specimens were extracted into one shared `researchReader.ts` fixture. The
clear-filter cases also assert heading focus. Full TypeScript checking, scoped
ESLint, qualifier syntax, whitespace and the nonempty added-lines language guard
passed. The language guard reported only inherited nonblocking findings.

Bounded advisory reviews found no new reader/account/invalid-input acceptance
path. Browser-review findings strengthened the qualifier: a selected read must
carry both exact hashes, both versions, segment and limit without duplicates;
the saved-progress baseline must contain the exact account pointer and segment2,
not merely an empty object that remains equal.

The incumbent authenticated intelligence qualifier adds a Research journey at
1440/820/320px, using the same authority and original synthetic specimens. It
checks delayed current-open acceptance, actual market switching, exact source
page selection, source evidence and return focus, Back/Forward, retained DOM and
progress, EN/ZH light/dark rendering, query-free PDF link, loaded search/facet
clearing, invalid duplicate link and401 withdrawal. Read-only intercepts refuse
mutations and unexpected request contracts. Source hashes and request observations
are captured in the existing artifact. No new runner, workflow or watcher exists.

This new journey has not run locally: the earlier browser permission refusal
remains fenced. Exact published-head hosted proof is still required. Synthetic
authority cannot establish real report access, PDF equality, live source freshness,
production CSP or deployed continuity. Existing entitled-document access must be
exercised after protected release, without inventing a report or account.

## Parent scope and next work

Research entry/resume visual refinement, public reports, News, Market Memory,
held loaded-page selection and real deployed proof remain P10 work. No legacy
report route or engine is archived. Continue P11's existing Portfolio composition
and other available path-disjoint work while owned CI and release controllers
run. The full P0–P17 acceptance in PLAN.md remains binding.

## Inherited Monitor failure and original-carrier repair

Run43589674862 on this PR's original head
`b71c0f9fa8be8c33dab72aaf5704b73fc19e867c` produced failed artifact14111344676.
Its exact candidate tree and archive/report hashes are recorded in
[the P9 repair receipt](P9_MONITOR_EVIDENCE_DESK.md#committed-market-navigation-repair--14-november).
It stopped at Monitor's Canada/China destination mismatch after 12 completed
cells, before this Research journey. The result is not Research browser proof.

Compose original P9 carrier commit `37bf903cd7fbba20dc46b819dcbcc9a91a12d7ff`
(tree `dc9f44afe91b85ac016de2ad7aea038fe7c70644`) as an additional parent,
preserving all Research source, reader, fixture and acceptance assertions.
The change reflects Next's committed URL in Monitor and waits for actual
destination attributes in the existing qualifier. No report source or Research
reader lifecycle is changed. New-head hosted proof remains owed; the failed
artifact is retained truthfully and is not replayed or relabelled.

## Pinned research request fixture repair — 14 November

The repaired Monitor is now proven by its 27-cell exact-tree receipt in the P9
document. Research's next hosted result fails truthfully at source page 3:
`#research-segment-2` is absent and the reader displays selected-revision
unavailability. This is not accepted Research or Portfolio browser proof.

| Receipt | P10 | Inherited P11 |
|---|---|---|
| Candidate | `b80e58a2b254ed49eb9e573c1131cf09e13e18af` | `a310840a858fab271a429b40065913f40cb46fb2` |
| Run / artifact | `43593646783` / `14113999081` | `43593801870` / `14114555466` |
| Test checkout | `fbbdd8dda4b9a3015410bcee8dc5974c8d46f96a` | `7f6c98c5f858ff85dafe8ffd04f5001ada192a6a` |
| Exact candidate tree | `8bf8905ea89edfb581272a9623c2a693c7e1b2da` | `8ca88896cbe77154a3215a6708682eb7df6e669b` |
| Archive SHA-256 | `4cb92fad24c374a08d6316124b5cb3209f462c03d63bf3b3553177e4b51a3f2c` | `b2c0e7b509b6ae96549d9f76d81808f263f2967d321f869ba5fef1de7de90b53` |
| Report SHA-256 | `a2acd283d81f17cad963d6f550865aea1c1faec0517e59f87a0d43e6bd3bedb4` | `e4a1185e2c84575316e6893009b40ab95f84f437fdf5f466a197d83869e72234` |

All 76 P10 and 85 P11 input hashes match their exact candidate files. Both
receipts stop after 13 completed cells, with no browser errors, external
requests, fixture writes or tracked changes; owned children closed. Root
inspected the P10 failure capture.

The qualifier expected six fields on pinned HTTP reads. The incumbent
`researchReadQuery` and `readingProxy.READ_PARAMS` admit four: the source-PDF
hash, extracted-text hash, segment start and maximum segments. Extractor and
segmenter versions remain part of URL/progress identity and response validation;
they are not API query fields. The fixture incorrectly returned400 to the correct
request. Remove only those two fields from the fixture's expected request. Keep
the strict key count, duplicate rejection, both hashes and segment bounds.

Strengthen the existing mounted source-page test to assert the exact four
outgoing keys. Reader, API, full revision pins, returned-version checks, exact
passage assertion, history, account withdrawal and zero-extra-read assertions
remain unchanged. New-head hosted proof must reach and complete the original
Research journey; no timeout or acceptance assertion is relaxed.

Canonical failures: [P10 run](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43593646783),
[P11 run](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43593801870).

Local repair verification: the existing reading payload, strict proxy and mounted
reader suites pass 145 cases in three files; scoped lint, JavaScript syntax and
diff checks pass. No local browser launch or hosted rerun was made.
