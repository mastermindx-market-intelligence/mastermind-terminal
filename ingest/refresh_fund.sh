#!/usr/bin/env bash
# One-command fund/opts/transcript/intel/insider refresh — fundamentals pipeline driver.
#
# Runs on the Mac (needs macro venv + TUSHARE_TOKEN in Macro Dashboard/.env,
# POLYGON_API_KEY in charting-app/.env, defeatbeta venv at /tmp/dbeta-venv or
# ~/.mm-dbeta-venv). Produces per-symbol fund/opts/tx static files and rsyncs
# them to the production VPS (content updates serve per-request — no restart).
#
# Usage:
#   ingest/refresh_fund.sh                               # full run
#   ingest/refresh_fund.sh --us-only                     # US + ADR only (skip CN/HK fund)
#   ingest/refresh_fund.sh --cn-hk-only                  # CN/HK fund only (skip US collect)
#   ingest/refresh_fund.sh --skip-collect                # gen+rsync from existing caches
#   ingest/refresh_fund.sh --skip-tx                     # skip transcript collect+upload
#   ingest/refresh_fund.sh --skip-opts                   # skip options collect+upload
#   ingest/refresh_fund.sh --limit N                     # pass --limit N to all collectors
#   ingest/refresh_fund.sh --prune-cache                 # delete raw us_fund cache after emit
#   ingest/refresh_fund.sh --dry-run                     # echo commands instead of executing
#
# Suggested cron (after CI's 22:40 UTC site/stockdata build) — path resolves from wherever this
# script lives (main checkout or worktree), so no absolute checkout path is baked into the crontab:
#   30 23 * * *  "$(git -C /Users/chriswong/Documents/Cluade/charting-app rev-parse --show-toplevel)/ingest/refresh_fund.sh" >> /tmp/mm_fund_refresh.log 2>&1
#
# JUDGE FIXES implemented:
#   1. First step: git pull --ff-only the Macro Dashboard clone (site/stockdata is CI-built).
#   2. Disk precondition: abort if Mac free space < 10 GB on the data volume.
#   3. rsync uses --files-from generated name lists (never re-walks the full data dir).
#   4. Refuses to start bulk rsync in 21:00-22:30 UTC (nightly terminal-data window).
set -uo pipefail

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
# Resolve paths from THIS script's own directory, not a hardcoded checkout — so a worktree run uses
# the worktree's scripts (and the crontab keeps working after the worktree is discarded).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CA="$(cd "$SCRIPT_DIR/.." && pwd)"
# MACRO_REPO / MM_REFRESH_PY: lane overrides for the launchd nightly (ops/nightly_cnhk.sh),
# which must run entirely outside ~/Documents (macOS TCC denies launchd reads there).
MACRO="${MACRO_REPO:-/Users/chriswong/Documents/Cluade/Macro Dashboard}"
PY="${MM_REFRESH_PY:-$MACRO/.venv/bin/python}"
export MACRO_REPO="$MACRO" CA_ROOT="$CA"   # the ingest/*.py children resolve their roots from these
INGEST="$SCRIPT_DIR"
DATA="$CA/terminal/public/data"
KEY="$HOME/.ssh/macro_dashboard_deploy_v2"
VPS="root@146.190.142.17"
VPS_DATA="/opt/terminal/terminal/public/data"

# defeatbeta venv — prefer persistent clone; fall back to /tmp
DBETA_VENV=""
for _v in "$HOME/.mm-dbeta-venv" "/tmp/dbeta-venv"; do
  [ -x "$_v/bin/python" ] && { DBETA_VENV="$_v/bin/python"; break; }
done

ts() { date -u "+%Y-%m-%d %H:%M:%S UTC"; }

