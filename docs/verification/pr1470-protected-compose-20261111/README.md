# PR 1470: accepted dependency integration

The original run 43058456105 failed in the Python generated-companion child and
in transcript source-link focus. Those repairs have now landed through their
original protected PRs: #1465 and #1033. This composition consumes protected
568fa505afb068900424fe4db0da67587d46a114; it does not duplicate either repair.

The original managed workspace fast-forwarded from its clean aa682f200 local
head to its already-published 9ff2b500 remote descendant. That advancement was
previously reconciled in PR comment 6801358573. The subsequent protected merge
was clean. The original carrier and expected remote head are retained.

Against protected source, the functional contribution remains exactly four
files: the filename-only GITHUB_ENV export, planner file reader, planner
regressions and workflow transport regression. The two planner blobs remain
identical to the original PR. Both E18 and inbox capture steps and artifacts,
parallel typecheck and three unit shards, their shared evidence-suite inventory,
required aggregate and browser setup fallback remain intact.

## Qualification

- 105 Python workflow, setup and inbox-owner checks passed.
- 391 Node owner/planner checks passed on the composed source.
- Exact source bytes remained unchanged throughout validation.
- The complete protected-relative source diff and whitespace check passed.
- Accepted loader blob: f05ff0062e7629d67e9864e30ceb3db50b3b748a.
- Accepted transcript drawer blob: 999070fa1b4053d44b0bc5c77704ec59b894a114.

The first local Node invocation passed 387 and failed four on-disk fixture
checks because macOS /tmp resolves to /private/tmp. The strict reader correctly
refused that path identity. The qualified invocation uses a physical temporary
directory; source code and symlink guards were not changed. Both original logs
are retained. The whole-merge whitespace report concerns existing protected
verification logs, patches and failure snapshots; their original bytes remain.

The original known-red CI result, existing auto request and both labels remain
recorded. New natural required CI and native queue acceptance are still owed.
No rerun, extra auto enrollment, label clearing or direct merge is part of this
source integration. Parent duty: Mastermind #2028.
