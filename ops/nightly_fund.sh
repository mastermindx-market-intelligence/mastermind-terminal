#!/bin/bash
# nightly_fund.sh — durable, codex-independent nightly Terminal fundamentals refresh.
#
# ── TCC LAW (macOS launchd) ──────────────────────────────────────────────────
# launchd (Aqua session) jobs are DENIED open-for-read on ANYTHING under
# ~/Documents/: bash exec of a script there dies "Operation not permitted"
# (exit 126), and plain file reads / git-metadata reads fail the same way.
# Counterintuitively, exec of *binaries* and *writes* under ~/Documents/ are
# allowed — probed empirically 2026-07-06 on the Mac Studio. The same failure
# hit com.macro.thetadata-backfill and com.mastermind.liveflow before their
# relocations. Therefore this lane lives ENTIRELY outside ~/Documents/:
#
#   DEPLOY   /Users/chriswong/fund-ops-wt     standalone clone of
#                                             mastermindx-market-intelligence/mastermind-terminal (master)
#                                             — this script + ingest/ code + terminal/public/data
#   ENGINE   /Users/chriswong/fund-engine-wt  standalone sparse+shallow clone of
#                                             mastermindx-market-intelligence/macro (main), cone dirs:
#                                             engine lib config data/edgar data/finra
#                                             data/sec_insider data/stock_fundamentals
#                                             site/factordata
#                                             EDGAR parquets + factors.json + factor_betas.json
#                                             are git-TRACKED, so the nightly reset refreshes
#                                             code AND data together.
#   FUNDSRC  /Users/chriswong/fund-src        panels() stockdata output + yfinance us_fund
#                                             cache (passed to ingest via MACRO_ROOT)
#   PY       /Users/chriswong/fund-venv       dedicated venv (numpy/pandas/pyarrow/PyYAML/
#                                             yfinance/requests pinned to the Macro Dashboard
#                                             .venv versions that produced the last good run)
#
# RECREATE THE LANE (if any piece is missing):
#   git clone --filter=blob:none --depth 1 --single-branch --branch main --no-checkout \
#       https://github.com/mastermindx-market-intelligence/macro.git /Users/chriswong/fund-engine-wt
#   cd /Users/chriswong/fund-engine-wt && git sparse-checkout init --cone && \
#       git sparse-checkout set engine lib config data/edgar data/finra data/sec_insider \
#       data/stock_fundamentals site/factordata && git checkout main
#   git clone https://github.com/mastermindx-market-intelligence/mastermind-terminal.git /Users/chriswong/fund-ops-wt
#   /opt/homebrew/Caskroom/miniconda/base/bin/python -m venv /Users/chriswong/fund-venv
#   /Users/chriswong/fund-venv/bin/pip install "numpy==2.4.6" "pandas==3.0.3" \
#       "pyarrow==24.0.0" "PyYAML==6.0.3" "yfinance==1.4.1" "requests==2.34.2"
#   mkdir -p /Users/chriswong/fund-src   # caches rebuild themselves on first run
#
# Flow: self-update DEPLOY (exec-once) → refresh ENGINE clone → panels() EV stockdata →
# transcript delta/index recovery → gentle Canadian .TO collect (--canada, workers=1, bounded)
# → gentle yfinance collect (incremental, --stale-days 3) → gen_fund_us → SEC filing lineage
# → deep statement history backfill (massive v1, non-fatal, time-boxed) → rsync data-only
# to the VPS. Safety gates abort BEFORE any deploy if EV coverage collapses or AAPL EV
# is null (never ship bad data).
#
# Loaded via ~/Library/LaunchAgents/com.mastermind.fund.plist. Log: /tmp/mm_fund_refresh.log
# Install/repair the job ON M1 ONLY (the bootstrap refuses every other host, exit 3):
#   /bin/bash /Users/chriswong/fund-ops-wt/ops/bootstrap_nightly_fund.sh [--run-now]
# M2 rollback goes through ~/dataplane-migration/rollback-groupB-to-M2.sh, never this.
set -u
ENGINE="/Users/chriswong/fund-engine-wt"
FUNDSRC="/Users/chriswong/fund-src"
DEPLOY="/Users/chriswong/fund-ops-wt"
PY="/Users/chriswong/fund-venv/bin/python"
KEY="$HOME/.ssh/macro_dashboard_deploy_v2"
VPS="root@146.190.142.17"; VPS_DATA="/opt/terminal/terminal/public/data"
LOG="/tmp/mm_fund_refresh.log"
DATA="$DEPLOY/terminal/public/data"
TX_INDEX="$FUNDSRC/data/us_fund/_tx_index.json"
TX_REFRESH_STAMP="$FUNDSRC/data/transcripts/.nightly_refresh_ok"
TX_ROLE_REPAIR_STAMP="$FUNDSRC/data/transcripts/.role_inference_v2_ok"
TX_REVISION_MARKER="$FUNDSRC/data/transcripts/.stock_earning_call_transcripts.applied_revision"
TX_REVISION_CANDIDATE="$FUNDSRC/data/transcripts/.stock_earning_call_transcripts.revision_candidate"
LOCK_DIR="/tmp/mm_fund_refresh.lock"
ts(){ date "+%Y-%m-%dT%H:%M:%S%z"; }