# ---------------------------------------------------------------------------
# Failure accounting (2026-10-21)
#
# This script drives the scheduled fundamentals lane, so its exit code is what
# ops/nightly_cnhk.sh turns into a last_success stamp. It used to end on a bare
# `echo`, i.e. always 0: when pull_macro_intel died on a missing jsonschema the
# log showed "exited 0" and the lane stamped a full success over stale data.
#
# Two defects are fixed here:
#   1. `cmd || echo "[$(ts)] ... exited $?"` reports 0 for every failure, because
#      the $(ts) command substitution runs first and resets $?. rc is now read into
#      a variable BEFORE anything else can touch it.
#   2. Failures were swallowed entirely. Every REQUESTED stage now contributes to
#      an aggregate that becomes the exit code.
#
# Explicitly optional (unchanged, last-good-tolerated): git pull of the Macro
# clone, the Massive statement backfill, the factordata pull-down, insider-power
# export, and a missing defeatbeta venv. Those are documented non-fatal by design
# and must not fail the lane.
# ---------------------------------------------------------------------------
FAILED_STAGES=()
US_FUND_READY=1
US_INTEL_READY=1
note_failure() { FAILED_STAGES+=("$1:$2"); }
note_last_good() { echo "[$(ts)] WARN: $1 (rc=$2) — explicitly optional, last-good output retained"; }
# Run a command, preserving its rc across any later command substitution.
run_stage() {
  local __rc=0
  "$@" || __rc=$?
  return "$__rc"
}

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
US_ONLY=0; CN_HK_ONLY=0; SKIP_COLLECT=0; SKIP_TX=0; SKIP_OPTS=0
LIMIT_ARG=""; PRUNE_CACHE=0; DRY_RUN=0
OPT_TOP="${OPT_TOP:-300}"   # top-N optionable US names by dollar volume (flagship 37 + top-N)

while [ $# -gt 0 ]; do
  case "$1" in
    --us-only)      US_ONLY=1 ;;
    --cn-hk-only)   CN_HK_ONLY=1 ;;
    --skip-collect) SKIP_COLLECT=1 ;;
    --skip-tx)      SKIP_TX=1 ;;
    --skip-opts)    SKIP_OPTS=1 ;;
    --prune-cache)  PRUNE_CACHE=1 ;;
    --dry-run)      DRY_RUN=1 ;;
    --limit=*)      LIMIT_ARG="--limit ${1#--limit=}" ;;
    --limit)
      shift
      [ $# -gt 0 ] || { echo "[refresh_fund] --limit requires a value"; exit 2; }
      LIMIT_ARG="--limit $1"
      ;;
    *) echo "[refresh_fund] unknown flag: $1"; exit 2 ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Dry-run wrapper — echo instead of execute
# ---------------------------------------------------------------------------
run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

echo "[$(ts)] === refresh_fund.sh start (DRY_RUN=$DRY_RUN) ==="

# ---------------------------------------------------------------------------
# 1. Load env
# ---------------------------------------------------------------------------
cd "$MACRO" || { echo "[$(ts)] ERROR: Macro Dashboard dir not found: $MACRO"; exit 1; }
set -a
[ -f "$MACRO/.env" ] && . "$MACRO/.env"
[ -f "$CA/.env" ]    && . "$CA/.env"
set +a



# ---------------------------------------------------------------------------
# 2. JUDGE FIX (1): git pull --ff-only the Macro Dashboard clone
#    site/stockdata is produced by GitHub Actions CI (22:40 UTC) — we must
#    pull it before the gen_fund_* emitters read it, or we work on stale data.
# ---------------------------------------------------------------------------
echo "[$(ts)] === git pull Macro Dashboard (site/stockdata is CI-built) ==="
if git -C "$MACRO" diff --quiet HEAD 2>/dev/null && git -C "$MACRO" diff --cached --quiet 2>/dev/null; then
  run git -C "$MACRO" pull --ff-only origin main \
    && echo "[$(ts)] Macro Dashboard up-to-date" \
    || echo "[$(ts)] WARN: git pull --ff-only failed (remote unreachable or diverged?); continuing with local data"
else
  echo "[$(ts)] WARN: Macro Dashboard working tree is dirty — skipping git pull to avoid conflicts; using local data"
fi

# ---------------------------------------------------------------------------
# 3. JUDGE FIX (2): disk-budget precondition — abort if < 10 GB free
# ---------------------------------------------------------------------------
echo "[$(ts)] === disk check ==="
FREE_KB=$(df "$MACRO/data" 2>/dev/null | awk 'NR==2 {print $4}' || df "$MACRO" | awk 'NR==2 {print $4}')
FREE_GB=$(( ${FREE_KB:-0} / 1024 / 1024 ))
echo "[$(ts)] free space on data volume: ~${FREE_GB} GB"
if [ "${FREE_GB}" -lt 10 ]; then
  echo "[$(ts)] ERROR: less than 10 GB free (${FREE_GB} GB). Aborting to protect disk."
  echo "[$(ts)] Tip: run with --prune-cache to delete raw us_fund payloads after emit."
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Collect — fund raw data
# ---------------------------------------------------------------------------
if [ "$SKIP_COLLECT" = "0" ]; then

  if [ "$CN_HK_ONLY" = "0" ]; then
    echo "[$(ts)] === collect US fund (yfinance statements/estimates/analyst/holders/dividends) ==="
    # shellcheck disable=SC2086
    run_stage run "$PY" "$INGEST/collect_us_fund.py" $LIMIT_ARG \
      || { note_failure "collect_us_fund" "$?"; US_FUND_READY=0; }
  fi



