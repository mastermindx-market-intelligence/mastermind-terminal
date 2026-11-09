# Indicator settings and legend usability — 9 November 2026

Parent mission: [Terminal UI improvements, PR #1363](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1363). The Chairman authorized ongoing UI fixes and the normal protected automatic release flow while independent work continues.

## Authority and source

Mastermind law pin: ff6d5ab67c3535056d69f603fac0d95c058baad8.
Terminal base: 8390cc4ad41b1c0773e979198c80e742852c01dc.
Macro design doctrine: 536ab7d78c2fbcab8a7c8a3cdc8d09fbe2bff136.
Product/test proof head: d5fd4e8632a34a70d182902f25857df1939bd911.
GitHub-native source carrier; isolated local/remote snapshots are validation artifacts. No shared source checkout or live writer was modified. SELF_REVIEWED under the Web waiver; actual GitHub review, queue and release controls remain binding.

Paper D06 is a reference study with acceptance unestablished, and the account/settings redesign is explicitly rejected. This repair applies the reference principles of named controls, retained chart context and useful focus return without replacing the Terminal design system.

## Repaired behavior

- Indicator settings now use a native modal dialog, the existing shared dialog lifecycle, scroll locking and background inertness. Desktop placement and the phone bottom sheet are retained in a scoped stylesheet.
- The shared lifecycle explicitly wraps Tab/Shift+Tab across visible enabled controls. Chromium otherwise allowed the last Tab to leave the document for browser chrome; the original failure was observed and repaired.
- Desktop legend groups can be reached by keyboard and reveal their actions with focus-within. Closing settings restores the persistent settings opener even after the pointer has left the row.
- Visibility, Suite and Pine controls have names; section and color choices expose their selected state. Existing color normalization makes translucent colors display and select the correct swatch while retaining their alpha.
- Escape/OK retain live edits. Cancel restores the opening snapshot. Existing parameter ownership, calculations, persistence and guide routing are unchanged.
- Touch legend action buttons remain transient. Their pre-existing dismissal focus behavior is not claimed repaired.

## Verification

| Evidence | Result |
| --- | --- |
| Focused component/utility tests on final color implementation | 69 passed: accessibility 18, chart settings utility 45, legend 3, overlay language keys 3 |
| Module-scoped settings tests | 2 passed |
| Full TypeScript check of the owned validation snapshot | Exit 0 with 4 GB heap; this snapshot also contains independent UI1/UI3 candidate work. Final hosted checks still qualify the PR head |
| Focused ESLint comparison | IndicatorSettings retains the same 19 baseline no-explicit-any findings; ChartOverlays, shared lifecycle and changed tests were clean |
| Native browser journey at product head d5fd4e8 | 3/3 passed, desktop 1440x900, touch tablet 820x1180 and phone 390x844 |
| Existing full chart-settings modal smoke at ae54728 | 3/3 passed on the same three sizes; shared lifecycle is unchanged since that proof |

The final indicator browser journey verifies keyboard legend entry on desktop, native modality, sequential focus containment, background inertness, settled viewport bounds, live edits surviving Escape, Cancel rollback, color selection, named Visibility controls and disabled dependent inputs. Desktop focus return is asserted. No failed attempt was counted as a passing result.

Representative captures are [desktop](./pr-crops/terminal-indicators-20261109/desktop-indicator-settings.png), [tablet](./pr-crops/terminal-indicators-20261109/tablet-indicator-settings.png), and [phone](./pr-crops/terminal-indicators-20261109/mobile-indicator-settings.png). All three layouts were visually inspected; the final color-only iteration retained the same dialog layout.

Remote evidence root: /Volumes/STORAGE/mmx-evidence/terminal-ui-20261109-c1. Source receipts attest every overlaid file by Git blob SHA. Final log: indicator-proof-final.log (3 passed, 55.1 seconds; process exit 0). Earlier failure logs are retained for the focus diagnosis.

## Release and continuation

PR #1367 is source-complete for Ready and one native exact-head auto-merge request after the evidence commit. Pending CI is not a reason to stop other scoped work. No merge, deployment or production-browser success is claimed here. User Chrome remains occupied by its extension UI; the isolated fixture runner is not production evidence.

PR #1363 is already armed at 418caa6570717942af8255dbac3dfbe108de8217 (enabledAt 2026-11-09T08:42:23Z). Do not re-arm or duplicate it.

Next owned lane: the four remaining Options Screener ticker actions (Volume > OI, delta-OI, 0DTE and Hot Contracts), preserving the broader #1248 source lane. Continue through affected checks, evidence, Ready and protected automatic release.
