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
| PE-2 Repair panel lifetime and refresh | PE-1 | ready | Panel-only source change, route-aligned semantic key, current-only rendering, request/busy retirement and preserved expansion. |
| PE-3 Prove actual composition | PE-2 | proposed | Real Portfolio caller, current repository runner, red/green discriminators, StrictMode, late fetch/body/error, unreadable transitions, ABA and expansion; EN/ZH responsive fixture proof. |
| PE-4 Review and qualify source | PE-3 | proposed | Non-author exact-head review, relevant hosted gates and actual composition; builder returns and releases its source responsibility. |
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
