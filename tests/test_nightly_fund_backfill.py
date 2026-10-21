"""The production fund nightly must RUN the statements backfill — and survive it failing (#364).

`ops/nightly_fund.sh` (launchd `com.mastermind.fund`, M1, 16:30) is the only lane that ships
US fund.json. Its gen_fund_us step rewrites every file from the ~5-period yfinance cache, and
nothing in the nightly re-applied the deep vendor history, so production lost 2009+ statement
history and its provenance every night while the backfill's own tests stayed green — the
"graceful fallback vs unwired producer" failure tests/test_nightly_wiring.py describes.

Pinned here:
  1. WIRING. The backfill runs after gen_fund_us, before the safety gates and the rsync, so
     its output is what ships.
  2. NON-FATAL. A vendor outage (410 since the vX sunset, a revoked key's 404/401) leaves the
     files as gen_fund_us emitted them and the nightly carries on to the deploy.
  3. KEY HYGIENE. The key is read from the env file inside the Python process: never exported,
     sourced, echoed or put on a command line. `$KEY` in this script is the SSH deploy key.
  4. BUDGET. The lane holds the shared fund lock and the 18:30 cnhk lane SKIPs while it is
     held, so a run starting before 18:30 must stop by 18:15.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NIGHTLY = ROOT / "ops" / "nightly_fund.sh"
TEXT = NIGHTLY.read_text()
LINES = TEXT.splitlines()
FAKE_KEY = "test-key-Zq81"


def line_of(pattern: str) -> int:
    hits = [i for i, line in enumerate(LINES) if re.search(pattern, line)]
    assert len(hits) == 1, f"{pattern!r} matched {len(hits)} lines"
    return hits[0]


def backfill_block() -> str:
    start = line_of(r"^BF_BUDGET=")
    end = line_of(r"^# 4\. SAFETY GATES")
    return "\n".join(LINES[start:end]) + "\n"


# ── static wiring ────────────────────────────────────────────────────────────
def test_the_backfill_runs_after_gen_and_before_the_gates_and_the_rsync():
    gen = line_of(r'"\$PY" "\$DEPLOY/ingest/gen_fund_us\.py"')
    backfill = line_of(r'"\$PY" "\$DEPLOY/ingest/backfill_fund_statements_massive\.py"')
    gates = line_of(r"^# 4\. SAFETY GATES")
    rsync = line_of(r"--files-from=/tmp/mm_fund_list\.txt")
    assert gen < backfill < gates < rsync


def test_the_backfill_step_can_never_abort_the_nightly():
    block = backfill_block()
    assert "exit" not in block
    call = block[block.index('"$PY" "$DEPLOY/ingest/backfill_fund_statements_massive.py"'):]
    command = call[: call.index("\nfi")]
    assert re.search(r"\|\|\s*echo .*WARN: statements backfill failed", command, re.S)


def test_the_key_is_read_by_the_process_and_never_handled_by_the_shell():
    block = backfill_block()
    assert '--env-file "$HOME/.macro-dashboard/.env"' in block
    assert "MASSIVE_API_KEY" not in block and "POLYGON_API_KEY" not in block
    for line in LINES:
        code = line.split("#", 1)[0]
        assert not re.search(r"\b(export|source)\b.*(MASSIVE|POLYGON)_API_KEY|macro-dashboard/\.env", code) \
            or "--env-file" in code, line
        assert not re.search(r"^\s*\.\s+\S*macro-dashboard/\.env", code), line
    # `$KEY` is the SSH deploy key the rsync uses; the backfill must not have clobbered it.
    assigned = [line for line in LINES if re.match(r"\s*KEY=", line)]
    assert assigned == ['KEY="$HOME/.ssh/macro_dashboard_deploy_v2"']


def test_the_flow_header_names_the_step():
    assert "deep statement history backfill" in TEXT[: TEXT.index("set -u")]


# ── the block, executed ──────────────────────────────────────────────────────
FAKE_DATE = """#!/bin/bash
[ -n "${FAKE_DATE_FAIL:-}" ] && [ "$1" = "-j" ] && exit 1
case "$*" in
  *18:15:00*) echo 1000000 ;;
  *18:30:00*) echo 1000900 ;;
  "+%s") echo "$FAKE_NOW" ;;
  *) echo TS ;;
