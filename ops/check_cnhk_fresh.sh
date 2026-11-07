#!/bin/bash
# check_cnhk_fresh.sh — dead-man watcher for the nightly CN/HK refresh lane.
#
# Mirrors the Macro Dashboard healthcheck idiom (run_status.json heartbeat + staleness
# limit + best-effort push): fails non-zero and alerts when any of
#   (1) the lane's local stamp (cnhk-src/cnhk_status.json last_success) is > 30h old,
#   (2) the actually-served VPS sentinel files stopped advancing (> 48h mtime) — this
#       catches silent rsync failures the local stamp cannot see, or
#   (3) the most recent run reported INCOMPLETE (stamp "exit" holds a nonzero rc). Neither
#       (1) nor (2) could see the 2026-10-22 false-green: that run stamped a FRESH
#       last_success and rsynced placeholder files, so both looked perfectly healthy while
#       the deep caches were empty. (3) reports it on the day it happens.
#
# Alert channels: /tmp/mm_cnhk_watch.log ALERT line + macOS notification + optional
# Telegram push when TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are set in ~/.mm-fund.env.
#
# Runs from ~/Library/LaunchAgents/com.mastermind.cnhk-watch.plist (daily 10:00 local,
# i.e. well after the 18:30 lane finished). TCC LAW: keep everything outside ~/Documents.
set -u
SRC="/Users/chriswong/cnhk-src"
STAMP="$SRC/cnhk_status.json"
PYBIN="/Users/chriswong/cnhk-venv/bin/python"
[ -x "$PYBIN" ] || PYBIN="python3"
KEY="$HOME/.ssh/macro_dashboard_deploy_v2"
VPS="root@146.190.142.17"; VPS_DATA="/opt/terminal/terminal/public/data"
LOG="/tmp/mm_cnhk_watch.log"
MAX_STAMP_AGE_H=30   # daily lane + slack
MAX_VPS_AGE_H=48     # served files must be rewritten at least every other day
# JNJ.intel.json watches the US-intel leg (refresh_fund step 10, pull_macro_intel --all).
# It MUST be a name outside build_polygon_universe.DEFAULT: the VPS's own nightly
# refreshes the 37 DEFAULT names and would mask a lane failure (the 2026-07-03→14
# no-op was invisible because only DEFAULT names kept advancing).
SENTINELS="600519.SS.intel.json 0700.HK.fund.json JNJ.intel.json"
ts(){ date "+%Y-%m-%dT%H:%M:%S%z"; }

FAILS=""
add_fail(){ FAILS="${FAILS:+$FAILS; }$1"; }

# 1. local dead-man stamp
if [ ! -f "$STAMP" ]; then
  add_fail "no stamp at $STAMP (lane never succeeded)"
else
  AGE_H=$("$PYBIN" - "$STAMP" <<'PYEOF'
import datetime as dt, json, sys
try:
    ls = json.load(open(sys.argv[1])).get("last_success")
    if not ls:
        print(-1); raise SystemExit
    age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(ls.replace("Z", "+00:00"))
    print(round(age.total_seconds() / 3600, 1))
except SystemExit:
    pass
except Exception:
    print(-2)
PYEOF
)
  case "$AGE_H" in
    -1) add_fail "stamp has no last_success (lane runs but never fully succeeded)" ;;
    -2) add_fail "unreadable stamp at $STAMP" ;;
    *)  awk "BEGIN{exit !($AGE_H > $MAX_STAMP_AGE_H)}" && add_fail "STALE: last CN/HK success ${AGE_H}h ago (limit ${MAX_STAMP_AGE_H}h)" ;;
  esac

  # 1b. A run that reported INCOMPLETE. This is the check that catches the 2026-10-22
  # false-green: the lane stamped a fresh last_success while a rejected Tushare token had
  # zeroed the deep caches. last_success stays put until a run fully succeeds, so staleness
  # alone only fires 30h later — by which time the data has been wrong for a day. Here the
  # incomplete run is reported the day it happens.
  INCOMPLETE=$("$PYBIN" - "$STAMP" <<'PYEOF'
import json, sys
try:
    s = json.load(open(sys.argv[1]))
except Exception:
    print("unreadable"); raise SystemExit
ex = s.get("exit")
if not isinstance(ex, dict) or not ex:
    print("none"); raise SystemExit          # pre-2026-10-21 stamp: no exit detail recorded
bad = {k: v for k, v in ex.items() if v}
if bad:
    print("stage(s) " + " ".join(f"{k}={v}" for k, v in sorted(bad.items())))
else:
    print("none")
PYEOF
)
  case "$INCOMPLETE" in
    none|unreadable) ;;
    *) add_fail "INCOMPLETE: last nightly ran but a required stage failed ($INCOMPLETE)" ;;
  esac
fi

# 2. VPS sentinel freshness — the deliverable is the served files advancing.
NOW_EPOCH=$(date +%s)
for f in $SENTINELS; do
  MT=$(ssh -i "$KEY" -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new "$VPS" \
        "stat -c %Y '$VPS_DATA/$f'" 2>/dev/null)
  if [ -z "${MT:-}" ]; then
    add_fail "cannot stat $f on VPS"
  else
    AGE=$(( (NOW_EPOCH - MT) / 3600 ))
    [ "$AGE" -gt "$MAX_VPS_AGE_H" ] && add_fail "VPS $f is ${AGE}h old (limit ${MAX_VPS_AGE_H}h)"
  fi
done

if [ -z "$FAILS" ]; then
  echo "[$(ts)] OK — CN/HK lane fresh (stamp ${AGE_H:-?}h)" >> "$LOG"
  exit 0
fi

MSG="CN/HK refresh dead-man tripped — $FAILS. See /tmp/mm_cnhk_refresh.log"
echo "[$(ts)] ALERT: $MSG" >> "$LOG"
osascript -e "display notification \"${FAILS//\"/}\" with title \"Terminal CN/HK refresh STALE\"" 2>/dev/null
set -a; [ -f "$HOME/.mm-fund.env" ] && . "$HOME/.mm-fund.env"; set +a
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  curl -s -m 20 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=🚨 $MSG" >/dev/null 2>&1
fi
exit 1
