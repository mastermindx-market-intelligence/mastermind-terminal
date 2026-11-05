# Terminal e2e self-hosted lane (ubuntu0)

Mastermind #917, phase 9. The `terminal-e2e` matrix job in `.github/workflows/ci.yml`
can run its twelve Playwright shards on the ubuntu0 host instead of `ubuntu-latest`.
The switch is a repository variable, so the lane is **inert until an administrator
sets it**. Unsetting the variable restores hosted routing; stopping the runner slots
is the full rollback (see Rollback). No PR is needed to turn it on or off.

## Why

Canary measurements on 2026-11-05 (workflow `selfhosted-e2e-canary.yml`, shard
`desktop-1`, ephemeral JIT runner on ubuntu0, 32 cores / 29 GB):

| lane | workers | wall time | run |
| --- | --- | --- | --- |
| hosted `ubuntu-latest` | 1 | 54m41s | baseline p50 |
| ubuntu0 JIT | 1 | 16m06s | 42011181810 |
| ubuntu0 JIT | 4 | 8m08s | 42029519496 |

The hosted shard is bound by the 4-core hosted runner's Next.js dev server; on the
host the same shard is 3.4x faster at one worker and 6.7x faster at four.

## The switch

| variable | values | effect |
| --- | --- | --- |
| `TERMINAL_E2E_LANE` | unset / anything else → hosted; `ubuntu0` → host | chooses `runs-on` |
| `TERMINAL_E2E_WORKERS` | integer 1..16, default 4 | Playwright `--workers` on the host lane only |

`runs-on` is

```
${{ (vars.TERMINAL_E2E_LANE == 'ubuntu0'
     && (github.event_name != 'pull_request'
         || github.event.pull_request.head.repo.full_name == github.repository))
    && fromJSON('["self-hosted","linux","x64","ubuntu0-e2e"]')
    || 'ubuntu-latest' }}
```

Safety properties, each pinned by `tests/test_ci_e2e_selfhosted_lane.py` unless
marked otherwise:

- **The hosted lane is today's job.** With the variable unset the script emits
  workers 1, ports 3108 / 31991 / 31992, the literal cache path and today's cache
  key, and exports nothing; `runs-on` is pinned by exact equality.
- **The fork guard is routing only.** A `pull_request` whose head repository is
  not this one is routed to the hosted runner by this unmodified job. It is **not a
  host fence**: a `pull_request` runs the workflow file from the PR's merge ref, so
  any PR (fork or same-repository) can edit `runs-on` or add a workflow naming the
  four labels, and `merge_group` runs fork-authored code once a maintainer queues
  it. The host fence is procedural and is described under *Administrator
  precondition* below. Fork runs are additionally held by the
  `all_external_contributors` approval policy (repository setting, not pinned here).
- **The hosted fallback is a literal** (`'ubuntu-latest'`), so an expression error
  cannot select the host. GitHub compares the variable case-insensitively, so
  `Ubuntu0` also selects the host; the exported lane env is always the literal
  `ubuntu0`.
- **No workflow expression is spliced into a `run:` block.** The job exports
  `TERMINAL_E2E_LANE` and `TERMINAL_E2E_LANE_WORKERS` as env; the step
  `Bind lane workers and ports` runs `.github/scripts/terminal_e2e_lane.sh`, which
  validates them and writes `lane`, `workers`, `port`, `port_investor`,
  `port_shared`, `browsers_path`, `cache_suffix` to `$GITHUB_OUTPUT`. Invalid
  input exits 2 and writes nothing.
- **Per-slot Playwright store.** On the host lane the script exports
  `PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright-ubuntu0-e2e-N` through
  `$GITHUB_ENV` and suffixes the `actions/cache` key with the slot name, so
  concurrent shards never restore a cache tar into a store another slot's Chromium
  is running from, and the host never shares a cache entry with the hosted lane.
- **Check names are unchanged.** `Terminal e2e <shard> (shard)` and the frozen
  `terminal` aggregator keep their names on both lanes, so branch protection and
  the merge sweeper see the same required checks.

## Runner slots on ubuntu0

Twelve shards run in parallel on the hosted lane. One self-hosted runner executes
one job at a time, so a single runner would serialize twelve shards (~12 × 8 min).
The lane therefore expects **N runner slots**, one runner per slot, named
`ubuntu0-e2e-N` (N in 1..9), each re-registered ephemerally after every job (see
*Registering a slot*). The bind script derives per-slot ports from the
runner name so concurrent shards on one host never share a dev-server port:

| slot | dev server | investor opt-in | shared opt-in |
| --- | --- | --- | --- |
| `ubuntu0-e2e-1` | 3201 | 32011 | 32012 |
| `ubuntu0-e2e-N` | 3200+N | 32000+10N+1 | 32000+10N+2 |

A runner not named `ubuntu0-e2e-N` (for example the canary's `ubuntu0-canary-*`
JIT runners) is rejected with exit 2, so a mislabelled runner fails the job
loudly instead of colliding on ports.

