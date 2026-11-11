# Futures source-to-API bridge

The existing Quote Hub now has an inert-by-default /futures read path for explicitly configured, digest-bound capture-owner publications. No vendor connection or local research-sample fallback is started. The Terminal /api/futures route reuses hasLiveOptions before any upstream request, has no fixture/auth bypass, validates a closed request vocabulary, and returns private no-store responses on all branches.

The server joins raw-byte-bound source gamma/matrix inputs to named-contract futures views. Quotes, source publication, selected expiry and replay remain independently checked. Closed cash sessions withhold gamma rather than comparing live futures against a frozen cash close. This is publisher byte binding, not license issuance or cryptographic proof of a new market-data permission. No account, source directory, credential or production setting was changed.

77 new focused tests passed (62 Terminal source/API and 15 Hub publication); full typecheck passed. The prior hosted CI failure was six translation/gloss findings, not failing futures math; those were repaired and the actual forward-only plain-language guard passed. Browser requalification follows in the next phase; older screenshots are not reasserted after copy changes.

Next: mount the reusable renderer in the existing Options shell at /options/futures, connect user controls and strict state handling to this API, and prove access loss, wrong-root isolation and missing-source behavior in the browser. Independent review/live rights and real production activation remain outside this completed phase.
