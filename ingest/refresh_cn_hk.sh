#!/usr/bin/env bash
# One-command China + Hong Kong deep-data refresh for the Terminal intel panel.
#
# Runs on the Mac (needs the Macro Dashboard venv + TUSHARE_TOKEN in its .env, and the
# nightly-built site data at Macro Dashboard/site/{chinastockdata,hkstockdata}). It:
#
# Lane overrides (used by the launchd nightly — ops/nightly_cnhk.sh — which must run
# entirely OUTSIDE ~/Documents because macOS TCC denies launchd reads there):
#   MACRO_REPO     alternate Macro-surface root (site/*stockdata + data/* + collectors code)
#   MM_REFRESH_PY  alternate python interpreter (defaults to $MACRO/.venv/bin/python)
#   TUSHARE_TOKEN  taken from the environment when set (no $MACRO/.env needed)
# CA (the charting-app root) self-resolves from this script's own location, so a
# worktree/clone run uses its own ingest/ + terminal/public/data.
#   1. collects the deep Tushare/akshare parquets (financials, holders, 龙虎榜/block, HK deep)
#   2. rebuilds every CN/HK <SYM>.intel.json via the bridge
#   3. rsyncs the intel to the production VPS (content updates serve per-request — no restart)
#
# Usage:
#   ingest/refresh_cn_hk.sh                 # normal daily refresh (data content only)
#   ingest/refresh_cn_hk.sh --force-hk      # also re-fetch cached HK names (schema change / full)
#   ingest/refresh_cn_hk.sh --deploy        # + rebuild & restart the VPS (needed only if NEW symbols appeared)
#   ingest/refresh_cn_hk.sh --skip-collect  # rebuild intel from existing parquets + rsync (fast, no API)
#
# The upstream site data (Macro Dashboard site/*stockdata) is produced by the Macro Dashboard's
# own build — run that first if you want fresh decision/conviction for the engine-covered names.
#
# EXIT CODE (2026-10-21): 0 only when every REQUIRED stage succeeded. A required stage that fails
# still lets the independent stages run and publish (HK is not gated on CN), but the script then
# exits NONZERO so ops/nightly_cnhk.sh can leave last_success alone. The previous version ended on a
# bare `echo` and therefore always returned 0 — a rejected Tushare token produced a green nightly
# over zero-row parquets. Required = CN deep collect, HK deep collect, intel bridge, publication
# rsync, optional deploy. Explicitly optional / last-good-tolerated = HK universe floor refresh.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CA="$(cd "$SCRIPT_DIR/.." && pwd)"
MACRO="${MACRO_REPO:-/Users/chriswong/Documents/Cluade/Macro Dashboard}"
PY="${MM_REFRESH_PY:-$MACRO/.venv/bin/python}"
export MACRO_REPO="$MACRO" CA_ROOT="$CA"   # the ingest/*.py children resolve their roots from these
KEY="$HOME/.ssh/macro_dashboard_deploy_v2"
VPS="root@146.190.142.17"
DATA="$CA/terminal/public/data"
ts() { date -u "+%Y-%m-%d %H:%M:%S"; }

FORCE_HK=""; DEPLOY=0; SKIP_COLLECT=0
for a in "$@"; do
  case "$a" in
    --force-hk) FORCE_HK="--force" ;;
    --deploy) DEPLOY=1 ;;
    --skip-collect) SKIP_COLLECT=1 ;;
    *) echo "unknown flag: $a"; exit 2 ;;
  esac
done

# Aggregate required-stage failures. Each entry is "name:rc".
FAILED_STAGES=()
note_failure() { FAILED_STAGES+=("$1:$2"); }
# Capture a command's rc into a caller-named variable. The rc MUST be read before any
# command substitution runs on the next line — `cmd || echo "$(ts) ... $?"` resets $? to
# the exit status of the substitution, which is how a failed collector got logged as 0.
run_stage() {
  local __rc=0
  "$@" || __rc=$?
  return "$__rc"
}

cd "$MACRO" || { echo "no Macro-surface dir at $MACRO"; exit 1; }
set -a; [ -f "$MACRO/.env" ] && . "$MACRO/.env"; set +a
if [ -z "${TUSHARE_TOKEN:-}" ]; then
  # Not a hard abort: the HK leg and the bridge do not need the Tushare credential, and
  # refusing to run them would keep a CN-side token problem from taking down good HK data.
  echo "[$(ts)] ERROR: TUSHARE_TOKEN missing (env or $MACRO/.env) — CN deep leg cannot run"
  note_failure "cn_token_missing" 1
fi

