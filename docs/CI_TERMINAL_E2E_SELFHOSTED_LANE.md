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
`ubuntu0-e2e-N` (N in 1..9), each registered per job with a JIT config (see
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

### Registering a slot (host operator)

**One OS user per slot, no sudo.** Every slot `ubuntu0-e2e-N` runs as its own
unprivileged user `ghrunner-N` with its own home. Slots must not share a uid: a
job on slot M running as the same uid as slot N could read slot N's
`/proc/<pid>/cmdline` and `environ`, its `.credentials` / `.credentials_rsaparams`
/ `.runner` files (the runner's private key and identity) and so impersonate
slot N's runner or reuse its registration token. Mount `/proc` with `hidepid=2`
so command lines are hidden across uids as well. Install the Playwright Chromium
system libraries once as an administrator (`npx playwright install-deps chromium`
from any checkout of this repository) so the job's bounded `--with-deps` step can
fail over to its browser-only path without apt.

**Registration is per job with a JIT config, minted by a separate account.**
Runner groups exist only for organization-level runners, so registration is at
the organization level into the restricted group. Instead of a reusable
registration token (valid for about an hour and reusable by whoever reads it), each
cycle mints a **just-in-time runner configuration**
(`POST /orgs/<org>/actions/runners/generate-jitconfig`, as the canary did), which
is bound to one runner name, serves exactly one job and then deregisters. Minting
needs the organization **"Self-hosted runners: write"** permission (a fine-grained
token or a GitHub App installation token with it). **That credential must never be
readable by any slot user**: the minting loop runs as a dedicated `ghmint` account
in a **system** unit, and `ghmint` alone can read the credential. The loop hands
the slot user only its one-shot JIT config and persists nothing.

**A dead slot and a fresh filesystem before every job.** A job can try to outlive
itself on its own slot: a `setsid` daemon that escapes the runner's orphan
cleanup, a crontab or `at` entry, `~/.gitconfig` (`core.hooksPath`,
`core.fsmonitor` run code on the next job's checkout), `~/.npmrc`, shell rc files,
`~/.config`, `~/.local`, or files in `/tmp`, `/var/tmp`, `/dev/shm`. Anything that
survives runs as `ghrunner-N`, the same uid as the next job's runner, and could
read that job's `.credentials` or JIT config (`hidepid=2` hides nothing from a
uid's own processes). So before minting, each cycle kills every process of the
slot user, removes its crontab and `at` jobs, rebuilds the whole home from
`/etc/skel`, deletes its files under the temp directories, and re-extracts the
runner directory from the pristine tarball with mode 0700 on both the slot and
the home (the job's `actions/cache` restores the per-slot Playwright store
itself). The unit also runs with `PrivateTmp=yes`. The canary's caveat stands:
registration alone does not clean the filesystem; this loop is what does.

```
# system unit for slot N (PrivateTmp=yes), running as root for the reset and as ghmint
# for minting; the org credential is readable only by ghmint. sudoers: ghmint may run
# exactly /opt/actions-runner/slots/ubuntu0-e2e-N/run.sh as ghrunner-N, with
# `Defaults!/opt/actions-runner/slots/ubuntu0-e2e-N/run.sh !log_allowed` so the
# JIT blob on that command line is not written to the auth log.
u=ghrunner-N; slot=/opt/actions-runner/slots/ubuntu0-e2e-N
while :; do
  # 1. dead slot: no process, cron, at job or file of the previous job survives
  loginctl terminate-user "$u" 2>/dev/null; pkill -KILL -u "$u"; sleep 1
  crontab -r -u "$u" 2>/dev/null; for j in $(atq | awk -v u="$u" '$NF==u{print $1}'); do atrm "$j"; done
  find /tmp /var/tmp /dev/shm -user "$u" -delete 2>/dev/null
  rm -rf "/home/$u" "$slot"
  mkdir -p "/home/$u" && cp -a /etc/skel/. "/home/$u/" && chown -R "$u:$u" "/home/$u" && chmod 0700 "/home/$u"
  # 2. pristine runner tree, readable by this slot only
  mkdir -p "$slot" && tar xzf /opt/actions-runner/actions-runner-linux-x64.tar.gz -C "$slot"
  chown -R "$u:$u" "$slot" && chmod 0700 "$slot"
  # 3. one-shot JIT config, minted as ghmint, handed only to this run.sh
  jit="$(sudo -u ghmint mint-jitconfig ubuntu0-e2e-N self-hosted,linux,x64,ubuntu0-e2e <restricted-group-id>)"  # never echoed
  sudo -u "$u" "$slot/run.sh" --jitconfig "$jit"
done
```

The JIT config must carry **all four labels**; `runs-on` requires every label in
the array. Never list runner processes with their arguments (`ps -f`, `pgrep -a`)
in a shared transcript: the JIT config blob on the command line is credential
material for that one job.

**What this does and does not bound.** With per-slot users, `hidepid=2`, JIT
configs, 0700 slot and home directories, and a dead slot plus fresh home, runner
tree and temp files before every job, one approved run cannot read another slot's
credentials and cannot persist a process, cron entry, dotfile or file into a later
job on its own slot. It can still read anything world-readable on the host, use
the host's network position, and exhaust the host; those are the residual trust
decision. Running this lane is a recorded administrator decision that every
approved run of this repository (including a maintainer-approved fork run that
edits the workflow file) executes on ubuntu0 inside that boundary.

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
2. Stop the slot units (the per-slot system units; `svc.sh stop` for any
   service-installed runner) so no runner is listening for the four labels. A JIT
   runner that is mid-job finishes that job and deregisters itself. Until this step
   a workflow that names the labels can still reach the host.

No workflow change or PR is needed for either step.

## Administrator precondition (named once)

The merged canary (`selfhosted-e2e-canary.yml`, #1277) recorded, as the
precondition for anything beyond the canary, an organization runner group
restricted to **one workflow on one ref**
(`selfhosted-e2e-canary.yml@refs/heads/master`); the canary runner itself also ran
as an unprivileged no-sudo user. **A pull-request lane cannot meet that
restriction**: a
`pull_request` run executes the workflow at `refs/pull/N/merge`, which a
workflow-and-ref restriction never matches. This lane therefore runs under a
**weaker fence** than the canary, and that must be recorded as an administrator
trust decision rather than presented as the canary's precondition:

- an organization runner group restricted to this repository, with "Allow public
  repositories" switched on (off by default; this repository is public). The
  group bounds which repositories' runs may use the slots, not which code within
  them;
- the `all_external_contributors` approval policy plus maintainer review of any
  workflow edit in an approved run (the only hold on fork code);
- no-sudo per-slot users with JIT-registered runners, the org credential held
  only by a separate minting account, `hidepid=2`, and a fresh runner directory
  and home per job, as described under *Registering a slot* (ephemeral
  registration alone does not bound the blast radius).

Creating the organization runner group, provisioning the organization
"Self-hosted runners: write" credential for JIT minting, creating the per-slot
users and `hidepid=2` mount, and qualifying host isolation need `admin:org` / host
ownership, which the CI seat
does not hold (the API returned 403 on 2026-11-05). That is the single human step
for this lane. Everything else in this document is already in source and inert
until the variable is set.
