#!/bin/bash
# Install or refresh the user LaunchAgent that owns the nightly fund/transcript lane.
set -euo pipefail

OPS_ROOT="${MM_FUND_OPS_ROOT:-/Users/chriswong/fund-ops-wt}"
SOURCE_PLIST="$OPS_ROOT/ops/launchd/com.mastermind.fund.plist"
SOURCE_RUNNER="$OPS_ROOT/ops/nightly_fund.sh"
DEST_DIR="$HOME/Library/LaunchAgents"
DEST_PLIST="$DEST_DIR/com.mastermind.fund.plist"
LABEL="com.mastermind.fund"
DOMAIN="gui/$(id -u)"
RUN_NOW=0
CHECK_ONLY=0

usage() {
  echo "Usage: /bin/bash $0 [--check | --run-now]"
  echo "  --check    validate repo paths and plist syntax without changing launchd"
  echo "  --run-now  install, then kick off one refresh immediately"
  echo "Runs only on the fund lane host ($FUND_LANE_HOST, i.e. M1); other hosts exit 3."
}

# ── HOST GUARD — this is the M1 installer, never run it anywhere else ────────
# The fund lane moved M2 → M1 on 2026-07-25/26. On 2026-08-01 this script ran
# on M2 and silently re-loaded the job there, so both Macs rsynced *.fund.json
# to the VPS every night for ~11 weeks and prod flip-flopped between them.
# M2's job was booted out again on 2026-10-19 and carries a persistent
# `launchctl disable` override; leave it in place.
#
# Identity is the Bonjour LocalHostName: user-set, independent of network/DHCP
# (unlike `hostname`), and read as m1studio on M1 / m2studio on M2 (2026-10-30).
# A missing or renamed name fails closed.
#
# Rolling the lane back to M2 goes through ~/dataplane-migration/rollback-groupB-to-M2.sh
# on M2 (it boots M1 out, lifts M2's disable override, restores M2's plist).
# MM_FUND_BOOTSTRAP_ALLOW_HOST=1 is only for refreshing the plist on M2 AFTER
# that rollback; never set it while M1 still runs the lane.
FUND_LANE_HOST="m1studio"
fund_lane_host_id() { /usr/sbin/scutil --get LocalHostName 2>/dev/null || true; }
require_fund_lane_host() {
  local host
  host="$(fund_lane_host_id)"
  [ "$host" = "$FUND_LANE_HOST" ] && return 0
  if [ "${MM_FUND_BOOTSTRAP_ALLOW_HOST:-}" = "1" ]; then
    echo "WARNING: MM_FUND_BOOTSTRAP_ALLOW_HOST=1 — proceeding on '${host:-unknown}'; the fund lane host is $FUND_LANE_HOST." >&2
    echo "Only valid after ~/dataplane-migration/rollback-groupB-to-M2.sh moved the lane off M1." >&2
    return 0
  fi
  echo "REFUSED: $LABEL runs only on $FUND_LANE_HOST (M1); this host's LocalHostName is '${host:-unknown}'." >&2
  echo "Nothing was installed: ~/Library/LaunchAgents and launchctl were not touched." >&2
  echo "Install or refresh the lane on M1:  ssh m1 '/bin/bash /Users/chriswong/fund-ops-wt/ops/bootstrap_nightly_fund.sh'" >&2
  echo "Roll the lane back to M2 only with:  ~/dataplane-migration/rollback-groupB-to-M2.sh" >&2
  echo "After that rollback, refresh M2's plist with MM_FUND_BOOTSTRAP_ALLOW_HOST=1." >&2
  return 3
}

# Sourced by tests/test_bootstrap_nightly_fund_host_guard.py: define, run nothing.
[ "${BASH_SOURCE[0]}" = "$0" ] || return 0

for arg in "$@"; do
  case "$arg" in
    --run-now) RUN_NOW=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

# Before every other check, so a wrong host never reaches LaunchAgents or launchctl.
require_fund_lane_host || exit $?

if ! /usr/bin/git -C "$OPS_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Missing standalone ops clone at $OPS_ROOT" >&2
  echo "Create it from mastermind-terminal master before installing the LaunchAgent." >&2
  exit 1
fi
if [ ! -f "$SOURCE_PLIST" ] || [ ! -f "$SOURCE_RUNNER" ]; then
  echo "Ops clone is missing the LaunchAgent plist or nightly runner; update $OPS_ROOT first." >&2
  exit 1
fi

/usr/bin/plutil -lint "$SOURCE_PLIST" >/dev/null
BRANCH="$(/usr/bin/git -C "$OPS_ROOT" symbolic-ref --quiet --short HEAD || true)"
HEAD_SHA="$(/usr/bin/git -C "$OPS_ROOT" rev-parse --short HEAD)"
if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "OK: repo=$OPS_ROOT branch=${BRANCH:-detached} head=$HEAD_SHA"
  echo "OK: plist and runner are present; plist syntax is valid"
  exit 0
fi

if [ "$BRANCH" != "master" ]; then
  echo "$OPS_ROOT must be on master before installing (found ${BRANCH:-detached})." >&2
  exit 1
fi
# Refresh refs, then prove the installed runner/plist come from the current
# deployment revision.  We refuse to install stale or locally modified control
# code; generated data elsewhere in the ops clone is intentionally ignored.
/usr/bin/git -C "$OPS_ROOT" fetch origin master --quiet
LOCAL_HEAD="$(/usr/bin/git -C "$OPS_ROOT" rev-parse HEAD)"
REMOTE_HEAD="$(/usr/bin/git -C "$OPS_ROOT" rev-parse origin/master)"
if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  echo "$OPS_ROOT is stale: HEAD=$LOCAL_HEAD origin/master=$REMOTE_HEAD" >&2
  echo "Update the dedicated ops clone, then rerun this bootstrap." >&2
  exit 1
fi
if ! /usr/bin/git -C "$OPS_ROOT" diff --quiet HEAD -- \
  ops/nightly_fund.sh ops/bootstrap_nightly_fund.sh ops/launchd/com.mastermind.fund.plist; then
  echo "Nightly control files have local modifications; refusing to install them." >&2
  exit 1
fi

/bin/mkdir -p "$DEST_DIR"
TMP_PLIST="$(/usr/bin/mktemp "$DEST_DIR/.com.mastermind.fund.XXXXXX")"
trap '/bin/rm -f "$TMP_PLIST"' EXIT
/usr/bin/install -m 0644 "$SOURCE_PLIST" "$TMP_PLIST"
/bin/mv "$TMP_PLIST" "$DEST_PLIST"

# Refreshing is idempotent.  bootout returns non-zero when the job was not
# installed, which is a healthy first-install state.
/bin/launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "$DOMAIN" "$DEST_PLIST"
/bin/launchctl enable "$DOMAIN/$LABEL"

if [ "$RUN_NOW" -eq 1 ]; then
  /bin/launchctl kickstart -k "$DOMAIN/$LABEL"
fi

echo "Installed $LABEL from $SOURCE_PLIST"
/bin/launchctl print "$DOMAIN/$LABEL" | /usr/bin/sed -n '1,36p'
echo "Log: /tmp/mm_fund_refresh.log"
