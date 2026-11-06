# Mastermind Terminal — shared agent operating rules

This repository and Macro Dashboard are operated by multiple Claude accounts and
Codex sessions. Repository files are the durable, shared source of instructions;
promises or “memory” recorded only inside one chat do not carry to another session.

## Session-owned PR/source review (Chairman 2026-11-03)

The assigned attended CEO Web session owns the actual source diff, self-review, focused tests, required CI and authorized release. **FAST, STANDARD, and CRITICAL do not impose a blanket independent technical reviewer, Fabric/Dot/native-child handoff or additional formal non-author approval on attended Web work.** A risk tier still determines proportionate security, regression and real-path proof; incomplete source is HOLD, not a shortcut. A different ChatGPT Web, Codex or Claude top-level session is never the default review prerequisite. Existing native GitHub/CODEOWNERS approvals, recorded release/security holds, exact-head CI, source custody and non-author merge authority remain binding; never self-approve, self-merge or bypass a required control. This attended-session waiver does not disable the separate signed automatic GitHub/Executive machine review path.

The Mastermind #2018/#2026/#2030 sources and Terminal #1251 T0 classifier have separate protected-release and installation receipts. A proposed PR, author-supplied "routine" label, or uninstalled risk consumer proves neither an automatic machine exemption nor a native GitHub approval. Verify the actual protected source and installed consumer when those facts affect a decision; do not wait for those optional machines before doing permitted attended-Web source work. Codex and Claude sessions also complete their own assigned source/test/release work in-session rather than requiring another top-level chat.

Only when an actually binding native/security requirement or an explicit eligible manual request demands distinct technical scrutiny should the session commission a qualified read-only reviewer, using a true in-session Codex/Claude child, exposed Web Pro child or admitted Fabric when authorized and useful. Verify separate context, exact source head, findings and parent adjudication. Author self-check remains `SELF_REVIEWED`; a technical child is **not** formal GitHub non-author `APPROVED`. No denied or EFFECT_UNKNOWN reviewer operation may be rerouted. Preserve the existing protected merge-on-green and no-author-merge controls. Repository text does not itself edit live ChatGPT Project or client settings.

## Finish the existing release, not the draft

The assigned session owns the original PR through qualified source/tests, failing-CI repair, Ready when reviewable, genuinely required technical/formal review, authorized protected merge-on-green, exact merge readback, git-gated deployment and owed live browser proof. An open Draft, PR, pending CI, review request, label or handoff is **not done**. Do not open another PR to bypass failing checks, an inactive reviewer account or a held original; preserve the source carrier and get the next real release step done this turn. Continue safe unblocked work while any real external wait proceeds through the existing verified observer. Branch protection, review findings, recorded HOLD, source custody, denied/unknown effects, no self-approval and no self-merge remain binding.

## Required context for the current scope

1. Read `terminal/AGENTS.md` and `terminal/CLAUDE.md` in full before changing the
   Next.js application. Reuse instructions already read in full in this session
   at the same applicable source revision across commands and subsequent tasks.
   Refresh affected instructions when scope or their governing source changes;
   read any unseen or newly applicable instructions before the work they govern.
   This reuse preserves the nested guides' specialized contracts and required
   framework documentation.
2. Treat local Claude project memory as optional context, not a startup or
   delivery gate. The historical index at
   `~/.claude/projects/-Users-chriswong-Documents-Cluade-charting-app/memory/MEMORY.md`
   and its `git-flow-commit-pr-merge-habit`, `prod-repo-is-stale`, and
   `deploy-topology` notes may be read when relevant and accessible. If absent,
   recover from current source and canonical Agent OS instead. Local memory
   never establishes a live owner, permission, or effect clearance.
3. Treat `/Users/chriswong/Documents/Cluade/Macro Dashboard` as the connected
   dashboard/backend repository. Authentication, subscriptions, data contracts,
   APIs, Caddy routes, and deployment changes may require checking both repos.
4. When the task belongs to an existing Mastermind workstream, read its Agent OS
   record and latest handoff first — see § "Agent OS knowledge plane" below.

## Agent OS knowledge plane (organizational memory)

- The canonical store is the Macro repo's `agentos/` directory
  (`/Users/chriswong/Documents/Cluade/Macro Dashboard`): workstream records
  (`WS-*`), decision records (`DEC-*`), discovery records (`DSC-*`), and session
  handoffs. Rules of the store: `agentos/README.md` there; handoff protocol:
  Macro `research/MASTERMIND_AGENT_HANDOFF_PROTOCOL.md`. Never create a
  Terminal-local copy or mirror of any part of it.
- At task start, when the task belongs to an existing Mastermind workstream, read
  its `WS-*` record, its latest handoff, and the decisions/discoveries they cite.
  `do_not_redo` entries are binding unless refuted with new evidence. Records are
  context, not permission — this file's delivery rules still govern work here.
