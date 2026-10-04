# Investigation evidence review

An authenticated user can explicitly compare one saved Investigation revision with the current publication for the same Earnings issuer and event. Opening or refreshing the saved research does not perform the comparison, run Brain, or advance its baseline.

`GET /api/investigations/review?id=<uuid>&revision=<integer>` reads the exact owned revision, resolves its retained baseline with current rights, selects the current owner generation, and separately resolves that retained generation with current rights. The response is private and not cacheable. A missing, denied or stale owner read cannot substitute current content for historical content. A different issuer/event refuses comparison.

The internal projection separates membership, content version, qualifications, current availability, owner exclusions/corrections and numerical interpretation. Removal requires an explicit comparable complete owner census or an owner tombstone. Incomplete pages, top-K sets, unknown inventories and outages do not prove removal. Numerical differences require finite values with the same explicit unit, basis and period/cohort. Missing values never become zero. Transport time is not content identity.

The admitted Earnings owner does not declare complete source inventory or removal records. Its adapter therefore always reports `observed_owner_rows_only`, `removalProofAvailable: false`, and incomplete overall coverage. Individual observed changes remain useful; a whole-evidence unchanged/removal claim is unavailable. Owner correction status applies to owner qualifications, not automatically to every fact.

The bilingual UI shows changed and incomplete observations first, with an all-observed-rows view and bounded pages. Selecting a reviewed version only reopens that exact generation in an edit. The existing explicit Save action advances the Investigation using the expected revision and original operation-receipt path; earlier revisions and baseline references remain retained. A failed comparison or failed exact reopen preserves the old saved baseline.

Validation and its limits are recorded in `terminal/docs/verification/iw2-g2/source-verification.json`. The backend received independent static PASS. UI review found a late-selection/save-lock race; the repaired host and four regression tests received a scoped independent PASS. Thirty-four focused tests and TypeScript checking pass. Eighteen responsive browser cases cover the original save/readback, explicit review/advance/history in EN/ZH, and existing Brain/ambient regressions at three viewports. The actual Terminal theme is dark; no light-mode coverage is claimed. Mobile also covers 320px width, doubled text and keyboard focus.

These local fixture-backed results do not establish hosted CI or production acceptance. G2 remains pending a real owner-backed authenticated review receipt on the deployed source. No migration or second evidence store is introduced.
