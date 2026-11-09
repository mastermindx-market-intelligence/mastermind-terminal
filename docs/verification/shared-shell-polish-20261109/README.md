# Shared Shell recovery and company continuity

## Outcome qualified locally

This change makes the retained workspace recover predictably and keeps the desktop chart handoff on the company being read. It uses the existing Shared Shell, route admission, presentation, chart-symbol and return-navigation owners.

| Interaction | Observed defect | Candidate behavior |
| --- | --- | --- |
| Failed or outdated legacy document | A later valid READY from the same attempt could hide recovery and revive the old document. Actions could still reach parent owners. | Failure retires that attempt and stops its initialization/deadline work. Late READY, navigation, context and authentication requests remain inert. Explicit retry receives a new generation and passes the existing runtime gate. |
| Recovery with keyboard focus in the frame | Hiding the mounted iframe can send browser focus to the document body. | Focus moves to the recovery heading, follows an explicit retry into loading, and enters the admitted workspace when ready. A newer focus choice in shell chrome wins. |
| Recovery on small screens | Uneven button/link targets and vertically centered overflow; retry rendered an untranslated key. | Both actions have a 44px minimum height, wrap at narrow widths, remain reachable on short screens, and display “Try again” / “重试”. Theme tokens and reduced-motion preferences remain authoritative. |
| US company to chart | The toolbar used the prior native cursor, such as NVDA, on stock.html#AAPL. | The explicit stock hash or established ticker query alias selects the chart. Same-document changes update the link. Invalid or absent company identity suppresses this company handoff; valid unknown symbols stay explicit. The exact research return URL is preserved. |

The toolbar reads the committed URL and existing normalizer without publishing another company cursor. Regional company identifiers and navigation/AI entry points outside this toolbar retain their existing owners.

## Source and scope

- Mastermind procedure pin: `494d095813dad415938800fa0e4d2719497738fa`.
- Terminal source base: `e33a4c3dd9f0965e7879fc5397175f6f49b0d751`.
- Macro source/design pin: `cdfb627f4fcf8fe9cd536cfcb4f8a0dba4fa9d93`.
- The established US hash and ticker-alias contract was checked in [the pinned stock template](https://github.com/mastermindx-market-intelligence/macro/blob/cdfb627f4fcf8fe9cd536cfcb4f8a0dba4fa9d93/templates/stock.html.j2).
- Protected Terminal master was refreshed to `ceb4a7cd9daa8ae8e0483268faa53af30d7876d1`; none of the existing edited product/test paths or package-lock changed between the source base and that ref.
- Existing #1188, #1244, #1276, #1364, #1373, #1376, #1378 and #1381 carriers were inspected for overlap. This contribution changes the recovery regions of LegacyPageHost, adds a component CSS module and one adjacent copy key, and confines the company fix to SharedShellToolbar. It takes over no held lane and removes no hold.

## Verification

### Reproduction and focused regression tests

Before the recovery fix, the new recovery suite had **7 failures and 2 passes**. Before the toolbar fix, the new company suite had **13 failures and 1 pass**.

After implementation, these six suites passed **93 tests**:

- sharedShellRecovery (9)
- sharedShellCompanyHandoff (14)
- sharedShellNavigationCommit (23)
- sharedShellContracts (16)
- sharedShellPublicPresentation (17)
- analysisWorkspaceNavigation (14)

The company suite was rerun after its test-only Link mock cleanup and passed all 14 cases again. The local Node 26 invocation uses `NODE_OPTIONS=--no-experimental-webstorage`; without that runtime setting, the unchanged presentation suite cannot access its jsdom storage setup. No product storage implementation was changed.

### Real browser journeys

The existing `shared-shell-refinement.spec.ts` now includes recovery and company-handoff proof in the already qualified Shared Shell CI lane. The complete local run passed **21 cases**, with **6 intentional viewport skips** and **zero retries**. Four skips are existing single-viewport cases; two are the desktop-only toolbar case.

The browser runs real Next routes, AppShell, LegacyPageHost, status admission, presentation controls, chart route and return navigation. A controlled cross-origin child provides repeatable READY/error/navigation messages; this is parent integration proof, not a claim that a live upstream feed failed or recovered.

Verified:

- Desktop 1440×900, tablet 820×1180 and phone 390×844.
- Failure remains visible after late READY; explicit retry uses a different generation.
- Real browser focus across iframe → recovery → loading → ready.
- Newer shell focus remains selected after delayed readiness.
- English/dark and Chinese/light presentation; reduced-motion action transitions.
- 44px recovery actions, no horizontal overflow, working hit targets at 568×320 and 320×480.
- AAPL research → same-document MSFT selection → actual MSFT chart → exact research return, including repeated query keys and distinct percent/plus encoding.
- Existing company search, directory, compact navigation, locale, touch dismissal and history cases remain green.

### Source checks

- TypeScript `npx tsc --noEmit`: **PASS** after regenerating the local Next route-type cache with the installed `next typegen` command. The dev-generated cache had malformed trailing content; no source/compiler configuration was weakened.
- ESLint on the toolbar, copy, new unit tests and browser spec: **PASS**.
- LegacyPageHost retains the same **two pre-existing set-state-in-effect errors and one unnecessary-dependency warning** as the exact base. Strict lint for that file is therefore not claimed green; no new diagnostic was introduced.
- `git diff --check`: **PASS**.
- Session source review: **SELF_REVIEWED**. The native child supplied bounded source reasoning only; this is not a GitHub approval.

## Retained screenshots

[Desktop, dark English](recovery-desktop-dark-en.png) ·
[Phone, dark English](recovery-mobile-dark-en.png) ·
[Tablet, light Chinese](recovery-tablet-light-zh.png) ·
[Short landscape](recovery-landscape-light-zh.png) ·
[320px phone](recovery-small-light-zh.png)

The adjacent manifest binds source and screenshot bytes. Raw local logs and traces stay in the ignored test-results area.

## Delivery boundary

This packet establishes the local candidate and affected consumer paths. Protected CI, native merge, the beta release transaction and live beta acceptance require their own readbacks. Production activation is outside this Beta polish change. The original managed branch remains the single source carrier.
