# PR 768 — evidence shadow repository portability

## Qualified repair

The hosted unit suite stopped before its evidence assertions because the shadow repository helper eagerly followed a dangling macro-site-link with statSync. Its actual native capture/validation stage had already passed.

The helper now preserves aliases to their original source entry and omits the unnecessary eager stat/type argument when creating a link. An optional fixture-root argument permits a fully isolated regression; ordinary callers retain the repository root. Product code, native capture owners, proof descriptors, browser packets and historical hashes are unchanged.

## Actual proof

The isolated regression was executed on PR650 with the original helper and reproduced the same ENOENT at macro-site-link before the repair. Its exact report and source hash are retained. The regression exercises a dangling entry, live file and directory aliases, and an overridden nested file; it verifies that source aliases still resolve to original bytes and the override never writes through to the source.

This branch's complete affected reader suites then passed 72 tests, including the regression and actual packet consumers. The five legacy/history-boundary Node cases passed. Route type generation, full TypeScript and scoped lint passed; TypeScript took 42.62 seconds. All 1,941 observed source inputs stayed stable during these checks.

The exact diff against 7d0483c995df95ea76e988029d0c229d2a0e177c has only one changed Terminal file: the evidence owner test. No image or native/browser evidence was recaptured, rehashed, restamped or relaxed. Current descriptors still validate their recorded sources and artifacts, and the negative corruption/source-drift/history tests remain executable.

## Delivery and limits

Publication is a single-parent successor of the exact current head using the existing PR branch and compare-and-swap. The existing automatic merge request is to be preserved and verified; no duplicate enrollment or old workflow rerun is needed. Normal hosted CI and protected queue acceptance remain required. Existing production, source-data and release boundaries are unchanged.

Structured red/green reports, source snapshots, original helper bytes and repair receipts accompany the change. Raw diagnostic logs remain in the owned workspace with a hash inventory.
