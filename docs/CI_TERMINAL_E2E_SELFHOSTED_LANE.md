# Terminal e2e self-hosted lane (ubuntu0)

Mastermind #917, phase 9. The `terminal-e2e` matrix job in `.github/workflows/ci.yml`
can run its twelve Playwright shards on the ubuntu0 host instead of `ubuntu-latest`.
The switch is a repository variable, so the lane is **inert until an administrator
sets it**, and unsetting the variable is the whole rollback. No PR is needed to turn
it on or off.

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

Safety properties, each pinned by `tests/test_ci_e2e_selfhosted_lane.py`:

- **Fork pull requests never reach the host.** This is a public repository; a
  `pull_request` whose head repository is not this one always runs hosted, whatever
  the variable says. Fork runs are additionally held by the
  `all_external_contributors` approval policy.
- **The hosted fallback is a literal** (`'ubuntu-latest'`), so an expression error
  cannot select the host.
- **No workflow expression is spliced into a `run:` block.** The job exports
  `TERMINAL_E2E_LANE` and `TERMINAL_E2E_LANE_WORKERS` as env; the step
  `Bind lane workers and ports` runs `.github/scripts/terminal_e2e_lane.sh`, which
  validates them and writes `lane`, `workers`, `port`, `port_investor`,
  `port_shared` to `$GITHUB_OUTPUT`. Invalid input exits 2 and writes nothing.
- **The hosted lane is today's job.** With the variable unset the script emits
  workers 1 and ports 3108 / 31991 / 31992, the values the job hard-coded before.
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

### Registering a slot (host operator, `ghrunner` user, `~/actions-runner`)

Each slot is its own runner directory and service. Registration requires a
registration token from the repository or organization settings, which is an
administrator step (see below). The commands, run once per slot with the token
piped in and never printed:

```
mkdir -p ~/actions-runner/ubuntu0-e2e-N && cd ~/actions-runner/ubuntu0-e2e-N
tar xzf ~/actions-runner/actions-runner-linux-x64.tar.gz
./config.sh --unattended --url <repo-or-org-url> --token <registration-token> \
  --name ubuntu0-e2e-N --labels self-hosted,linux,x64,ubuntu0-e2e \
  --work _work --replace
sudo ./svc.sh install ghrunner && sudo ./svc.sh start
```

The runner must carry **all four labels**; `runs-on` requires every label in the
array. Node 20 and the Playwright Chromium dependencies are installed by the job
itself (same steps as the hosted lane), so the host needs only the runner
prerequisites, git and a working `sudo` for the `playwright install --with-deps`
step (or pre-install the browser dependencies once and the fallback
`npx playwright install chromium` path handles the rest).

### Turning the lane on

1. Register the slots above and confirm each shows **Idle** under the repository's
   runners with the four labels.
2. Set the repository variable `TERMINAL_E2E_LANE=ubuntu0` (and optionally
   `TERMINAL_E2E_WORKERS`).
3. Watch the next same-repository push or PR run: every `Terminal e2e <shard>`
   job should report the runner name `ubuntu0-e2e-N` in its "Set up job" step
   and the bind step should print `lane=ubuntu0`.

### Rollback

Delete the `TERMINAL_E2E_LANE` repository variable (or set it to anything but
`ubuntu0`). The next run is hosted. No workflow change, no PR, no runner
deregistration needed; idle slots can stay registered.

## Administrator precondition (named once)

Self-hosted runners serving `pull_request` jobs on a **public** repository need the
organization-level control that keeps those runners off fork code: an organization
runner group restricted to this repository (or repository-level runners with the
"Require approval for all external contributors" policy, which this repository
already has). Creating an organization runner group and minting registration
tokens need `admin:org` / repository admin, which the CI seat does not hold (the
API returned 403 on 2026-11-05). That is the single human step for this lane:
create the group (or approve repository-level registration) and register the
`ubuntu0-e2e-N` services. Everything else in this document is already in source
and inert until the variable is set.
