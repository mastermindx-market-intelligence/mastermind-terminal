"""The CN/HK refresh lane must never report success it did not achieve.

These are hermetic shell harnesses: the REAL driver scripts are run against fake
executables in a sandbox tree, so no Tushare call, no VPS, no SSH and no production file is
touched. Each test pins one link in the chain that produced the 2026-10-22 false-green:

    collect_cn_deep zeroed its caches  ->  pull_macro_intel died on a missing jsonschema
      ->  both logged "exited 0"        ->  nightly stamped last_success
      ->  the watcher saw fresh files   ->  nobody was paged

Covered here: the actual rc reaching the aggregate, the aggregate becoming the exit code,
CN/HK independence in both directions, explicitly-optional legs still being tolerated, and
last_success being preserved across an incomplete run.
"""
import json
import os
import re
import shutil
import site
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

REFRESH_CN_HK = ROOT / "ingest" / "refresh_cn_hk.sh"
REFRESH_FUND = ROOT / "ingest" / "refresh_fund.sh"
NIGHTLY_CNHK = ROOT / "ops" / "nightly_cnhk.sh"
CHECK_CNHK_FRESH = ROOT / "ops" / "check_cnhk_fresh.sh"

# Real interpreter for the inline-python blocks (the nightly's preflight and dead-man stamp).
import sys as _sys  # noqa: E402

REAL_PYTHON = _sys.executable


def rewrite_constants(text: str, mapping: dict) -> str:
    """Repoint the hardcoded lane paths (the TCC lane cannot be parameterised by env, which
    is deliberate on macOS). Only the constant assignments are touched — the control flow under
    test is the shipped code, byte for byte."""
    for name, value in mapping.items():
        # Some constants share a line (`VPS="…"; VPS_DATA="…"`) and some are re-assigned
        # (check_cnhk_fresh.sh falls back to `PYBIN="python3"`), so anchor on a word boundary
        # and repoint every occurrence.
        text, n = re.subn(rf'(?<![A-Za-z0-9_]){name}="[^"]*"', f'{name}="{value}"', text)
        assert n >= 1, f"expected a {name}= assignment to repoint, found none"
    return text


