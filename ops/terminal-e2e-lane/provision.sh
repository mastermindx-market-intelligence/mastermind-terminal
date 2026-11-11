#!/bin/bash
# Provision the Terminal e2e JIT lane on its host. No slot is started here.
# Usage (root): bash provision.sh <dir holding this directory's files>
# Idempotent. Every change is appended to /var/log/ci-lightning-fleet-changes.log.
# The org credential (/etc/ghmint/token) and group id (/etc/ghmint/group_id) are
# installed separately; this script never reads them.
set -euo pipefail
SRC="$1"
LOG=/var/log/ci-lightning-fleet-changes.log
SLOTS="1 2 3 4"
RUNNER_URL=https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-x64-2.338.2.tar.gz
RUNNER_SHA=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40
log() { echo "$(date -u +%FT%TZ) terminal-e2e-lane: $*" | tee -a "$LOG"; }
die() { echo "provision: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"

# 0. host prerequisites from the runbook
[ "$(wc -l < /proc/self/cgroup)" = 1 ] && grep -q '^0::' /proc/self/cgroup || die "not unified cgroup v2"
kmaj=$(uname -r | cut -d. -f1); kmin=$(uname -r | cut -d. -f2)
[ "$kmaj" -gt 5 ] || { [ "$kmaj" = 5 ] && [ "$kmin" -ge 14 ]; } || die "kernel older than 5.14"
sv=$(systemctl --version | awk 'NR==1{print $2}')
[ "$sv" -ge 249 ] && [ "$sv" -le 256 ] || die "systemd $sv outside 249-256"
command -v setpriv >/dev/null || die "util-linux setpriv missing"
log "prerequisites OK (cgroup v2, kernel $(uname -r), systemd $sv, setpriv)"

# 1. dedicate the host: retire every other actions runner service on it. Disable first so
#    nothing restarts it; refuse while a job runs; stop an idle listener; read both back.
worker_in() {  # does the unit's cgroup hold a Runner.Worker?
  local cg pid
  cg="/sys/fs/cgroup$(systemctl show -p ControlGroup --value "$1")"
  [ "$cg" != /sys/fs/cgroup ] && [ -d "$cg" ] || return 1
  while read -r pid; do
    [ "$(cat "/proc/$pid/comm" 2>/dev/null)" = Runner.Worker ] && return 0
  done < <(find "$cg" -name cgroup.procs -exec cat {} +)
  return 1
}
mapfile -t runner_units < <(systemctl list-unit-files --no-legend --plain 'actions.runner.*.service' | awk '{print $1}')
for s in "${runner_units[@]}"; do
  if systemctl is-enabled -q "$s"; then systemctl disable -q "$s"; log "$s disabled (rollback: systemctl enable $s)"; fi
  if worker_in "$s"; then die "$s is running a job; the host is not eligible until it finishes"; fi
  if systemctl is-active -q "$s"; then systemctl stop "$s"; log "$s stopped (rollback: systemctl start $s)"; fi
  ! systemctl is-enabled -q "$s" && ! systemctl is-active -q "$s" && ! worker_in "$s" \
    || die "$s retirement did not complete"
done
log "other runner services retired: ${runner_units[*]:-none}"

# 2. the retired canary account cannot run anything: no shell, locked, no linger, idle
if id ghrunner >/dev/null 2>&1; then
  [ "$(getent passwd ghrunner | cut -d: -f7)" = /usr/sbin/nologin ] || usermod -s /usr/sbin/nologin ghrunner
  passwd -l ghrunner >/dev/null
  loginctl disable-linger ghrunner 2>/dev/null || true
  prc=0; pgrep -u ghrunner >/dev/null || prc=$?
  [ "$prc" = 1 ] || die "retired account ghrunner has live processes (pgrep rc=$prc)"
  log "retired account ghrunner: shell nologin, password locked, linger off, no processes"
fi

# 3. accounts: ghmint (credential holder) and one no-login user per slot, private group only
if ! id ghmint >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin ghmint
  log "created system user ghmint"
fi
for N in $SLOTS; do
  u="ghrunner-$N"
  if ! id "$u" >/dev/null 2>&1; then
    useradd -m -s /usr/sbin/nologin "$u"; log "created slot user $u"
  fi
  [ "$(getent passwd "$u" | cut -d: -f7)" = /usr/sbin/nologin ] || usermod -s /usr/sbin/nologin "$u"
  passwd -l "$u" >/dev/null
  loginctl disable-linger "$u" 2>/dev/null || true
  [ "$(id -G "$u")" = "$(id -g "$u")" ] || die "$u has supplementary groups"
  case "$(sudo -n -l -U "$u" 2>&1 || true)" in *"is not allowed to run sudo"*) ;; *) die "$u may have sudo rights" ;; esac
  for f in /etc/cron.deny /etc/at.deny; do
    touch "$f"; chmod 0644 "$f"
    grep -qx "$u" "$f" || { echo "$u" >> "$f"; log "added $u to $f"; }
  done
