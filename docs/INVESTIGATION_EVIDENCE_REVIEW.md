# Investigation evidence review

An authenticated user can explicitly compare one saved Investigation revision with the current publication for the same Earnings issuer and event. Opening or refreshing the saved research does not perform the comparison, run Brain, or advance its baseline.

`GET /api/investigations/review?id=<uuid>&revision=<integer>` reads the exact owned revision, resolves its retained baseline with current rights, selects the current owner generation, and separately resolves that retained generation with current rights. The response is private and not cacheable. A missing, denied or stale owner read cannot substitute current content for historical content. A different issuer/event refuses comparison.

The internal projection separates membership, content version, qualifications, current availability, owner exclusions/corrections and numerical interpretation. Removal requires an explicit comparable complete owner census or an owner tombstone. Incomplete pages, top-K sets, unknown inventories and outages do not prove removal. Numerical differences require finite values with the same explicit unit, basis and period/cohort. Missing values never become zero. Transport time is not content identity.

The admitted Earnings owner does not declare complete source inventory or removal records. Its adapter therefore always reports `observed_owner_rows_only`, `removalProofAvailable: false`, and incomplete overall coverage. Individual observed changes remain useful; a whole-evidence unchanged/removal claim is unavailable. Owner correction status applies to owner qualifications, not automatically to every fact.

The bilingual UI shows changed and incomplete observations first, with an all-observed-rows view and bounded pages. Selecting a reviewed version only reopens that exact generation in an edit. The existing explicit Save action advances the Investigation using the expected revision and original operation-receipt path; earlier revisions and baseline references remain retained. A failed comparison or failed exact reopen preserves the old saved baseline.

The original October 4 validation and its limits are preserved in `terminal/docs/verification/iw2-g2/source-verification.json`. That frozen source received scoped backend and repaired UI reviews, 34 focused tests, TypeScript checking, and 18 responsive browser cases. Its hashes and review conclusions describe that historical source only.

The November 9 integration is recorded separately in `terminal/docs/verification/iw2-g2/integration-20261109/verification.json`. It preserves the current journal, Options, reference-only scenario, assessment and watch owners. The review route now uses the existing request-time Investigation API admission gate before auth or owner I/O. Admitted textual denominator facts remain content evidence and are never coerced into numeric differences.

On the current integration, 342 focused tests across 18 suites and full TypeScript checking passed. The actual fixture-backed browser run passed all 24 Investigation cases at 1440x900, 820x1180 and 390x844, with one worker and zero retries. It exercises EN/ZH review, explicit baseline selection and one Save, earlier-revision retention, uncertain-operation and rejection behavior, and the current Analysis source-capture emitter. The mobile case also checks 320px, doubled text, focused controls and no horizontal overflow. Seven new review screenshots and the complete browser log accompany the receipt. The actual Terminal theme is dark; no light-mode coverage is claimed.

These local fixture-backed results do not establish hosted CI or production acceptance. G2 remains pending a real owner-backed authenticated review receipt on the deployed source. No migration or second evidence store is introduced.
