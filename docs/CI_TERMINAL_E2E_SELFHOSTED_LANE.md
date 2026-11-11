# Terminal e2e self-hosted lane (ubuntu0)

Mastermind #917, phase 9. The `terminal-e2e` matrix job in `.github/workflows/ci.yml`
can route its selected Playwright shards to ubuntu0 instead of the GitHub-hosted
`ubuntu-24.04` runner.
The accepted dynamic selector chooses the matrix; a full selection has twelve shards.
Trusted docs-only and native merge-group skips retain their existing separate rules.
The switch is a repository variable, so the lane is **inert until an administrator
sets it**. Unsetting the variable restores hosted routing; stopping the runner slots
is the full rollback (see Rollback). No PR is needed to turn it on or off.

## Why

Historical canaries on 2026-11-05 used `selfhosted-e2e-canary.yml`,
`desktop-1`, an ephemeral JIT runner on ubuntu0, 32 cores / 29 GB.
Keep their measurement boundaries separate:

| Observation | Time | Source / boundary |
| --- | ---: | --- |
| Earlier hosted baseline | 54m41s | Reported historical shard p50; not a matched-source comparison |
| ubuntu0, one worker | 16m06s | Canary job, run 42011181810 |
| ubuntu0, four workers | 8m08s | Canary job, run 42029519496 |
| Four-worker browser command | 7m11s | Actual `shard_seconds=431` in job 127256570861 |
| Four-worker whole workflow | 17m36s | Run 42029519496, created 12:43:10Z / completed 13:00:46Z |

The [four-worker native log](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42029519496/job/127256570861)
selected 268 tests: 236 passed and 32 skipped. Source was protected 50713efda7cbd06c60b6dce2f88b31cea5c005a2,
runner `ubuntu0-canary-3`, group `Default`. This proves one shard on
that canary, not a restricted multi-slot fleet, a current whole-matrix result,
causal speed ratios or a five-minute verdict. Required host isolation and runner
group qualification below remain unproved by that historical Default-group run.

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
    || 'ubuntu-24.04' }}
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
- **The hosted fallback is a literal** (`'ubuntu-24.04'`, a GitHub-hosted image),
  so an expression error cannot select the host. It must not be `'ubuntu-latest'`:
  the fleet runners also carry that label, so it sent "hosted" shards to a shared
  fleet host (2026-11-10: 16/26 fleet shard jobs failed versus 11/273 hosted).
  GitHub compares the variable case-insensitively, so
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

Four slots × four workers is an initial sizing proposal, subject to measured CPU,
memory, storage contention and queue behavior under the qualified host policy.
The simple estimate of three eight-minute rounds is about 25 minutes before other
required paths and scheduling costs; it is not observed whole-matrix performance.
The 431-second canary command already exceeds the complete 300-second target, so
fixture work and smaller qualified scheduling units remain necessary. Increasing
slots alone cannot establish the five-minute architecture's acceptance.

### Registering a slot (host operator)

