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
        (data / name).write_text("{}")
    (ca / "requirements.txt").write_text((ROOT / "requirements.txt").read_text())

    # Real collector modules, so the nightly's preflight performs a genuine import check.
    for name in ("__init__.py", "collect_cn_deep.py", "security_state_bridge.py",
                 "refresh_cn_hk.sh", "refresh_fund.sh"):
        shutil.copy2(ROOT / "ingest" / name, ca / "ingest" / name)
    shutil.copy2(NIGHTLY_CNHK, ca / "ops" / "nightly_cnhk.sh")
    shutil.copy2(CHECK_CNHK_FRESH, ca / "ops" / "check_cnhk_fresh.sh")

    macro = sb / "MACRO"
    (macro / "data" / "tushare").mkdir(parents=True)
    (macro / "site" / "chinastockdata").mkdir(parents=True)
    (macro / "site" / "hkstockdata").mkdir(parents=True)
    (macro / ".env").write_text("TUSHARE_TOKEN=fake-token\n")

    (sb / "HOME" / ".ssh").mkdir(parents=True)
    bindir = sb / "bin"
    bindir.mkdir()

    def script(name: str, body: str) -> Path:
        p = bindir / name
        p.write_text(f"#!/usr/bin/env bash\n{body}")
        p.chmod(0o755)
        return p

    # Interpreter shim: inline python programs (preflight / stamp) run for REAL, so the
    # shipped preflight and stamp code are exercised; collector scripts exit a configured rc.
    script("pyshim", f'''
if [ "${{1:-}}" = "-" ]; then
  prog="$(cat)"
  case "$prog" in
    *PREFLIGHT*) [ -n "${{FAKE_PREFLIGHT_FAIL:-}}" ] && exit 1 ;;
  esac
  # `exec` inside a pipeline replaces only the subshell, so run it and propagate the real rc.
  printf '%s' "$prog" | {REAL_PYTHON} - "${{@:2}}"
  exit $?
fi
name="$(basename "${{1:-}}")"
var="FAKE_RC_$(echo "$name" | tr '.-' '__' | tr '[:lower:]' '[:upper:]')"
echo "$name" >> "${{FAKE_CALLS:-/dev/null}}"
exit "${{!var:-0}}"
''')
    script("rsync", 'echo "rsync $*" >> "${FAKE_CALLS:-/dev/null}"\nexit "${FAKE_RSYNC_RC:-0}"\n')
    # `stat` probes are how check_cnhk_fresh reads served-file mtimes; answer them with a
    # recent epoch so the watcher sees fresh files, and log the call for assertions.
    script("ssh", '''echo "ssh $*" >> "${FAKE_CALLS:-/dev/null}"
case "$*" in
  *stat*) echo 1790000000 ;;
esac
exit 0
''')
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


# ─────────────────────────────── refresh_cn_hk.sh ───────────────────────────────
def test_cnhk_refresh_exits_zero_only_when_every_required_stage_succeeds(sandbox):
    r = run(["bash", str(sandbox / "CA" / "ingest" / "refresh_cn_hk.sh")], sandbox)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "refresh complete" in r.stdout
    assert "collect_cn_deep.py" in calls(sandbox) and "collect_hk_deep.py" in calls(sandbox)


def test_cnhk_refresh_reports_the_real_rc_and_exits_nonzero(sandbox):
    """The headline defect: a failed collector logged "exited 0" because the $(ts) command
    substitution reset $? before the message expanded it."""
    r = run(["bash", str(sandbox / "CA" / "ingest" / "refresh_cn_hk.sh")], sandbox,
            FAKE_RC_collect_cn_deep_py=3)
    assert r.returncode == 1
    assert "collect_cn_deep:3" in r.stdout, r.stdout
    assert "exited 0" not in r.stdout
    assert "INCOMPLETE" in r.stdout


def test_cnh_token_failure_does_not_stop_the_independent_hk_leg(sandbox):
    """HK deep + the bridge + publication must still run when CN is broken; only the overall
    verdict is red."""
    r = run(["bash", str(sandbox / "CA" / "ingest" / "refresh_cn_hk.sh")], sandbox,
            FAKE_RC_collect_cn_deep_py=1)
    assert r.returncode == 1
    seen = calls(sandbox)
    assert "collect_hk_deep.py" in seen, "HK must still collect"
    assert "pull_cn_hk_intel.py" in seen, "the bridge must still rebuild from last-good"
    assert "rsync" in seen, "good HK data must still publish"
    assert "rsync_intel" not in r.stdout


def test_cnh_missing_token_still_refreshes_hk(sandbox):
    """A missing Tushare credential used to abort the whole script before the HK leg."""
    (sandbox / "MACRO" / ".env").unlink()          # the only credential source in the sandbox
    r = run(["bash", str(sandbox / "CA" / "ingest" / "refresh_cn_hk.sh")], sandbox,
            TUSHARE_TOKEN="")
    assert r.returncode == 1
    assert "collect_hk_deep.py" in calls(sandbox)
    assert "cn_token_missing" in r.stdout


def test_cnh_hk_failure_is_independent_of_a_green_cn_leg(sandbox):
    r = run(["bash", str(sandbox / "CA" / "ingest" / "refresh_cn_hk.sh")], sandbox,
            FAKE_RC_collect_hk_deep_py=2)
    assert r.returncode == 1
    assert "collect_hk_deep:2" in r.stdout
    assert "collect_cn_deep.py" in calls(sandbox), "CN must still run"