# Both launchd lanes share this incumbent lock BEFORE self-update or any cache write.
LOCK_DIR="/tmp/mm_fund_refresh.lock"
. "$(cd "$(dirname "$0")" && pwd)/fund_writer_lock.sh"
LOCK_RC=0
acquire_fund_writer_lock 0 "${2:-}" || LOCK_RC=$?
if [ "$LOCK_RC" != "0" ]; then
  echo "[$(ts)] SKIP: fund writer lock unavailable (rc=$LOCK_RC); no checkout or data mutation" >> "$LOG"
  [ "$LOCK_RC" = "10" ] && exit 0
  exit 1
fi
trap release_fund_writer_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# -1. self-update the deploy clone, then exec the (possibly fresher) script exactly once.
#     Acquire the writer lock first so a manual kick cannot race git reset. exec
#     preserves the PID, and --lock-held lets the fresh process inherit ownership.
if [ "${1:-}" != "--post-update" ]; then
  git -C "$DEPLOY" fetch origin master --quiet 2>>"$LOG" && git -C "$DEPLOY" reset --hard origin/master --quiet 2>>"$LOG" \
    || echo "[$(ts)] WARN: deploy self-update failed — using current code" >> "$LOG"
  exec /bin/bash "$DEPLOY/ops/nightly_fund.sh" --post-update --lock-held
fi

echo "[$(ts)] ===== nightly fund refresh start =====" >> "$LOG"