fi

# ---------------------------------------------------------------------------
# 5. Collect transcripts (defeatbeta-api venv — separate from macro venv)
#    MUST run BEFORE the emitters: gen_fund_us.py joins earnings.q[].tx from _tx_index.json, which
#    collect_transcripts.py writes. Running it after would leave every tx id null on a fresh backfill.
# ---------------------------------------------------------------------------
if [ "$SKIP_TX" = "0" ]; then
  if [ -z "$DBETA_VENV" ]; then
    # Explicitly optional: an absent defeatbeta venv means the transcripts leg was never
    # requested in a runnable form. Existing behaviour — warn and continue.
    echo "[$(ts)] WARN: defeatbeta venv not found at ~/.mm-dbeta-venv or /tmp/dbeta-venv — skipping transcripts"
    echo "[$(ts)] Tip: create it with: python -m venv ~/.mm-dbeta-venv && ~/.mm-dbeta-venv/bin/pip install defeatbeta-api duckdb"
  else
    echo "[$(ts)] === collect transcripts (defeatbeta, gzip at rest) ==="
    # shellcheck disable=SC2086
    run_stage run "$DBETA_VENV" "$INGEST/collect_transcripts.py" $LIMIT_ARG \
      || note_failure "collect_transcripts" "$?"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Generate fund JSON files — three real emitters (gen_fund_json.py never existed).
#    US when not --cn-hk-only; CN + HK when not --us-only. The emitters take --only/--limit only
#    (no --market flag), so we gate by the flags instead of a market string.
# ---------------------------------------------------------------------------
if [ "$CN_HK_ONLY" = "0" ] && [ "$US_FUND_READY" = "1" ]; then
  echo "[$(ts)] === gen_fund_us ==="
  # An emitter failure leaves the previous <SYM>.fund.json in place; the run continues so the
  # CN/HK leg and publication still happen, and the aggregate below reports the lane incomplete.
  # shellcheck disable=SC2086
  run_stage run "$PY" "$INGEST/gen_fund_us.py" --exclude-canada $LIMIT_ARG \
    || { note_failure "gen_fund_us" "$?"; US_FUND_READY=0; }

  # Deep statement history from Massive/polygon.io (SEC XBRL, back to the 2009 mandate).
  # MUST run AFTER gen_fund_us: it merges INTO the files that emitter just wrote, and the
  # merge never overwrites, so a re-emit is what lets a mapping change take effect.
  # EXPLICITLY OPTIONAL — a vendor outage or a missing key must not fail the whole
  # fundamentals refresh and leave the US files unpublished; yfinance depth still ships.
  if [ -n "${POLYGON_API_KEY:-}${MASSIVE_API_KEY:-}" ]; then
    echo "[$(ts)] === backfill statements (massive) ==="
    # shellcheck disable=SC2086
    run_stage run "$PY" "$INGEST/backfill_fund_statements_massive.py" $LIMIT_ARG \
      && echo "[$(ts)] massive statements backfill OK" \
      || note_last_good "massive statements backfill failed — US files keep yfinance depth" "$?"
  else
    echo "[$(ts)] WARN: POLYGON_API_KEY/MASSIVE_API_KEY unset — skipping statements backfill"
  fi
fi
if [ "$US_ONLY" = "0" ]; then
  REGIONAL_ARGS=(--repo "$CA")
  [ "$SKIP_COLLECT" = "1" ] && REGIONAL_ARGS+=(--skip-collect)
  [ "$DRY_RUN" = "1" ] && REGIONAL_ARGS+=(--dry-run)
  # shellcheck disable=SC2086
  "$PY" "$INGEST/regional_refresh.py" --phase fund "${REGIONAL_ARGS[@]}" $LIMIT_ARG \
    || note_failure "regional_fund" "$?"
