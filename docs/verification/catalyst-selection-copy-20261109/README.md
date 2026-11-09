# Catalyst selection and copy follow-up — 2026-11-09

## User problem and resulting behavior

An explicit saved Catalyst case previously resolved inside the filtered list. Selecting Defense and then filtering Energy could substitute Energy's detail and copy target; zero matching rows could remove the valid selected detail. A missing saved case also left the first unrelated detail visible. Clipboard completion had no case/read identity guard, and the error message pointed to an address bar that might not contain the implicit default case.

The corrected view resolves an explicit selection from the complete current eligible case collection. Scope and search affect the list. An absent explicit case has a notice and no substituted detail or copy action. Only a URL without a valid explicit selection may default to the first visible watch, after the existing URL synchronization completes.

Copying prepares one exact URL per user action. Its completion and manual fallback belong to that attempt and the existing workspace result object. Selection/history, account/read changes, ineligibility and unmount retire old feedback. A failed attempt exposes the same prepared URL in a labelled, read-only field; Select link focuses and selects that value. An already issued clipboard write cannot be cancelled.

## Existing architecture retained

The workspace passes its existing `current` result as an opaque `readContext`; there is no new fetch, cache, account lifecycle, retry queue, URL owner or entitlement decision. The market view hides prior data while its owner is loading or denies the read. The independently supplied Defense panel remains outside that market-state guard. Source observations, source dates, coverage semantics and external destinations remain unchanged.

An explicit Inspect action focuses its current detail after the React commit. A superseding history or read change cannot redirect a queued animation-frame focus request because that deferred request is removed. If an asynchronously removed detail held keyboard focus, focus moves to the missing-case notice or retained page heading. Filtering does not steal focus.

## Design and source provenance

- Base: Terminal `929e008f689bc834662f52f845d070db3fc8eb00`.
- Managed operation: `paper-catalyst-selection-copy-20261109`.
- Original Catalyst source PR1038 is merged. This follow-up owns a new, bounded selection/copy diff; it does not reopen the old candidate or represent its historical denied tests as completed.
- Paper file: `01M6Y2VTQBVC9NA39HNG1DYWFH`, page 3, Build root `10D-0`; selected/filtered, zero-result, absent-case and failed-copy specimens `10J-0`, `117-0`, `11D-0`, `11J-0`, `11P-0`, `1HL-0`, `1I6-0`.
- Canonical design audit: [Macro PR10617](https://github.com/mastermindx-market-intelligence/Macro/pull/10617), [workflow report §§20–21](https://github.com/mastermindx-market-intelligence/Macro/blob/eebafeb32613dc7dd924bee0e85229e9f6a16c4b/research/design_candidates/production_design_20261102/audit_20261108/WORKFLOW_CONTINUATION_20261108.md).
- [manifest.json](manifest.json) binds the six implementation/test blobs and seven unmodified browser captures.

## Verification

The changes were written and read back in the operation's isolated managed workspace before execution.

| Check | Observed result |
| --- | --- |
| `npx vitest run lib/__tests__/catalystOpportunityView.test.tsx` | 46 passed, 0 failed; exit 0 |
| `npx tsc --noEmit` | Exit 0 on the complete six-file implementation/test diff |
| Targeted Playwright selection/copy journey, desktop/tablet/mobile | 18 passed, 0 failed, no retries; exit 0 |
| Source diff whitespace check | Exit 0 |
| Native screenshots inspected | Desktop EN, tablet ZH, mobile EN and ZH |

The browser command used the existing Playwright configuration and an isolated loopback port with existing server reuse disabled:

```sh
TERMINAL_E2E_PORT=55716 \
TERMINAL_VISUAL_EVIDENCE_OPERATION=paper-catalyst-selection-copy-20261109 \
npx playwright test e2e/catalyst-opportunity.spec.ts \
  --grep 'selection and copy:' \
  --project=desktop --project=tablet --project=mobile \
  --workers=1 --reporter=line
```

The configured desktop viewport was 1440×900, tablet 820×1180 and mobile EN 390×844. Mobile ZH explicitly used 320×780. The new journeys assert retained detail through zero results and Clear, no substituted missing-case detail, exact fallback URL, text selection, focus, minimum 44px copy/select controls, and no horizontal overflow.

Component checks additionally cover initial URL readiness, same-case overlapping promises, delayed success and rejection, A→B→A and same-case history events, unchanged source dates on a new read, existing workspace account/refresh transitions, ineligible reads, unmount and focused-detail removal.

## Visual evidence

| State | Captures |
| --- | --- |
| Zero matching rows with selected Defense detail | [Desktop EN](catalyst-desktop-en-selection-zero.png), [tablet ZH](catalyst-tablet-zh-selection-zero.png), [mobile ZH](catalyst-mobile-zh-selection-zero.png) |
| Failed copy with the complete prepared URL selected | [Desktop EN](catalyst-desktop-en-copy-fallback.png), [tablet ZH](catalyst-tablet-zh-copy-fallback.png), [mobile EN](catalyst-mobile-en-copy-fallback.png), [mobile ZH](catalyst-mobile-zh-copy-fallback.png) |

These are synthetic fixture browser results in Terminal's native dark theme. Their market figures, October 16 date and loopback URL are test inputs. They prove the changed component journey, not live market data, real entitlement, human usability research, production deployment or the broader Catalyst programme. Required native CI, protected merge and any live acceptance remain separate receipts.
