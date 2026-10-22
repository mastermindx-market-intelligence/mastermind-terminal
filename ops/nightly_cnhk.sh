#!/bin/bash
# nightly_cnhk.sh — durable nightly CN/HK deep-data refresh (Terminal intel + fund + US intel).
#
# Closes the staleness gap found 2026-07-13: CN intel.json 17d / CN-HK fund.json 10d stale
# because ingest/refresh_cn_hk.sh + ingest/refresh_fund.sh only ran when invoked manually
# (the VPS nightly terminal-data cannot run them — the Tushare/akshare collection lives on
# this Mac).
#
# ── TCC LAW (macOS launchd) ──────────────────────────────────────────────────
# launchd (Aqua session) jobs are DENIED open-for-read on ANYTHING under
# ~/Documents/ (script exec dies exit 126, file reads fail "Operation not
# permitted"; binary exec + writes are, counterintuitively, allowed — probed
# 2026-07-06). Same failure class previously hit com.mastermind.fund,
# com.mastermind.liveflow and com.macro.thetadata-backfill. This lane therefore
# lives ENTIRELY outside ~/Documents/:
#
#   DEPLOY   /Users/chriswong/fund-ops-wt    charting-app clone (self-updating from
#                                            origin/master; shared with the US fund lane)
#   ENGINE   /Users/chriswong/fund-engine-wt macro sparse clone — cones now also include
#                                            collectors (hk_fundamentals code), data/tushare
#                                            + data/hk_southbound (CI-maintained parquets:
#                                            valuation/forecast/moneyflow/southbound)
#   MACROSRC /Users/chriswong/cnhk-src       the MACRO_REPO surface the refresh scripts see:
#                                            collectors/lib/config symlinks → ENGINE,
#                                            site/{chinastockdata,hkstockdata} R2 mirrors,
#                                            data/tushare + data/hk_fund collector stores
#   PY       /Users/chriswong/cnhk-venv      dedicated venv (tushare/akshare/pandas pinned to
#                                            the Macro Dashboard .venv versions; separate from
#                                            fund-venv so the US lane stays untouched)
#   SECRETS  ~/.mm-fund.env                  TUSHARE_TOKEN (+ optional TELEGRAM_* for alerts)
#
# RECREATE THE LANE (if any piece is missing):
#   cd /Users/chriswong/fund-engine-wt && git sparse-checkout add collectors data/tushare data/hk_southbound
#   python3.12 -m venv /Users/chriswong/cnhk-venv
#   /Users/chriswong/cnhk-venv/bin/pip install "tushare==1.4.29" "akshare==1.18.64" \
#       "pandas==3.0.3" "pyarrow==24.0.0" "numpy==2.4.6" "yfinance==1.4.1" \
#       "requests==2.34.2" "PyYAML==6.0.3" "lxml" "beautifulsoup4"
#   # then close any gap between this pinned list and the repo's canonical requirements
#   # (requirements.txt is authoritative — it carries jsonschema>=4.20, which the explicit
#   # list above used to omit and which pull_macro_intel needs via ingest.security_state_bridge):
#   /Users/chriswong/cnhk-venv/bin/pip install -r "$DEPLOY/requirements.txt"
#   mkdir -p /Users/chriswong/cnhk-src/{site,data/tushare,data/hk_fund,data/hk_southbound}
#   ln -sfn /Users/chriswong/fund-engine-wt/collectors /Users/chriswong/cnhk-src/collectors
#   ln -sfn /Users/chriswong/fund-engine-wt/lib        /Users/chriswong/cnhk-src/lib
#   ln -sfn /Users/chriswong/fund-engine-wt/config     /Users/chriswong/cnhk-src/config
#   printf 'TUSHARE_TOKEN=<token>\n' > ~/.mm-fund.env && chmod 600 ~/.mm-fund.env
#   (collector parquet stores rebuild themselves — all collectors are resumable-from-empty)
#
# Flow: self-update DEPLOY (exec-once) → dependency preflight → wait for the US fund lane →
# refresh ENGINE →
# copy CI parquets into MACROSRC → R2-mirror chinastockdata/hkstockdata → rsync HK OHLC
# down from the VPS (collect_hk_deep universe + intel lite tech read) → refresh_cn_hk.sh
# (Sundays: --force-hk full HK refetch) → refresh_fund.sh --cn-hk-only → dead-man stamp.
# ops/check_cnhk_fresh.sh (com.mastermind.cnhk-watch) alerts if the stamp or the served
# VPS files go stale.
#
# Loaded via ~/Library/LaunchAgents/com.mastermind.cnhk.plist. Log: /tmp/mm_cnhk_refresh.log
set -u
DEPLOY="/Users/chriswong/fund-ops-wt"
ENGINE="/Users/chriswong/fund-engine-wt"
SRC="/Users/chriswong/cnhk-src"
PYBIN="/Users/chriswong/cnhk-venv/bin/python"
KEY="$HOME/.ssh/macro_dashboard_deploy_v2"
VPS="root@146.190.142.17"; VPS_DATA="/opt/terminal/terminal/public/data"
LOG="/tmp/mm_cnhk_refresh.log"
STAMP="$SRC/cnhk_status.json"
DATA="$DEPLOY/terminal/public/data"
ts(){ date "+%Y-%m-%dT%H:%M:%S%z"; }