**One OS user per slot, no sudo, no login.** Every slot `ubuntu0-e2e-N` runs as
its own unprivileged user `ghrunner-N` with its own home, created with
`useradd -m -s /usr/sbin/nologin ghrunner-N` (locked password, no shell, its private
group only, no sudo) and listed in `DenyUsers ghrunner ghrunner-*` in `sshd_config`
(`ghrunner` is the retired canary account, locked the same way). A slot user that could log in
(a job can drop its own key into `~/.ssh/authorized_keys` and `ssh` to
`127.0.0.1`) would get a logind session scope under `user-<uid>.slice`, outside
the job cgroup described below, and a process started there would survive the
cgroup kill. Slots must not share a uid: a
job on slot M running as the same uid as slot N could read slot N's
`/proc/<pid>/cmdline` and `environ`, its `.credentials` / `.credentials_rsaparams`
/ `.runner` files (the runner's private key and identity) and so impersonate
slot N's runner or reuse its registration token. Hide other uids' processes as
well: mount `/proc` with `hidepid=2` host-wide, or, where that breaks the desktop
session, run each slot unit with `ProtectProc=invisible` (its private procfs is
`hidepid=invisible`; the loop asserts it) **and** let no other uid run untrusted code
on the host: the slot unit is the only place jobs run, and the loop refuses to mint
while any other actions runner service is active there. Install the Playwright Chromium
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
uid's own processes). Two mechanisms close this, in a fixed order.

First, **cron and `at` are denied to the slot users outright** (`/etc/cron.deny`
and `/etc/at.deny` list every `ghrunner-N`), so a job cannot install a timer that
fires as its uid after the reset; a job that fires later runs in `cron.service`
/ `atd`, not in the job's cgroup, and no cgroup kill would reach it. The reset
still removes any crontab or `at` queue entry **before** it kills anything, so the
purge is never racing a timer that fires between the fail-closed check and the
mint.

Second, each cycle kills the previous job's **cgroup**, not its process list:
`pkill` reads the list once, so a job that keeps forking can leave a child alive
past a plain kill, and `loginctl terminate-user` does nothing here because job
processes live in the unit's cgroup, not a logind session. Each job runs in its
own child cgroup of the unit (`Delegate=yes`); the process placed in that cgroup is
the one that `exec`s `run.sh`, so with login denied every process of that uid
descends from `run.sh` inside it. The reset writes `1` to that cgroup's
`cgroup.kill` (kernel 5.14 or later; the write fails the slot on an older kernel
rather than spinning), waits until `cgroup.events` reports `populated 0` (the
`cgroup.procs` file always has size 0, so a size test would not wait at all), and
removes the cgroup, failing the slot if either step fails. It then rebuilds the
whole home from `/etc/skel`, deletes the user's files under the temp and sticky
directories, re-extracts the runner directory from the pristine tarball with mode
0700 on both the slot and the home (the job's `actions/cache` restores the
per-slot Playwright store itself), and as the **last statements before the mint**
**fails closed**: if logind still lists a session for `ghrunner-N` (login is
denied, so one can only mean a misconfigured host) or `pgrep -u ghrunner-N` still
finds anything, the slot stays down rather than minting a new config beside a
survivor. The unit also runs with
`PrivateTmp=yes` and the default `KillMode=control-group`, so a unit stop kills
whatever the loop did not. The canary's caveat stands: registration alone does not
clean the filesystem; this loop is what does.

**The host files are in [`ops/terminal-e2e-lane/`](../ops/terminal-e2e-lane/)**, and
the installed copies must be byte-identical to them:

| file | installed as | role |
| --- | --- | --- |
| `provision.sh` | run once as root | asserts the host prerequisites, retires every other actions runner service on the host (disable, refuse beside a running job, stop, read back), locks the retired canary account, creates `ghmint` and the slot users, writes and live-reloads the sshd deny, installs the files below |
| `terminal-e2e-slot` | `/usr/local/sbin/`, 0700 root | the per-slot loop |
| `terminal-e2e-slot@.service` | `/etc/systemd/system/` | one unit per slot: `PrivateTmp`, `PrivateIPC`, `ProtectProc=invisible`, the host's other world-writable directories read-only, `Delegate=yes`, 6G/7G memory, `LimitCORE=0`, `Restart=no` |
| `terminal_e2e.slice` | `/etc/systemd/system/` | aggregate memory bound for all slots (22G high / 24G max, an initial value to re-measure) |
| `mint-jitconfig` | `/usr/local/bin/`, 0755 root | mints a JIT config as `ghmint`; `status` / `check` read the group back |

**Host prerequisites the loop asserts on every start** (it exits otherwise): unified
cgroup v2 only, running as `terminal-e2e-slot@N.service` in `terminal_e2e.slice`
(run by hand, the job would land in the caller's session cgroup outside the sandbox),
`/proc` mounted `hidepid=invisible` and an IPC namespace that is not the host's (the
reset runs `ipcrm --all`), the slot user with shell `/usr/sbin/nologin`, home
`/home/ghrunner-N`, a uid no other account shares, its private group only and no sudo
rights, linger off, `/etc/cron.deny` and `/etc/at.deny` naming it and no allow file
naming it (an allow file makes cron and `at` ignore the deny file), `sshd -T` denying
`ghrunner` and `ghrunner-*`, the retired canary account locked with no shell and no
linger, and the pristine runner tarball. Kernel 5.14 or later is needed for
`cgroup.kill`, and util-linux `setpriv` (the loop drops to the slot user with it rather
than `sudo`, so no PAM session stack runs for `run.sh` and nothing can move it into a
`user-N.slice` session scope outside the job cgroup). The JIT config blob is never in
argv, so an auditd `execve` rule cannot record it.

**One cycle of the loop**, in this order:

1. Purge any crontab (the spool file must be gone afterwards) and `at` entry of the slot
   user **before** killing anything.
2. Kill the previous job's cgroup through `cgroup.kill`, wait at most 60 seconds for
   `cgroup.events` to report `populated 0` (an unkillable task stops the slot with
   `RETRYING_CLEANUP_BLOCKED` instead of wedging it), and remove it. A slot-user process
   still alive outside that cgroup is an escape: the loop kills it and stops.
3. Remove every IPC object in the unit's private namespace, delete the slot user's files
   under `/tmp`, `/var/tmp` (both private to the unit), `/dev/shm`, `/dev/mqueue` and
   `/run/lock` and re-scan that none survived, rebuild the home from `/etc/skel` and
   the runner tree from the tarball (both 0700), and create the fresh job cgroup.
4. **Fail closed**, as the last statements before the mint: a logind session or
   `/run/user/<uid>` for the slot user, a live process of the slot user or of the
   retired canary account, or another active actions runner service stops the slot. A
   failed query stops it too; it never reads as "none".
5. Mint one JIT config as `ghmint`. `mint-jitconfig` exits 75 for an API or network
   failure: the loop backs off (15 s doubling to 300 s) and starts the cycle again. Any
   other refusal stops the slot.
6. Hand the config to `run.sh` in the environment variable
   `ACTIONS_RUNNER_INPUT_JITCONFIG`, never in argv: `/proc/<pid>/cmdline` is readable
   by every uid outside the unit and `sudo` writes its whole command line to the auth
   log. A subshell drops every exported variable and function (by name, never printing
   a value), sets what `sudo -H -u` would give the job (`env_reset`, `secure_path`) plus
   the config, writes its own `$BASHPID` into the job cgroup and `exec`s
   `setpriv --reuid --regid --init-groups run.sh`, so no root parent holds the value
   for the life of the job. Runner.Listener reads the variable and removes it from its
   own environment; `/proc/<pid>/environ` is readable only by the slot uid and root. Do
   not use `systemd-run` for this either: a transient unit's ExecStart and Environment
   are readable by every user through `systemctl show`.
7. A runner that exits nonzero within 30 seconds never took a job, and its registration
   may still exist offline: the loop stops rather than minting again over an uncertain
   start.

**A slot that stops needs an operator, not a restart.** `Restart=no` is deliberate:
every local failure means a survivor, a broken prerequisite or an uncertain
registration. Read the unit's journal, fix the cause, and if the runner's registration
is in doubt run `mint-jitconfig status <group-id>` as `ghmint` before
`systemctl start terminal-e2e-slot@N`. On the next mint, a 409 (the name is taken)
deletes the old registration only when it is provably the slot's own stale one: exactly
one runner of that name in the organization (every page read; a partial list is never
used), in the lane's group, with an integer id, explicitly not busy, offline, and with
exactly the lane's four labels. Anything else exits 3 and the slot stays down. The
recovery never deletes a busy or online runner, so it cannot cancel a live job.

The JIT config must carry **all four labels**; `runs-on` requires every label in
the array. The JIT config blob is never on a command line, but job processes can
still carry tokens in theirs (for example `git` given an auth header): never list runner processes with their arguments
(`ps -f`, `pgrep -a`) or dump a process environment in a shared transcript.

**What this does and does not bound.** With per-slot users that cannot log in,
hidden processes across uids, JIT configs handed over outside argv, 0700 slot and home
directories, cron and `at` denied, a cgroup kill that fails closed, a private IPC
namespace, the host's other world-writable directories read-only, and a fresh home,
runner tree and scratch files before every job, one approved run cannot read another
slot's credentials and cannot persist a process, cron entry, dotfile, IPC object or
file into a later job on its own slot. It can still read anything world-readable on the host, use
the host's network position, and exhaust the host; those are the residual trust
decision. Running this lane is a recorded administrator decision that every
approved run of this repository (including a maintainer-approved fork run that
edits the workflow file) executes on ubuntu0 inside that boundary.

### Turning the lane on

1. Install the org credential and group id for `ghmint`, run `provision.sh`, then
   `systemctl enable --now terminal-e2e-slot@N` for each slot. Confirm with
   `mint-jitconfig status <group-id>` (as `ghmint`) that each `ubuntu0-e2e-N` shows
   online and idle with the four labels.
2. Set the repository variable `TERMINAL_E2E_LANE=ubuntu0` (and optionally
   `TERMINAL_E2E_WORKERS`).
3. Watch the next same-repository pull request, merge-group or dispatch run: every
   `Terminal e2e <shard>` job should report the runner name `ubuntu0-e2e-N` in its
   "Set up job" step and the bind step should print `lane=ubuntu0`.

### Rollback

1. Delete the `TERMINAL_E2E_LANE` repository variable (or set it to anything but
   `ubuntu0`). The next run of this unmodified job is hosted. This restores
   **routing only**.
2. Stop the slot units (`systemctl disable --now terminal-e2e-slot@N`; `svc.sh stop`
   for any service-installed runner) so no runner is listening for the four labels. A JIT
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

## Current protected-source composition — 2026-11-07

This original candidate composes protected `da93645b9f21d8bdd25ace98ef24d08d0914c2fd`.
It retains `needs: [pr_scope, e2e-scope]`, the selected JSON matrix, both
`matrix.projects` and `matrix.specs`, trusted docs/native merge-group
skip conditions, artifact names and fail-closed aggregate. Only the existing
lane binder, worker/port selection and per-slot browser cache differ from the
protected browser job. Hosted defaults remain one worker and original ports;
both serial opt-ins remain one worker with zero retries.

The original #1223 create-commit effect remains unresolved on its own branch and
candidate tree. This composition does not import its held topology, tracing,
timing or Node-discovery work. The original #1306 queue entry and old-head review
remain historical receipts; a new source head needs current CI and any genuinely
mandatory review. No variable, listener, runner registration, queue admission,
administrator setting or host installation is changed by this source update.

Activation still needs the existing restricted runner-group/public-contributor
policy, no-sudo slot identities, ephemeral credential and process custody,
fresh-home/drain checks, capacity evidence and verified rollback. The earlier
administrator 403 is not retried. Source qualification and an administrator's
host activation are distinct milestones.