- Write records for real events only, as normal Macro PRs: a `DEC-*` when a choice
  with durable consequences is taken, a `DSC-*` when a durable non-obvious fact is
  verified (both a falsifier and a so-what are required), and a handoff when
  claimed work transfers to another session or pauses in a state another session
  must resume. Facts that live only in one chat's memory are lost to the next
  session and to Codex — that is the gap this store exists to close.
- Agent OS is a knowledge plane, never a control plane: nothing in it gates
  execution, schedules work, ranks priorities, or proves a worker is alive.
  Terminal delivery remains governed entirely by this file — CI, merge-on-green,
  the git-gated deploy, and live verification are unchanged.

## Current receiver and executable handoffs

A handoff that says "only the original writer/parent must act" is a custody
clue, not a living session or approval gate. The currently assigned receiver
inspects the original PR/workspace, live writer/lease and unresolved effects,
then executes the next permitted recovery action or safe independent work.
Keep STARTed exact-session bindings and EFFECT_UNKNOWN on the existing carrier;
handoff text never transfers those effects, releases a lease, or proves ACK. A successor handoff names the current or next valid receiver,
exact source/effect checks, real CI/review/release gates and a reachable next
action; never an archived chat as the only actor.

## Workspace and git

**Authoring-surface boundary (conditional on accepted Mastermind source):** The
`mmx-workspace` and local checkout constraints below govern sessions that actually
edit, commit or publish using an M2 host filesystem/process. Once Mastermind PR
#2118 has **merged to protected `master`**, and the current protected
`docs/DELIVERY_WORKFLOW.md` explicitly admits it, a separately authorized Web,
Claude or Codex session using GitHub-native source APIs may create/update an
isolated branch, commit and open its own PR without acquiring an M2 worktree
for that remote-only operation. An open policy PR is not installed authority.

Preserve exact repository/source pin, original operation branch/carrier,
preimage or expected-head CAS, competing writers and denied/unknown effects.
A pre-existing local uncommitted change cannot be moved to GitHub API as a
workaround for a refused host publication. All M2-local work still obeys the
installed launcher, occupied-checkout restrictions and source-storage guards;
neither route permits direct `master` writes, review/CI bypass, self-approval,
self-merge or bypass of Terminal's `merge-on-green` release contract.

- The canonical project home is `/Users/chriswong/Documents/Cluade`.
- Never create project work in `~/.codex/worktrees`, `/private/tmp`, or another
  Codex-only location. Never use a `codex/` branch for these repositories.
- The primary checkout is shared and commonly dirty. Never change its files or git
  state. Attended ChatGPT Web/Studio sessions acquire or reuse one exact source-pinned
  operation workspace through the installed `mmx-workspace` owner, as authorized for
  this repository. Native/harness sessions use their actual assigned source launcher
  and workspace; only those with an approved direct-worktree contract may create one
  under its designated root. Do not create an alternate worktree or force/re-home an
  existing operation to bypass a refusal, exclusive writer, or uncertain effect.
- Never reuse a squash/merge-completed branch and never use the repo-global stash.

## `ingest/` runs as scripts, not modules

- `ingest/refresh_fund.sh` and `ops/nightly_fund.sh` invoke the emitters as
  `$PY ingest/gen_fund_us.py`, so `sys.path[0]` is `ingest/` — **not** the repo root.
  A bare `from ingest.<mod> import ...` therefore **passes pytest** (which puts the root
  on `sys.path`) and raises `ModuleNotFoundError` in the nightly, aborting the run before
  deploy. Factoring a shared helper out of an emitter needs the house bootstrap:
  `CA_ROOT = Path(__file__).resolve().parents[1]`, `sys.path.insert(0, str(CA_ROOT))`,
  then the import with `# noqa: E402` (see `gen_slices_all.py`).
- Verify with `cd ingest && python3 -c "import gen_fund_us"`, never with pytest alone.
- `gen_fund_*.py` write to `CA_ROOT/terminal/public/data`, so running an emitter from a
  worktree is a safe dry run that cannot touch production.

## One responsive Terminal

- `terminal/` is the only product implementation for desktop, tablet, and mobile. Do not create
  device-specific repositories, long-lived mobile branches, duplicated API routes, or separate
  business-logic implementations.
- `feat/mobile-terminal-redesign` and the historical `charting-app-mobile` worktree are retired
  development artifacts, not delivery targets. New work starts from `origin/master`.
- Every user-facing Terminal change must be verified at 1440×900 desktop, 820×1180 tablet, and
  390×844 mobile. Run `npm run test:e2e:responsive` from `terminal/`; update the shared responsive
  shell and test together when behavior intentionally changes.

## Native app shells (`apps/`)

- The installable iPhone/iPad/macOS apps (later Windows/Android) are thin native hosts around the
  Terminal, governed by `docs/NATIVE_APPS_ALPHA_MASTERPLAN_2026-07-30.md`.
- Native code under `apps/` may implement presentation and OS integration only: navigation chrome,
  lists/sheets rendering data fetched from published Terminal HTTP APIs (`/api/*`, `/data/*`),
  OS features (share, keychain, haptics), and WebView hosting of Terminal routes in shell mode.
