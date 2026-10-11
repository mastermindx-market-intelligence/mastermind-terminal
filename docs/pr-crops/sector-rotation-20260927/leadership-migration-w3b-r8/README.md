# W3B source-bound native Rotation Command closed episodes

Local, intercepted-owner browser evidence only; NOT authenticated production deployment, natural first-seen/PIT research, or independent source acceptance.

## Actual owner sources

- Current Sector Central: Macro b29ba7102d35bebf6f322c1d6fadf8309726bf4e, as_of=2026-10-08, 11 US sectors.
- Reconstructed sector/SPY 21D/63D plus retrospective price-cycle turns: Macro W3A head 7d343dc5efc0353e7a0090acdf664f1f663946ed, as_of=2026-10-08. 2,772 daily RS observations and 187 retrospective price-cycle turns (11 provisional, two with null magnitudes).
- Native closed RC handoff feed: current Macro main 7bf322e8925b90e7986b0b2b0a4e14e6a43f8b90, site/marketdata/rotation_events.json, as_of=2026-10-08 and generated_utc=2026-10-09 14:18 UTC. Nine closed recent native episodes, zero active; all nine lack a natural-first-seen/replayed marker and are classified RETAINED_LEDGER_UNMARKED, NOT proven naturally observed.
- Input revisions, file paths, byte counts and SHA-256 hashes are retained in qualification.json.

## Browser verification

- 176/176 checks PASS, zero page errors, five screenshots.
- Chromium: desktop 1440x900 light/EN, tablet 820x1180 dark/EN, mobile 390x844 light/EN.
- WebKit: desktop 1440x900 dark/EN and mobile 390x844 light/ZH.
- Tests preserve current 11-sector coordinates and ranking while showing (1) source-dated reconstructed RS 21-session visual trail, (2) retrospective price-cycle turns, and (3) separately labeled native closed RC handoff receipts with native origin/destination, close date, recorded-at clock and source as-of date.
- Empty-sector and absent-source states are not inferred all-clear; freshness notices follow the actual source date. Existing source drawer, keyboard/Back, access-loss and no-overflow behavior are retained.

## Acceptance limitations

- The harness intercepts real owner payloads in the local Next UI: productionProof=false, transport=local interception. It is NOT a normal signed-in owner→Terminal transport proof.
- New native closed RC episodes do not replace rotation_calls.v1 candidacy, create as-known historical episode membership, grant signal power, or equate price-cycle turns with migration events.
- Exact implementation passed 286 sector/risk unit tests, TypeScript/scoped ESLint and a full Next 16.2.9 production build (59 static pages) before this evidence save. Hosted CI on the new immutable PR head and independent review remain required.
- Macro W3A, Macro W1B and Terminal #881 source releases and actual entitled deployment/browser proof remain separate gates.
