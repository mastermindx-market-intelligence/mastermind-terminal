# LR-T18-TERM-EV1 — measured coverage receipt + A42 (LOCAL browser evidence)

LOCAL intercepted evidence only (route-intercepted owner payloads against a local `next dev`).
NOT a production proof; `productionProof: false` in `qualification.json`.

Inputs (frozen, sha256-verified by the harness before any cell ran):
- `sector_base.json` ← macro `1c8ff99ff7c06dda6482b8ba3a81b4e615a63c52:site/sectordata/sector_central.json` (145069 B, 2f89eee8…)
- `history.json` ← same ref `site/sectordata/sector_cycles.json` (2119318 B, 462201aa…)
- `events.json` ← same ref `site/marketdata/rotation_events.json` (117246 B, 9eb9993b…)
- `measured_read_v1.json` ← worktree fixture `terminal/lib/__tests__/fixtures/measured_read_v1.json` (9430 B, 3c941630…)

History-unpublished state, as observed: the owner `sector_cycles.json` payload carries NO
`meta.rs_history` (the reconstructed trail is unpublished at this ref), so the rotation view
renders the honest "Historical trail unavailable" state next to a fully plotted current map.
No trail was fabricated anywhere in this run.

GAPS:
- webkit cells (F) skipped: no cached webkit build matching playwright-core revision 2311
  in `~/.cache/ms-playwright`; chromium 1228 cells all ran.
- Distinctness is asserted on full line text; the printed table's first-80-char heads are
  identical for aligned vs stale because the stale clause begins after 80 chars.

Findings (reported, not failures): touch 390 — 0/11 rotation points are < 44 px in both
dimensions. Keyboard — 30 Tab presses from page load reached rotation point XLP (BUTTON);
Enter selected it (URL `sector=xle`→`xlp`); Space re-selected the same point.
