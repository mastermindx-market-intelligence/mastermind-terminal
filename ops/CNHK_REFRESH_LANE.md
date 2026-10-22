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
| publication rsync | non-zero or unknown: reconcile actual remote hashes; partial effects remain fenced |
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


## Integrated publication and rollout boundary (2026-10-22)

The two launchd drivers now acquire `/tmp/mm_fund_refresh.lock` **before**
self-update or any cache write. Their exec-once handoff retains ownership; a stale
or unidentifiable lock is held for investigation rather than silently reclaimed.
No second scheduler is introduced.

Each regional fund emitter reads an immutable snapshot of the incumbent local
artifacts. Before transfer, the publisher requires the served file hashes to
match that snapshot exactly, including absence for new listings. A mismatch
holds publication: synchronize the current served baseline and regenerate.
The durable receipt retains the candidate and the replaced bytes under
`cnhk_publish_receipts/<market>-fund/<receipt>/`. A failed or unknown transfer
is reconciled against both hash sets before any subsequent work. A partial
transfer may have changed some remote files and is fenced against blind replay.

Canada uses this same publisher from the existing `nightly_fund.sh`, after
its bounded collector. Its status is `/Users/chriswong/fund-src/canada_status.json`.
The legacy US generator and bulk transfer exclude .TO/.V, so they cannot bypass
Canada's history check. Canada publication with `--skip-collect` records the
actual cache acquisition timestamps and advances only `last_publication`;
it never claims a new collection. Both clocks survive later failures.

### Mainland coverage extension

With a rejected configured Tushare credential, `MM_CN_SOURCE_DISABLED=1`
holds the Tushare-backed deep-intelligence stages. The explicit
`MM_CN_FUND_SOURCE=yahoo` setting enables qualified, append-only financial
coverage through the existing fund driver. It does not create source-document
CI, local shareholder records, or an entitlement to another provider.

The collector records a finalized invocation receipt with the selected listing
scope, exact admitted raw hashes and counts for qualified, fresh, unavailable,
failed and deferred observations. Only that admitted scope may be emitted.
Partial coverage remains incomplete even when its qualified subset publishes.

The emitted single-file compatibility envelope keeps a coherent legacy
financial view and a hash-bound selected projection for updated readers.
The legacy view also withholds the proven unqualified subtraction-derived EPS
and its surprise, without adding mixed-source periods to older consumers.
Unknown publication/acquisition evidence stays unknown.

### First activation

1. Merge via the normal protected checks and deploy the exact merged commit.
2. Verify the app's source/deployment/served identity and the installed
   `terminal/scripts/dist/gen_fundamental_scan.mjs` selector. The production
   deploy bundles this worker after app promotion; bundle failure retains the
   previous worker and is non-fatal, so app success alone is insufficient.
   Beta does not update this production worker.
3. Under the existing writer lock, update the M1 collector clone normally and
   synchronize the relevant prior artifacts from the served data. Record
   matching hashes, especially for the earlier Canadian data-only refresh.
4. Activate the qualified source setting, stage from those exact prior bytes,
   and publish only validated candidates through the shared receipt boundary.
5. Check actual served files and desktop/tablet/mobile EN/ZH readers, including
   Financials, Earnings, reported Ownership, Intelligence Snapshot and scan IO.

Do not publish the first envelopes before both the app and its compiled
fundamental scan reader are verified.
