# CN/HK refresh lane — failure semantics and recovery

Operational companion to `ops/nightly_cnhk.sh` (launchd `com.mastermind.cnhk`),
`ops/check_cnhk_fresh.sh` (`com.mastermind.cnhk-watch`), `ingest/refresh_cn_hk.sh`
and `ingest/refresh_fund.sh`.

## What "success" means

A nightly run is successful **only** when the dependency preflight passed *and* both
`refresh_cn_hk.sh` and `refresh_fund.sh` exited `0`.

`$SRC/cnhk_status.json` records this:

| key | meaning |
| --- | --- |
| `last_run` | written every night, including failures |
| `last_success` | written **only** on a fully clean run |
| `last_incomplete` | written when a run finished with a failed stage |
| `exit` | per-leg rcs: `preflight`, `refresh_cn_hk`, `refresh_fund_cnhk` |

Each driver ends on an explicit `exit` derived from its failure aggregate, so a stage
that dies can never be reported as a green lane. If `last_run` keeps advancing but
`last_success` does not, a required stage is failing every night.

## Failure semantics

| stage | failure effect |
| --- | --- |
| dependency preflight | abort before any work; nothing collected, nothing published |
| `collect_cn_deep` | last-good `financials`/`lhb`/`holders` parquets left untouched |
| `collect_hk_deep` | independent — a CN failure does not stop it, and vice versa |
| HK universe floor | **explicitly optional** — existing cache is kept, run stays green |
| intel bridge | nothing is published; the VPS keeps its previous consistent intel set |
| publication rsync | non-zero; the VPS keeps what it already served |
| Massive statement backfill | **explicitly optional** — US files keep their yfinance depth |
| factordata pull-down | **explicitly optional** — last-good cache |
| insider-power export | **explicitly optional** — artifact skipped |
| a missing defeatbeta venv | **explicitly optional** — transcripts skipped |

A collector may still be *partially* useful: stages that fall back to last-good keep
publishing, so independent good data still refreshes. What they may not do is claim a
full success — that is what the aggregate exit code and `last_success` enforce.

## The caches are never truncated by an outage

`ingest/collect_cn_deep.py` distinguishes a legitimate empty answer from a failed
question:

* a quiet 龙虎榜 session (`code == 0`, no rows) is data, and is published as such;
* a rejected token, missing entitlement, rate limit that outlived its backoff, or a dead
  socket is a typed error — the stage writes **nothing** and the previous parquet survives
  byte-for-byte;
* an auth or permission failure is never retried, and stops the remaining stages, because
  every later call would fail identically;
* a partial holders refresh merges per symbol: symbols that refreshed are updated and all
  others keep their last-good observation;
* writes are atomic (temp file + `os.replace`), so a reader never sees a partial parquet;
* a holder's `period` is the provider's own `end_date`. The build clock is never
  substituted for a source period.

## Triage

```bash
# 1. What did the lane record?
cat /Users/chriswong/cnhk-src/cnhk_status.json

# 2. Which stage failed?
grep -E 'INCOMPLETE|ERROR|FAILED|rc=' /tmp/mm_cnhk_refresh.log | tail -40

# 3. Is the venv still consistent with requirements.txt? (diagnostic only — installs nothing)
/Users/chriswong/cnhk-venv/bin/python -c \
  "import jsonschema, pandas, pyarrow; print('deps OK')"

# 4. What is the watcher saying?
tail -20 /tmp/mm_cnhk_watch.log
```

### Dependency drift (the 2026-10-22 failure)

`pull_macro_intel.py` imports `ingest.security_state_bridge`, which imports `jsonschema`.
The dedicated venv's recreate command pinned an explicit package list that had drifted
from `requirements.txt` and omitted it, so the intel stage could not even import.

The nightly now preflights every import the drivers need, in the interpreter that will run
them, and aborts in seconds with the specific missing modules. The preflight **diagnoses
only** — it never installs, upgrades, or mutates the host or the venv. The fix is the
operator's:

```bash
/Users/chriswong/cnhk-venv/bin/pip install -r /Users/chriswong/fund-ops-wt/requirements.txt
```

`requirements.txt` is canonical. Never upgrade the venv's Python, install into the host
interpreter, or copy a script straight onto production to work around an import error.

### Rejected Tushare token

A rejected credential is not something the lane can recover from: every Tushare-backed
stage will fail. `collect_cn_deep` stops immediately rather than retrying, the HK leg and
the bridge still run, and the run is reported incomplete. Restore a working
`TUSHARE_TOKEN` in `~/.mm-fund.env`; the next nightly republishes from the preserved
last-good caches in the meantime. Do not substitute a token that has not been verified.

## Verification

```bash
python3 -m pytest tests/test_collect_cn_deep_reliability.py \
                 tests/test_cnhk_refresh_failure_propagation.py -q
```

The shell suite runs the real driver scripts against fake executables in a sandbox tree —
no Tushare call, no VPS, no SSH, no production file is touched.

## Known integration risk (unresolved 2026-10-21)

`nightly_cnhk.sh` self-updates and re-execs itself **before** it waits for the US fund
lane, while `ops/nightly_fund.sh` self-updates the same shared clone
(`/Users/chriswong/fund-ops-wt`) from its own lane. While this lane is blocked on
`nightly_fund`, both hold one working tree with a `reset --hard` in each. Resolving this
means giving each lane its own clone, or serialising the update itself — it is a change
to the sibling `nightly_fund.sh` and is deliberately not made here.