- Native code must never re-implement chart rendering, indicator/signal math, entitlement logic,
  or any analysis; those live only in `terminal/` and its backends. If a native screen needs data
  that no published API provides, add the API to `terminal/` first.
- The Options suite is excluded from every installable alpha surface (feature manifest + webview
  route policy) while remaining untouched on the web.
- Native binaries are build artifacts, never VPS deploys; the web delivery chain is unchanged.

## Definition of done

For every substantive, verified change, complete the full delivery chain without
asking the operator to finish it:

1. commit;
2. push;
3. open a pull request against `master`;
4. check CI and resolve genuine failures;
5. merge and delete the remote branch;
6. deploy the merged `origin/master` through the git-gated
   `/opt/terminal/terminal-build.sh`;
7. verify the expected marker and behavior on `https://app.mastermind-x.com`.

The operator granted standing authorization on 2026-07-30 for this entire
commit → push → PR → CI → merge → production deploy → live verification chain.
Do not wait for a separate request to commit, push, merge, or deploy.

Do not stop at a local commit or open PR. Release holds include an explicit
operator hold, required CI or independent review that is pending or failing,
and a genuine deployment blocker. Never arm a protected merge while its required
review or current-head checks remain unqualified.

Direct working-tree rsync/scp is not a deployment; production builds only
merged master. A held release step blocks that effect, not the whole session.
Before finalizing an incomplete assignment, name and execute the next
independent authorized source, test, integration, or real-path verification action.
An issue, reviewer request, CI observation, or preserved branch is not completion.

Preserve completed work in the original managed workspace; commit and push to its
recoverable branch only through a lawful original publisher. If commit/push is
unavailable, distinguish a proven pre-effect technical failure from an explicit
safety/permission denial or EFFECT_UNKNOWN. A technical failure may be requalified
only on material same-carrier recovery evidence and the applicable typed preflight.
An explicit safety/permission denial ends retries of that effect; an uncertain
effect must be reconciled on its original carrier before retry. Keep exact local
source/custody recoverable and continue genuinely independent permitted work.
Do not force, create a replacement branch, switch accounts/tools, or use GitHub
direct writes to evade a refusal. Report the exact blocker and recovery action
only when no safe useful work remains. Never leave completed work only as
uncommitted changes when lawful publication is available.

## Merge-on-green controller

- After opening a non-draft pull request that is ready to ship, add the
  `merge-on-green` label and arm GitHub native auto-merge with a full-head lease:
  `gh pr merge <PR> --repo mastermindx-market-intelligence/mastermind-terminal --auto --squash --match-head-commit <CURRENT_40_HEX_HEAD>`.
  **Do not add `--delete-branch`: GitHub CLI rejects it when the active native
  merge queue is enabled (ruleset 24411653).** Remote-branch deletion is a
  separate optional post-merge cleanup after reading the actual merged PR SHA
  and reconciling live writers. `master` protects the exact three CI checks;
  these and native `merge_group` integrated checks still gate the merge. Use
  `hold` or `do-not-merge` as explicit vetoes; never combine with auto-merge.
- `.github/workflows/merge-on-green.yml` is the repository fallback for sessions
  interrupted while CI runs. It requires the latest instance of all three CI jobs
  to succeed, refreshes stale heads onto current `master` and waits for fresh CI,
  refuses forks/drafts/conflicts, SHA-pins the squash merge, and deletes the remote
  branch. It is the orphaned-PR fallback and defense-in-depth behind native
  auto-merge, not a second definition of green.
- A branch update or commit written with `GITHUB_TOKEN` leaves the new head's
  `pull_request` CI run held (`action_required`, no jobs). The pull request's
  required checks are read from that run only, so green checks from a dispatched
  run on the same commit leave it BLOCKED (#874). The controller therefore
  re-runs its own held run once (`POST /actions/runs/{id}/rerun`; verified to
  execute under `GITHUB_TOKEN` on 2026-10-13), both right after a refresh and
  whenever an armed PR is pending or blocked on one. Dispatching CI is only the
  fallback when no `pull_request` run appears. A run held for anyone else, or
  held again after that re-run, is reported for a maintainer to re-run; never
  bypass protection for it.
- `merge-blocked` means the latest required CI is red or the branch has a real
  conflict. Fix the head; do not use an admin bypass. The controller removes the
  label automatically after the new head is green.
- The controller moves only the merge wait off the interactive session. The
  initiating session still owns the git-gated production deployment and live
  verification required above; an armed PR is not a completed delivery.
- If branch protection or any required-check context is changed, update this
  section, `.github/workflows/merge-on-green.yml`, and the controller tests in the
  same PR. Disabling protection makes native auto-merge unsafe again.

When an operating standard changes, update the repository's `AGENTS.md`,
`CLAUDE.md`, and any nested agent guide together so Codex and every Claude account
inherit the same rule.