# 0. keep the engine clone on latest main (EV code + tracked EDGAR/factors data).
#    launchd jobs get EPERM from git and /bin tools on an external volume (TCC). A storage
#    offload symlinked ENGINE and FUNDSRC onto /Volumes/STORAGE on 2026-09-17 and the engine
#    sat frozen for six weeks behind a bare WARN, so name the cause and log the SHA reached.
for p in "$ENGINE" "$FUNDSRC"; do
  case "$(readlink "$p" 2>/dev/null || true)" in
    /Volumes/*) echo "[$(ts)] WARN: $p -> $(readlink "$p") is on an external volume; launchd TCC blocks git/bin writes there — move it back to the internal disk" >> "$LOG" ;;
  esac
done
if git -C "$ENGINE" fetch --depth 1 origin main --quiet 2>>"$LOG" && git -C "$ENGINE" reset --hard origin/main --quiet 2>>"$LOG"; then
  echo "[$(ts)] engine at $(git -C "$ENGINE" log -1 --format='%h %cI' 2>/dev/null)" >> "$LOG"
else
  echo "[$(ts)] WARN: engine git update failed — using current code" >> "$LOG"
fi

# 1. refresh EV-bearing stockdata via panels() (SAFETY GATE: abort if EV coverage collapses).
"$PY" - <<PYEOF >> "$LOG" 2>&1
import os, sys, json
from pathlib import Path
os.chdir("$ENGINE"); sys.path.insert(0, "$ENGINE")
from engine.stock_fundamentals import panels
out = panels()
dest = Path("$FUNDSRC/site/stockdata"); dest.mkdir(parents=True, exist_ok=True)
for t, p in out.items():
    (dest / f"{t}.json").write_text(json.dumps(p))
ev = sum(1 for p in out.values()
         if (((p.get("valuation") or {}).get("ev_to_sales") or {}).get("v")) is not None)
print(f"panels: {len(out)} written, {ev} with EV")
assert ev > 500, f"EV coverage too low ({ev}) — aborting before deploy"
PYEOF
if [ $? -ne 0 ]; then echo "[$(ts)] ABORT: panels/EV step failed — no deploy" >> "$LOG"; exit 1; fi

# 2. HEAD-probe the upstream parquet every night.  A changed file triggers an
# immediate collection; an unchanged file still gets the existing weekly full
# repair pass without a 2.2 GB redownload.  If the cheap probe is unavailable,
# fail open: keep the weekly age-based fallback and continue on non-weekly days.
# Indexes remain untouched until the remote no-write scan and append-only gate.
export MACRO_ROOT="$FUNDSRC"
TX_COLLECTED=0
TX_REPAIR_NEEDED=0
TX_BODY_SYNCED=0
TX_WEEKLY_DUE=0
TX_PROBE_RC=0
TX_UPSTREAM_REVISION=""
rm -f "$TX_REVISION_CANDIDATE"
if [ ! -f "$TX_REFRESH_STAMP" ] || find "$TX_REFRESH_STAMP" -mtime +6 -print -quit | grep -q .; then
  TX_WEEKLY_DUE=1
fi
TX_UPSTREAM_REVISION=$("$PY" "$DEPLOY/ingest/collect_transcripts.py" \
  --probe-parquet-revision 2>> "$LOG") || TX_PROBE_RC=$?
if { [ "$TX_PROBE_RC" -eq 0 ] || [ "$TX_PROBE_RC" -eq 10 ]; } && [ -z "$TX_UPSTREAM_REVISION" ]; then
  TX_PROBE_RC=11
  echo "[$(ts)] WARN: transcript parquet probe returned an empty revision" >> "$LOG"
elif [ "$TX_PROBE_RC" -eq 10 ]; then
  echo "[$(ts)] transcript parquet changed: $TX_UPSTREAM_REVISION" >> "$LOG"
elif [ "$TX_PROBE_RC" -eq 0 ]; then
  echo "[$(ts)] transcript parquet unchanged: $TX_UPSTREAM_REVISION" >> "$LOG"
else
  echo "[$(ts)] WARN: transcript parquet probe failed (rc=$TX_PROBE_RC) — weekly fallback retained" >> "$LOG"
fi

if [ "$TX_WEEKLY_DUE" -eq 1 ] || [ "$TX_PROBE_RC" -eq 10 ]; then
  TX_COLLECT_ARGS=(--quarters 8 --defer-index-publish \
    --revision-candidate-out "$TX_REVISION_CANDIDATE")
  if [ "$TX_PROBE_RC" -eq 0 ] || [ "$TX_PROBE_RC" -eq 10 ]; then
    TX_COLLECT_ARGS+=(--upstream-revision "$TX_UPSTREAM_REVISION")
  fi
  if "$PY" "$DEPLOY/ingest/collect_transcripts.py" "${TX_COLLECT_ARGS[@]}" >> "$LOG" 2>&1; then
    TX_COLLECTED=1
    TX_REPAIR_NEEDED=1
  else
    rm -f "$TX_REVISION_CANDIDATE"
    echo "[$(ts)] WARN: transcript refresh failed — stamp not advanced; scanning remote last-good" >> "$LOG"
  fi
fi
if [ ! -f "$TX_ROLE_REPAIR_STAMP" ]; then TX_REPAIR_NEEDED=1; fi

# Re-run the current conservative speaker-role classifier after new bodies or
# whenever its versioned migration stamp is absent.  A source-download failure
# must not block repair of the already-valid local archive.
if [ "$TX_REPAIR_NEEDED" -eq 1 ]; then
  if "$PY" "$DEPLOY/ingest/repair_transcript_roles.py" \
    --tx-root "$DATA/tx" --write >> "$LOG" 2>&1; then
    # Bodies only: never let locally generated indexes bypass the remote gate.
    # Checksums are intentional: a CEO→CFO repair can retain the same gzip size.
    if rsync -az --checksum \
      --include='*/' --include='*.json.gz' --exclude='*' \
      -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=25" \
      "$DATA/tx/" "$VPS:$VPS_DATA/tx/" >> "$LOG" 2>&1; then
      mkdir -p "$(dirname "$TX_REFRESH_STAMP")"
      touch "$TX_ROLE_REPAIR_STAMP"
      if [ "$TX_COLLECTED" -eq 1 ]; then TX_BODY_SYNCED=1; fi
    else
      rm -f "$TX_REVISION_CANDIDATE"
      echo "[$(ts)] WARN: transcript body rsync failed — stamps not advanced; retry next run" >> "$LOG"
    fi
  else
    rm -f "$TX_REVISION_CANDIDATE"
    echo "[$(ts)] WARN: transcript role repair failed — no body rsync; retry next run" >> "$LOG"
  fi
