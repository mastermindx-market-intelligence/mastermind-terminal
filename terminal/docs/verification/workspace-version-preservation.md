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

Independent GLM review `rs_20261006T043453Z_46520` found that workspace rename
could stamp reserved identity keys onto schema-less legacy configuration when an
unrelated legacy revision happened to match. Two regressions reproduce this on
missing-schema and JSON-null-schema records. Rename now requires a supported v1
workspace envelope; the explicit migrate-on-write path remains unchanged. All 132
storage, route, team and format-preservation tests pass, including those two cases.
TypeScript passes after regenerating route types for this branch; an initial check
encountered a generated route reference left over from the previous checkout.
Independent GLM rereview `rs_20261006T044422Z_67336` accepts the corrective storage
source `ecf71caa28eceff98342c05fced7a3f29aa30a44`. The parent accepted both the first
review's finding and the scoped repair approval, with exact ACK/START, complete
returns, process cleanup and released provider leases. The original implementation
attempt timed out and its recovered draft was corrected by the parent. No merge,
deployment or production acceptance is claimed here.