if [ "$SKIP_COLLECT" = "0" ]; then
  # Refresh the authoritative HKEX universe floor (Tushare hk_basic ~2.8k listed names) and
  # push it to the VPS. The nightly cron's expand_universe reads this cache as its floor, so
  # this keeps the FULL universe (incl. new listings) durable instead of the old top-500.
  # EXPLICITLY OPTIONAL: on failure the existing cache stays and the run continues.
  echo "[$(ts)] === refresh HK universe floor (Tushare hk_basic) ==="
  RC_UNIVERSE=0
  if "$PY" "$CA/ingest/gen_hk_universe.py" --merge "$CA/ingest/hk_universe_cache.json" --out "$CA/ingest/hk_universe_cache.json"; then
    RC_PUSH=0
    rsync -az -e "ssh -i $KEY" "$CA/ingest/hk_universe_cache.json" "$VPS:/opt/terminal/ingest/hk_universe_cache.json" || RC_PUSH=$?
    [ "$RC_PUSH" = "0" ] && echo "[$(ts)] HK universe floor refreshed + pushed to VPS" \
                         || echo "[$(ts)] WARN: HK universe floor push failed (rc=$RC_PUSH) — VPS keeps its existing copy"
  else
    RC_UNIVERSE=$?
    echo "[$(ts)] WARN: HK universe floor refresh failed (rc=$RC_UNIVERSE) — keeping existing cache"
  fi

  # CN and HK are collected independently: a CN-side credential failure must not stop the
  # HK leg, and vice versa. Each leg is scored on its own.
  if [ "${TUSHARE_TOKEN:-}" ]; then
    echo "[$(ts)] === CN deep collectors (fina_indicator/income + 龙虎榜/大宗 + top-holders) ==="
    run_stage "$PY" "$CA/ingest/collect_cn_deep.py" || note_failure "collect_cn_deep" "$?"
  else
    echo "[$(ts)] === CN deep collectors SKIPPED (no TUSHARE_TOKEN) — last-good caches serve ==="
    note_failure "collect_cn_deep" 1
  fi
  echo "[$(ts)] === HK deep collector (financials/analyst/profile/valuation) ==="
  run_stage "$PY" "$CA/ingest/collect_hk_deep.py" $FORCE_HK --workers 8 || note_failure "collect_hk_deep" "$?"
fi

echo "[$(ts)] === rebuild CN/HK intel ==="
RC_BRIDGE=0
"$PY" "$CA/ingest/pull_cn_hk_intel.py" || RC_BRIDGE=$?
if [ "$RC_BRIDGE" != "0" ]; then
  echo "[$(ts)] ERROR: bridge failed (rc=$RC_BRIDGE) — publishing nothing"
  note_failure "pull_cn_hk_intel" "$RC_BRIDGE"
fi

echo "[$(ts)] === rsync CN/HK intel → VPS ==="
cd "$DATA" || exit 1
ls *.SS.intel.json *.SZ.intel.json *.HK.intel.json 2>/dev/null > /tmp/cnhk_intel_list.txt
N=$(wc -l < /tmp/cnhk_intel_list.txt | tr -d ' ')
RC_RSYNC=0
if [ "$RC_BRIDGE" != "0" ]; then
  # The bridge died partway, so $DATA now mixes freshly-written and last-good intel. Shipping
  # that would serve an incoherent panel. The VPS keeps its previous consistent set instead.
  echo "[$(ts)] SKIPPED: bridge failed, not publishing a mixed fresh/last-good intel set"
elif [ "$N" -eq 0 ]; then
  # A "successful" bridge that produced nothing to publish is exactly the false-green shape.
  echo "[$(ts)] ERROR: no CN/HK intel files to publish — nothing was produced"
  note_failure "rsync_intel" 1
else
  rsync -az --files-from=/tmp/cnhk_intel_list.txt -e "ssh -i $KEY" ./ "$VPS:/opt/terminal/terminal/public/data/" || RC_RSYNC=$?
  if [ "$RC_RSYNC" = "0" ]; then
    echo "[$(ts)] rsync'd $N intel files"
  else
    echo "[$(ts)] ERROR: intel rsync failed (rc=$RC_RSYNC) — VPS keeps its previous data"
    note_failure "rsync_intel" "$RC_RSYNC"
  fi
fi

if [ "$DEPLOY" = "1" ]; then
  echo "[$(ts)] === rebuild + restart terminal (picks up NEW symbol files) ==="
  RC_DEPLOY=0
  ssh -i "$KEY" "$VPS" 'cd /opt/terminal/terminal && rm -rf .next && npm run build >/tmp/refresh-build.log 2>&1 && systemctl restart terminal && sleep 3 && systemctl is-active terminal' || RC_DEPLOY=$?
  if [ "$RC_DEPLOY" = "0" ]; then
    echo "[$(ts)] deployed"
  else
    echo "[$(ts)] ERROR: deploy failed (rc=$RC_DEPLOY)"
    note_failure "deploy" "$RC_DEPLOY"
  fi
else
  echo "[$(ts)] content updates serve per-request (no restart needed). Use --deploy only when NEW symbols were added."
fi

if [ "${#FAILED_STAGES[@]}" -gt 0 ]; then
  echo "[$(ts)] === refresh INCOMPLETE — required stage(s) failed: ${FAILED_STAGES[*]} ==="
  exit 1
fi
echo "[$(ts)] === refresh complete ($N intel files) ==="
exit 0