fi

# Rebuild discovery from production bodies on EVERY run.  Phase 1 is a no-write
# scan that opens and validates every gzip.  Phase 2 proves exact pair retention
# against the last-good legacy map.  Only then may phase 3 publish per-symbol
# indexes and the archive-wide commit marker.
TX_TMP="/tmp/mm_tx_index.$$"
REMOTE_TX_BASELINE="/tmp/mm_tx_index.$$.json"
mkdir -p "$(dirname "$TX_INDEX")"
if ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=25 "$VPS" \
  "python3 /opt/terminal/ingest/build_transcript_index.py --tx-root '$VPS_DATA/tx' --stdout legacy" \
  > "$TX_TMP" 2>> "$LOG"; then
  "$PY" - "$TX_TMP" "$TX_INDEX" <<'PYEOF' >> "$LOG" 2>&1
import json, sys
from pathlib import Path
def normalize(raw):
    assert isinstance(raw, dict), "transcript index must be an object"
    out = {}
    for sym, values in raw.items():
        assert isinstance(sym, str) and sym.strip(), f"invalid symbol: {sym!r}"
        assert isinstance(values, list), f"IDs for {sym} must be an array"
        ids = set()
        for value in values:
            assert (isinstance(value, str) and len(value) == 6 and value[:4].isdigit()
                    and value[4] == "Q" and value[5] in "1234"), f"invalid ID: {sym}/{value!r}"
            ids.add(value)
        if ids: out[sym.strip().upper()] = ids
    return out
new = normalize(json.loads(Path(sys.argv[1]).read_text()))
n_sym = len(new); n_ids = sum(len(v) for v in new.values())
assert n_sym >= 2500, f"transcript symbol floor failed: {n_sym}"
assert n_ids >= 15000, f"transcript body floor failed: {n_ids}"
old_path = Path(sys.argv[2])
if old_path.exists():
    old = normalize(json.loads(old_path.read_text()))
    missing = sorted((sym, tx_id) for sym, ids in old.items() for tx_id in ids - new.get(sym, set()))
    assert not missing, f"append-only gate failed; missing {len(missing)} pair(s): {missing[:8]}"
print(f"transcript index healthy: {n_ids} bodies across {n_sym} symbols")
PYEOF
  if [ $? -eq 0 ]; then
    if scp -q -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=25 \
      "$TX_TMP" "$VPS:$REMOTE_TX_BASELINE" 2>> "$LOG" && \
      ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=25 "$VPS" \
        "python3 /opt/terminal/ingest/build_transcript_index.py --tx-root '$VPS_DATA/tx' --require-superset-of '$REMOTE_TX_BASELINE' --write-public --stdout summary; rc=\$?; rm -f '$REMOTE_TX_BASELINE'; exit \$rc" \
        >> "$LOG" 2>&1; then
      mv "$TX_TMP" "$TX_INDEX"
      if [ "$TX_BODY_SYNCED" -eq 1 ]; then
        if [ -f "$TX_REVISION_CANDIDATE" ]; then
          if mv "$TX_REVISION_CANDIDATE" "$TX_REVISION_MARKER"; then
            touch "$TX_REFRESH_STAMP"
          else
            echo "[$(ts)] WARN: transcript revision promotion failed — refresh stamp not advanced" >> "$LOG"
          fi
        else
          # Probe failure preserves the old weekly path, which may not have a
          # stable upstream revision to promote.
          touch "$TX_REFRESH_STAMP"
        fi
      fi
    else
      rm -f "$TX_TMP"
      rm -f "$TX_REVISION_CANDIDATE"
      echo "[$(ts)] ABORT: transcript index publication failed — local and remote last-good retained" >> "$LOG"
      exit 1
    fi
  else
    rm -f "$TX_TMP"
    rm -f "$TX_REVISION_CANDIDATE"
    echo "[$(ts)] ABORT: transcript index validation failed — no fund overwrite" >> "$LOG"
    exit 1
  fi
else
  rm -f "$TX_TMP"
  rm -f "$TX_REVISION_CANDIDATE"
  echo "[$(ts)] ABORT: remote transcript no-write scan failed — no fund overwrite" >> "$LOG"
  exit 1
