# Sector Central R7 — source-classified group navigation

Operation: `sector-intelligence-terminal-20260926-sol-001`
Parent publication: `4afebc251c1e91963c4392c63aed3822b51b0847`
Protected Skillpack: `d7c949d31f3893d95822a4ee8e5e4be9edaf5593`

## Capability delta

The existing company-group browser now consumes only the confluence owner's explicit `subsectors[].sector` classification. When an exact source sector is available, the browser defaults to that sector's subsectors and keeps an explicit **All source groups** escape hatch. It preserves source keys and source order, does not infer aliases, and does not describe the classification as fund holdings or business exposure. A selection from another sector or an unclassified/aggregate record remains visible but is identified honestly rather than silently reset.

The change stays inside the single Sector Central product. It does not create a second board, replace the Paper designer, invent a new taxonomy, or alter ranking, entry, sizing, watchlist, alert, history, or publishing planes.

## Verified source surface

- New R7 unit surface: **25 / 25 passed**.
- Related Sector surface: **125 / 125 passed** across seven files.
- `next typegen` + `tsc --noEmit`: **PASS**.
- Scoped ESLint: **PASS, zero errors**; the CSS file is ignored by the repository's ESLint configuration.
- Full unit suite: **6,395 passed / 4 todo / 1 unrelated timeout**. The unchanged timed-out `guideExperience.test.ts` then passed **3 / 3** in isolation in 734 ms, so the full-suite run is disclosed rather than rewritten as all-green.
- Fresh Chromium, with no sector-response interception: desktop and mobile both returned HTTP 200, had no page exceptions or 5xx responses, leaked zero group rows under access loss, had no horizontal overflow, and opened the existing contextual Sources panel.

`chromium-live-no-intercept-access-report.json` records the six exact source/test SHA-256 values and the browser receipts. The four accompanying images are the current degraded-state group-browser and Sources handoff proof.

## Held gates

CI run `36279293161` remains red in the two historical Sector workflow specs: the old fixture shape supplies zero group/company rows, and one Sources expectation still targets the superseded `sectorView=sources` URL instead of contextual `sectorSources=1`. The recorded fixture-envelope/label-helper action remains held; no fixture, expectation, quarantine, retry, or override was attempted in R7.

Authenticated ready-state transport, exact-head CI, independent design/comprehension review, merge, non-Vercel production release, and browser proof remain open. Full rotation/bubbles/Matrix/theme-heatmap parity remains owned by the continuing consolidated Sector Central program.

The older untracked `sector-intelligence-r2` captures are preserved locally and are not promoted as R7 evidence because they predate these source bytes.
