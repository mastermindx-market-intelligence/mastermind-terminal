"""The staged build yields CPU to serving without changing the release contract."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "ops" / "terminal-build.sh"


def build_command() -> str:
    lines = [line for line in SCRIPT.read_text().splitlines()
             if line.startswith('( cd "$STAGE" && ') and "npm run build )" in line]
    assert len(lines) == 1
    return lines[0]


def test_only_build_subtree_is_niced():
    command = build_command()
    assert 'NEXT_DEPLOYMENT_ID="$FULL_SHA" nice -n 10 npm run build )' in command
    assert 'NODE_OPTIONS="$BUILD_NODE_OPTIONS" GIT_SHA="$FULL_SHA"' in command
    source = SCRIPT.read_text()
    assert source.count("nice -n 10 npm run build") == 1
    assert "BUILD_NODE_HEAP_MB=3072" in source


@pytest.mark.parametrize("exit_code", [0, 17])
def test_priority_preserves_identity_environment_cwd_and_failure(tmp_path, exit_code):
    if not shutil.which("bash") or not shutil.which("nice") or not hasattr(os, "getpriority"):
        pytest.skip("POSIX bash/nice required for the Linux VPS build command")
    bindir = tmp_path / "bin"
    bindir.mkdir()
    stage = tmp_path / "staging with spaces"
    stage.mkdir()
    npm = bindir / "npm"
    npm.write_text('''#!/usr/bin/env python3
import json, os, sys
print(json.dumps({"argv": sys.argv[1:], "cwd": os.getcwd(),
 "nice": os.getpriority(os.PRIO_PROCESS, 0),
 "node_options": os.environ.get("NODE_OPTIONS"), "git_sha": os.environ.get("GIT_SHA"),
 "deployment_id": os.environ.get("NEXT_DEPLOYMENT_ID")}))
sys.exit(int(os.environ["TEST_NPM_EXIT"]))
''')
    npm.chmod(0o755)
    sha = "a" * 40
    env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ.get("PATH", ""),
               STAGE=str(stage), BUILD_NODE_OPTIONS="--max-old-space-size=3072",
               FULL_SHA=sha, TEST_NPM_EXIT=str(exit_code))
    before = os.getpriority(os.PRIO_PROCESS, 0)
    run = subprocess.run(["bash", "-c", "set -eu; " + build_command()], env=env,
                         text=True, capture_output=True, timeout=10)
    assert run.returncode == exit_code, run.stderr
    result = json.loads(run.stdout)
    assert result["argv"] == ["run", "build"]
    assert result["cwd"] == str(stage.resolve())
    assert result["nice"] == min(before + 10, 19)
    assert result["node_options"] == "--max-old-space-size=3072"
    assert result["git_sha"] == result["deployment_id"] == sha
    assert os.getpriority(os.PRIO_PROCESS, 0) == before