fi

# 3a. Canadian .TO refresh FIRST, so this same run's gen_fund_us publishes fresh Canadian
# fundamentals instead of re-emitting whatever was last cached. Canada used to be collected only
# by an occasional ad-hoc `--foreign` run, so every .TO fund.json froze on its last good fetch
# (216 listings in the 2026-10-21 manifest, incl. NA.TO/SGD.TO which had no cache at all).
# Scope is `--canada`, NOT `--foreign`: this lane must not drag the ~1.2k other intl names onto
# a nightly that has to fit before the 18:30 cnhk lane. Gentle: workers=1 and a wide jitter, so
# the Canadian pass never competes with the US pass for yfinance's rate limit.
# NON-FATAL: per-symbol failures are logged by the collector and the last valid cache is kept —
# collect_us_fund refuses to let a thinner fetch overwrite a richer one, so a vendor blip can
# never erase good Canadian data. BOUNDED: the collector takes --deadline-seconds and defers
# whatever it does not reach to the next night (unreached names keep their old cache mtime, so
# they are retried rather than skipped as fresh). The subprocess supervisor stops at 17:15 (plus a 3s kill grace), before the 18:30 lane
# and before the statements backfill that follows gen_fund_us.
CA_BUDGET=$("$PY" "$DEPLOY/ingest/run_bounded.py" --daily-budget)
if [ "$CA_BUDGET" -lt 60 ]; then
  echo "[$(ts)] WARN: Canada refresh skipped — too close to the 18:30 cnhk lane" >> "$LOG"
else
  echo "[$(ts)] Canada refresh (--canada, workers=1; budget ${CA_BUDGET}s)" >> "$LOG"
  "$PY" "$DEPLOY/ingest/run_bounded.py" --seconds "$CA_BUDGET" -- \
    "$PY" "$DEPLOY/ingest/collect_us_fund.py" --canada --workers 1 --stale-days 7 \
    --delay 3.0 6.0 --deadline-seconds "$CA_BUDGET" >> "$LOG" 2>&1 \
    || echo "[$(ts)] WARN: Canada collect had per-name errors (existing caches retained)" >> "$LOG"
fi

# 3. gentle, incremental yfinance collect + gen (reads EV stockdata via MACRO_ROOT).
"$PY" "$DEPLOY/ingest/collect_us_fund.py" --workers 2 --stale-days 3 --delay 2.0 5.0 >> "$LOG" 2>&1 \
  || echo "[$(ts)] WARN: collect had per-name errors (continuing)" >> "$LOG"
"$PY" "$DEPLOY/ingest/gen_fund_us.py" --exclude-canada >> "$LOG" 2>&1 \
  || { echo "[$(ts)] ABORT: gen_fund_us failed — no deploy" >> "$LOG"; exit 1; }
# E11-03: stamp each statement column with the SEC filing that carries its figures, and
# mark recast periods restated. No stamp is the safe state, so a failure never blocks deploy.
"$PY" "$DEPLOY/ingest/annotate_sec_lineage.py" >> "$LOG" 2>&1 \
  || echo "[$(ts)] WARN: SEC filing lineage failed — statement columns keep no filing stamp (continuing)" >> "$LOG"

# 3b. deep statement history (massive stocks/financials/v1, #364). gen_fund_us just rewrote
# every file from the ~5-period yfinance cache, so without this pass the 2009+ history is
# wiped nightly. It runs AFTER the SEC lineage pass and keeps every stamp that pass wrote;
# it dates only the older columns it adds. NON-FATAL: a vendor outage leaves the yfinance files as emitted and the
# deploy proceeds. The key is read from the env file inside the Python process only — it is
# never exported, echoed or put on a command line. BOUNDED: this lane holds $LOCK_DIR, and
# the 18:30 cnhk lane SKIPs while it is held, so before 18:30 the pass must end by 18:15.
# It stops itself at its budget, and run_bounded kills it 60s later if a request hangs.
# What follows (gates, Canada publication, rsync) took 28s on 2026-10-30, before this pass
# existed (annotate ended 17:46:34, rsync OK 17:47:02) — well inside the 15-minute margin;
# an overrun past 18:30 only makes that night's cnhk lane log SKIP. Symbols not reached
# (the sweep runs largest market cap first) keep that night's yfinance periods; nothing
# carries over, since gen_fund_us rewrites every file the next night.
BF_BUDGET=2700
BF_NOW=$(date +%s)
BF_STOP=$(date -j -f "%H:%M:%S" "18:15:00" +%s 2>/dev/null || echo 0)
BF_CNHK=$(date -j -f "%H:%M:%S" "18:30:00" +%s 2>/dev/null || echo 0)
if [ "$BF_NOW" -lt "$BF_CNHK" ]; then
  BF_LEFT=$((BF_STOP - BF_NOW))
  [ "$BF_LEFT" -lt "$BF_BUDGET" ] && BF_BUDGET=$BF_LEFT