done

# 4. sshd denies the slot users and the retired canary; reload must succeed and be live
f=/etc/ssh/sshd_config.d/60-terminal-e2e-slots.conf
want='DenyUsers ghrunner ghrunner-*'
if [ "$(cat "$f" 2>/dev/null)" != "$want" ]; then
  install -d -m 0700 /var/backups/ci-lightning
  [ ! -e "$f" ] || cp -p "$f" "/var/backups/ci-lightning/$(basename "$f").$(date -u +%Y%m%dT%H%M%SZ)"
  printf '%s\n' "$want" > "$f"; chmod 0644 "$f"
  sshd -t || die "sshd -t refused the configuration"
  systemctl reload ssh || die "ssh reload failed"
  systemctl is-active -q ssh || die "ssh is not active after reload"
  log "sshd $want ($f), reloaded"
fi
sshd_cfg="$(sshd -T -C user=ghrunner-1,host=localhost,addr=127.0.0.1)" || die "sshd -T failed"
grep -qiE '^denyusers( .*)? ghrunner-\*( |$)' <<<"$sshd_cfg" || die "sshd -T does not deny ghrunner-*"
grep -qiE '^denyusers( .*)? ghrunner( |$)' <<<"$sshd_cfg" || die "sshd -T does not deny ghrunner"

# 5. credential directory, readable by ghmint only
install -d -o ghmint -g ghmint -m 0700 /etc/ghmint

# 6. pristine runner tarball, checksum-verified
install -d -o root -g root -m 0755 /opt/actions-runner /opt/actions-runner/slots
if ! echo "$RUNNER_SHA  /opt/actions-runner/actions-runner-linux-x64.tar.gz" | sha256sum -c - >/dev/null 2>&1; then
  curl -fsSL -o /opt/actions-runner/.download.tar.gz "$RUNNER_URL"
  echo "$RUNNER_SHA  /opt/actions-runner/.download.tar.gz" | sha256sum -c - >/dev/null
  mv /opt/actions-runner/.download.tar.gz /opt/actions-runner/actions-runner-linux-x64.tar.gz
  chmod 0644 /opt/actions-runner/actions-runner-linux-x64.tar.gz
  log "runner tarball v2.338.2 installed (sha256 verified)"
fi

# 7. scripts, slice and unit. The JIT config never reaches a sudo command line, so no
#    sudoers no-log rule is needed; remove the one an earlier revision installed.
install -o root -g root -m 0755 "$SRC/mint-jitconfig" /usr/local/bin/mint-jitconfig
install -o root -g root -m 0700 "$SRC/terminal-e2e-slot" /usr/local/sbin/terminal-e2e-slot
install -o root -g root -m 0644 "$SRC/terminal_e2e.slice" /etc/systemd/system/terminal_e2e.slice
install -o root -g root -m 0644 "$SRC/terminal-e2e-slot@.service" /etc/systemd/system/terminal-e2e-slot@.service
# Removing a drop-in cannot introduce a syntax error, so no visudo pass here.
if [ -e /etc/sudoers.d/terminal-e2e-slots ]; then
  rm -f /etc/sudoers.d/terminal-e2e-slots
  log "removed unused /etc/sudoers.d/terminal-e2e-slots"
fi
systemctl daemon-reload
log "installed mint-jitconfig $(sha256sum /usr/local/bin/mint-jitconfig | cut -c1-16)," \
    "terminal-e2e-slot $(sha256sum /usr/local/sbin/terminal-e2e-slot | cut -c1-16)," \
    "slice and unit template; slots NOT started"
