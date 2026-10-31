# Composable Tape screens (R4 Draft)

Choose two to four single saved screens in the existing Saved screens panel, then Combine selected. A row must satisfy every condition within at least one selected screen. Current Tape controls further refine that union; the current global sort applies once. Overlapping groups do not duplicate a feed row. Separate source rows are never coalesced by guessed identity.

Save screen preserves both the outer controls and copies of all group definitions. Renaming/deleting an original screen does not change the saved composition. No nested combination, market snapshot, account sync, new collector or scientific evidence store is introduced. New matching feed events appear on the next normal feed update.

Single-screen `tapeView` links remain byte-compatible v1. Composed links use an exact v2 envelope containing the validated v1 outer view and strict finite group codec. Old v1 clients reject the whole v2 link rather than ignoring groups and broadening the population. Missing/invalid/duplicated parameters show the existing invalid-link recovery; no rows/export are rendered until explicit reset. Existing browser-local storage remains fail-closed; composed entries add a validated optional `groups` field, so older decoders also withhold unsupported libraries.

Validation:54focusedunit tests;33local Playwright journeys across English/Chinese and desktop1440x900, tablet820x1180, phone390x844; TypeScript passes. Lint retains the existing17errors/12warnings from OptionsHubView (no additional diagnostic kind/count); other changed files are clean. No lint waiver or unrelated source repair. Actual fixture screenshots and their hashes are in `evidence/options-tape-filter-groups-20261031/verification.json`. The existing product is dark-only; no light-theme or authenticated production acceptance is claimed.

Independent review and hosted CI are separate. Release is Draft-only under the current programme scope. This advances R4 composable discovery; cross-tool inheritance/cloudsync and the broader Plan/Save/outcome/scientific obligations remain separate.