fi

# ---------------------------------------------------------------------------
# 7. Prune raw us_fund cache if requested (reclaims ~1-2 GB per run)
# ---------------------------------------------------------------------------
if [ "$PRUNE_CACHE" = "1" ]; then
  echo "[$(ts)] === prune raw us_fund cache ==="
  run rm -rf "$MACRO/data/us_fund"
  echo "[$(ts)] pruned $MACRO/data/us_fund"
fi

# ---------------------------------------------------------------------------
# 8. Collect options (flagship 37 + top-$OPT_TOP optionable US/ADR by dollar volume)
# ---------------------------------------------------------------------------
if [ "$SKIP_OPTS" = "0" ]; then
  echo "[$(ts)] === collect options (yfinance chains + CBOE fallback, --top $OPT_TOP) ==="
  # shellcheck disable=SC2086
  run_stage run "$PY" "$INGEST/collect_options.py" --top "$OPT_TOP" $LIMIT_ARG \
    || note_failure "collect_options" "$?"
fi

# ---------------------------------------------------------------------------
# 9. Collect US deep (yfinance analyst targets + recommendation trend → us_deep.parquet).
#    MUST run before pull_macro_intel — it reads us_deep.parquet for analyst.target/dist/revisions.
# ---------------------------------------------------------------------------
if [ "$CN_HK_ONLY" = "0" ]; then
  echo "[$(ts)] === collect US deep (targets+recs → us_deep.parquet) ==="
  # shellcheck disable=SC2086
  run_stage run "$PY" "$INGEST/collect_us_deep.py" $LIMIT_ARG \
    || note_failure "collect_us_deep" "$?"
fi

# ---------------------------------------------------------------------------
# 9b. factordata pull-down (tech_lab.json + tech_events/) → ~/.mm-factordata
#     pull_macro_intel's tech block used to fetch these two payload sets from
#     the PUBLIC https://mastermind-x.com/factordata carve-out (macro PR #3393
#     regwalled everything else under /factordata/).  So that carve-out can
#     close, mirror them down from the droplet's own macro checkout over ssh
#     instead — /opt/macro is git-pulled every ~3 min, so it is at least as
#     fresh as the public edge.  $HOME cache (not $MACRO/site/) because the
#     launchd lanes cannot read ~/Documents (TCC) and the Documents checkout
#     is a git working tree we must not write into.  Non-fatal: on rsync
#     failure the last-good cache serves; on a cold cache pull_macro_intel
#     falls back to the HTTPS carve-out while it still exists.
#     Tiny transfer (~230 small JSONs) — deliberately OUTSIDE the 21:00–22:30
#     bulk-rsync window guard below (it is a pull, no manifest race).
# ---------------------------------------------------------------------------
FD_CACHE="$HOME/.mm-factordata"
echo "[$(ts)] === factordata pull-down (VPS /opt/macro → $FD_CACHE) ==="
run mkdir -p "$FD_CACHE/tech_events"
run_stage run rsync -az --timeout=60 --delete -e "ssh -i $KEY" \
    "$VPS:/opt/macro/site/factordata/tech_events/" "$FD_CACHE/tech_events/" \
  && echo "[$(ts)] tech_events pull-down OK" \
  || note_last_good "tech_events pull-down failed — using last-good cache" "$?"
# tech_lab.json last: it is the cache-valid marker pull_macro_intel checks for.
run_stage run rsync -az --timeout=60 -e "ssh -i $KEY" \
    "$VPS:/opt/macro/site/factordata/tech_lab.json" "$FD_CACHE/tech_lab.json" \
  && echo "[$(ts)] tech_lab pull-down OK" \
  || note_last_good "tech_lab pull-down failed — using last-good cache" "$?"
# Respect an operator override; else point the intel build at the cache.
export FACTORDATA_BASE="${FACTORDATA_BASE:-$FD_CACHE}"

# ---------------------------------------------------------------------------
# 10. US deep intel (pull_macro_intel --all)
# ---------------------------------------------------------------------------
echo "[$(ts)] === rebuild US intel (pull_macro_intel --all) ==="
# Required publication stage. This is where the 2026-10-22 false-green was born: an import
# failure (missing jsonschema via ingest.security_state_bridge) was logged as "exited 0".
# shellcheck disable=SC2086
run_stage run "$PY" "$INGEST/pull_macro_intel.py" --all $LIMIT_ARG \
  || { note_failure "pull_macro_intel" "$?"; US_INTEL_READY=0; }

