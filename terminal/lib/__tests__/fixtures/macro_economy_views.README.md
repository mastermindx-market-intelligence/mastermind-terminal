# Native economic view fixtures

These are **synthetic qualification fixtures**, not production readings or authenticated responses. All fourteen workspace shapes came through Macro's existing `build_all` -> `read_workspace` -> `build_view` chain with synthetic collector Parquets and a fixed build date. The producer implementation is the candidate in Macro commit `9a3fa260d070fe86787377eb72e610ec78180497` (baseline `2cd28dc84c750303d1edce21c72137659663f976`).

The fixture retains consumed view fields and all published coordinates, source clocks, comparison dates, driver impact and correction information. Unconsumed display metadata is omitted to limit size. The `a`-filled manifest digest is an explicit test sentinel. Workspace content identities come from synthetic publications; the client boundary only checks their binding, while Macro's manifest reader verifies source bytes and canonical semantic digests.

Tests deliberately alter identities, dates and coordinates to exercise refusal. Missing points are real fixture nulls and remain gaps. Several missing-source workspaces are intentionally included: a workspace with no two-axis model or no available source is still a valid publisher shape. No test fixture may be used as a production fallback.


`macro_payroll_revisions.json` is the full Jobs view from a synthetic, exact-byte PAYEMS full-vintage cohort. Reproduce its inputs with `_write_payroll_cohort` in Macro's registered `tests/test_macro_workspace_build.py`; publish with `build_all` at `2025-04-15T12:00:00Z`, then `read_workspace` and `build_view`. The manifest digest and artifact semantic digest/byte count are those of the synthetic publication. The envelope represents the expected reader contract for testing, not authenticated delivery. January2025 changes from +57 to +30 thousand jobs, yielding -27; the earliest fixture month intentionally lacks a prior level.
