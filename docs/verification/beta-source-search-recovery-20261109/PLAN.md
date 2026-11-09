# Exact-source search recovery - 2026-11-09

Parent: the continuing beta-shell bug sweep and Terminal Experience masterplan. Original operation `beta-source-search-read-recovery-20261109-astra-01`; protected base `b387616013f38cce9e467cc7da7b87fd2672718c`. Mastermind procedure pin `ff6d5ab67c3535056d69f603fac0d95c058baad8` and applicable source unchanged.

The browser adapter shared by exact transcript search and comparison currently passes a caller abort signal but has no independent completion deadline. Reproduce a never-returning fetch/body and a noncooperative canceled request before changing it. The required outcome is an actionable retryable unavailable state rather than an endless search, preserving the exact phrase, event scope and strict source-receipt validation. Cancellation must remain AbortError, not an invented no-results result. Retry stays explicitly user-driven.

Implement only the incumbent companySourceSearch request producer; reuse its typed states and the existing component Retry controls. No source/data/API/auth/rate-limit/financial behavior, corpus, scope broadening or publication gate changes. No new request/cache/identity queue or runtime owner.

Proof: failing-before adapter cases; successful, unavailable, canceled, pre-aborted, malformed/scope mismatch, late completion and independent search/compare tests; real component/browser timeout and retry across EN/ZH and contract viewports; TypeScript/lint; one source-bound evidence set and original-branch Ready PR. Continue independent work while actual hosted/protected checks run; deploy only the accepted merge through the beta release owner.

Custody: #1275/#1376/#1385 and other current search-titled candidates were checked and do not own the adapter/component paths; #1375 owns the transcript drawer and is not touched. Initial acquisition returned unqualified; original-operation publisher and mmx-workspace reads reconciled a registered clean workspace at the exact protected base, with no active acquisition process. Acquisition was not replayed. Direct work reason: LOWER_TOTAL_OVERHEAD for bounded adapter regression/repair.