# ---------------------------------------------------------------------------
# 10b. Insider Power — per-ticker <SYM>.insider.json for the Terminal "Insider"
#      tab. Scoring is owned by the Macro pipeline (engine/insider_power.py) and
#      reads the PIT SEC Form-4 panel that the nightly Macro build_site already
#      rebuilds (data/sec_insider/insider_panel.parquet). Writes into $DATA
#      alongside fund/opts so the same rsync ships it. US-only (Form-4 = US
#      names). Non-fatal: a missing/unbuilt panel just skips this artifact.
# ---------------------------------------------------------------------------
if [ "$CN_HK_ONLY" = "0" ]; then
  echo "[$(ts)] === export insider power (<SYM>.insider.json) ==="
  # EXPLICITLY OPTIONAL (unchanged): a missing/unbuilt panel just skips this artifact.
  run_stage run "$PY" "$MACRO/scripts/export_insider_power.py" \
      --panel "$MACRO/data/sec_insider/insider_panel.parquet" \
      --out "$DATA" \
    && echo "[$(ts)] insider power exported" \
    || note_last_good "export_insider_power failed — insider artifacts skipped" "$?"
fi

# ---------------------------------------------------------------------------
# 10. JUDGE FIX (4): refuse bulk rsync in 21:00–22:30 UTC
#     (nightly terminal-data window on the VPS — avoids race on the manifest)
# ---------------------------------------------------------------------------
HOUR_MIN=$(date -u +"%H%M")
if [ "$HOUR_MIN" -ge "2100" ] && [ "$HOUR_MIN" -lt "2230" ]; then
  echo "[$(ts)] ERROR: bulk rsync refused — inside 21:00–22:30 UTC nightly terminal-data window."
  echo "[$(ts)] Wait until 22:30 UTC and re-run (or use --skip-collect to fast-rsync)."
  exit 1
fi

# ---------------------------------------------------------------------------
# 11. JUDGE FIX (3): rsync via --files-from name lists
#     Build lists AFTER emit so only actually-produced files are transferred.
# ---------------------------------------------------------------------------
cd "$DATA" || { echo "[$(ts)] ERROR: data dir not found: $DATA"; exit 1; }

echo "[$(ts)] === building rsync name lists ==="

