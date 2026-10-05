# Workspace writer format preservation

Storage implementation: `64d173a3de19583b51daab20ddc466363b5b1d76`.

Old clients refuse saves, renames and duplicates of unsupported stored schemas or
requirements. The stored format is part of the atomic write predicate, including
format changes after a rename read. Missing optional requirements remain compatible;
JSON null, string floors, malformed containers and unknown keys do not.

## Verification

- 367 tests pass across 10 storage, route, frozen-vector, legacy and team files,
  including all 42 preservation regressions. TypeScript passes.
- Isolated PostgreSQL verifies 11 JSON predicate vectors: the three supported
  requirements shapes match; malformed requirements and future formats do not.
- The unchanged 26-case workspace browser suite with existing CI settings completed
  with 24 passes, one phone tile case that passed its built-in retry, and one failure:
  the combined tablet/phone tap-target case exhausted its 60-second test budget.
- This commit splits that case into separate 820px and 390px tests, preserving every
  action, assertion and configured timeout. Both pass (28.0s and 38.9s). The other
  25 cases and application source are unchanged. This gives passing evidence for
  all 27 resulting cases across two runs, not a claim of a single clean full run.
- Coverage includes English/Chinese at desktop/tablet/phone, unsupported-format
  rows, stale updates, no-write unreadable opens, keyboard behavior, overflow,
  and fixture team workflows. Fixture identities do not establish real-team proof.

The earlier local 30-second run and the CI run's phone retry remain disclosed.
A separate intermediate run had invalid generated Next cache/404s; after archiving
that owned cache, all 13 warm-up routes returned 200 before the measured CI run.
No application or timeout change was used to mask that environment failure.

Logs, traces and fresh PNGs are retained under
`/Volumes/Mastermind/evidence/iw2-initiation-01a104c8/`:
`g3-version-strict-validation-green.log`, `g3-version-strict-typecheck-final.log`,
`workspace-floor-postgres.json`, `g3-version-responsive-ci-fresh.log`,
`g3-workspace-browser-ci60/`, `g3-version-tap-matrix.log`,
`g3-version-browser-proof-64d173/` and `g3-version-browser-proof-sha256.json`.
The screenshot manifest binds their exact bytes. Existing repository screenshots
are unchanged because this repair changes storage guards and test partitioning.

Independent review is still required. The Fabric implementation attempt timed out;
its recovered draft was corrected and expanded by the parent. No independent
approval, merge, deployment or production acceptance is claimed here.
