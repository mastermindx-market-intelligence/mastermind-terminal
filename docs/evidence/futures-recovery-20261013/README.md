# Futures recovery and production-boundary hardening

Recovered the original PR #964 branch at fb241fb91e19ce8da82ddc6603b55d940c63606c,
including its interrupted staged and unstaged capture-publication work. No duplicate
worker or replay of an uncertain write was started.

The existing capture domain now has an executable pure publication composer,
explicit execution coverage and definition validity. The existing Hub reads only
closed variant leaves. Source/quote attachments must use the same admitted futures
definition; mismatched gamma is withheld without deleting independently valid flow.
Actual source-distribution and account-access decisions remain separate owners.

This pass additionally repaired transient current-view recovery (one bounded poll
loop), denial/rate-limit stop behavior, byte-bounded browser JSON, total gamma/response
budgets, provenance bounds, incomplete-execution imbalance flags, expired-current
contracts, safe upstream error reasons and nonblocking rejection of FIFO source leaves.
No provider client, source directory, vendor key or market-data grant was activated.

## Evidence

569/569 full Hub tests, 195/195 focused Terminal tests, full typecheck and scoped lint
pass. 21/21 browser cases pass at 1440x900, 820x1180 and 390x844: existing Options
navigation, shared chart/GEX coordinates, ES/NQ switching, partial coverage, denied
access clearing, wrong-root/stale withholding, replay, bilingual responsive geometry,
old-request isolation, automatic transient recovery and no automatic denial replay.
All browser inputs here are clearly captioned synthetic HTTP fixtures; they are not
live market-data or paid-account proof. Fresh browser contexts and zero test retries.

The first test-server startup timed out. Its stopped process/listener were reconciled;
a bounded direct startup returned HTTP 200 and was terminated, then the unchanged
normal server configuration completed the suite. No page reload workaround.

EVIDENCE.json binds the tested source hashes and new screenshots. Recovered older
screenshots retain their historical paths; only this new manifest represents this
phase. The separate actual historical ES source proofs remain unchanged.

## Remaining boundary

The admitted Fabric review request found no eligible remote placement; its stable ID
remains NOT_FOUND and no worker ran. Preserve those admission constraints. Full
compiled-production qualification, complete candidate regression, independent release
review, exact-head CI, licensed source installation and deployed browser acceptance
are not implied by these local checks. Next: compile and exercise the local production
build's guest/denied and private-sample boundaries, then retain its exact evidence.