Sizing from the canary: at 4 workers one shard used roughly 4-6 cores at peak.
Four slots × 4 workers fits the 32-core host with headroom; start with four slots
(`ubuntu0-e2e-1..4`) and `TERMINAL_E2E_WORKERS` unset (default 4). Twelve shards
over four slots is three rounds of ~8 min, about 25 min wall for the whole matrix
against 54 min hosted, and each additional slot removes a round.

### Registering a slot (host operator; unprivileged `ghrunner` user, no sudo)

Each slot is its own runner directory. The runner user must have **no sudo**: a
self-hosted runner executes every approved run of this repository, so a
sudo-capable runner would hand root to any such run. Install the Playwright
Chromium system libraries once as an administrator
(`npx playwright install-deps chromium` from any checkout of this repository) so
the job's bounded `--with-deps` step can fail over to its browser-only path without
needing apt.

Register each slot **at the organization level, into the restricted runner group,
and ephemeral**. Runner groups exist only for organization-level runners: a runner
registered with a repository URL is a repository-level runner outside any group,
so `--url` must be the organization URL. `--ephemeral` makes the runner serve
exactly one job and then deregister, which removes the idle listener between jobs
(the property the canary relied on); a wrapper then re-registers it. Minting an
organization registration token needs the organization **"Self-hosted runners:
write"** permission (a fine-grained token with that organization permission, or a
GitHub App installation token with it); the administrator holds that credential on
the host and it is never printed:

```
mkdir -p ~/actions-runner/ubuntu0-e2e-N && cd ~/actions-runner/ubuntu0-e2e-N
tar xzf ~/actions-runner/actions-runner-linux-x64.tar.gz
# loop, run by a systemd user unit for ghrunner:
while :; do
  token="$(mint-org-registration-token)"   # POST /orgs/<org>/actions/runners/registration-token; never echoed
  ./config.sh --unattended --ephemeral --url https://github.com/<org> --token "$token" \
    --name ubuntu0-e2e-N --labels self-hosted,linux,x64,ubuntu0-e2e \
    --runnergroup <restricted-group> --work _work --replace
  ./run.sh
done
```

The runner must carry **all four labels**; `runs-on` requires every label in the
array.

**What ephemeral does not do.** It does not give each job a clean machine. Every
slot runs as the same `ghrunner` user with one home directory, which owns the
runner binaries, the re-registration wrapper, `~/.npm` and the per-slot browser
stores, so one approved run can rewrite any of those and compromise every later
job on every slot. The canary recorded the same caveat ("registration alone does
not clean its filesystem; the original runtime owner must separately qualify
isolation and cleanup"), and GitHub warns that re-using hardware for JIT runners
can expose information between jobs. Before turning the lane on, the host owner
must qualify that isolation: at minimum one OS user per slot with runner binaries
owned by a separate account, or a fresh container/VM per job. Until that is
qualified, running this lane is a recorded administrator trust decision that every
approved run of this repository may tamper with the host.

### Turning the lane on

1. Register the slots above and confirm each shows **Idle** under the repository's
   runners with the four labels.
2. Set the repository variable `TERMINAL_E2E_LANE=ubuntu0` (and optionally
   `TERMINAL_E2E_WORKERS`).
3. Watch the next same-repository pull request, merge-group or dispatch run: every
   `Terminal e2e <shard>` job should report the runner name `ubuntu0-e2e-N` in its
   "Set up job" step and the bind step should print `lane=ubuntu0`.

### Rollback

1. Delete the `TERMINAL_E2E_LANE` repository variable (or set it to anything but
   `ubuntu0`). The next run of this unmodified job is hosted. This restores
   **routing only**.
2. Stop the slot listeners (stop the re-registration unit, or `svc.sh stop` for a
   service-installed runner, then `config.sh remove` with a removal token) so no
   runner is listening for the four labels. Until this step a workflow that names
   the labels can still reach the host.

No workflow change or PR is needed for either step.

## Administrator precondition (named once)

The merged canary (`selfhosted-e2e-canary.yml`, #1277) recorded, as the
precondition for anything beyond the canary, an organization runner group
restricted to **one workflow on one ref**
(`selfhosted-e2e-canary.yml@refs/heads/master`), serving as an unprivileged
no-sudo user. **A pull-request lane cannot meet that restriction**: a
`pull_request` run executes the workflow at `refs/pull/N/merge`, which a
workflow-and-ref restriction never matches. This lane therefore runs under a
**weaker fence** than the canary, and that must be recorded as an administrator
trust decision rather than presented as the canary's precondition:

- an organization runner group restricted to this repository (bounds which
  repositories' runs may use the slots, not which code within them);
- the `all_external_contributors` approval policy plus maintainer review of any
  workflow edit in an approved run (the only hold on fork code);
- no-sudo ephemeral runners, with host isolation qualified as described under
  *Registering a slot* (ephemeral alone does not bound the blast radius).

Creating the organization runner group, provisioning the organization
"Self-hosted runners: write" credential for ephemeral re-registration and
qualifying host isolation need `admin:org` / host ownership, which the CI seat
does not hold (the API returned 403 on 2026-11-05). That is the single human step
for this lane. Everything else in this document is already in source and inert
until the variable is set.
