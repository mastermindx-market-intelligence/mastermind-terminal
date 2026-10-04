# Investigation evidence review

An authenticated user can explicitly compare one saved Investigation revision with the current publication for the same Earnings issuer and event. Opening or refreshing the saved research does not perform the comparison, run Brain, or advance its baseline.

`GET /api/investigations/review?id=<uuid>&revision=<integer>` reads the exact owned revision, resolves its retained baseline with current rights, selects the current owner generation, and separately resolves that retained generation with current rights. The response is private and not cacheable. A missing, denied or stale owner read cannot substitute current content for historical content. A different issuer/event refuses comparison.

The internal projection separates membership, content version, qualifications, current availability, owner exclusions/corrections and numerical interpretation. Removal requires an explicit comparable complete owner census or an owner tombstone. Incomplete pages, top-K sets, unknown inventories and outages do not prove removal. Numerical differences require finite values with the same explicit unit, basis and period/cohort. Missing values never become zero. Transport time is not content identity.

The admitted Earnings owner does not declare complete source inventory or removal records. Its adapter therefore always reports `observed_owner_rows_only`, `removalProofAvailable: false`, and incomplete overall coverage. Individual observed changes remain useful; a whole-evidence unchanged/removal claim is unavailable. Owner correction status applies to owner qualifications, not automatically to every fact.

The bilingual UI shows changed and incomplete observations first, with an all-observed-rows view and bounded pages. Selecting a reviewed version only reopens that exact generation in an edit. The existing explicit Save action advances the Investigation using the expected revision and original operation-receipt path; earlier revisions and baseline references remain retained. A failed comparison or failed exact reopen preserves the old saved baseline.

Validation and its current limits are recorded in `terminal/docs/verification/iw2-g2/source-verification.json`. The frozen backend received independent static PASS; that verdict does not cover the new UI, hosted CI or production. G2 is not accepted until current-source responsive proof and a real owner-backed authenticated review receipt pass. No migration or second evidence store is introduced.
