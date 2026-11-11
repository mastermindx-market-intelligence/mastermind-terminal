# News reading recovery — current-code verification

PR: [Terminal #1207](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1207)

Source candidate: `5c9269d207e4cef89a60c39752d3233fbcb2fdc7`

Integrated master: `bf9826e3d52d84458e7498a95c88ea609c14428b`

Date: 2026-11-02

This packet records actual local fixture execution and retained screenshots for
the scoped News continuation. It does not claim deployment, authenticated
production acceptance, live-feed recovery or a successful CI release.

## Delivered behavior

- Desktop News fills the available rail column.
- The company board remains mounted but hidden while News is selected and
  becomes visible again when News is left.
- On phone, Symbol details selects Watchlists before scrolling to the company
  dossier.
- Tablet and phone keep natural document flow without an inner height cap.
- The mounted News activity strip is removed; canonical flow payloads, parsers,
  standalone component and static light specimen remain.
- Headline, teaser, member-title and review-button display text is decoded once
  as plain React text. URLs, identities, revision/cache tokens and saved evidence
  remain raw.
- R3 typography, sentence ladder, review controls, clocks/member grids, editorial
  views, correction/race handling and saved basis remain.

The earlier proposal to remove review chips and both review actions remains
deferred because those controls capture the saved evidence basis. This packet
does not claim that deferred cleanup was implemented.

## Verification actually completed

| Check | Exact source | Result |
| --- | --- | --- |
| Next type generation + TypeScript | `b8c7f472ceefb5d9bf87692b32228620686cdbb3` | Passed |
| Focused News unit suite | same source | 23 files, 509 passed |
| Core News browser suites | `a1881e7274e8215f72c7a0d85a75d559f3204afb` | 26 passed, 13 intentional viewport skips, 0 failed/flaky |
| News payload/R3 evidence + reading slice | `5c9269d207e4cef89a60c39752d3233fbcb2fdc7` | 74 passed, 16 intentional viewport skips, 0 failed/flaky; retries 0 |

All four changed product files are byte-identical between the earlier tested
source and the final source candidate. The later source integration adds the
one-file R3 consumer-test update and current master's independent Today-page
work. The four core browser specs are unchanged between their completed run and
the final candidate.

The full static light SPECIMEN test through the R2/R3 evidence tail is
byte-identical to master `82a8cd89c0925f68301034f9b47d94261b88a82a`:
18,057 bytes. That source includes #1129 and #1209, so this is verification of the
implemented R3 design.

### Exact browser commands

Core run, one worker and no retries, port 47327:

```sh
playwright test e2e/news-reading-slice.spec.ts \
  e2e/news-corrected-save.spec.ts e2e/news-catchup.spec.ts \
  e2e/ticker-news.spec.ts --project=desktop --project=tablet \
  --project=mobile --workers=1 --retries=0 --reporter=list,json
```

Final-candidate matrix, port 47329:

```sh
playwright test e2e/news-flow-responsive.spec.ts \
  e2e/news-reading-slice.spec.ts --project=desktop --project=tablet \
  --project=mobile --workers=1 --retries=0 --reporter=list,json
```

Both used CI=1 for an owned server, Node v26.5.0 with
`NODE_OPTIONS=--no-experimental-webstorage`, the installed Playwright Chromium,
and isolated fixture contexts. Shared-shell and investor-preview flags were 0
for the final matrix. Legacy capture output was disabled with
`TERMINAL_CROPS=0`; new News captures use this packet's directories.

### What the assertions establish

The desktop test requires the News panel to use more than 90% of its rail column
and leave at most 16px below it. Company visibility assertions include count=1
before hiding, so an unmounted board cannot falsely satisfy the hidden check.
Leaving News requires visible company content and removal of the News panel.

The phone journey requires Watchlists' selected state, a visible company board,
and its bounding box intersecting the viewport after Symbol details. All
responsive cells check horizontal overflow. The R3 phone wrap test measures the
ladder's scroll/client widths and right edge; that case has no screenshot call.

The payload matrix retains six states (busier, typical, quieter, thin, partial,
unavailable) in EN/ZH at all three viewports. Each requires positive article,
first-headline and review-control content as well as absence of the removed
strip and its former details control. The unchanged R3 tests exercise the
expanded evidence block, clocks, members, limited comparison, restricted/
unavailable states, retry, keyboard focus and touch targets.

The core correction tests compare the saved basis before and after reopening,
check the revision token requested by Open current, and verify an out-of-order
older presentation is not labelled an update. These are fixture consumer checks,
not claims about a production user's saved state.

The 16 final-matrix skips are existing viewport ownership: E1 and restricted/
unavailable R3 cases run on desktop; wrap runs on phone; full-column ownership
runs on desktop; Symbol details runs on phone. Tablet and phone retry behavior
is additionally exercised by the completed core suite.

## Retained evidence

- [Core process output](CORE_BROWSER_EXECUTION.txt): verbatim output read from
  the completed process, including individual cases, saved-basis checks and
  exit 0.
- [Final matrix process output](R3_BROWSER_EXECUTION.txt): exact source snapshot,
  command context, individual cases and exit 0.
- [Final matrix Playwright report](R3_BROWSER_REPORT.json): unmodified actual JSON;
  SHA256 `7b6c3caa65743ea3443e20cd147ba4f4511e944c6c7b4a63c9329701d39d52c5`.
- `reading/`: 8 earlier core journey screenshots.
- `reading-5c9269d20/`: 8 final-candidate reading/navigation screenshots.
- `flow-5c9269d20/`: 43 payload/status/static-specimen screenshots.
- `r3-5c9269d20/`: 28 R3 evidence screenshots copied byte-for-byte from the
  completed run's default `test-results/news-r2-crops` directory.

The core run's JSON was read and hashed before the subsequent Playwright run
cleared its default output directory. Its observed SHA256 was
`95226302f8d5fe9deaabd814532ac486105edb88ae2db807e37698895119634f`;
the raw JSON is no longer retained. The complete retained process output and
eight journey images are the available core evidence. No replacement JSON was
manufactured.

Images were inspected for desktop reader height, restored company content,
phone News and Symbol details, tablet Chinese expanded evidence, and phone
Chinese expanded/English limited-comparison layouts. The raw images and
assertions establish the bounded journeys above, not universal appearance
quality for every possible feed item.

## Source contract for broader shell captures

The unchanged prospective visual-evidence owner discovers 1,761 runtime/e2e/
configuration inputs on the source candidate. Its canonical source digest is
`250ec240c087a91a1e2544468f4a39f5912971d5dd12bc9c05a724061ce9d4f9`.

A separate existing-controller commission,
`terminal-news-sidebar-20261102-c4-current-evidence-001`, is capturing the required
20 PL6 + 30 Visual Intelligence cases through that existing immutable owner.
Its completed records and validation will be reported separately. No successful
composition or full-suite result is claimed in this checkpoint.

## Recovery and release disposition

Original run `terminal-news-sidebar-20261102-c4-current-build-001` remains a
settled terminal rc75/admission failure with recorded controller return and
released original lease `9e8400f4e4d6`. It was not replayed or accepted.
Historical usage/execution are unknown. The new build and R3 test commissions
returned through fresh ordinary admission. No thermal threshold, receipt,
controller generation or retry policy changed.

The source-only thermal-owner proposal, Mastermind #1949, was closed without
merge or installation. The older #1081 carrier remains unarmed and unmerged.

Independent source review `terminal-news-sidebar-20261102-c4-current-review-001`
is pending. PR #1207 remains Draft with auto-merge off.

Two incumbent shell-hash evidence locks remain a release gate in the unselected
unit suite. The [explicit CI selection proposal](EVIDENCE_CI_PROPOSAL.md)
describes the exact unapplied workflow diff and its broad future-source
consequences. Local proof is not an exception to required CI; no merge or
deployment is claimed.
