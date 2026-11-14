# Native economic view fixtures

These are **synthetic qualification fixtures**, not production readings or authenticated responses. All fourteen workspace shapes came through Macro's existing `build_all` -> `read_workspace` -> `build_view` chain with synthetic collector Parquets and a fixed build date. The producer implementation is the candidate in Macro commit `9a3fa260d070fe86787377eb72e610ec78180497` (baseline `2cd28dc84c750303d1edce21c72137659663f976`).

The fixture retains consumed view fields and all published coordinates, source clocks, comparison dates, driver impact and correction information. Unconsumed display metadata is omitted to limit size. The `a`-filled manifest digest is an explicit test sentinel. Workspace content identities come from synthetic publications; the client boundary only checks their binding, while Macro's manifest reader verifies source bytes and canonical semantic digests.

Tests deliberately alter identities, dates and coordinates to exercise refusal. Missing points are real fixture nulls and remain gaps. Several missing-source workspaces are intentionally included: a workspace with no two-axis model or no available source is still a valid publisher shape. No test fixture may be used as a production fallback.