@pytest.fixture
def sandbox(tmp_path):
    """A complete fake lane: deploy clone, Macro surface, home, and fake executables."""
    sb = tmp_path

    ca = sb / "CA"
    (ca / "ingest").mkdir(parents=True)
    (ca / "ops").mkdir()
    (ca / "terminal" / "public" / "data").mkdir(parents=True)
    data = ca / "terminal" / "public" / "data"
    for name in ("600519.SS.intel.json", "0700.HK.intel.json", "000001.SZ.intel.json",
                 "600519.SS.fund.json", "0700.HK.fund.json", "ABC.us.intel.json"):
        payload = ({"schema":"mastermind.fund/v1", "ticker":name.removesuffix(".fund.json")}
                   if name.endswith(".fund.json") else {})
        (data / name).write_text(json.dumps(payload))
    (ca / "requirements.txt").write_text((ROOT / "requirements.txt").read_text())

    # Real collector modules, so the nightly's preflight performs a genuine import check.
    for name in ("__init__.py", "collect_cn_deep.py", "security_state_bridge.py",
                 "refresh_cn_hk.sh", "refresh_fund.sh", "regional_refresh.py", "run_bounded.py"):
        shutil.copy2(ROOT / "ingest" / name, ca / "ingest" / name)
    shutil.copy2(NIGHTLY_CNHK, ca / "ops" / "nightly_cnhk.sh")
    shutil.copy2(ROOT / "ops" / "fund_writer_lock.sh", ca / "ops" / "fund_writer_lock.sh")
    shutil.copy2(CHECK_CNHK_FRESH, ca / "ops" / "check_cnhk_fresh.sh")

    macro = sb / "MACRO"
    (macro / "data" / "tushare").mkdir(parents=True)
    (macro / "site" / "chinastockdata").mkdir(parents=True)
    (macro / "site" / "hkstockdata").mkdir(parents=True)
    (macro / ".env").write_text("TUSHARE_TOKEN=fake-token\n")

    (sb / "HOME" / ".ssh").mkdir(parents=True)
    bindir = sb / "bin"
    bindir.mkdir()

    # Test-only Python clock pin. The shell `date` below is faked at 12:00, but the actual
    # publication clock of the real driver is Python's dt.datetime.now(utc) inside
    # regional_refresh.py — the clock CI ran on, whose 21:00–22:30 UTC window held every
    # publication in the retained red run. The fixture pins that clock exactly like the shell
    # one (12:00 UTC by default), so the whole lane is deterministic and the window guard is
    # exercised on purpose instead of by accident of wall-clock time. The pin is installed
    # only in the interpreter that runs regional_refresh.py (see the pyshim branch below);
    # no production byte is touched and nothing outside the sandbox sees it.
    clock_spec = bindir / "pinned_clock.json"
    clock_spec.write_text(json.dumps({
        "utc": "2026-10-22T12:00:00+00:00",
        "receipt": str(sb / "clock_receipts.jsonl"),
    }) + "\n")
    (bindir / "regional_clock_pin.py").write_text('''"""Test-only sandbox fixture artifact; never imported by production code.

Installs a deterministic ``datetime.datetime`` into the interpreter that runs the real
``ingest/regional_refresh.py`` driver, so the 21:00-22:30 UTC publication-window guard
reads the fixture instant instead of the wall clock. Every clock read is receipted so a
test can prove the driver subprocess actually ran on the fixture clock.
"""
import datetime as _dt
import json
import os
import sys


def install(clock_dir):
    with open(os.path.join(clock_dir, "pinned_clock.json")) as handle:
        spec = json.load(handle)
    moment = _dt.datetime.fromisoformat(spec["utc"])
    receipt = spec.get("receipt")
    origin = os.path.abspath(sys.argv[0]) if sys.argv else "?"

    class PinnedDateTime(_dt.datetime):
        @classmethod
        def now(cls, tz=None):
            if receipt:
                with open(receipt, "a") as handle:
                    handle.write(json.dumps(
                        {"utc": moment.astimezone(_dt.timezone.utc).isoformat(),
                         "script": origin, "pid": os.getpid()}) + "\\n")
            return moment.astimezone(tz) if tz is not None else moment.replace(tzinfo=None)

    _dt.datetime = PinnedDateTime
''')

    def script(name: str, body: str) -> Path:
        p = bindir / name
        p.write_text(f"#!/usr/bin/env bash\n{body}")
        p.chmod(0o755)
        return p

    # The real regional driver runs; only its external source/emitter/remote boundaries are fake.
    pyshim = f"""#!/bin/bash
if [ "$1" = "-" ]; then
  prog="$(cat)"
  case "$prog" in
    *PREFLIGHT*) [ -n "$FAKE_PREFLIGHT_FAIL" ] && exit 1 ;;
  esac
  shift
  printf '%s' "$prog" | {REAL_PYTHON} - "$@"
  exit $?
fi
name="$(basename "$1")"
if [ "$name" = "regional_refresh.py" ]; then
  # Bootstrap the fixture's pinned publication clock into exactly this interpreter, then run
  # the shipped driver bytes unchanged (runpy keeps __main__ semantics and the argv contract).
  exec {REAL_PYTHON} -c 'import sys, runpy
clock_dir = sys.argv.pop(1)
sys.argv = sys.argv[1:]
sys.path.insert(0, clock_dir)
import regional_clock_pin
regional_clock_pin.install(clock_dir)
runpy.run_path(sys.argv[0], run_name="__main__")' "{bindir}" "$@" --python "$0"
fi
if [ "$name" = "run_bounded.py" ]; then
  exec {REAL_PYTHON} "$@"
fi
exec {REAL_PYTHON} "$FAKE_BOUNDARY_SCRIPT" "$@"
"""
    (bindir / "pyshim").write_text(pyshim)
    (bindir / "pyshim").chmod(0o755)
    boundary = sb / "boundary.py"
    boundary.write_text(r"""
import json,os,pathlib,sys
name=pathlib.Path(sys.argv[1]).name
args=sys.argv[2:]
with open(os.environ["FAKE_CALLS"],"a") as f:f.write(name+" "+" ".join(args)+"\n")
key="FAKE_RC_"+name.replace(".","_").replace("-","_").upper()
rc=int(os.environ.get(key,"0"))
if name=="collect_cn_deep.py" and not os.environ.get("TUSHARE_TOKEN"):rc=1
if name.startswith("gen_fund_") or name=="pull_cn_hk_intel.py":
 if "--out" in args:
  out=pathlib.Path(args[args.index("--out")+1]);out.mkdir(parents=True,exist_ok=True)
  market=args[args.index("--market")+1] if "--market" in args else ("cn" if name=="gen_fund_cn.py" else "hk")
  suffix=".fund.json" if name.startswith("gen_fund_") else ".intel.json"
  schema="mastermind.fund/v1" if suffix==".fund.json" else "intel/v1"
  names=["600519.SS","430047.BJ"] if market=="cn" else ["0700.HK","0005.HK"]
  for ticker in names:(out/(ticker+suffix)).write_text(json.dumps({"ticker":ticker,"schema":schema}))
sys.exit(rc)
""")
    ssh = bindir / "ssh"
    ssh.write_text("#!" + REAL_PYTHON + r"""
import hashlib,json,os,pathlib,sys
with open(os.environ["FAKE_CALLS"],"a") as f:f.write("ssh "+" ".join(sys.argv[1:])+"\n")
if "stat" in " ".join(sys.argv):
 print(1790000000)
else:
 try:request=json.load(sys.stdin)
 except (ValueError,EOFError):sys.exit(0)
 root=pathlib.Path(os.environ["FAKE_REMOTE"])
 print(json.dumps({name:hashlib.sha256((root/name).read_bytes()).hexdigest() if (root/name).exists() else None for name in request["names"]}))
""")
    ssh.chmod(0o755)
    rsync = bindir / "rsync"
    rsync.write_text("#!" + REAL_PYTHON + r"""
import os,pathlib,shutil,sys
args=sys.argv[1:]
with open(os.environ["FAKE_CALLS"],"a") as f:f.write("rsync "+" ".join(args)+"\n")
rc=int(os.environ.get("FAKE_RSYNC_RC","0"))
if rc:sys.exit(rc)
manifest=next((part.split("=",1)[1] for part in args if part.startswith("--files-from=")),None)
if manifest:
 root=pathlib.Path(os.environ["FAKE_REMOTE"]);root.mkdir(exist_ok=True)
 source=pathlib.Path(args[-2])
 for name in pathlib.Path(manifest).read_text().splitlines():
  path=source/name
  if path.is_file():shutil.copyfile(path,root/name)
""")
    rsync.chmod(0o755)
    script("git", 'exit 0\n')
    # Nothing is waiting on the sibling lane, so the serialisation loop exits at once.
    script("pgrep", "exit 1\n")
    # Pinned clock: refresh_fund refuses bulk rsync inside the 21:00-22:30 UTC window, and a
    # test that ran during it would abort for the wrong reason. Formats are matched anywhere
    # in argv because the real calls pass `-u` first.
    script("date", '''case " $* " in
  *" +%s "*) echo 1790000000 ;;
  *" +%H%M "*) echo 1200 ;;
  *) echo "2026-10-21 12:00:00 UTC" ;;
esac
''')
    return sb