def test_cnh_bridge_failure_publishes_nothing_and_fails(sandbox):
    r = run(["bash", str(sandbox / "CA" / "ingest" / "refresh_cn_hk.sh")], sandbox,
            FAKE_RC_pull_cn_hk_intel_py=4)
    assert r.returncode == 1
    assert "pull_cn_hk_intel:4" in r.stdout
    assert "bridge failed" in r.stdout
    # The HK universe floor is pushed before the bridge and is unrelated; what must not
    # happen is the intel publication transfer.
    assert not any("cnhk_intel_list" in ln for ln in call_lines(sandbox)), \
        "a failed bridge must not publish a partial intel set"


def test_cnh_publication_rsync_failure_is_not_green(sandbox):
    r = run(["bash", str(sandbox / "CA" / "ingest" / "refresh_cn_hk.sh")], sandbox,
            FAKE_RSYNC_RC=23)
    assert r.returncode == 1
    assert "rsync_intel:23" in r.stdout


def test_cnh_hk_universe_floor_stays_explicitly_optional(sandbox):
    """A failed universe-floor refresh must NOT redden the lane — it falls back to the cache."""
    r = run(["bash", str(sandbox / "CA" / "ingest" / "refresh_cn_hk.sh")], sandbox,
            FAKE_RC_gen_hk_universe_py=1)
    assert r.returncode == 0, "universe floor is explicitly optional and keeps its cache"
    assert "keeping existing cache" in r.stdout


# ─────────────────────────────── refresh_fund.sh ───────────────────────────────
def fund(sandbox, *args, **extra):
    return run(["bash", str(sandbox / "CA" / "ingest" / "refresh_fund.sh"),
                "--cn-hk-only", "--skip-tx", "--skip-opts", *args], sandbox, **extra)


def full_fund(sandbox, *args, **extra):
    """The US+CN/HK lane — the only one that reaches the Massive statements backfill."""
    return run(["bash", str(sandbox / "CA" / "ingest" / "refresh_fund.sh"),
                "--skip-collect", "--skip-tx", "--skip-opts", *args], sandbox, **extra)


def test_fund_exits_zero_on_a_clean_cnhk_run(sandbox):
    r = fund(sandbox)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "refresh_fund.sh complete" in r.stdout


def test_fund_intel_publication_failure_is_no_longer_a_green_nightly(sandbox):
    """The exact 2026-10-22 failure: pull_macro_intel could not import (jsonschema) and the
    lane still exited 0."""
    r = fund(sandbox, FAKE_RC_pull_macro_intel_py=1)
    assert r.returncode == 1
    assert "pull_macro_intel:1" in r.stdout
    assert "INCOMPLETE" in r.stdout
    assert "pull_macro_intel.py" in calls(sandbox), "the stage must actually have been attempted"


def test_fund_emitter_failure_is_reported_but_does_not_block_cn_hk(sandbox):
    r = fund(sandbox, FAKE_RC_gen_fund_cn_py=1)
    assert r.returncode == 1
    assert "gen_fund_cn:1" in r.stdout
    assert "gen_fund_hk.py" in calls(sandbox), "an independent emitter must still run"


def test_fund_collector_failure_is_reported(sandbox):
    r = fund(sandbox, FAKE_RC_collect_cn_hk_fund_py=5)
    assert r.returncode == 1
    assert "collect_cn_hk_fund:5" in r.stdout


def test_fund_publication_rsync_failure_is_not_green(sandbox):
    r = fund(sandbox, FAKE_RSYNC_RC=19)
    assert r.returncode == 1
    assert "rsync_fund_intel:19" in r.stdout


def test_fund_massive_backfill_stays_explicitly_optional(sandbox):
    """Documented non-fatal by design: a vendor outage must not leave the US files unpublished.
    Reached only on the full lane — --cn-hk-only skips the whole US block."""
    r = full_fund(sandbox, MASSIVE_API_KEY="present",
                  FAKE_RC_backfill_fund_statements_massive_py=1)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "backfill_fund_statements_massive.py" in calls(sandbox), "it must actually have run"
    assert "explicitly optional" in r.stdout


def test_fund_massive_backfill_absent_key_is_not_a_failure(sandbox):
    r = full_fund(sandbox)
    assert r.returncode == 0
    assert "skipping statements backfill" in r.stdout


def test_fund_dry_run_executes_nothing_and_stays_green(sandbox):
    r = run(["bash", str(sandbox / "CA" / "ingest" / "refresh_fund.sh"),
             "--cn-hk-only", "--skip-tx", "--skip-opts", "--dry-run"], sandbox)
    assert r.returncode == 0
    assert "[DRY-RUN]" in r.stdout
    assert "collect_cn_hk_fund.py" not in calls(sandbox)


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
         "DATA": str(sb / "CA" / "terminal" / "public" / "data")},
    )
    out.write_text(text)
    out.chmod(0o755)
    return out


def seed_stamp(sb: Path, last_success="2026-10-20T01:00:00Z") -> Path:
    stamp = sb / "cnhk_status.json"
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
    assert st["exit"]["refresh_fund_cnhk"] == 0


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
    real = [m for m in ("jsonschema", "pandas", "pyarrow", "numpy", "yaml", "requests")]
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
    assert any(re.match(r"\s*exit \d+\s*$", ln) for ln in body[-8:]), \
        "the driver must end on an explicit exit derived from its failure aggregate"