# -1. self-update the deploy clone, then exec the (possibly fresher) script exactly once.
if [ "${1:-}" != "--post-update" ]; then
  git -C "$DEPLOY" fetch origin master --quiet 2>>"$LOG" && git -C "$DEPLOY" reset --hard origin/master --quiet 2>>"$LOG" \
    || echo "[$(ts)] WARN: deploy self-update failed — using current code" >> "$LOG"
  exec /bin/bash "$DEPLOY/ops/nightly_cnhk.sh" --post-update
fi

echo "[$(ts)] ===== nightly CN/HK refresh start =====" >> "$LOG"

# 0. dependency preflight — fail fast on import drift instead of half-running the lane.
#
# 2026-10-22: pull_macro_intel died on `from jsonschema import ...` (via
# ingest.security_state_bridge) because the dedicated cnhk-venv was missing jsonschema. The
# stage was logged "exited 0" and the lane stamped a full success. requirements.txt has always
# carried jsonschema>=4.20, but nothing verified the dedicated venv against it — the recreate
# command in this file's header pip-installs an explicit list that had drifted from it.
#
# This preflight imports what the two refresh drivers actually import, in the interpreter that
# will run them. It DIAGNOSTES ONLY: it never installs, never upgrades, and never mutates the
# host or the venv. Remediation is the operator's `pip install -r requirements.txt` into
# $PYBIN, or the RECREATE block above. Checking early turns a silent false-green into a loud
# one-line abort that costs seconds instead of a full run.
PREFLIGHT_THIRD_PARTY="jsonschema pandas pyarrow numpy yaml requests"
PREFLIGHT_REPO="ingest.security_state_bridge ingest.collect_cn_deep"
RC_PREFLIGHT=0
preflight() {
  if [ ! -x "$PYBIN" ]; then
    echo "[$(ts)] PREFLIGHT: dedicated venv interpreter missing: $PYBIN" >> "$LOG"
    echo "[$(ts)] PREFLIGHT: recreate it — see the RECREATE THE LANE block at the top of this file" >> "$LOG"
    return 1
  fi
  if ! "$PYBIN" - "$DEPLOY" "$PREFLIGHT_THIRD_PARTY" "$PREFLIGHT_REPO" >>"$LOG" 2>&1 <<'PREFLIGHT_EOF'
import importlib, sys

root, third_party, repo = sys.argv[1], sys.argv[2].split(), sys.argv[3].split()
sys.path.insert(0, root)                      # the drivers put the deploy clone on sys.path
broken = []
for mod in third_party + repo:
    try:
        importlib.import_module(mod)
    except Exception as e:
        broken.append(f"{mod}  ->  {type(e).__name__}: {e}")
if broken:
    print("PREFLIGHT: unusable imports — the lane cannot run:")
    for b in broken:
        print(f"  - {b}")
    print("PREFLIGHT: fix with  $PYBIN/bin/pip install -r <clone>/requirements.txt")
    raise SystemExit(1)
print("PREFLIGHT: OK — " + ", ".join(third_party + repo))
PREFLIGHT_EOF
  then
    return 1
  fi
  return 0
}
preflight || RC_PREFLIGHT=1