esac
"""


def run_block(tmp_path: Path, now: int, *, py_rc: int = 0, date_fails: bool = False):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    (bin_dir / "date").write_text(FAKE_DATE)
    (bin_dir / "date").chmod(0o755)
    args_log = tmp_path / "py_args"
    py = tmp_path / "py"
    py.write_text(f'#!/bin/bash\nprintf "%s\\n" "$@" > "{args_log}"\nexit {py_rc}\n')
    py.chmod(0o755)
    log = tmp_path / "nightly.log"
    script = (
        "set -u\nts(){ date; }\n"
        f'PY="{py}"\nDEPLOY="{tmp_path / "deploy"}"\nLOG="{log}"\n'
        + backfill_block()
        + 'echo "NEXT STEP RAN" >> "$LOG"\n'
    )
    env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp_path), "FAKE_NOW": str(now)}
    if date_fails:
        env["FAKE_DATE_FAIL"] = "1"
    proc = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=30)
    assert proc.returncode == 0, proc.stderr
    args = args_log.read_text().splitlines() if args_log.exists() else None
    return log.read_text(), args


def budget(args):
    return int(args[args.index("--deadline-seconds") + 1])


def test_an_on_time_run_gets_the_full_budget(tmp_path):
    log, args = run_block(tmp_path, now=1000000 - 9000)   # 16:45 in fake seconds
    assert budget(args) == 2700
    assert args[:3] == [f"{tmp_path}/deploy/ingest/backfill_fund_statements_massive.py",
                        "--env-file", f"{tmp_path}/.macro-dashboard/.env"]
    assert "--quiet" in args and "NEXT STEP RAN" in log


def test_a_late_run_is_cut_to_end_by_1815(tmp_path):
    _, args = run_block(tmp_path, now=1000000 - 1000)
    assert budget(args) == 1000


@pytest.mark.parametrize("now", [1000000 - 30, 1000000, 1000000 + 600], ids=["1814:30", "1815", "1825"])
def test_too_close_to_cnhk_skips_and_carries_on(tmp_path, now):
    log, args = run_block(tmp_path, now=now)
    assert args is None
    assert "WARN: statements backfill skipped" in log and "NEXT STEP RAN" in log


@pytest.mark.parametrize("date_fails", [False, True], ids=["after-1830", "no-bsd-date"])
def test_outside_the_cnhk_window_the_budget_is_the_default(tmp_path, date_fails):
    _, args = run_block(tmp_path, now=1000900 + 60, date_fails=date_fails)
    assert budget(args) == 2700


def test_a_failing_backfill_logs_a_warning_and_the_nightly_continues(tmp_path):
    log, args = run_block(tmp_path, now=1000000 - 9000, py_rc=1)
    assert args is not None
    assert "WARN: statements backfill failed (non-fatal" in log
    assert log.rstrip().endswith("NEXT STEP RAN")


# ── the block, executed against the real script and a dead endpoint ──────────
def test_a_dead_endpoint_leaves_every_file_as_emitted_and_the_nightly_continues(tmp_path):
    """The real backfill script under the real block, its sys.path[0] = ingest/ exactly as
    launchd runs it, with a `curl` that answers 410 the way the sunset vX endpoint does."""
    deploy = tmp_path / "deploy"
    shutil.copytree(ROOT / "ingest", deploy / "ingest",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    data = deploy / "terminal" / "public" / "data"
    data.mkdir(parents=True)
    before = {}
    for sym in ("AAPL", "MSFT"):
        path = data / f"{sym}.fund.json"
        path.write_text(json.dumps({
            "ticker": sym, "src": {"statements": "yfinance"},
            "statements": {"annual": {"periods": ["2025"], "period_end": ["2025-09-30"],
                                      "income": {"revenue": [1.0]}}},
        }))
        before[path] = path.read_bytes()
    (tmp_path / ".macro-dashboard").mkdir()
    (tmp_path / ".macro-dashboard" / ".env").write_text(f"MASSIVE_API_KEY={FAKE_KEY}\n")

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "date").write_text(FAKE_DATE)
    (bin_dir / "curl").write_text(
        f'#!/bin/bash\nprintf "%s\\n" "$@" >> "{tmp_path / "curl_argv"}"\ncat > /dev/null\n'
        "printf '{\"status\":\"ERROR\",\"error\":\"vX endpoint sunset\"}\\n410'\n"
    )
    for tool in ("date", "curl"):
        (bin_dir / tool).chmod(0o755)
    log = tmp_path / "nightly.log"
    py = sys.executable
    script = (
        "set -u\nts(){ date; }\n"
        f'PY="{py}"\nDEPLOY="{deploy}"\nLOG="{log}"\n'
        + backfill_block()
        + 'echo "NEXT STEP RAN" >> "$LOG"\n'
    )
    env = {k: v for k, v in os.environ.items() if k not in ("MASSIVE_API_KEY", "POLYGON_API_KEY")}
    env.update(PATH=f"{bin_dir}:{env['PATH']}", HOME=str(tmp_path), FAKE_NOW=str(1000000 - 9000))
    proc = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=120)
    assert proc.returncode == 0, proc.stderr
    text = log.read_text()
    assert "HTTP 410" in text and "files left unchanged" in text, text
    assert "WARN: statements backfill failed (non-fatal" in text
    assert text.rstrip().endswith("NEXT STEP RAN")
    assert "Traceback" not in text
    assert {p: p.read_bytes() for p in before} == before
    assert FAKE_KEY not in text + (tmp_path / "curl_argv").read_text()
