# Current-base integration — 2026-09-29 (TERMINAL-03)

This pass did **not** change replay or geometry behaviour. It reconciled the stalled #608
carrier with current protected `master` and re-earned its proof on the shipping tree.

## Why the carrier stalled

`14f9a8d8...` was complete and hosted-CI green on 2026-09-18, then sat untouched for ten days
waiting on an independent re-review requested on 2026-09-19 that never returned. That wait was
**self-imposed process, not branch protection**: `master` requires the three CI contexts plus
strict up-to-date, and `required_approving_review_count` is `0`.

Checked before touching anything: none of the repair existed in `master`. The four mounted
tests, the three e2e specs, the render-boundary `isSurfaceFrameForContext` call and the
`surfaceRefreshFailed` / `surfaceUnavailable` lexicon were all absent from `b9828842d`.

## The one real merge conflict

`lib/flowClientCache.ts` was modified on both sides — master added `flowGetFresh()` (#634),
the carrier added the `{ refresh }` option to `flowGet()`. Git auto-merged it; the semantics
were then checked by hand. Both paths still route through the same `store` / `doFetch` owner,
so the merged module keeps **one** cache owner. The "no second cache plane" non-goal holds.

## Why the green here is new proof

The RED was re-established on this base rather than quoted from 2026-09-18. Reverting only
`SurfacePane.tsx` to pre-repair `1f94c551f` fails exactly the two frame-refresh cases —
the data strip is erased on a same-stamp refresh failure, and an initial transport failure
renders `No surface data yet — accruing.` The other 23 cases in the same file stay green,
so the discrimination is specific to the repair and not an environment artifact.

The browser matrix ran cold (`CI=1`, fresh server) with `--workers=1 --retries=0`. Retries were
forced to zero rather than inherited from the CI config, so a race cannot be papered over by a
second attempt.

## Receipts

| file | what |
| --- | --- |
| `focused-green.log` | the four packet tests, 40/40, exit 0 |
| `frame-refresh-red.log` | discriminating RED, 2 failed / 23 passed |
| `surface-family-green.log` | surface/replay/contract/theme family, 233/233 |
| `browser-matrix-green.log` | real-route EN/ZH × desktop/tablet/mobile, 30/30 cold |
| `typecheck-green.log` | `tsc --noEmit`, exit 0 |
| `verification.json` | SHAs, commands, exit codes, assertion counts |

Not claimed by this pass: production freshness, observed dealer inventory, predictive edge,
or #603 / Quanted parity completion.