def env_for(sb: Path, **extra) -> dict:
    env = dict(os.environ)
    env.update({
        "HOME": str(sb / "HOME"),
        "PATH": f"{sb / 'bin'}:{env['PATH']}",
        "MACRO_REPO": str(sb / "MACRO"),
        "MM_REFRESH_PY": str(sb / "bin" / "pyshim"),
        "FAKE_CALLS": str(sb / "calls.log"),
        "FAKE_BOUNDARY_SCRIPT": str(sb / "boundary.py"),
        "FAKE_REMOTE": str(sb / "served"),
        "PYTHONPATH": os.pathsep.join([site.getusersitepackages(), os.environ.get("PYTHONPATH", "")]),
        # Inherited Tushare/vendored keys must not reach the sandbox.
        "TUSHARE_TOKEN": "fake-token",
    })
    for k in ("POLYGON_API_KEY", "MASSIVE_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
        env.pop(k, None)
    # The interpreter shim upper-cases the script basename, so failure-code overrides are
    # normalised the same way — FAKE_RC_collect_cn_deep_py matches collect_cn_deep.py.
    for k, v in extra.items():
        env[k.upper() if k.startswith("FAKE_RC_") else k] = str(v)
    return env


def run(cmd, sb: Path, **extra):
    return subprocess.run(cmd, env=env_for(sb, **extra), capture_output=True, text=True,
                          timeout=180)


def calls(sb: Path) -> list:
    p = sb / "calls.log"
    return p.read_text().split() if p.exists() else []


def call_lines(sb: Path) -> list:
    p = sb / "calls.log"
    return p.read_text().splitlines() if p.exists() else []


def set_driver_clock(sb: Path, utc: str) -> None:
    """Re-point the sandboxed driver's pinned Python publication clock (test-only fixture
    state; the shipped driver bytes never change). The next regional_refresh.py subprocess
    then runs — and window-guards — on exactly this instant."""
    spec_path = sb / "bin" / "pinned_clock.json"
    spec = json.loads(spec_path.read_text())
    spec["utc"] = utc
    spec_path.write_text(json.dumps(spec) + "\n")


def clock_receipts(sb: Path) -> list:
    p = sb / "clock_receipts.jsonl"
    return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []


# ─────────────────────────────── real driver stage boundaries ───────────────────────────────
def stage_status(sb):
    return json.loads((sb / "MACRO" / "cnhk_status.json").read_text())["markets"]

def test_cnhk_refresh_succeeds_only_after_both_markets_are_verified(sandbox):
    r = run(["bash", str(sandbox / "CA/ingest/refresh_cn_hk.sh")], sandbox)
    assert r.returncode == 0, r.stdout + r.stderr
    status = stage_status(sandbox)
    assert all(status[market]["intel"]["publication"] == "published" for market in ("cn","hk"))
    assert (sandbox / "served/430047.BJ.intel.json").is_file()
    # The ordinary cases run the real driver subprocess on the pinned 12:00 fixture clock.
    assert {entry["utc"] for entry in clock_receipts(sandbox)} == {"2026-10-22T12:00:00+00:00"}
    assert all(entry["script"].endswith("regional_refresh.py") for entry in clock_receipts(sandbox))

def test_blocked_publication_window_still_holds_and_transfers_nothing(sandbox):
    """Discriminator for the pinned clock: the identical lane that publishes at the ordinary
    12:00 fixture instant must still be stopped by the real in-driver window guard at
    21:30 UTC — no ssh probe, no rsync, not one served byte moved. The clock receipts prove
    the subprocess itself ran on the fixture instant, so this holds regardless of when CI
    runs, and the guard is proven live rather than patched out."""
    served = sandbox / "served"
    served.mkdir()
    for name in ("600519.SS.intel.json", "0700.HK.intel.json"):
        shutil.copyfile(sandbox / "CA/terminal/public/data" / name, served / name)
    before = {path.name: path.read_bytes() for path in served.iterdir()}
    set_driver_clock(sandbox, "2026-10-22T21:30:00+00:00")
    r = run(["bash", str(sandbox / "CA/ingest/refresh_cn_hk.sh")], sandbox)
    assert r.returncode == 1, r.stdout + r.stderr
    status = stage_status(sandbox)
    for market in ("cn", "hk"):
        assert status[market]["intel"]["publication"] == "held"
        assert status[market]["intel"]["error"] == "publication window blocked (21:00–22:30 UTC)"
    assert call_lines(sandbox), "the drivers must have run"
    assert not any(line.startswith(("rsync ", "ssh ")) for line in call_lines(sandbox))
    after = {path.name: path.read_bytes() for path in served.iterdir()}
    assert after == before, "the blocked window must not transfer or rewrite a single served byte"
    receipts = clock_receipts(sandbox)
    assert receipts, "the pinned publication clock must have been consulted"
    assert {entry["utc"] for entry in receipts} == {"2026-10-22T21:30:00+00:00"}
    assert any(entry["script"].endswith("regional_refresh.py") for entry in receipts), \
        "the real driver subprocess must have received the fixture clock"

def test_cn_failure_publishes_hk_only_and_keeps_aggregate_red(sandbox):
    r = run(["bash", str(sandbox / "CA/ingest/refresh_cn_hk.sh")], sandbox,
            FAKE_RC_collect_cn_deep_py=3)
    assert r.returncode == 1, r.stdout + r.stderr
    status = stage_status(sandbox)
    assert status["cn"]["intel"]["collection"] == "failed"
    assert status["cn"]["intel"]["publication"] == "held"
    assert status["hk"]["intel"]["publication"] == "published"
    assert sorted(path.name for path in (sandbox / "served").glob("*.json")) == [
        "0005.HK.intel.json", "0700.HK.intel.json"]

def test_missing_cn_token_still_allows_hk(sandbox):
    (sandbox / "MACRO/.env").unlink()
    r = run(["bash", str(sandbox / "CA/ingest/refresh_cn_hk.sh")], sandbox, TUSHARE_TOKEN="")
    assert r.returncode == 1
    assert stage_status(sandbox)["hk"]["intel"]["publication"] == "published"

def test_bridge_failure_never_transfers_a_partial_emission(sandbox):
    r = run(["bash", str(sandbox / "CA/ingest/refresh_cn_hk.sh")], sandbox,
            FAKE_RC_pull_cn_hk_intel_py=4)
    assert r.returncode == 1
    assert not any(line.startswith("rsync ") for line in call_lines(sandbox))
    assert not (sandbox / "served").exists()

def test_failed_regional_fund_is_not_published_by_the_residual_bulk_lane(sandbox):
    # The successful HK writer must start from the exact served baseline.
    (sandbox / "served").mkdir()
    shutil.copyfile(sandbox / "CA/terminal/public/data/0700.HK.fund.json",
                    sandbox / "served/0700.HK.fund.json")
    r = run(["bash", str(sandbox / "CA/ingest/refresh_fund.sh"),
             "--cn-hk-only", "--skip-tx", "--skip-opts"], sandbox,
            FAKE_RC_gen_fund_cn_py=1)
    assert r.returncode == 1, r.stdout + r.stderr
    assert not (sandbox / "served/600519.SS.fund.json").exists()
    assert not (sandbox / "served/430047.BJ.fund.json").exists()
    assert (sandbox / "served/0700.HK.fund.json").exists()
    assert stage_status(sandbox)["hk"]["fund"]["publication"] == "published"

# ─────────────────────────────── nightly + dead-man stamp ───────────────────────────────
def nightly_script(sb: Path, stamp: Path) -> Path:
    out = sb / "CA" / "ops" / "nightly_cnhk_sandboxed.sh"
    text = rewrite_constants(
        NIGHTLY_CNHK.read_text(),
        {"DEPLOY": str(sb / "CA"),
         "ENGINE": str(sb / "ENGINE"),
         "SRC": str(sb / "MACRO"),
         "PYBIN": str(sb / "bin" / "pyshim"),
         "KEY": str(sb / "HOME" / ".ssh" / "key"),
         "VPS": "root@fake",
         "VPS_DATA": "/fake",
         "LOG": str(sb / "nightly.log"),
         "STAMP": str(stamp),
         "DATA": str(sb / "CA" / "terminal" / "public" / "data"),
         "LOCK_DIR": str(sb / "fund.lock")},
    )
    out.write_text(text)
    out.chmod(0o755)
    return out


def seed_stamp(sb: Path, last_success="2026-10-20T01:00:00Z") -> Path:
    stamp = sb / "MACRO" / "cnhk_status.json"
    stamp.write_text(json.dumps({
        "last_run": "2026-10-20T01:00:00Z",
        "last_success": last_success,
        "exit": {"refresh_cn_hk": 0, "refresh_fund_cnhk": 0},
    }, indent=2) + "\n")
    return stamp


def run_nightly(sb: Path, stamp: Path, **extra):
    r = run(["bash", str(nightly_script(sb, stamp)), "--post-update"], sb, **extra)
    return r


def test_nightly_advances_last_success_only_on_a_fully_clean_run(sandbox):
    (sandbox / "served").mkdir()
    for path in (sandbox / "CA/terminal/public/data").glob("*.fund.json"):
        shutil.copyfile(path, sandbox / "served" / path.name)
    stamp = seed_stamp(sandbox)
    r = run_nightly(sandbox, stamp)
    assert r.returncode == 0, (sandbox / "nightly.log").read_text()
    st = json.loads(stamp.read_text())
    assert st["last_success"] != "2026-10-20T01:00:00Z"
    assert st["exit"] == {"preflight": 0, "refresh_cn_hk": 0, "refresh_fund_cnhk": 0}
    assert "last_incomplete" not in st


def test_nightly_preserves_last_success_when_a_required_stage_fails(sandbox):
    """The false-green, end to end: refresh_fund's intel publication dies, the lane must not
    claim success, and the previous good last_success must survive untouched."""
    stamp = seed_stamp(sandbox)
    r = run_nightly(sandbox, stamp, FAKE_RC_pull_macro_intel_py=1)
    assert r.returncode == 1
    st = json.loads(stamp.read_text())
    assert st["last_success"] == "2026-10-20T01:00:00Z", "last_success must NOT advance"
    assert st["last_run"] != "2026-10-20T01:00:00Z", "last_run must still advance"
    assert st["exit"]["refresh_fund_cnhk"] == 1
    assert st["exit"]["refresh_cn_hk"] == 0, "the independent CN/HK leg did succeed"
    assert "last_incomplete" in st


def test_nightly_preserves_last_success_when_the_cn_leg_fails(sandbox):
    stamp = seed_stamp(sandbox)
    r = run_nightly(sandbox, stamp, FAKE_RC_collect_cn_deep_py=1)
    assert r.returncode == 1
    st = json.loads(stamp.read_text())
    assert st["last_success"] == "2026-10-20T01:00:00Z"
    assert st["exit"]["refresh_cn_hk"] == 1
    assert st["exit"]["refresh_fund_cnhk"] == 1
    assert "collect_cn_hk_fund.py --market cn" not in "\n".join(call_lines(sandbox))


def test_nightly_dependency_preflight_aborts_before_any_work(sandbox):
    """Import drift must cost seconds, not a full run."""
    stamp = seed_stamp(sandbox)
    r = run_nightly(sandbox, stamp, FAKE_PREFLIGHT_FAIL=1)
    assert r.returncode == 1
    log = (sandbox / "nightly.log").read_text()
    assert "ABORT: dependency preflight failed" in log
    assert "no refresh, no publication" in log
    assert calls(sandbox) == [], "no collector may run after a failed preflight"
    st = json.loads(stamp.read_text())
    assert st["last_success"] == "2026-10-20T01:00:00Z"
    assert st["exit"]["preflight"] == 1


def test_nightly_preflight_runs_the_real_shipped_import_check(sandbox):
    """The preflight's Python block is extracted from the shipped script and executed, so it
    catches a genuinely missing dependency rather than merely existing."""
    source = NIGHTLY_CNHK.read_text()
    block = source.split("<<'PREFLIGHT_EOF'\n", 1)[1].split("\nPREFLIGHT_EOF", 1)[0]
    real = [m for m in ("jsonschema", "pandas", "pyarrow", "numpy", "yaml", "requests", "yfinance")]
    repo = ["ingest.security_state_bridge", "ingest.collect_cn_deep"]

    ok = subprocess.run([REAL_PYTHON, "-", str(sandbox / "CA"), " ".join(real), " ".join(repo)],
                        input=block, capture_output=True, text=True, timeout=120)
    assert ok.returncode == 0, ok.stdout + ok.stderr

    broken = subprocess.run(
        [REAL_PYTHON, "-", str(sandbox / "CA"), " ".join(real + ["totally_absent_pkg"]),
         " ".join(repo)],
        input=block, capture_output=True, text=True, timeout=120)
    assert broken.returncode == 1
    assert "totally_absent_pkg" in broken.stdout


# ─────────────────────────────── dead-man watcher ───────────────────────────────
def watcher(sb: Path, stamp: Path) -> Path:
    out = sb / "CA" / "ops" / "check_cnhk_fresh_sandboxed.sh"
    out.write_text(rewrite_constants(
        CHECK_CNHK_FRESH.read_text(),
        {"SRC": str(sb), "STAMP": str(stamp), "PYBIN": REAL_PYTHON,
         "KEY": str(sb / "HOME" / ".ssh" / "key"), "VPS": "root@fake",
         "VPS_DATA": "/fake", "LOG": str(sb / "watch.log")},
    ))
    out.chmod(0o755)
    return out


def test_watcher_reports_a_fresh_but_incomplete_run(sandbox):
    """Neither staleness nor served-file mtime could see the 2026-10-22 run: it stamped a
    fresh last_success and rsynced placeholder files. The exit detail can."""
    stamp = seed_stamp(sandbox, last_success="2999-01-01T00:00:00Z")  # deliberately not stale
    stamp.write_text(json.dumps({
        "last_run": "2026-10-21T02:00:00Z",
        "last_success": "2999-01-01T00:00:00Z",
        "exit": {"preflight": 0, "refresh_cn_hk": 0, "refresh_fund_cnhk": 1},
        "last_incomplete": "2026-10-21T02:00:00Z",
    }, indent=2) + "\n")
    r = run(["bash", str(watcher(sandbox, stamp))], sandbox)
    assert r.returncode == 1
    assert "INCOMPLETE" in (sandbox / "watch.log").read_text()
    assert "refresh_fund_cnhk=1" in (sandbox / "watch.log").read_text()


def test_watcher_stays_quiet_on_a_clean_run(sandbox):
    stamp = seed_stamp(sandbox, last_success="2999-01-01T00:00:00Z")
    r = run(["bash", str(watcher(sandbox, stamp))], sandbox)
    assert r.returncode == 0, (sandbox / "watch.log").read_text()
    assert "OK" in (sandbox / "watch.log").read_text()


# ─────────────────────────────── static guards ───────────────────────────────
@pytest.mark.parametrize("script", [REFRESH_CN_HK, REFRESH_FUND, NIGHTLY_CNHK, CHECK_CNHK_FRESH])
def test_every_driver_script_is_valid_bash(script):
    assert subprocess.run(["bash", "-n", str(script)], timeout=60).returncode == 0


@pytest.mark.parametrize("script", [REFRESH_CN_HK, REFRESH_FUND])
def test_no_surviving_rc_clobbering_idiom(script):
    """`cmd || echo "[$(ts)] ... $?"` always prints 0: the command substitution runs first and
    resets $?. No driver may reintroduce it."""
    offenders = [ln for ln in script.read_text().splitlines()
                 if re.search(r"\|\|\s*echo\b.*\$\(ts\).*\$\?", ln) and not ln.lstrip().startswith("#")]
    assert not offenders, offenders


@pytest.mark.parametrize("script", [REFRESH_CN_HK, REFRESH_FUND, NIGHTLY_CNHK])
def test_drivers_end_with_an_explicit_exit_contract(script):
    """A script that simply falls off the end can never signal failure to its caller."""
    body = [ln for ln in script.read_text().splitlines()
            if ln.strip() and not ln.lstrip().startswith("#")]
    assert any(re.match(r'\s*exit (?:\d+|"\$RC")\s*$', ln) for ln in body[-8:]), \
        "the driver must end on an explicit exit derived from its failure aggregate"

def test_nightly_never_overwrites_an_unreadable_publication_fence(sandbox):
    stamp = sandbox / "MACRO/cnhk_status.json"
    original = '{"markets":{"hk":{"fund":{"pending_publication":'
    stamp.write_text(original)
    result = run_nightly(sandbox, stamp, FAKE_PREFLIGHT_FAIL=1)
    assert result.returncode == 1
    assert stamp.read_text() == original
    assert calls(sandbox) == []
