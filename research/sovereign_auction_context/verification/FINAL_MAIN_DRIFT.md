# Current-main TerminalShell drift — final read-only adjudication

**Decision: no overlapping import or mount edit was found in the exact base-to-current Shell diff.** Root can proceed with the planned code commit and merge-tree inspection. No merge was performed by this audit.

Base: `d660d98b1ebc0bdf0d1b16d66202b1760f6cc94a`  
Current and observed `origin/master`: `f03aa5d019f1894210a7c6e40b8825ae28015198`  
Source: `terminal/components/TerminalShell.tsx`

## Exact changes

| Source location | Upstream change | Auction overlap |
|---|---|---|
| Base/current line 151 | Replaces `renameScript as renScript` with `runRenameScriptClick` in the existing userScripts import | None; the auction import is the bounded addition near line 25 |
| Base 4174–4182 → current 4174–4175 | Replaces the inline script rename operation with `const s = scriptById[id]; void runRenameScriptClick(loggedIn, s, name, setScripts);` | None; this is the script rename handler |
| Existing action group, base 6024–6027 → current 6017–6020 | Source text unchanged; shifted by the seven removed lines above | Keep the auction leaf immediately after the group's closing div, inside the same detail-scroll |

No other TerminalShell source differences exist between these exact blobs. The StockAnalysis/action-button/mount neighborhood remains byte-equivalent at its shifted location. Neither base nor current Shell imports the dormant NeuralWebStrip.

## Required preservation and semantic danger

Retain the new upstream import and rename-handler delegation together. The current `runRenameScriptClick` helper passes the script's last-observed `updated_at` to `renameScript` and publishes its `ScriptWriteReceipt | null` result. The old inline handler assumed a boolean result and did not pass that version.

Consequently, copying the complete older Shell over current main would erase a material upstream rename change. Integrate only the two auction additions and preserve current-main's corresponding userScripts implementation and owner changes. Nothing in the observed upstream Shell change couples auction context to script renaming, authentication, scoring, risk decisions or Oracle.

The existing leaf location remains appropriate: after both current action buttons and their enclosing `.sa-btn-group`, before the existing detail-scroll closes. Preserve StockAnalysis and the buttons' callbacks exactly.

## Evidence and limits

The retained `FINAL_MAIN_DRIFT.diff` is the exact 3,503-byte Git diff, SHA-256 `a1802fcafbb5ad3591f12f951fcd981565720b7dcc8a3c7d349f7c39983e7b37`. The receipt records both Git blob IDs and source SHA-256 values. `FINAL_MAIN_DRIFT_SOURCE_READ.txt` retains the seam and narrow current-helper excerpts used for this decision.

This audit made no remote source writes and ran no merge, tests, build, lint or browser process. It did not inspect the entire current userScripts change or re-census unrelated targets. Root owns the pending merge-tree inspection. Root's reported 42 native tests, tsc, leaf/E2E lint and 18 real-route browser cases are prior validation of the candidate, not a claim here about a combined current-main tree.
