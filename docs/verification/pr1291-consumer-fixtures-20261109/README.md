# PR 1291 — current consumer fixture repair

## Result and scope

Two existing browser fixtures were incompatible with the current account and identity contracts. This successor repairs only those fixtures. No product, authentication owner, provider or scientific logic changes.

The actual local baseline reproduced all four failed hosted titles: English and Chinese saved-theme cold return, and English and Chinese mounted shortlist to Plan comparison. After the repair, the same four titles passed on desktop, tablet and phone: twelve passes, zero skips, failures, flakes or retries. All 1,983 source inputs remained stable throughout both runs. Full TypeScript and scoped lint passed.

## Causal changes

The Plan fixture now calls the existing fixtureAuthSetup owner instead of supplying an opaque identity rejected by the verified account boundary. It waits for the actual saved-research action to become enabled before pinning the selected source. Existing source, calculation, comparison, focus and no-persistence assertions remain intact.

The cold-return fixture still owns its explicit e2e-user-default account and Node-held preferences. Its account-read interception now derives the auth user pathname and origin from the existing FIXTURE_ORIGIN, matching the current same-server fixture endpoint. It keeps the actual Settings choice, acknowledged preference write, separate cold document, no theme pre-seeding and external-request refusal. Unmatched requests continue through normal fetch.

## Actual proof

- Baseline: four failed cases, zero passed, 217.28 seconds.
- Repaired run: twelve passed, zero skipped, failed, flaky or retried, 101.60 seconds.
- Full TypeScript: passed in 42.22 seconds.
- Lint of both changed specs: passed with zero warnings in 2.80 seconds.
- Root inspected the current Chinese 320-pixel comparison controls and English phone saved-theme cold-return images.
- Both ordinary consumer runs closed their own port 3898 and left no Next lock. Reports, failed traces, successful images and exact source snapshots are retained.

The capture checkout is the real published parent 0616efc99babb713394a34124279cf35b519cb1b with two recorded fixture edits. The original hosted tested merge is separately recorded; no future publication hash is claimed as the capture checkout.

## Preserved boundaries

The separate original r2 PL6 operation remains failed and fenced. Its post-SIGTERM process-group probe returned EPERM without preserving the inner PGID. These ordinary Playwright consumers never invoke that owner, signal that group, replay its cleanup or accept its failed packet.

This PR remains Draft, merge-blocked and unarmed. Original native evidence, hosted CI, migration, release, producer, authenticated production data and scientific acceptance boundaries remain in force. This fixture repair does not clear them. No old workflow rerun, deployment, provider request or production acceptance is claimed.

Publication is a single-parent GitHub-native successor of the exact current head, using compare-and-swap on the existing branch. Raw diagnostic logs remain in the owned workspace with their hash inventory; structured results and preserved artifacts accompany the repair.
