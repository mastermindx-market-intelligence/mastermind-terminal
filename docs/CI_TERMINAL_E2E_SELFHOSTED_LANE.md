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
The lane therefore expects **N persistent runner services**, one per slot, named
`ubuntu0-e2e-N` (N in 1..9). The bind script derives per-slot ports from the
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

Each slot is its own runner directory and service. The runner user must have **no
sudo**: a self-hosted runner executes every approved run of this repository, so a
sudo-capable runner would let one run tamper with the host for later runs. Install
the Playwright Chromium system libraries once as an administrator
(`npx playwright install-deps chromium` from any checkout of this repository) so
the job's bounded `--with-deps` step can fail over to its browser-only path without
needing apt.

Register each slot **ephemeral**: an `--ephemeral` runner serves exactly one job
and then deregisters, so no listener exists for a stray workflow to land on between
jobs, which is the property the canary relied on. A persistent service must then
re-register after every job; the wrapper needs a registration-capable credential
(a fine-grained token with repository `administration:write`, or a GitHub App
installation token), held on the host by the administrator and never printed:

```
mkdir -p ~/actions-runner/ubuntu0-e2e-N && cd ~/actions-runner/ubuntu0-e2e-N
tar xzf ~/actions-runner/actions-runner-linux-x64.tar.gz
# loop, run by a systemd user unit for ghrunner:
while :; do
  token="$(mint-registration-token)"   # from the held credential; never echoed
  ./config.sh --unattended --ephemeral --url <repo-url> --token "$token" \
    --name ubuntu0-e2e-N --labels self-hosted,linux,x64,ubuntu0-e2e \
    --runnergroup <restricted-group> --work _work --replace
  ./run.sh
done
```

The runner must carry **all four labels**; `runs-on` requires every label in the
array. If ephemeral re-registration is not provisioned, persistent listeners are a
deliberate trust decision by the administrator: every approved run of this
repository, including a maintainer-approved fork run that edits the workflow file,
executes on the host between rollbacks. Record that decision with the variable.

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
2. Stop the slot listeners (`svc.sh stop` / stop the systemd user unit, then
   `config.sh remove` with a removal token) so no runner is listening for the four
   labels. Until this step a workflow that names the labels can still reach the host.

No workflow change or PR is needed for either step.

## Administrator precondition (named once)

The merged canary (`selfhosted-e2e-canary.yml`, #1277) recorded the precondition
for anything beyond the canary: self-hosted runners for this **public** repository
live in an **organization runner group restricted to this repository**, serve as an
**unprivileged user with no sudo**, and are **ephemeral**. A runner group restricted
to the repository does not by itself keep fork code off the host (fork PR runs are
runs of this repository); the fork hold is the `all_external_contributors` approval
policy plus maintainer review of any workflow edit in an approved run, and the
blast radius is bounded by no-sudo ephemeral runners.

Creating the organization runner group, minting registration tokens and
provisioning the re-registration credential need `admin:org` / repository admin,
which the CI seat does not hold (the API returned 403 on 2026-11-05). That is the
single human step for this lane. Everything else in this document is already in
source and inert until the variable is set.
