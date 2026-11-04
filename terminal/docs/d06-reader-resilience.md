# D06 reader resilience — implementation slice

**Historical implementation and verification record.** The original candidate is now published at `2d29878cf52b6a8ac950b93ea9a78ec0fae60aff` in [Draft #1270](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1270). The [current chart-time continuation](d06-chart-time.md) records publisher recovery, the next bounded correction and its new proof. Earlier publisher-refusal and source identities below remain historical.

## Authority and source custody

D06 remains with Astra Pro / ChatGPT4 (mastermidx4), the owner of the existing
[Macro design carrier](https://github.com/mastermindx-market-intelligence/macro/pull/10655).
The Chairman's 2026-11-03 Chicago continuation explicitly authorizes implementation
before F01 completion. It does not authorize Ready/un-draft, merge, enqueue,
held-PR relabeling or deployment. Final shared-shell composition and Paper write
admission remain separate gates. Rejected full-pane Refraction is excluded.

Protected procedure: Mastermind `910803421beca53ca25145392725ab2d84c7a8e9`.
Terminal base: `2ded360882b9c721e690907ff363b553781fb920`.
Managed operation: `d06-terminal-reader-resilience-20261103-c4`.
Branch: `sol/web-d06-terminal-reader-resilience-20261103-c4`.

The writer census found active Chart AI (#1048, including a dirty managed carrier),
Intelligence (#1252), Options (#1248), and startup work (#654). This slice does not
edit their ChartPanel, ChartPane, TerminalShell, Intelligence, or Options paths.
The original shared checkout is untouched.

Direct implementation exception: **NO_ELIGIBLE_PRE_EFFECT_WORKER / LOWER_TOTAL_OVERHEAD**.
The supplied Fabric capability reports adapter availability but admission and START
are unprobed. Both supplied Executive read operations returned backend_unavailable,
explicitly before sending the request, at 2026-11-04T00:45Z. No authenticated
root/parent/grant was obtained, and no Fabric modifying request was submitted.
The incumbent owner performs this bounded reader-only change in the acquired
workspace. A native reasoning adviser challenged focus/scroll race semantics only;
that is neither a builder commission nor independent review/approval.

## Frozen behavior

- Keep the existing reader, data callbacks, selected-bar cursor, calendar withholding,
  layer preferences, feedback, source labels and close/Settings ownership.
- Preserve the three disclosure sections through rail/inline portal replacement
  within one logically open reader and the same symbol/timeframe/replay identity.
- A transient missing portal host is a presentation gap, not an explicit dismissal.
- Remember the actual internal reader scroller (panel or bounded inline host).
  Restore a clamped offset to a new internal scroller. A plain inline page does not
  receive programmatic document scrolling; its last internal offset remains
  available when the reader returns to a bounded destination.
- Restore the same visible, enabled reader control only while reader focus is still
  owned, the document is focused, and no different control currently owns focus.
  Outside focus, pointer and keyboard intent cancel that ownership.
  No delayed focus callback is introduced.
- Explicit close or a different symbol/timeframe/replay identity clears presentation
  retention. Existing selected-bar behavior remains under its existing owner.
- Use controlled summary activation so a rapid toggle followed by a host change
  cannot lose a queued native details toggle.
- Preserve native semantic details/summary and keyboard activation.
- Extend the existing 44px control rule to phone-width fine-pointer layouts as well
  as coarse pointers. Reuse existing tokens, spacing and labels.

## Boundaries and validation

This is an implementation of the reader portion of D06 LAY06, LAY02/05 and A11Y01/02,
not completion of the broad 75-case migration plan. It does not implement the
shared 640px plot budget, rail keyboard resize, source clock corrections,
exact-bar AI handoff, public share lifecycle, or new backend/data contracts.

Focused DOM tests must cover disconnected old hosts, temporary null hosts,
disclosure retention, scroll-owner changes and clamping, outside focus/intent,
disabled or absent targets, explicit close, source changes, and StrictMode.
Existing real Terminal route tests must cover 1440x900, 820x1180 and 390x844;
narrow fine-pointer controls; the supported dark EN/ZH presentation; selected historical facts,
Escape and settings transfer. Fixture route proof is distinct from served beta
or deployment proof.

Validation and screenshot receipts are in [verification.json](pr-crops/d06-reader-resilience/verification.json).
Current state: **BUILT_AND_LOCALLY_VERIFIED / TERMINAL_PUBLICATION_BLOCKED**.
There is no implementation commit, Terminal PR, hosted CI, formal approval or deployment claim.

## Source contracts and state ownership

| Boundary | Existing owner retained | This slice |
| --- | --- | --- |
| Listing / interval / replay | VisualIntelligencePanel props and VisualFrame identity checks | Use the exact symbol, timeframe and replay flag as presentation identity; no inferred listing or separate selection |
| Historical inspection | Existing selected value, series index and onInspectTime callback | Host changes retain the current cursor; legitimate crosshair/Previous/Next/Latest events keep their existing meaning |
| Calendar / quote basis | getFund, visualCalendar, historical/replay withholding and current frame basis | No fetch, cache, entitlement, timestamp or truth-label changes |
| Layer and candle preferences | Existing onSettings and onCandleSettings callbacks | No new preference store; Candle settings continues to the Mastermind Candles indicator dialog |
| Close / return | ChartContextDock.onClose and TerminalShell's launcher fallback | New helper schedules no delayed focus; explicit close and Settings retain their incumbent owners |
| Disclosures / internal position | One component-owned ephemeral hook | No localStorage, backend, workspace schema, URL, global registry or migration |
| Geometry | Existing rail / inline / bounded inline hosts | No new shell slot, breakpoint, chart renderer, rail-width preference or page scroll owner |

When a source identity changes while the same reader DOM remains mounted, reset
the physical internal scroller to zero, with that zero pending through an
unbounded or absent host. Retain a focus claim only if it was still owned and the
same connected visible enabled control remains focused. An outside click that
left activeElement unchanged must not resurrect a cancelled claim.

The existing Terminal chart surface is intentionally dark-only (root tokens and
app/settings.css); language is EN/ZH. This slice preserves that source contract.
A forced data-theme attribute would not constitute a real light-mode journey.
Light composition remains a separate future requirement; no light screenshot or
whole-theme acceptance is claimed.

## Publication preflight — blocked before effect

The original managed publisher's read-only status call returned:
`REFUSED / NOT_APPLIED / TYPED_GIT_PRECHECK_REFUSED`.
No commit or push tool was called after that refusal.

A bounded read-only diagnosis on the same host found:
- Repository-qualified `mmx-workspace status --repository terminal` resolves this
  exact operation, base, branch and preserved dirty workspace successfully.
- The same status lookup without a repository argument returns
  "workspace is not registered to the source repository".
- The inspected publisher source calls status without a repository argument and
  checks against one configured Mastermind source repository. This is consistent
  with a repository-binding mismatch; the deployed gateway configuration and
  byte identity were not independently attested.

The publisher owner must qualify Terminal support for this existing operation
and the applicable same-carrier typed preflight. Do not change the operation,
branch, remote, account, source launcher or publisher configuration here. Do not
substitute raw Git or GitHub source writes for the refused Terminal effect.
No uncertain publication effect exists.

The existing Macro D06 research carrier may receive this factual continuation
and test/image evidence independently; it is not a replacement Terminal code
publisher. The implementation remains in this original managed workspace.

## Acceptance boundary and successor action

Local code/test completion, source publication, independent review, F01/F02
composition, deployment and actual served acceptance are separate stages.
The new Chairman authorization permits this independent build before F01 is
complete; it does not release a shell contract or remove the explicit release
hold.

Next executable action after a material publisher repair: read the same managed
workspace identity and exact file hashes, rerun the typed preflight, commit the
bounded verified file set through that publisher, push its same branch, and
open one Draft Terminal PR linked to Macro #10655. Preserve all explicit release
holds. Formal non-author review and hosted CI are not yet proven.

Rollback scope, if later required, is the reader component/CSS and the new
presentation hook. No data/schema conversion or saved-state rollback is needed.

## Executed verification

| Check | Actual result |
| --- | --- |
| Unchanged-source regression | The new desktop-to-inline test failed on the native disclosure reset before production edits |
| Final focused Vitest suite | 22 passed, including StrictMode and source-change ownership/reset cases |
| Final browser matrix | 57 passed, 12 intentional viewport skips, 0 failed, 0 flaky; desktop/tablet/mobile projects, two local workers |
| Browser suites | chart-context-resilience, chart-context-dock, visual-intelligence |
| TypeScript | npx tsc --noEmit --incremental false, exit 0 |
| Scoped lint | Reader component/helper and both new test files, exit 0 |
| Diff scope / whitespace | git diff --check passed; legacy screenshot outputs restored to their original contents |
| Visual evidence | 12 raw PNGs: two local pre-change captures, two transition captures, six EN/ZH viewport captures, two 320px fine-pointer captures |

The final browser run started at 2026-11-04T01:07:48.733Z and took 195.415 seconds.
The 12 skips are deliberate: crossing sequences run once in desktop, while native
viewport paths run separately. There were no retries in that final run.

The initial broad run passed all 43 executed incumbent browser cases but exposed
three incorrect paths in the newly written automation (five failures across
projects). They were corrected to the real focusable chart control, desktop
fullscreen entry and Mastermind Candles dialog, then passed. No production
behavior was changed to satisfy those mistaken test assumptions.

Twelve captures were inspected for readable hierarchy, wrapping, local clipping
and retained reader/plot separation. Six measured locale/viewport records retain
the actual dark background and widths (360px rail; 820/390px inline). Phone-width
fine-pointer and coarse-pointer cases pass 44px target assertions. Existing source
states remain visible; no missing field was replaced with a fabricated value.

The recorded source-file SHA-256/Git blob identities bind the tested working
files even though the publisher has not created an implementation commit.
The full 75-case migration plan, actual touch devices, 400% zoom, light composition,
screen-reader/contrast audit and served-after-build proof remain unqualified.
