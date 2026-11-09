# Unified Today daily desk

Actual React components under controlled local source/identity fixtures, not a live authenticated beta release. Paper binding and parent scope are in `docs/plans/SHARED_SHELL_DAILY_DESK_2026-11-09.md`.

Source qualification: 186/186 focused tests across nine suites; TypeScript passed. Node 26 on this host exposes experimental Web Storage; the initial unmodified test baseline failed before rendering on undefined localStorage. `NODE_OPTIONS=--no-experimental-webstorage` restores jsdom ownership; no product or CI test was weakened.

The capture runner reuses the existing Today browser harness and existing component/API boundaries, with explicitly illustrative snapshot data and an added tablet viewport. Generated JS/CSS bundles are ignored. Responsive captures and result receipts are pending.