# Dead-man stamp. last_run always advances; last_success only when EVERY leg exited 0.
# Extracted so a preflight abort reports the same way a late failure does — the watcher reads
# this file, and a preflight failure that never reached the stamp looked identical to a lane
# that had not run at all.
write_stamp() {
  [ -x "$PYBIN" ] || { echo "[$(ts)] STAMP: no interpreter, skipping stamp (last_success untouched)" >> "$LOG"; return; }
  "$PYBIN" - "$STAMP" "$1" "$2" "$3" <<'PYEOF' >> "$LOG" 2>&1
import datetime as dt
import json
import sys
from pathlib import Path

path, rc_intel, rc_fund, rc_pre = Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
try:
    status = json.loads(path.read_text())
except Exception:
    status = {}
status["last_run"] = now
status["exit"] = {"preflight": rc_pre, "refresh_cn_hk": rc_intel, "refresh_fund_cnhk": rc_fund}
if rc_pre == 0 and rc_intel == 0 and rc_fund == 0:
    status["last_success"] = now
else:
    status["last_incomplete"] = now
    status["failed_stages_hint"] = "see /tmp/mm_cnhk_refresh.log — a required stage exited nonzero; last_success deliberately NOT advanced"
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(status, indent=2) + "\n")
print(f"stamp: last_run={now} preflight={rc_pre} intel={rc_intel} fund={rc_fund}"
      f"{' last_success=' + now if rc_pre == 0 and rc_intel == 0 and rc_fund == 0 else ''}")
PYEOF
}

if [ "$RC_PREFLIGHT" != "0" ]; then
  echo "[$(ts)] ABORT: dependency preflight failed — no refresh, no publication" >> "$LOG"
  write_stamp 1 1 "$RC_PREFLIGHT"
  echo "[$(ts)] ===== nightly CN/HK refresh done (preflight failed) =====" >> "$LOG"
  exit 1
fi

# 0b. serialize behind the US fund lane (16:30 start, 10min–4h runtime; shares DEPLOY + VPS).
#
# INTEGRATION RISK (flagged 2026-10-21, deliberately NOT changed here): the self-update + exec
# above happens BEFORE this wait, so while this lane is blocked on nightly_fund it holds the
# shared /Users/chriswong/fund-ops-wt clone at the self-updated origin/master — and nightly_fund
# self-updates the same clone from its own lane. Two lanes sharing one working tree with a
# `reset --hard` in each is the real hazard. Moving the self-update after the wait would fix
# it, but that reorder interacts with the sibling nightly_fund's own update, which is owned by
# another worker — so it is raised here rather than fixed unilaterally. Resolving it means
# giving each lane its own clone or serialising the update itself.
WAITED=0
while pgrep -f "ops/nightly_fund.sh" >/dev/null 2>&1; do
  if [ "$WAITED" -ge 12600 ]; then
    echo "[$(ts)] WARN: nightly_fund still running after 3.5h — proceeding anyway" >> "$LOG"
    break
  fi
  sleep 300; WAITED=$((WAITED+300))
done
[ "$WAITED" -gt 0 ] && echo "[$(ts)] waited ${WAITED}s for nightly_fund" >> "$LOG"

# 1. engine clone on latest main (collectors code + CI-maintained parquets).
git -C "$ENGINE" fetch --depth 1 origin main --quiet 2>>"$LOG" && git -C "$ENGINE" reset --hard origin/main --quiet 2>>"$LOG" \
  || echo "[$(ts)] WARN: engine git update failed — using current code" >> "$LOG"

