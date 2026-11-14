"""Exercise the nightly migration gate without collector, network or corpus writes."""
from __future__ import annotations

import os
from pathlib import Path
import shlex
import subprocess
import sys
import time

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _run_gate(tmp_path, *, weekly=False, probe=0, collect=0, repair=0, sync=0):
    source = (ROOT / "ops" / "nightly_fund.sh").read_text()
    assignment = next(
        line for line in source.splitlines()
        if line.startswith("TX_ROLE_REPAIR_STAMP=")
    )
    start = source.index('export MACRO_ROOT="$FUNDSRC"')
    end = source.index("# Rebuild discovery from production bodies on EVERY run.")
    block = source[start:end]
    stamps = tmp_path / "fund" / "data" / "transcripts"
    stamps.mkdir(parents=True, exist_ok=True)
    # The original migration may already have completed before #1434 shipped.
    (stamps / ".role_inference_v2_ok").touch()
    refresh = stamps / ".nightly_refresh_ok"
    refresh.touch()
    if weekly:
        old = time.time() - 9 * 86400
        os.utime(refresh, (old, old))
    events = tmp_path / "events"
    events.write_text("")
    bridge = tmp_path / "bridge.py"
    bridge.write_text('''import os, sys
from pathlib import Path
target = Path(sys.argv[1]).name
args = sys.argv[2:]
with open(os.environ["EVENTS"], "a") as stream:
    if target == "collect_transcripts.py":
        probe = "--probe-parquet-revision" in args
        stream.write("probe\\n" if probe else "collect\\n")
        code = int(os.environ["PROBE_RC" if probe else "COLLECT_RC"])
        if probe and code in (0, 10):
            print("etag:synthetic-transcript-revision")
    elif target == "repair_transcript_roles.py":
        stream.write("repair\\n")
        code = int(os.environ["REPAIR_RC"])
    elif target == "synthetic-rsync":
        stream.write("sync\\n")
        code = int(os.environ["SYNC_RC"])
    elif target == "fund_state_ops.py":
        assert args[0] == "touch"
        Path(args[1]).touch()
        stream.write("stamp\\n")
        code = 0
    else:
        raise AssertionError("Unexpected operation: " + target)
sys.exit(code)
''')
    wrapper = tmp_path / "python-bridge"
    wrapper.write_text(
        "#!/bin/sh\nexec " + shlex.quote(sys.executable) + " "
        + shlex.quote(str(bridge)) + ' "$@"\n'
    )
    wrapper.chmod(0o700)
    env = {
        **os.environ,
        "FUNDSRC": str(tmp_path / "fund"), "DEPLOY": str(ROOT),
        "DATA": str(tmp_path / "data"), "PY": str(wrapper),
        "TX_REFRESH_STAMP": str(refresh),
        "TX_REVISION_CANDIDATE": str(stamps / "candidate"),
        "LOG": str(tmp_path / "log"), "EVENTS": str(events),
        "KEY": "unused-synthetic", "VPS": "unused-synthetic",
        "VPS_DATA": "unused-synthetic", "PROBE_RC": str(probe),
        "COLLECT_RC": str(collect), "REPAIR_RC": str(repair),
        "SYNC_RC": str(sync),
    }
    # Transport is a shell function, never the real rsync/ssh program. Only
    # the bounded decision block is executed, not the nightly refresh job.
    harness = (
        assignment + '\nts(){ printf SYNTHETIC; }\n'
        + 'rsync(){ "$PY" synthetic-rsync; }\n' + block
    )
    result = subprocess.run(
        ["bash", "--noprofile", "--norc", "-c", harness],
        env=env, text=True, capture_output=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr
    return events.read_text().splitlines(), stamps


@pytest.mark.parametrize("weekly,probe,collect", [
    (False, 0, 0), (False, 11, 0),
    (False, 10, 0), (False, 10, 1),
    (True, 0, 0), (True, 0, 1),
    (True, 11, 0), (True, 11, 1),
])
def test_old_role_stamp_does_not_suppress_new_classifier_migration(
    tmp_path, weekly, probe, collect,
):
    events, stamps = _run_gate(tmp_path, weekly=weekly, probe=probe, collect=collect)
    assert events.count("repair") == events.count("sync") == events.count("stamp") == 1
    assert (stamps / ".role_inference_v2_ok").exists()
    # The ordinary next run is cheap once the new classifier's migration succeeded.
    second, _ = _run_gate(tmp_path)
    assert second == ["probe"]


@pytest.mark.parametrize("failed_step", ["repair", "sync"])
def test_failed_role_migration_is_not_stamped_and_retries_next_run(tmp_path, failed_step):
    events, _ = _run_gate(tmp_path, **{failed_step: 1})
    assert events.count("repair") == 1
    assert events.count("sync") == (0 if failed_step == "repair" else 1)
    assert "stamp" not in events
    retry, _ = _run_gate(tmp_path)
    assert retry.count("repair") == retry.count("sync") == retry.count("stamp") == 1
