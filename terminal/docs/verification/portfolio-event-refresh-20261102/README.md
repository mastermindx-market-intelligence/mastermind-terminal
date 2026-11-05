# Portfolio event-panel refresh — bounded continuation

Recorded: 2026-11-02. Task-tree revision: PE v1; the containing commit and readback receipt identify the exact plan bytes. This is an implementation subtree of the existing Portfolio project, not a new workstream, runtime job registry, or replacement Market OS plan.

- Workstream / true parent: WS:MARKET-OS / WS:MARKET-OS.
- Owning repository: mastermindx-market-intelligence/mastermind-terminal.
- Source path: terminal/docs/verification/portfolio-event-refresh-20261102/README.md.
- Branch: sol/web-portfolio-event-refresh-20261102.
- Application baseline: 82a8cd89c0925f68301034f9b47d94261b88a82a.
- Protected procedure: mastermindx-market-intelligence/Mastermind@ae3fc6fce8f704b32b01664f1b0d1c0d52a1c8ed, docs/sol_skills/INDEX.md, skillpack 1.0.1 / bootstrap 1.
- Existing project record: terminal/docs/PORTFOLIO_IMPLEMENTATION_AND_RESEARCH.md and [Portfolio recovery PR #1044](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1044).
- Continuation authority: Chairman requests recovery and continuation of Implement Portfolio Terminal. Existing Fable flagship Today ownership, chart PR #1212 and held Risk PR #1143 retain their independent custody.
- Organizational linkage: PLAN_NOT_ORG_LINKED. This is committed repository evidence; no Agent OS artifacts pointer or accepted organizational wave has been changed. The current Market OS flagship receiver remains the lawful writer for its cumulative organizational record. The source repair is independent of that missing plan-link receipt.

## Intended outcome and boundary

A Portfolio user who edits a holding must see event facts for the resulting canonical book. Same-count changes to position id, ticker, shares or status must trigger a fresh read. Old responses must not replace current facts or clear the current request's busy state. A committed input change must not present the prior input's result as current while refresh is being scheduled.

Preserve Show all across meaningful same-count edits. Preserve the existing collapse policy on position-count or holdings-unreadable transitions. Preserve owner-keyed retirement, both languages, native layout, typed failure distinctions, source disclosure, and all route/auth/math/currency/persistence behavior.

DONE_WHEN: the actual caller and route projection are matched; meaningful tests fail the current baseline and pass the repair; exact-head independent review and hosted gates qualify the source; ordinary delivery separately proves the served revision and appropriate user path. Builder completion alone is not production acceptance.

## Current evidence and decision

Current EventImpactPanel blob dde9f2271200c4ec44824427de65192d4365df5f loads on holdingsUnreadable and positions.length only, and has no request-generation retirement. Current event-impact route blob 7e175291c2294d9752e9f48d30591647c79676ea projects id/ticker/shares/status. PortfolioView blob e5f8abbb848dc5a60c2d58f6b8a3c1ffe7b59ef6 supplies the panel inside owner-keyed PortfolioWorkspace.

The [preferred October support proposal](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1044#issuecomment-6344733581) is unadopted supporting evidence. It supersedes the earlier whole-panel remount proposal. Its historical 72-case synthetic result is not current native or production acceptance. Do not apply both proposals.

Adopt semantic-input detection plus request-generation retirement, with an explicit rendering or committed-lifetime guard so passive-effect scheduling cannot expose obsolete facts as current. Do not mutate generations during speculative render. Existing owner-keyed retirement is the account boundary; do not add an auth listener or store. Avoid changing PortfolioView or PortfolioWorkspace.

The November 2 scoped PR path census found no EventImpactPanel overlap in #888, #866, #904, #902, #849, #1011, #714, #761 (both pages), #1212 or #1143. This is a scoped source observation, not a complete live-worker lease census. The builder must honor actual harness custody and stop on a current collision.

## Task subtree

| Task | Dependency | Editorial state | Acceptance |
| --- | --- | --- | --- |
| PE-1 Verify current defect and scope | Existing Portfolio implementation | accepted | Exact panel, caller and route blobs inspected; preferred proposal identified; current source still lacks semantic refresh and async retirement. |
| PE-2 Repair panel lifetime and refresh | PE-1 | implemented (builder); repaired 2026-11-02 after an independent review found the expansion-grant defect; not independently reviewed since | Panel-only source change landed: route-aligned semantic key, published read bound to that key plus the committed lifetime, current-only rendering, request/busy retirement, expansion preserved. The 2026-11-02 repair adds the one thing the first build did not do: RETIRE the expansion grant at a committed count/readability boundary. Typecheck and lint clean; see the evidence sections for what is and is not proven. |
| PE-3 Prove actual composition | PE-2 | implemented (builder); repaired 2026-11-02; not independently reviewed | Real Portfolio caller executed through the actual PositionModal edit and canonical readback; red/green discriminators, StrictMode, late fetch/body/error at both retirement stages, unreadable transitions, ABA and expansion; EN/ZH responsive browser proof at the three contract viewports, plus the 2026-11-02 desktop-only EN/ZH browser exercise of the expansion round trip. See the evidence sections. |
| PE-4 Review and qualify source | PE-3 | ready | Non-author exact-head review, relevant hosted gates and actual composition; builder returns and releases its source responsibility. The candidate is published as a DRAFT; hosted checks and independent review were still pending at the builder's return. |
| PE-5 Release and accept | PE-4 | blocked | Current release owner, merged/deployed source and served evidence agree. Authenticated production acceptance requires a current permitted identity and grant. |

## Required discriminators

1. Independently change id, ticker, shares and status at the same array length. Identical semantic copies and entry-price/notes-only changes must not spuriously refresh.
2. Preserve Show all for same-count changes, while obsolete rows disappear from current presentation during the new read. Original count/unreadable collapse remains.
3. Hold fetch and body completion independently; test obsolete success, 401, typed 503, malformed body, network error and finally against newer success/checking/busy.
4. Commit A-to-B-to-A input changes and resolve the first A last. Key equality alone must not resurrect its response.
5. Readable-to-unreadable invalidates before early return, initiates no inappropriate fetch and settles busy. Recovery starts a new read.
6. Owner retirement, unmount and StrictMode setup-cleanup-setup do not publish retired work or permanently disable the current load.
7. Prove actual PortfolioView -> PortfolioWorkspace -> EventImpactPanel updates after a successful position edit and canonical readback, and preserve existing failure/source copy. Test fixtures only.
8. Exercise required desktop 1440x900, tablet 820x1180 and mobile 390x844 in EN/ZH, with repository browser fixtures, retries disabled, and truthful screenshot/source receipts. Scope tests to remaining concrete risk; do not enlarge the full program.

## Writer and effect fences

Only EventImpactPanel, focused tests and this evidence directory are writable by the bounded builder. No edits to chart PR #1212, PortfolioView, PortfolioWorkspace, shared shell, API routes, RLS, migrations, production credentials or live accounts. The current one-use disposable-account QA grant is consumed and cannot be reused.

Migration 0036 is already applied; preserve original SQL and receipt. PR #1143's independent review was explicitly rejected; do not retry or substitute this operation for it. Original OHLC publisher lock_busy/unknown effects are a separate dependency, not permission to retry publication or remove locks. No merge, deploy, Ready, auto-merge or external messaging is delegated.

After source/tests/evidence are complete, publish only ordinary fast-forward commits to the named branch and return exact head/tree, commands, results, artifact digests, limitations and source-cleanliness/custody evidence. Independent review and release remain separate. NOT_WATCHER_ENABLED after terminal return.

## Bounded continuation — builder evidence (2026-11-02)

This section records what the bounded builder actually executed. It does not claim acceptance: PE-4
(non-author exact-head review) and the hosted gates are separate, and PE-5 remains blocked.

### Source change

Panel blob `dde9f2271200c4ec44824427de65192d4365df5f` → `d9fb301f11354dec9df86aef9221ec5e85c6dc0f`
(`terminal/components/EventImpactPanel.tsx` only). The copy table, the JSX, the typed failure
mapping and the route contract are unchanged; the change is the read's lifetime.

1. **Route-aligned semantic identity.** The identity is exactly the route's own projection —
   `{id, ticker, shares, status}` per position, canonicalised (sorted), because the route re-reads
   the book with its own ordered query and never sees this array. Cost basis, notes, currency and
   dates are not projected, so they cannot start a read; an unreadable book is its own identity.
2. **A published read is bound to the identity AND the committed lifetime it was fetched for.**
   The lifetime is an epoch that advances once per COMMITTED identity change, carried in React
   state and advanced with React's documented "adjusting state when a prop changes" pattern — the
   same idiom `PortfolioView` uses for its owner-scoped seed reset. React discards a speculative
   render, so the render that commits already carries the new epoch and a render that never
   commits never advances it. No generation is mutated during render.
3. **Rendering is current-only.** A published read renders as current only when its identity is
   the identity committed right now and its epoch is the committed epoch. A committed input change
   therefore removes the previous input's rows from the committed render itself, before any effect
   runs — the obsolete facts are never painted while the fresh read is being scheduled.
4. **Request retirement.** Every attempt carries a per-effect-lifetime token (unmount and
   StrictMode setup-cleanup-setup revoke it) and a monotonic sequence (a newer attempt retires an
   older one). The response, the body, the error and the `finally` are all fenced: a retired
   attempt may neither publish nor clear the current attempt's busy state. The read's sequence is
   bumped on every identity change, so an A → B → A excursion retires the first A's response.
5. **Expansion policy — CORRECTED 2026-11-02. The original wording was:** *"Expansion policy
   unchanged. Expansion is remembered with the boundaries it was granted under (open-position
   count and book readability), so it survives every other change — including a meaningful
   same-count edit — and ends exactly on the existing count/unreadable boundaries. No new effect
   was introduced for it."* **That claim was wrong.** The grant was stored but never retired, so
   the panel only LOOKED collapsed while the boundaries differed, and a later commit that
   returned the boundaries to the values the grant was made under restored it — "Show all"
   reopened for a boundary the user never granted. The independent review of this candidate
   found that with two falsifiers, the parent returned REQUEST_CHANGES/STOP, and the bounded
   repair recorded below retires the grant. No new effect was introduced for it, before or
   after: the repair is a render-time state adjustment, the same idiom the committed lifetime
   uses for its epoch.

The preferred October support proposal was used as supporting evidence for the portable shape
(semantic key + generation retirement); it was not applied, and its 72-case synthetic result is
not this acceptance. It was not combined with the earlier whole-panel remount proposal.

### Files written

| Path | Blob |
| --- | --- |
| `terminal/components/EventImpactPanel.tsx` | `d9fb301f11354dec9df86aef9221ec5e85c6dc0f` |
| `terminal/lib/__tests__/eventImpactPanelRefresh.test.tsx` | `e0c08d10243ae7ba6719c563b47359d4c1a8c8ba` |
| `terminal/lib/__tests__/eventImpactPanelActualCaller.test.tsx` | `886eb92306df8c2e0c4d16901479d44cb782bfc3` |
| `terminal/e2e/portfolio-event-refresh.spec.ts` | `25c80c5cf7f3742b7a187b17d6a2528e802f7357` |
| `terminal/docs/verification/portfolio-event-refresh-20261102/README.md` (this file) | the containing commit identifies its exact bytes; the pre-continuation plan blob was `f11e5a673a94a05a4bce9ea47ce9686042095b87` and is preserved unchanged above it |

No other path was written. `PortfolioView`, `PortfolioWorkspace`, `TerminalShell`/chart
controller, routes, API/auth/RLS, math/currency and shared shell are untouched.

### Test-first evidence (actual caller and panel, current repository runner)

Baseline panel blob `dde9f227…` restored in place for the RED run, then the repair restored:

| Suite | Baseline (RED) | Repair (GREEN) |
| --- | --- | --- |
| `lib/__tests__/eventImpactPanelRefresh.test.tsx` (31 cases) | 20 failed / 11 passed | 31 passed / 0 failed |
| `lib/__tests__/eventImpactPanelActualCaller.test.tsx` (6 cases) | 4 failed / 2 passed | 6 passed / 0 failed |
| both, combined (37 cases) | 24 failed / 13 passed | 37 passed / 0 failed |

Commands (from `terminal/`, `CI=1`):

- `npx vitest run lib/__tests__/eventImpactPanelRefresh.test.tsx lib/__tests__/eventImpactPanelActualCaller.test.tsx` → exit 0, `Test Files 2 passed (2)`, `Tests 37 passed (37)`.
- `npx vitest run lib/__tests__/eventImpactPanelRefresh.test.tsx lib/__tests__/eventImpactPanelActualCaller.test.tsx lib/__tests__/eventImpact.test.ts lib/__tests__/eventImpactPanelRender.test.ts lib/__tests__/portfolioWorkspaceOwnerPanels.test.tsx lib/__tests__/eventImpactRoute.test.ts` → exit 0, `Test Files 6 passed (6)`, `Tests 113 passed (113)`. The pre-existing panel-render, owner-panel, pure-join and route suites are unchanged and green.
- `npx vitest run` (whole terminal suite) → exit 0, `Test Files 1033 passed | 5 skipped (1038)`, `Tests 17540 passed | 47 skipped | 4 todo (17591)`. The pre-change run was `1032 passed | 5 skipped (1037)` and `17534 passed | 47 skipped | 4 todo (17585)`. **CORRECTED 2026-11-02:** the original wording here said "the delta is exactly the two new files". The two figures differ by 6, while the two new files contain 37 cases (31 + 6), so that wording cannot be reconciled with the counts and is withdrawn as unverified. These two suite totals are the earlier run's reported figures; the 2026-11-02 repair run did not repeat the whole-suite run, so they are recorded here as dated history and are not re-certified by it.
- `npx tsc --noEmit -p tsconfig.json` → exit 0, no diagnostics.
- `npx eslint components/EventImpactPanel.tsx lib/__tests__/eventImpactPanelRefresh.test.tsx lib/__tests__/eventImpactPanelActualCaller.test.tsx` → exit 0, 0 problems. The baseline panel reported 1 error (`react-hooks/set-state-in-effect`) and 1 warning; the repair removes both.

Discriminator coverage, as executed: independent id / ticker / shares / status changes at the same
array length each start a fresh read; an identical semantic copy in a new array and entry-price,
entry-date, notes and entry-currency-only changes do not; a committed input change removes the
previous rows from the committed render; Show all survives a same-count change and still collapses
on the count and unreadable boundaries; the fetch stage and the JSON body stage are retired
independently, against obsolete success, 401, 429, typed 503, malformed body and network failure,
and a retired completion cannot clear the current busy state; A → B → A with the first A resolved
last does not resurrect it; readable → unreadable invalidates, fetches nothing and settles busy,
and recovery reloads; unmount and StrictMode setup-cleanup-setup publish nothing retired while the
current load works.

### Actual caller

`lib/__tests__/eventImpactPanelActualCaller.test.tsx` mounts the real `PortfolioView` (inside the
real `LangProvider`) with only `@/lib/dataCache` mocked, drives the real workspace's record
inspector → the real `PositionModal` → the real mutation queue → the real canonical reread, and
asserts the panel's facts on the other side of it. The mock applies the canonical writer's own
`normalizeTicker` / `normalizeNumeric` / `normalizeEntryCurrency` / `normalizeEntryDate` /
`normalizeNotes` to the written record, so the receipt is the store's own normalization rather
than a hand-rolled coercion. Both registers are exercised (EN and ZH).

### Native browser proof

`terminal/e2e/portfolio-event-refresh.spec.ts`, run against the repository's own Playwright
configuration and fixture dev server (`TERMINAL_E2E_FIXTURE=1`, port 3199 for this run):

```
CI=1 TERMINAL_E2E_PORT=3199 npx playwright test e2e/portfolio-event-refresh.spec.ts \
  --retries=0 --workers=1 --reporter=list
```

- Baseline panel blob `dde9f227…`: **6 failed** (all three viewports, both registers) — the panel
  never invalidated the previous read, so `event-impact-checking` never appeared.
- Repair: **6 passed (46.1s)** — desktop 1440×900, tablet 820×1180 and mobile 390×844, EN and ZH,
  retries 0, one worker, no skips.

Each case seeds the holding through the product's own route (`POST /api/portfolio`), edits it
through the real modal, and then asserts that the committed edit retires the previous facts
(`event-impact-checking` visible, the previous marker and the previous held size gone, zero rows),
that the fresh read answers for the resulting book, and that the page has no horizontal document
overflow at that viewport.

The `/api/event-impact` route's own response is **not** executed in the browser: the macro
calendar artifact is not reachable from this host, so the route would answer a transport failure
rather than a calendar, and the proof would be about that failure instead of about the panel. The
served payload is the route's own response shape, served from the browser so the panel's states
are deterministic — it is a fixture and is labelled as one. The route's projection and its typed
failure states are source-verified in the unit suites, not executed. The holdings side of the
journey is real.

Browser artifacts (sha256):

| Artifact | sha256 |
| --- | --- |
| `browser/desktop-en-refreshed.png` | `183f79adcfa91ef94a344e95086a3e85c152e2ba2e1cce10397ff8de0f9954c8` |
| `browser/desktop-zh-refreshed.png` | `59b7be7e42166ba43fe7e20119e3814c3036b4d740dfb7d10cc52c8749f641e1` |
| `browser/tablet-en-refreshed.png` | `ce10114b6d8c85c1664fb9383c0ec0252e85d47a9b3a77268ab517f9bca310c5` |
| `browser/tablet-zh-refreshed.png` | `e1532871a145c986b41bfb8644d74543aff3768103ce1b75711b6f4c800b12b3` |
| `browser/mobile-en-refreshed.png` | `0bcca823b5dc75f0417d440e8d78bed05d58d894e7705ecd8f88d0874518ab7a` |
| `browser/mobile-zh-refreshed.png` | `2dcee8073fd61cdd0e784c844af0d5f069b040a353065ffa208b5399fe682969` |

### Custody observed at build time

A live path census over **all 167 open PRs** in `mastermindx-market-intelligence/mastermind-terminal`
found no overlap with `terminal/components/EventImpactPanel.tsx`,
`terminal/app/api/event-impact/route.ts`, `terminal/lib/eventImpact.ts` or
`terminal/components/PortfolioWorkspace.tsx`. `terminal/components/PortfolioView.tsx` is owned by
#866 and was not touched. The three new file names were confirmed unused by every open PR before
they were created. This is a scoped source observation, not a lease or private-owner liveness
assertion; harness custody still controls.

### Limitations and what is NOT claimed

- Builder completion only. No self-review acceptance, no independent review, no hosted-gate
  result and no production-complete claim. The candidate is published as a **draft**.
- No authenticated production proof: the browser proof ran against the local fixture dev server
  with the browser signed out of any real account, and no production account was mutated. The
  one-use disposable-account QA grant remains consumed and was not reused.
- The event-impact route was not executed end-to-end anywhere in this work — source-verified only.
- The native browser proof covers the event panel's own behaviour, not the whole Portfolio
  journey, and it deliberately drives the edit from the overview so the panel stays on screen.
- The full responsive suite (`npm run test:e2e:responsive`) was not run locally; this run's
  browser proof is the three contract viewports for this surface only.
- The 2026-11-02 PR path census is a point-in-time observation.

## Bounded semantic repair — expansion grant retirement (2026-11-02)

Run `portfolio-event-refresh-repair-20261102-c1-002`. A NEW bounded semantic repair of the
independent review blocker on PR #1213 — not a rerun of the original build, and not a
maintenance-only release takeover. It claims no acceptance: PE-4 (non-author exact-head review)
and the hosted gates are separate and still pending, PE-5 remains blocked, and the candidate
stays a DRAFT, unarmed.

### Authority and exact source

- Parent ruling: REQUEST_CHANGES / STOP —
  https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1213#issuecomment-6572997905
- Independent reviewer `portfolio-event-refresh-review-20261102-c2-001`: TERMINAL, rc0,
  NOT_WATCHER_ENABLED. The original builder `portfolio-event-refresh-20261102-c1-001`: TERMINAL,
  rc0, NOT_WATCHER_ENABLED. Neither reported a pending modify.
- Branch: `sol/web-portfolio-event-refresh-20261102` — unchanged. No new branch, no force, no
  reset, no rebase.
- Source before this repair: head `a13693bd9513b4e48cb8c8e883f767f9cdbc550e`, tree
  `799e8d8216de5ce5790561578f53b94440f0e4b0` (the exact head the reviewer reviewed).
- Custody: a fresh worktree created for this run at that exact head, detached and clean; the
  shared primary checkout was not used and not touched.

### The defect, precisely

`expandedUnder` held the boundaries the expansion was granted under and was compared against the
current ones on every render — but it was never cleared. The comparison MASKS the difference
instead of ending the grant: while the boundaries differ the panel looks collapsed, and when a
later commit returns the boundaries to the values the grant was made under, the stored grant
matches again and "Show all" reopens. Two round trips show it:

- expand under 8 positions → commit 7 → commit 8: 8 rows where 6 were required.
- expand under 8 positions → commit the book unreadable → commit it readable again: 8 rows where
  6 were required.

The reviewer's two independent falsifiers failed this candidate (2 fail) and passed the original
panel (2 pass); falsifier SHA256
`80e6158c471836e87f64c6668fd199060f998bdb5ddfdff3f06c123e0374f786`. This run reproduces both
independently — see the RED row below.

### The repair

One thing changed in the panel: the grant is now RETIRED, once, at the first committed boundary
that differs. It uses React's documented "adjusting state when a prop changes" pattern — the same
idiom the committed lifetime uses for its epoch, and the same one PortfolioView uses for its
owner-scoped seed reset. React discards a speculative render and re-renders immediately, so the
render that COMMITS already carries the retired grant, and a render that never commits never
retires it. Nothing is mutated in place during render, so a render React goes on to discard
cannot burn the grant — the same guarantee the epoch already has.

The retirement condition reads only the open-position count and the book's readability, so a
meaningful same-count edit (id, ticker, shares or status) and any irrelevant or order change
still preserve the expansion. The request identity/epoch/token/sequence design, PortfolioView,
PortfolioWorkspace, the route, auth, math, the shared shell and the chart/cache branches are
unchanged, and no new effect was introduced.

### Test-first evidence (current repository runner)

The two round-trip cases were added FIRST and run against the exact baseline panel
(`d9fb301f11354dec9df86aef9221ec5e85c6dc0f`) before the repair was written.

| Run | Command | Result |
| --- | --- | --- |
| RED — baseline panel, the two new cases | `CI=1 npx vitest run lib/__tests__/eventImpactPanelRefresh.test.tsx` | `Tests 2 failed \| 31 passed (33)` — both round trips reported 8 rows where 6 were required (`expected …(8) to have a length of 6 but got 8`) |
| GREEN — repaired panel, focused | `CI=1 npx vitest run lib/__tests__/eventImpactPanelRefresh.test.tsx lib/__tests__/eventImpactPanelActualCaller.test.tsx` | exit 0, `Test Files 2 passed (2)`, `Tests 39 passed (39)` (37 + 2) |
| GREEN — repaired panel, supporting risk surface | `CI=1 npx vitest run lib/__tests__/eventImpactPanelRefresh.test.tsx lib/__tests__/eventImpactPanelActualCaller.test.tsx lib/__tests__/eventImpact.test.ts lib/__tests__/eventImpactPanelRender.test.ts lib/__tests__/portfolioWorkspaceOwnerPanels.test.tsx lib/__tests__/eventImpactRoute.test.ts` | exit 0, `Test Files 6 passed (6)`, `Tests 115 passed (115)` (113 + 2) |
| typecheck | `npx tsc --noEmit -p tsconfig.json` | exit 0, no diagnostics |
| lint | `npx eslint components/EventImpactPanel.tsx lib/__tests__/eventImpactPanelRefresh.test.tsx` | exit 0, 0 problems |

The one-way and same-count controls are unchanged and still green: the panel still collapses on
the count boundary and on the unreadable boundary, and the expansion still survives a same-count
edit.

### Native browser proof (2026-11-02)

The existing six-case browser proof predates this source, so the repair's own behaviour was
exercised once in a real browser, in both registers, against the repository's own Playwright
configuration and fixture dev server (`TERMINAL_E2E_FIXTURE=1`, port 3207 for this run):

```
CI=1 TERMINAL_E2E_PORT=3207 npx playwright test e2e/portfolio-event-refresh.spec.ts \
  -g "expansion is retired" --retries=0 --workers=1 --reporter=list
```

- Baseline panel `d9fb301f…`: **2 failed** (EN and ZH), exit 1 — after the count came back the
  panel showed **7 rows where 6 were required**: the grant came back with the boundaries. The
  call log shows the sequence plainly — 0 rows (the previous read retired, the fresh read in
  flight) and then 7 rows, persistently.
- Repaired panel: **2 passed (13.7s)**, exit 0; the tablet and mobile projects are skipped for
  this case (one exercise per register).

The exercise: seed two holdings through the product's own route, expand the panel to seven rows,
close one holding through the workspace's own record inspector (the count boundary changes from
two to one), and reopen it (the count comes back to two). The panel must be COLLAPSED at the end
and must be showing a fresh read of the book, not the facts it was showing before. Two holdings,
not one, because the workspace renders its empty state — and unmounts the panel with it — when no
position is open.

Browser artifacts (sha256):

| Artifact | sha256 |
| --- | --- |
| `browser/desktop-en-expansion-retired.png` | `e02a9b6b31eadf6bf32077155fbcf95c8cf2796a7d4de90ec3a866d92e3e283a` |
| `browser/desktop-zh-expansion-retired.png` | `f6d449e1cd70f2f2352af1ee88abc5da6798526eef2d7cbd79ce4fe6a6128818` |

The six earlier responsive artifacts are PRESERVED, not recaptured: their bytes are unchanged and
still hash to the digests recorded in the section above (re-verified 2026-11-02).

### Files written by this repair

| Path | Blob |
| --- | --- |
| `terminal/components/EventImpactPanel.tsx` | `cbd8a0d3278cf87770666756e23f9fffb399a2e6` |
| `terminal/lib/__tests__/eventImpactPanelRefresh.test.tsx` | `ef2a3a08c31d02566838e8de11f893463aee7c05` |
| `terminal/e2e/portfolio-event-refresh.spec.ts` | `c6115665116056c7bb5302be01cdc3c20ce36973` |
| `terminal/docs/verification/portfolio-event-refresh-20261102/README.md` (this file) | the containing commit identifies its exact bytes |
| `terminal/docs/verification/portfolio-event-refresh-20261102/browser/desktop-en-expansion-retired.png` | new artifact |
| `terminal/docs/verification/portfolio-event-refresh-20261102/browser/desktop-zh-expansion-retired.png` | new artifact |

The e2e spec is this feature's own browser-proof file, created by the original build on this
branch; the repair run added the expansion case to it because the browser exercise is required
evidence for this change and has to be reproducible from the repository. It is a focused test of
this feature, and no other worker or pull request owns it (the open-pull path census in the
section above found no overlap). No path outside this feature's own set was written.

### Limitations and what is NOT claimed by this repair

- Builder completion only: no self-review acceptance, no independent review, no hosted-gate
  result, no production-complete claim. The candidate stays a DRAFT and unarmed; no Ready, no
  merge, no deploy.
- The whole-terminal suite was NOT repeated by this run (no actual need and no required gate).
  The whole-suite counts in the earlier section are that run's reported figures, recorded as
  dated history, and are not re-certified here.
- The reviewer's "5 additional lifetime probes" are the reviewer's own probes against the
  baseline; they are not a repository suite and were not re-run here. The repository's
  lifetime-adjacent coverage for this surface is inside the 115-test set above.
- The interrupted/discarded-render guard is structural, not unit-tested: the retirement is a
  React state adjustment, so React discards it together with the render it belongs to, exactly
  as it discards the epoch adjustment. There is no deterministic way to force a render that is
  started and then discarded in this jsdom harness, so no test claims to cover it.
- The browser proof covers the event panel's own expansion behaviour, not the whole Portfolio
  journey, and the served event payload is the route's own response shape served from the
  browser — a fixture, labelled as one. The holdings side of the journey is real. There is no
  authenticated production proof, no live account, and no production route execution.
- The one-use disposable-account QA grant remains consumed and was not reused. No live account
  was mutated.