# fund.json
FUND_LIST="/tmp/refresh_fund_list_fund.$$.txt"
ls ./*.fund.json 2>/dev/null | sed 's|^\./||' | grep -Ev '\.(SS|SZ|BJ|HK|TO|V)\.fund\.json$' > "$FUND_LIST" || true
if [ "$CN_HK_ONLY" = "1" ] || [ "$US_FUND_READY" = "0" ]; then : > "$FUND_LIST"; fi
N_FUND=$(wc -l < "$FUND_LIST" | tr -d ' ')

# opts.json
OPTS_LIST="/tmp/refresh_fund_list_opts.txt"
if [ "$SKIP_OPTS" = "0" ]; then
  ls ./*.opts.json 2>/dev/null | sed 's|^\./||' > "$OPTS_LIST" || true
else
  : > "$OPTS_LIST"
fi
N_OPTS=$(wc -l < "$OPTS_LIST" | tr -d ' ')

# US intel.json (*.intel.json that are NOT CN/HK suffixes)
INTEL_LIST="/tmp/refresh_fund_list_intel.txt"
ls ./*.intel.json 2>/dev/null | sed 's|^\./||' \
  | grep -v '\.SS\.intel\.json\|\.SZ\.intel\.json\|\.BJ\.intel\.json\|\.HK\.intel\.json' > "$INTEL_LIST" || true
[ "$US_INTEL_READY" = "0" ] && : > "$INTEL_LIST"
N_INTEL=$(wc -l < "$INTEL_LIST" | tr -d ' ')

# insider.json (per-ticker Insider Power; US names only)
INSIDER_LIST="/tmp/refresh_fund_list_insider.txt"
ls ./*.insider.json 2>/dev/null | sed 's|^\./||' > "$INSIDER_LIST" || true
N_INSIDER=$(wc -l < "$INSIDER_LIST" | tr -d ' ')

echo "[$(ts)] name lists: fund=$N_FUND  opts=$N_OPTS  us_intel=$N_INTEL  insider=$N_INSIDER"

# ---------------------------------------------------------------------------
# 12. rsync fund + opts + intel
# ---------------------------------------------------------------------------
if [ "$N_FUND" -gt 0 ] || [ "$N_OPTS" -gt 0 ] || [ "$N_INTEL" -gt 0 ] || [ "$N_INSIDER" -gt 0 ]; then
  # Merge all lists for a single rsync pass to keep SSH round-trips minimal
  MERGED_LIST="/tmp/refresh_fund_list_merged.txt"
  cat "$FUND_LIST" "$OPTS_LIST" "$INTEL_LIST" "$INSIDER_LIST" > "$MERGED_LIST"

  echo "[$(ts)] === rsync fund/opts/intel/insider → VPS ($N_FUND + $N_OPTS + $N_INTEL + $N_INSIDER files) ==="
  # Publication is REQUIRED. A failed rsync must never end the lane green: the served files
  # would be stale while the stamp claimed a full success.
  run_stage run rsync -az --files-from="$MERGED_LIST" \
    -e "ssh -i $KEY" \
    ./ "$VPS:$VPS_DATA/" \
    && echo "[$(ts)] rsync fund/opts/intel/insider done" \
    || note_failure "rsync_fund_intel" "$?"
else
  echo "[$(ts)] no fund/opts/intel/insider files to rsync — skipping"
fi

# ---------------------------------------------------------------------------
# 13. rsync transcripts (tx/ tree)
# ---------------------------------------------------------------------------
if [ "$SKIP_TX" = "0" ] && [ -d "$DATA/tx" ]; then
  TX_LIST="/tmp/refresh_fund_list_tx.txt"
  TX_MARKER="$DATA/tx/.last_rsync_ts"
  # Use a sentinel marker file (touched AFTER each successful rsync) rather than -newer on the tx/
  # dir: a rewrite of an existing tx/<SYM>/<ID>.json.gz does NOT bump the parent dir's mtime, so
  # -newer "$DATA/tx" would silently miss refreshed files. -newer the marker catches every file
  # (created OR modified) since the last upload.
  if [ -f "$TX_MARKER" ]; then
    find "$DATA/tx" -name "*.json.gz" -newer "$TX_MARKER" 2>/dev/null \
      | sed "s|^$DATA/||" > "$TX_LIST" || true
  else
    # first run — no marker yet: ship everything
    find "$DATA/tx" -name "*.json.gz" | sed "s|^$DATA/||" > "$TX_LIST" || true
  fi
  N_TX=$(wc -l < "$TX_LIST" | tr -d ' ')

  if [ "$N_TX" -gt 0 ]; then
    echo "[$(ts)] === rsync transcripts → VPS tx/ ($N_TX files) ==="
    if run_stage run rsync -az --files-from="$TX_LIST" \
        -e "ssh -i $KEY" \
        ./ "$VPS:$VPS_DATA/"; then
      echo "[$(ts)] rsync tx done"
      run touch "$TX_MARKER"   # mark the successful upload boundary for the next incremental run
    else
      # The marker is deliberately NOT advanced: the next incremental run must retry these.
      note_failure "rsync_tx" "$?"
    fi
  else
    echo "[$(ts)] no new transcript files to rsync — skipping"
  fi
else
  [ "$SKIP_TX" = "1" ] && echo "[$(ts)] tx rsync skipped (--skip-tx)"
fi

# ---------------------------------------------------------------------------
# Done
#
# Exit 0 only when every REQUESTED stage succeeded. Regional groups publish only after their own successful staged emission — but the lane is reported
# incomplete so ops/nightly_cnhk.sh leaves last_success untouched. A half-refresh must never
# be mistaken for a fresh one, and no stage re-stamps its output as newly collected.
# ---------------------------------------------------------------------------
echo "[$(ts)]   fund files : $N_FUND"
echo "[$(ts)]   opts files : $N_OPTS"
echo "[$(ts)]   intel files: $N_INTEL"
echo "[$(ts)]   insider files: $N_INSIDER"

if [ "${#FAILED_STAGES[@]}" -gt 0 ]; then
  echo "[$(ts)] === refresh_fund.sh INCOMPLETE — failed stage(s): ${FAILED_STAGES[*]} ==="
  exit 1
fi
echo "[$(ts)] === refresh_fund.sh complete ==="
exit 0