fi
if [ "$BF_BUDGET" -lt 60 ]; then
  echo "[$(ts)] WARN: statements backfill skipped — too close to the 18:30 cnhk lane" >> "$LOG"
else
  echo "[$(ts)] statements backfill (massive v1, #364; budget ${BF_BUDGET}s)" >> "$LOG"
  "$PY" "$DEPLOY/ingest/run_bounded.py" --seconds "$((BF_BUDGET + 60))" -- \
    "$PY" "$DEPLOY/ingest/backfill_fund_statements_massive.py" --env-file "$HOME/.macro-dashboard/.env" \
      --deadline-seconds "$BF_BUDGET" --quiet >> "$LOG" 2>&1 \
    || echo "[$(ts)] WARN: statements backfill failed (non-fatal — fund.json keeps the yfinance periods)" >> "$LOG"
fi

# 4. SAFETY GATES: AAPL EV must be non-null and transcript discovery may
# never collapse before deploy.
AEV=$("$PY" -c "import json;print(json.load(open('$DATA/AAPL.fund.json')).get('ratios',{}).get('current',{}).get('ev_sales'))" 2>/dev/null)
if [ "$AEV" = "None" ] || [ -z "$AEV" ]; then
  echo "[$(ts)] ABORT: AAPL ev_sales null post-gen — no deploy" >> "$LOG"; exit 1; fi
"$PY" - "$DATA" <<'PYEOF' >> "$LOG" 2>&1
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
n_sym = n_ids = 0
for path in root.glob("*.fund.json"):
    try: rows = (json.loads(path.read_text()).get("earnings") or {}).get("q") or []
    except Exception: continue
    ids = {row.get("tx") for row in rows if row.get("tx")}
    if ids: n_sym += 1; n_ids += len(ids)
assert n_sym >= 2500, f"linked transcript symbol floor failed: {n_sym}"
assert n_ids >= 15000, f"linked transcript body floor failed: {n_ids}"
print(f"fund transcript links healthy: {n_ids} across {n_sym} symbols")
PYEOF
if [ $? -ne 0 ]; then echo "[$(ts)] ABORT: transcript link gate failed — no deploy" >> "$LOG"; exit 1; fi

# Canada stays under this existing writer lock, but emits into a stage using immutable
# prior files. A different served baseline holds publication until it is synchronized.
# Collection has its own acquired-at clock; publishing retained caches is not a new fetch.
CA_PUBLISH_RC=0
"$PY" "$DEPLOY/ingest/regional_refresh.py" --phase fund --market ca --skip-collect \
  --repo "$DEPLOY" --data "$DATA" --status "$FUNDSRC/canada_status.json" \
  --key "$KEY" --remote "$VPS:$VPS_DATA" >> "$LOG" 2>&1 \
  || { CA_PUBLISH_RC=$?; echo "[$(ts)] WARN: Canada staged publication failed — retained candidates require review" >> "$LOG"; }

# 5. rsync data-only to the VPS (never touches the app).
ls "$DATA"/*.fund.json 2>/dev/null | xargs -n1 basename | grep -Ev '\.(SS|SZ|BJ|HK|TO|V)\.fund\.json$' > /tmp/mm_fund_list.txt
N=$(wc -l < /tmp/mm_fund_list.txt | tr -d ' ')
rsync -az -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=25" \
  --files-from=/tmp/mm_fund_list.txt "$DATA/" "$VPS:$VPS_DATA/" >> "$LOG" 2>&1 \
  && echo "[$(ts)] rsync OK — $N fund.json (AAPL ev_sales=$AEV)" >> "$LOG" \
  || { echo "[$(ts)] rsync FAILED" >> "$LOG"; exit 1; }
echo "[$(ts)] ===== nightly fund refresh done (Canada publication rc=$CA_PUBLISH_RC) =====" >> "$LOG"
exit "$CA_PUBLISH_RC"