# 2. copy the CI-maintained parquets into the MACRO surface. Collector-written stores
#    (financials/lhb/holders/stmt_*/hk_deep/...) live alongside as real files and are
#    never touched by this copy.
mkdir -p "$SRC/data/tushare" "$SRC/data/hk_southbound" "$SRC/data/hk_fund" "$SRC/site"
cp -f "$ENGINE"/data/tushare/*.parquet "$SRC/data/tushare/" 2>>"$LOG" \
  || echo "[$(ts)] WARN: CI tushare parquet copy failed" >> "$LOG"
cp -f "$ENGINE"/data/hk_southbound/*.parquet "$SRC/data/hk_southbound/" 2>>"$LOG" \
  || echo "[$(ts)] WARN: southbound parquet copy failed" >> "$LOG"

# 3. mirror the CI-built CN/HK site stockdata from the public R2 bucket (the fresh
#    universe + decision/conviction source; the ~/Documents copies are manual-run relics).
"$PYBIN" "$DEPLOY/ingest/r2_mirror.py" chinastockdata "$SRC/site/chinastockdata" >> "$LOG" 2>&1 \
  || { echo "[$(ts)] ABORT: chinastockdata R2 mirror failed — no refresh" >> "$LOG"; exit 1; }
"$PYBIN" "$DEPLOY/ingest/r2_mirror.py" hkstockdata "$SRC/site/hkstockdata" >> "$LOG" 2>&1 \
  || { echo "[$(ts)] ABORT: hkstockdata R2 mirror failed — no refresh" >> "$LOG"; exit 1; }

# 4. HK OHLC universe down from the VPS: collect_hk_deep's universe is the local
#    *.HK.json glob, and pull_cn_hk_intel computes the lite tech read from these bars.
rsync -az -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=25" \
  --include='*.HK.json' --exclude='*' "$VPS:$VPS_DATA/" "$DATA/" >> "$LOG" 2>&1 \
  && echo "[$(ts)] OHLC rsync-down OK ($(ls "$DATA" 2>/dev/null | grep -c '\.HK\.json$') HK files)" >> "$LOG" \
  || echo "[$(ts)] WARN: OHLC rsync-down failed — HK universe may be incomplete" >> "$LOG"

# 5. lane environment for the two refresh drivers.
set -a; [ -f "$HOME/.mm-fund.env" ] && . "$HOME/.mm-fund.env"; set +a
export MACRO_REPO="$SRC"
export MM_REFRESH_PY="$PYBIN"
export MACRO_STOCKDATA="$SRC/site/stockdata"   # pull_macro_intel's US mirror (self-syncs from R2)

# 6. CN/HK deep intel. Sundays do a full HK refetch (hk_deep payloads are cached
#    per-name and only refresh under --force; Sunday = markets closed, cheap window).
FORCE=""
[ "$(date +%u)" = "7" ] && FORCE="--force-hk"
/bin/bash "$DEPLOY/ingest/refresh_cn_hk.sh" $FORCE >> "$LOG" 2>&1
RC_INTEL=$?
echo "[$(ts)] refresh_cn_hk.sh exit=$RC_INTEL" >> "$LOG"

# 7. CN/HK fund + US intel (step 10 of refresh_fund runs pull_macro_intel --all even
#    with --cn-hk-only). tx/opts stay manual: tx needs the defeatbeta venv (volatile
#    /tmp today) and opts needs the US OHLC dollar-volume surface this lane lacks.
/bin/bash "$DEPLOY/ingest/refresh_fund.sh" --cn-hk-only --skip-tx --skip-opts >> "$LOG" 2>&1
RC_FUND=$?
echo "[$(ts)] refresh_fund.sh exit=$RC_FUND" >> "$LOG"

# 8. dead-man stamp (mirrors the macro repo's run_status.json heartbeat idiom):
#    last_run always advances; last_success only when preflight AND both drivers exited 0.
#    ops/check_cnhk_fresh.sh alerts when last_success goes stale.
write_stamp "$RC_INTEL" "$RC_FUND" "$RC_PREFLIGHT"

echo "[$(ts)] ===== nightly CN/HK refresh done (preflight=$RC_PREFLIGHT intel=$RC_INTEL fund=$RC_FUND) =====" >> "$LOG"
if [ "$RC_PREFLIGHT" = "0" ] && [ "$RC_INTEL" = "0" ] && [ "$RC_FUND" = "0" ]; then
  exit 0
fi
exit 1
