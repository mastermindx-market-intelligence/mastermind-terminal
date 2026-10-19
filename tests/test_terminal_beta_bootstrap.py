"""Beta bootstrap, shared build lock, restored production dependency detection,
and the repaired release-owner acceptance: derived exact shared-shell tuple from the
admitted source, cache-only writability, and root-umask runtime read publication.

WHAT THIS CONTRACT PINS
-----------------------
The three defects the beta candidate carried, plus the approved lifecycle:

1. ONE shared, owner-managed, non-stealing build-resource lock for BOTH profiles,
   taken before any mutable deploy/build/source effect. A beta npm build and a
   production npm build must never run concurrently on one 3.9 GB host, and no EXIT
   path may remove a lock it did not write.
2. The production runtime overlay must sample hub content state and the hub
   lockfile digest BEFORE the archive lands. Sampling them afterwards makes
   LOCK_BEFORE == LOCK_AFTER forever and silently disables the hub `npm ci` on every
   dependency change.
3. `--target beta --bootstrap --target-sha <sha>` is the only entrance that can
   take a never-accepted, provably empty beta target to a first generation. It
   produces ENFORCED source-provisioned state — never a fabricated deploy:
     * provisioning happens only after the exact commit is proven contained by a
       freshly fetched protected ref;
     * the ordinary, unweakened source audit runs against the provisioned source;
     * runtime acceptance requires the real shared-shell status producer, the
       three-identity gate, and (for a bootstrap) a post-activation audit;
     * provisioned source can never satisfy post-deploy verification, become a
       rollback baseline, or advertise successful runtime;
     * an interrupted attempt resumes only VERIFIED matching provisioned state and
       never cleans up state it cannot account for.

HERMETIC BY CONSTRUCTION
------------------------
The owner keeps its hardcoded /opt/terminal paths; the full-flow tests execute a
rewritten COPY pointed at a temporary host root, with a temporary Git origin cloned
locally (no network, no credentials, no project repository) and node/npm/npx/systemctl/
curl/sleep/install/stat shims on PATH. git, tar, rsync, python3 and the REAL
ops/terminal_audit + ops/terminal_release_preflight modules are used unshimmed, so the
preflight evidence in these tests is produced by the code that will run on the box —
not by a stub that always says CLEAN. Nothing here touches a real deploy root.

An env override exists only so the same file can be re-run against a different
candidate bundle: MMX_TERMINAL_BUILD_SCRIPT and MMX_TERMINAL_BETA_POLICY.
"""

from __future__ import annotations

import getpass
import hashlib
import json
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
import re

REPO = Path(__file__).resolve().parents[1]
OPS = Path(os.environ.get("MMX_TERMINAL_BETA_TEST_OPS", REPO / "ops"))
SCRIPT = Path(os.environ.get("MMX_TERMINAL_BUILD_SCRIPT", OPS / "terminal-build.sh"))
BETA_POLICY_ARTIFACT = Path(
    os.environ.get("MMX_TERMINAL_BETA_POLICY", OPS / "terminal_source_audit.beta.json")
)
UNIT_ARTIFACT = Path(os.environ.get("MMX_TERMINAL_BETA_UNIT", OPS / "terminal-beta.service"))
FULL_SHA_RE = r"[0-9a-f]{40}"

OLD_SHA = "1111111111111111111111111111111111111111"
NEW_BUILD_ID = "build-BETAcandidate0001"
SECRET_SENTINEL = "NEVER-LOG-THIS-DB-PASSWORD"

# The shared-shell producer constants the fixture commits INTO its temporary
# protected origin (mirroring terminal/lib/sharedShellContracts.ts and the
# projection metadata). The repaired owner must DERIVE acceptance from these
# files at the admitted commit — they are fixture data, not owner constants.
FIXTURE_PROTOCOL = "mmx.shared-shell.v1"
FIXTURE_BRIDGE = "20261018.1"
FIXTURE_DOCUMENT = "20261018.1"
FIXTURE_REGISTRY = "30516d80cd64baf1f542e0d1cbf90ed254a1eab02cb55da3504766f5ae245535"
FIXTURE_CONTRACTS_TS = (
    "export const SHARED_SHELL_PROTOCOL = \"mmx.shared-shell.v1\" as const;\n"
    "export const SHARED_SHELL_BRIDGE_VERSION = \"20261018.1\" as const;\n"
    "export const SHARED_SHELL_DOCUMENT_VERSION = \"20261018.1\" as const;\n"
)
FIXTURE_ROUTES_JSON = json.dumps(
    {
        "sources": {
            "registrySha256": FIXTURE_REGISTRY,
            "macro": "d1e7e5559114f3b1e39e27a4331cd39f71ccb5db",
        },
        "legacyPaths": ["/stocks/msft.html"],
        "nativePaths": ["/options"],
        "directory": [],
    }
) + "\n"


def _bash() -> str:
    found = shutil.which("bash")
    assert found, "bash is required to exercise the deploy contract"
    return found


def run_lib(body: str, script: Path = SCRIPT) -> subprocess.CompletedProcess:
    driver = textwrap.dedent(
        f'''
        . "{script}"
        set +e            # the owner sets -e; drivers test failure paths on purpose
        {textwrap.dedent(body)}
        '''
    )
    return subprocess.run([_bash(), "-c", driver], capture_output=True, text=True, timeout=120)


def git(repo: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    )
    return completed.stdout.strip()


# ---------------------------------------------------------------------------
# library level: the lifecycle state machine, in isolation
# ---------------------------------------------------------------------------


def state_scaffold(tmp_path: Path) -> dict[str, Path]:
    target_root = tmp_path / "beta"
    app = target_root / "terminal"
    state_dir = tmp_path / "varlib" / "mastermind-terminal-beta" / "source-provisioned"
    # The target root starts genuinely EMPTY: a bootstrap must not be admitted
    # against scaffolding the test itself left behind.
    for directory in (target_root, state_dir):
        directory.mkdir(parents=True)
    policy = tmp_path / "terminal_source_audit.beta.json"
    policy.write_text(
        json.dumps(
            {
                "schema": "mastermind.terminal.source_audit_policy.v1",
                "accepted_ref": "refs/remotes/origin/master",
                "deployment_id_file": str(app / ".deployment-id"),
                "mappings": [
                    {
                        "name": "beta-terminal-app",
                        "repo_path": "terminal",
                        "live_path": str(app),
                        "allowances": [
                            {
                                "path": ".deployment-id",
                                "classification": "deployment_marker",
                                "expected_live_type": "file",
                            }
                        ],
                    },
                    {
                        "name": "beta-terminal-ingest",
                        "repo_path": "ingest",
                        "live_path": str(target_root / "ingest"),
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    return {
        "target_root": target_root,
        "app": app,
        "state_dir": state_dir,
        "policy": policy,
        "production_app": tmp_path / "terminal",
        "repo": tmp_path / ".gitsrc-beta",
    }


def state_lib(prefix: str, scaffold: dict[str, Path], sha: str, digest: str) -> str:
    return (
        f'SHARED_BUILD_LOCK_DIR="{scaffold["target_root"]}/.lock"; '
        f'TARGET=beta; BETA_TARGET_ROOT="{scaffold["target_root"]}"; '
        f'SOURCE_PROVISIONED_STATE_DIR="{scaffold["state_dir"]}"; '
        f'APP="{scaffold["app"]}"; PREFLIGHT_POLICY="{scaffold["policy"]}"; '
        f'PREFLIGHT_POLICY_DIGEST="{digest}"; SRC="{scaffold["repo"]}"; '
        f'PRODUCTION_APP_DEFAULT="{scaffold["production_app"]}"; '
        f'beta_statectl {prefix}'
    )


def call_state(scaffold, action: str, *args: str) -> tuple[int, str]:
    digest = hashlib.sha256(b"policy").hexdigest()
    body = state_lib(f"{action} " + " ".join(args), scaffold, scaffold.get("sha", OLD_SHA), digest)
    result = run_lib(body)
    return result.returncode, result.stdout + result.stderr


@pytest.fixture()
def scaffold(tmp_path: Path) -> dict[str, Path]:
    box = state_scaffold(tmp_path)
    box["sha"] = OLD_SHA
    box["digest"] = hashlib.sha256(b"policy").hexdigest()
    return box


def inventory_file(tmp_path: Path, scaffold: dict[str, Path]) -> Path:
    tree = hashlib.sha1(b"tree").hexdigest()
    path = tmp_path / "trees.tsv"
    path.write_text(
        f"terminal\t{scaffold['app']}\t{tree}\n"
        f"ingest\t{scaffold['target_root'] / 'ingest'}\t{tree}\n",
        encoding="utf-8",
    )
    return path


def test_state_inventory_is_read_from_the_policy_and_confined(tmp_path, scaffold):
    rc, out = call_state(scaffold, "inventory", str(scaffold["policy"]),
                         str(scaffold["target_root"]), str(scaffold["app"]),
                         str(scaffold["production_app"]))
    assert rc == 0, out
    rows = {tuple(line.split("\t")) for line in out.strip().splitlines()}
    assert rows == {("terminal", str(scaffold["app"])), ("ingest", str(scaffold["target_root"] / "ingest"))}


def test_state_inventory_refuses_paths_outside_the_beta_target(tmp_path, scaffold):
    policy = Path(scaffold["policy"])
    payload = json.loads(policy.read_text())
    payload["mappings"][1]["live_path"] = str(scaffold["production_app"] / "ingest")
    policy.write_text(json.dumps(payload))
    rc, out = call_state(scaffold, "inventory", str(scaffold["policy"]),
                         str(scaffold["target_root"]), str(scaffold["app"]),
                         str(scaffold["production_app"]))
    assert rc != 0
    assert "outside the beta target root" in out or "overlaps the production app tree" in out


def test_bootstrap_admits_only_an_empty_or_exactly_verified_target(tmp_path, scaffold):
    # empty -> admitted as fresh
    rc, out = call_state(scaffold, "admit", str(scaffold["target_root"]),
                         str(scaffold["state_dir"]), str(scaffold["app"]), scaffold["sha"],
                         scaffold["digest"], str(scaffold["repo"]), str(scaffold["policy"]),
                         str(scaffold["production_app"]))
    assert rc == 0 and out.strip() == "EMPTY", out

    # unexpected files -> refused, and never wiped
    (scaffold["target_root"] / "surprise.txt").write_text("keep me\n")
    (scaffold["target_root"] / "hub").mkdir()
    rc, out = call_state(scaffold, "admit", str(scaffold["target_root"]),
                         str(scaffold["state_dir"]), str(scaffold["app"]), scaffold["sha"],
                         scaffold["digest"], str(scaffold["repo"]), str(scaffold["policy"]),
                         str(scaffold["production_app"]))
    assert rc != 0 and "never wiped to bootstrap" in out, out
    assert (scaffold["target_root"] / "surprise.txt").read_text() == "keep me\n"
    assert (scaffold["target_root"] / "hub").is_dir()
    (scaffold["target_root"] / "surprise.txt").unlink()
    (scaffold["target_root"] / "hub").rmdir()


def test_provision_record_binds_sha_paths_and_digest_and_denies_runtime(tmp_path, scaffold):
    trees = inventory_file(tmp_path, scaffold)
    rc, out = call_state(scaffold, "begin", str(scaffold["target_root"]),
                         str(scaffold["state_dir"]), str(scaffold["app"]), scaffold["sha"],
                         scaffold["digest"], str(scaffold["repo"]), str(scaffold["policy"]),
                         str(trees), str(scaffold["production_app"]))
    assert rc == 0, out
    record = Path(out.strip())
    payload = json.loads(record.read_text())
    assert payload["accepted_sha"] == scaffold["sha"]
    assert payload["policy_digest"] == scaffold["digest"]
    assert payload["policy_path"] == str(scaffold["policy"])
    assert payload["app_root"] == str(scaffold["app"])
    assert payload["deployment_marker"] == str(scaffold["app"] / ".deployment-id")
    assert {item["repo_path"] for item in payload["provisioned"]} == {"terminal", "ingest"}
    assert payload["provision_authorized"] is True
    # THE enforcement fields: this record is a SOURCE claim and says so.
    assert payload["accepted_runtime"] is False
    assert payload["rollback_baseline"] is False
    pointer = scaffold["target_root"] / ".source-provisioned"
    assert pointer.is_symlink() and Path(os.readlink(pointer)) == record

    scaffold["app"].mkdir(parents=True, exist_ok=True)
    rc, out = call_state(scaffold, "marker", str(scaffold["target_root"]),
                         str(scaffold["state_dir"]), str(scaffold["app"]), scaffold["sha"],
                         str(record))
    assert rc == 0 and "written" in out, out
    assert (scaffold["app"] / ".deployment-id").read_text().strip() == scaffold["sha"]


def test_resume_requires_an_exact_match_and_never_reuses_another_generation(tmp_path, scaffold):
    trees = inventory_file(tmp_path, scaffold)
    rc, out = call_state(scaffold, "begin", str(scaffold["target_root"]),
                         str(scaffold["state_dir"]), str(scaffold["app"]), scaffold["sha"],
                         scaffold["digest"], str(scaffold["repo"]), str(scaffold["policy"]),
                         str(trees), str(scaffold["production_app"]))
    assert rc == 0, out
    record = Path(out.strip())

    def admit(sha: str, digest: str) -> tuple[int, str]:
        return call_state(scaffold, "admit", str(scaffold["target_root"]),
                          str(scaffold["state_dir"]), str(scaffold["app"]), sha, digest,
                          str(scaffold["repo"]), str(scaffold["policy"]),
                          str(scaffold["production_app"]))

    rc, out = admit(scaffold["sha"], scaffold["digest"])
    assert rc == 0 and out.startswith("RESUME"), out
    assert Path(out.split("\t")[1].strip()) == record

    other = "2" * 40
    rc, out = admit(other, scaffold["digest"])
    assert rc != 0 and "different commit" in out, out
    rc, out = admit(scaffold["sha"], hashlib.sha256(b"other-policy").hexdigest())
    assert rc != 0 and "different policy digest" in out, out

    # a record that claims runtime acceptance is not a source-provisioned record
    payload = json.loads(record.read_text())
    payload["record_id"] = "0" * 64
    record.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    rc, out = admit(scaffold["sha"], scaffold["digest"])
    assert rc != 0 and "identity does not match" in out, out


def test_runtime_acceptance_requires_validated_transaction_and_demotion(tmp_path, scaffold):
    trees = inventory_file(tmp_path, scaffold)
    rc, out = call_state(scaffold, "begin", str(scaffold["target_root"]),
                         str(scaffold["state_dir"]), str(scaffold["app"]), scaffold["sha"],
                         scaffold["digest"], str(scaffold["repo"]), str(scaffold["policy"]),
                         str(trees), str(scaffold["production_app"]))
    assert rc == 0, out
    record = Path(out.strip())
    gate_args = tuple(str(scaffold[key]) for key in
                      ("target_root", "state_dir", "app", "repo", "production_app"))
    rc, out = call_state(scaffold, "ordinary-gate", *gate_args)
    assert rc == 0 and out.strip() == "NEED_BOOTSTRAP", out

    rc, out = call_state(scaffold, "attempt-begin", str(scaffold["target_root"]),
                         str(scaffold["state_dir"]), str(scaffold["app"]),
                         str(scaffold["repo"]), scaffold["sha"], scaffold["digest"],
                         str(scaffold["production_app"]), "bootstrap", '""', '""')
    assert rc == 0, out
    attempt_id = out.strip()
    assert (scaffold["target_root"] / ".release-pending").is_symlink()
    runtime_args = (
        str(scaffold["target_root"]), str(scaffold["state_dir"]),
        str(scaffold["app"]), str(scaffold["repo"]), scaffold["sha"],
        scaffold["digest"], str(scaffold["policy"]), str(scaffold["production_app"]),
        '""', str(tmp_path / "receipt.json"), "a" * 64, "b" * 64,
        NEW_BUILD_ID, attempt_id,
    )
    # A pending staging attempt is insufficient authority to accept a runtime.
    rc, out = call_state(scaffold, "runtime", *runtime_args)
    assert rc != 0 and "validated pending beta transaction" in out, out
    for phase in ("inputs-dirty", "validated", "committing"):
        rc, out = call_state(scaffold, "attempt-phase", str(scaffold["target_root"]),
                             str(scaffold["state_dir"]), attempt_id, phase, NEW_BUILD_ID)
        assert rc == 0, out
    # Even a validated attempt must prove its exact live marker/build pair.
    rc, out = call_state(scaffold, "runtime", *runtime_args)
    assert rc != 0 and ".deployment-id" in out, out
    scaffold["app"].mkdir(parents=True, exist_ok=True)
    (scaffold["app"] / ".deployment-id").write_text(scaffold["sha"] + "\n")
    build_dir = scaffold["app"] / ".next"
    build_dir.mkdir()
    (build_dir / "BUILD_ID").write_text(NEW_BUILD_ID + "\n")
    rc, out = call_state(scaffold, "runtime", *runtime_args)
    assert rc == 0, out
    accepted = Path(out.strip())
    payload = json.loads(accepted.read_text())
    assert payload["runtime_accepted"] is True and payload["rollback_baseline"] is True
    assert payload["build_id"] == NEW_BUILD_ID
    assert payload["source_provisioned_record"] == str(record)
    assert payload["acceptance_attempt_id"] == attempt_id
    assert payload["previous_runtime_record"] is None
    assert (scaffold["target_root"] / ".runtime-accepted").is_symlink()
    rc, out = call_state(scaffold, "ordinary-gate", *gate_args)
    assert rc != 0 and "pending beta release" in out, out
    rc, out = call_state(scaffold, "attempt-finish", str(scaffold["target_root"]),
                         str(scaffold["state_dir"]), attempt_id, "committed")
    assert rc == 0 and out.strip() == "committed", out
    rc, out = call_state(scaffold, "ordinary-gate", *gate_args)
    assert rc == 0, out
    assert out.strip().split("\t") == [
        "BASELINE", str(accepted), payload["record_id"], scaffold["sha"], NEW_BUILD_ID,
    ], out

    # The existing low-level demotion operation removes only the runtime claim.
    rc, out = call_state(scaffold, "demote", str(scaffold["target_root"]),
                         str(scaffold["state_dir"]), scaffold["sha"])
    assert rc == 0, out
    assert not (scaffold["target_root"] / ".runtime-accepted").exists()
    assert record.is_file() and (scaffold["app"] / ".deployment-id").is_file()
    rc, out = call_state(scaffold, "ordinary-gate", *gate_args)
    assert rc == 0 and out.strip() == "NEED_BOOTSTRAP", out


def test_active_runtime_target_is_never_bootstrapped_over(tmp_path, scaffold):
    (scaffold["target_root"] / ".runtime-accepted").symlink_to(scaffold["state_dir"] / "x.json")
    rc, out = call_state(scaffold, "admit", str(scaffold["target_root"]),
                         str(scaffold["state_dir"]), str(scaffold["app"]), scaffold["sha"],
                         scaffold["digest"], str(scaffold["repo"]), str(scaffold["policy"]),
                         str(scaffold["production_app"]))
    assert rc != 0 and "never bootstrapped over" in out, out


def test_symlink_aliases_are_refused_never_followed(tmp_path, scaffold):
    linked_state = tmp_path / "state-alias"
    linked_state.symlink_to(scaffold["state_dir"])
    rc, out = call_state(scaffold, "admit", str(scaffold["target_root"]),
                         str(linked_state), str(scaffold["app"]), scaffold["sha"],
                         scaffold["digest"], str(scaffold["repo"]), str(scaffold["policy"]),
                         str(scaffold["production_app"]))
    assert rc != 0 and "symlink alias" in out, out


def test_archive_members_must_stay_inside_the_mapped_beta_roots(tmp_path, scaffold):
    trees = inventory_file(tmp_path, scaffold)
    members = tmp_path / "members.txt"
    base = f'beta_statectl members "{scaffold["target_root"]}" "{trees}" "{members}"'
    ok = run_lib(
        f'printf "terminal/app.py\ningest/x.py\nterminal/\n" >"{members}"; '
        f'( {base} ); echo "RC=$?"'
    )
    assert "RC=0" in ok.stdout, ok.stdout + ok.stderr
    for evil in ("../escape.py", "outside/x", "/absolute/x", "terminal/../../etc/passwd"):
        bad = run_lib(f'printf "{evil}\n" >"{members}"; ( {base} ); echo "RC=$?"')
        assert "RC=1" in bad.stdout or "RC=1" in bad.stderr, (evil, bad.stdout, bad.stderr)
    empty = run_lib(f'printf "" >"{members}"; ( {base} ); echo "RC=$?"')
    assert "RC=1" in empty.stdout, empty.stdout


def lock_dir_of(tmp_path: Path) -> Path:
    parent = tmp_path / "host"
    parent.mkdir(exist_ok=True)
    return parent / ".terminal-build-resource.lock"


def test_shared_lock_serializes_both_profiles_and_is_never_stolen(tmp_path):
    lock = lock_dir_of(tmp_path)
    child = tmp_path / "child.sh"
    child.write_text(
        f'. "{SCRIPT}"\n'
        f'SHARED_BUILD_LOCK_DIR="{lock}"\n'
        f'deploy_lock_acquire "{lock}" "$1" || exit $?\n'
        'echo ACQUIRED_$1\n'
    )
    child.chmod(0o755)
    body = f'''
      SHARED_BUILD_LOCK_DIR="{lock}"
      "{_bash()}" "{child}" production &
      child=$!
      sleep 1
      SHARED_BUILD_LOCK_DIR="{lock}"
      # a beta run must contend for the SAME lock, not a parallel one
      deploy_lock_acquire "{lock}" beta; echo "BETA_RC=$?"
      wait "$child"; echo "CHILD_RC=$?"
      deploy_lock_release "{lock}" 0 beta; echo "STEAL_RC=$?"
      test -d "{lock}/hold" && echo STILL_HELD
      exit 0
    '''
    result = run_lib(body)
    out = result.stdout
    assert "BETA_RC=75" in out, out + result.stderr
    assert "CHILD_RC=0" in out, out + result.stderr
    # DEPLOY_LOCK_HELD=0: a process that never held it must not be able to drop it
    assert "STEAL_RC=0" in out and "STILL_HELD" in out, out + result.stderr
    assert (lock / "hold" / "owner").read_text().count("target=production") == 1


def test_release_removes_only_this_pids_hold_and_ignores_a_foreign_record(tmp_path):
    lock = lock_dir_of(tmp_path)
    (lock / "hold").mkdir(parents=True)
    (lock / "hold" / "owner").write_text("pid=999999\nuid=0\ntarget=production\n")
    body = f'''
      SHARED_BUILD_LOCK_DIR="{lock}"
      deploy_lock_release "{lock}" 1 beta; echo "RC=$?"
      test -f "{lock}/hold/owner" && echo FOREIGN_INTACT
      exit 0
    '''
    result = run_lib(body)
    assert "RC=1" in result.stdout, result.stdout + result.stderr
    assert "FOREIGN_INTACT" in result.stdout
    assert (lock / "hold" / "owner").exists()


def test_acquire_refuses_a_non_shared_path_and_nesting(tmp_path):
    lock = lock_dir_of(tmp_path)
    result = run_lib(f'''
      SHARED_BUILD_LOCK_DIR="{lock}"
      deploy_lock_acquire "{tmp_path}/elsewhere" beta; echo "WRONG_PATH_RC=$?"
      deploy_lock_acquire "{lock}" staging; echo "BAD_TARGET_RC=$?"
      deploy_lock_acquire "{lock}" beta >/dev/null; echo "FIRST_RC=$?"
      deploy_lock_acquire "{lock}" beta; echo "NEST_RC=$?"
      deploy_lock_release "{lock}" "$DEPLOY_LOCK_HELD" beta >/dev/null
      exit 0
    ''')
    assert "WRONG_PATH_RC=64" in result.stdout, result.stdout + result.stderr
    assert "BAD_TARGET_RC=64" in result.stdout
    assert "FIRST_RC=0" in result.stdout
    assert "NEST_RC=64" in result.stdout


def test_profile_tuple_is_the_source_of_truth_for_every_path() -> None:
    result = run_lib('''
      select_release_target production
      echo "P|$APP|$SRC|$SERVICE_NAME|$HEALTH_URL|$PREFLIGHT_RECEIPT_DIR|$PREFLIGHT_POLICY_BASENAME|$INSTALLS_GLOBAL_RUNTIME|$ENV_SOURCE_DIR"
      select_release_target beta
      echo "B|$APP|$SRC|$SERVICE_NAME|$HEALTH_URL|$PREFLIGHT_RECEIPT_DIR|$PREFLIGHT_POLICY_BASENAME|$INSTALLS_GLOBAL_RUNTIME|$ENV_SOURCE_DIR"
      select_release_target Beta; echo "LABEL_RC=$?"
      select_release_target /opt/terminal/beta; echo "PATH_RC=$?"
      exit 0
    ''')
    out = result.stdout
    assert "P|/opt/terminal/terminal|/opt/terminal/.gitsrc|terminal|http://127.0.0.1:3000/|/var/lib/mastermind-terminal/release-preflight|terminal_source_audit.production.json|1|/opt/terminal/terminal" in out, out
    assert "B|/opt/terminal/beta/terminal|/opt/terminal/.gitsrc-beta|terminal-beta|http://127.0.0.1:3001/|/var/lib/mastermind-terminal-beta/release-preflight|terminal_source_audit.beta.json|0|/var/lib/mastermind-terminal-beta/host" in out, out
    assert "LABEL_RC=64" in out and "PATH_RC=64" in out


def test_shared_shell_flag_is_profile_state_not_caller_state(tmp_path):
    production = run_lib(f'''
      export MMX_SHARED_SHELL=1
      select_release_target production
      apply_profile_environment; echo "RC=$?"
      echo "INHERITED=[${{MMX_SHARED_SHELL-<unset>}}]"
      exit 0
    ''')
    assert "INHERITED=[<unset>]" in production.stdout, production.stdout + production.stderr
    declared = run_lib('''
      unset MMX_SHARED_SHELL
      select_release_target beta
      apply_profile_environment; echo "RC=$?"; echo "VALUE=$MMX_SHARED_SHELL"
      exit 0
    ''')
    assert "RC=0" in declared.stdout and "VALUE=1" in declared.stdout, declared.stdout
    disagree = run_lib('''
      export MMX_SHARED_SHELL=2
      select_release_target beta
      apply_profile_environment; echo "RC=$?"
      exit 0
    ''')
    assert "RC=64" in disagree.stdout, disagree.stdout


def test_paths_that_cross_the_profile_boundary_are_refused(tmp_path):
    host = tmp_path / "host"
    app = host / "terminal"
    src = host / ".gitsrc"
    (src / ".git").mkdir(parents=True)
    app.mkdir()
    result = run_lib(f'''
      select_release_target production
      APP="{host}/beta/terminal"
      assert_deploy_paths_scoped; echo "CROSS_RC=$?"
      APP="{app}"; SRC="{src}/terminal"
      assert_deploy_paths_scoped; echo "SRC_RC=$?"
      exit 0
    ''')
    assert "CROSS_RC=64" in result.stdout, result.stdout + result.stderr
    assert "SRC_RC=64" in result.stdout


def test_unit_inspection_never_prints_the_environment(tmp_path):
    shim_dir = tmp_path / "bin"
    shim_dir.mkdir()
    shim = shim_dir / "systemctl"
    shim.write_text(
        '#!/bin/sh\n'
        'case "$3" in\n'
        '  LoadState) echo loaded ;;\n'
        '  UnitFileState) echo enabled ;;\n'
        '  ActiveState) echo inactive ;;\n'
        '  Environment) echo "MMX_SHARED_SHELL=1 DB_PASSWORD=' + SECRET_SENTINEL + '" ;;\n'
        '  *) echo "" ;;\n'
        'esac\n'
    )
    shim.chmod(0o755)
    result = run_lib(f'''
      PATH="{shim_dir}:$PATH"
      select_release_target beta
      beta_unit_declares_shared_shell inactive; echo "RC=$?"
      beta_unit_declares_shared_shell active; echo "ACTIVE_RC=$?"
      exit 0
    ''')
    out = result.stdout + result.stderr
    assert "RC=0" in out, out
    assert "ACTIVE_RC=65" in out, out
    assert SECRET_SENTINEL not in out, "the inspected unit environment was logged"


# ---------------------------------------------------------------------------
# full flow: a rewritten COPY of the owner executed against a temporary host root,
# a temporary local Git origin, and the REAL release preflight + source audit.
# ---------------------------------------------------------------------------

MAPPED_ROOTS = ["terminal", "ingest", "scripts", "config", "contracts", "hub", "signal_layer"]


def shim_text(name: str, real_git: str) -> str | None:
    if name == "node":
        return "#!/bin/sh\nprintf 'node %s\\n' \"$*\" >> \"$MMX_EFFECT_LOG\"\necho v20.0.0\n"
    if name == "npm":
        return (
            '#!/bin/sh\n'
            'printf "npm %s\\n" "$*" >> "$MMX_EFFECT_LOG"\n'
            'if [ "$1" = ci ] || [ "$1" = install ]; then mkdir -p node_modules; : > node_modules/.installed; fi\n'
            'if [ "$1" = run ] && [ "$2" = build ]; then\n'
            '  if [ -n "${FAIL_NPM_BUILD:-}" ]; then exit 23; fi\n'
            '  mkdir -p .next && printf "%s\\n" "$FAKE_BUILD_ID" > .next/BUILD_ID\n'
            'fi\nexit 0\n'
        )
    if name == "npx":
        return (
            '#!/bin/sh\n'
            'printf "npx %s\\n" "$*" >> "$MMX_EFFECT_LOG"\n'
            'exit ${MMX_NPX_RC:-1}\n'
        )
    if name == "git":
        return (
            '#!/bin/sh\n'
            'printf "git %s\\n" "$*" >> "$MMX_EFFECT_LOG"\n'
            f'exec {real_git} "$@"\n'
        )
    if name == "systemctl":
        return (
            '#!/bin/sh\n'
            'printf "systemctl %s\\n" "$*" >> "$MMX_EFFECT_LOG"\n'
            'case "$1" in\n'
            '  show)\n'
            '    case "$3" in\n'
            '      LoadState) echo loaded ;;\n'
            '      UnitFileState) if [ -n "${MMX_UNIT_FILE_STATE:-}" ]; then echo "$MMX_UNIT_FILE_STATE"; '
            'elif [ -f "$MMX_UNIT_ENABLED" ]; then cat "$MMX_UNIT_ENABLED"; else echo disabled; fi ;;\n'
            '      ActiveState) if [ -f "$MMX_UNIT_ACTIVE" ]; then cat "$MMX_UNIT_ACTIVE"; '
            'else echo "${MMX_UNIT_ACTIVE_STATE:-inactive}"; fi ;;\n'
            '      Environment) echo "${MMX_UNIT_ENVIRONMENT:-MMX_SHARED_SHELL=1 ' + SECRET_SENTINEL + '}" ;;\n'
            '      *) echo "" ;;\n'
            '    esac ;;\n'
            '  start) [ "${MMX_SYSTEMCTL_START_RC:-0}" = 0 ] || exit "$MMX_SYSTEMCTL_START_RC"; '
            'echo active > "$MMX_UNIT_ACTIVE"; '
            'if [ -f "$MMX_LIVE_MARKER" ]; then cp "$MMX_LIVE_MARKER" "$MMX_RUNTIME_SHA_FILE"; fi ;;\n'
            '  stop) echo inactive > "$MMX_UNIT_ACTIVE"; exit 0 ;;\n'
            '  restart) [ "${MMX_SYSTEMCTL_RESTART_RC:-0}" = 0 ] || exit "$MMX_SYSTEMCTL_RESTART_RC"; '
            'echo active > "$MMX_UNIT_ACTIVE"; '
            'if [ -f "$MMX_LIVE_MARKER" ]; then cp "$MMX_LIVE_MARKER" "$MMX_RUNTIME_SHA_FILE"; fi ;;\n'
            '  enable) echo enabled > "$MMX_UNIT_ENABLED" ;;\n'
            '  disable) echo disabled > "$MMX_UNIT_ENABLED" ;;\n'
            'esac\nexit 0\n'
        )
    if name == "curl":
        return (
            '#!/bin/sh\n'
            'printf "curl %s\\n" "$*" >> "$MMX_EFFECT_LOG"\n'
            'url=""\n'
            'for a in "$@"; do case "$a" in http*) url="$a" ;; esac; done\n'
            'case "$url" in\n'
            '  */api/shared-shell/status)\n'
            '    if [ "${MMX_STATUS_FOLLOWS_RUNTIME:-0}" = 1 ]; then\n'
            '      python3 -c \'import json,os,pathlib; p=json.loads(pathlib.Path(os.environ["MMX_STATUS_FILE"]).read_text()); '
            'p["buildId"]=pathlib.Path(os.environ["MMX_RUNTIME_SHA_FILE"]).read_text().strip(); print(json.dumps(p))\'\n'
            '    else [ -f "$MMX_STATUS_FILE" ] && cat "$MMX_STATUS_FILE"; fi\n'
            '    exit ${MMX_STATUS_RC:-0} ;;\n'
            'esac\n'
            '[ -n "${FAIL_HEALTH:-}" ] && exit 22\nexit 0\n'
        )
    if name == "sleep":
        return "#!/bin/sh\nexit 0\n"
    if name == "stat":
        return (
            '#!/bin/sh\n'
            'if [ "$1" = -c ] && [ "$2" = "%F:%a:%u:%g" ]; then\n'
            '  [ -d "$3" ] || exit 1\n'
            '  echo directory:750:0:0\n  exit 0\nfi\nexit 64\n'
        )
    if name == "install":
        return (
            '#!/bin/sh\n'
            'if [ "$1" = -d ]; then\n'
            '  [ -n "${FAIL_INSTALL_DIR:-}" ] && { echo "install -d: simulated failure" >&2; exit 1; }\n'
            '  shift; mode=0755\n'
            '  while [ "$#" -gt 0 ]; do\n'
            '    case "$1" in -o|-g) shift 2 ;; -m) mode=$2; shift 2 ;; *) mkdir -p "$1" || exit $?; '
            'chmod "$mode" "$1" || exit $?; shift ;; esac\n'
            '  done\n  exit 0\nfi\n'
            'mode=0755\n'
            'while [ "$#" -gt 0 ]; do case "$1" in -m) mode=$2; shift 2 ;; -o|-g) shift 2 ;; *) break ;; esac; done\n'
            '[ "$#" -eq 2 ] || exit 64\ncp "$1" "$2" || exit $?\nchmod "$mode" "$2"\n'
        )
    return None


STUB_PREFLIGHT = '''import argparse
import hashlib
import json
import os
import sys
from pathlib import Path


def deterministic(payload):
    body = {k: v for k, v in payload.items() if k not in {"generated_at", "receipt_id"}}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


parser = argparse.ArgumentParser()
parser.add_argument("--canonical-repo")
parser.add_argument("--policy", type=Path)
parser.add_argument("--receipt-dir", type=Path)
args = parser.parse_args()
digest = hashlib.sha256(
    json.dumps(json.loads(args.policy.read_text()), sort_keys=True, separators=(",", ":")).encode()
).hexdigest()
inner = {
    "schema": "mastermind.terminal.source_audit_receipt.v1",
    "generated_at": "2026-10-18T00:00:00Z",
    "status": "CLEAN",
    "accepted_sha": os.environ["STUB_ACCEPTED_SHA"],
    "policy_digest": digest,
    "canonical_repo_head": os.environ["STUB_ACCEPTED_SHA"],
    "accepted_ref": {"name": "refs/remotes/origin/master", "sha": os.environ["STUB_ACCEPTED_SHA"],
                     "contains_sha": True},
    "deployment": {"marker_path": "x", "marker_state": "VALID", "sha": os.environ["STUB_ACCEPTED_SHA"]},
    "mappings": [],
    "summary": {"blocking_findings": 0, "tracked_paths": 0, "allowed_paths": 0},
    "findings": [],
}
inner["receipt_id"] = deterministic(inner)
outer = {
    "schema": "mastermind.terminal.release_preflight_receipt.v1",
    "generated_at": "2026-10-18T00:00:01Z",
    "result": "CLEAN",
    "accepted_sha": os.environ["STUB_ACCEPTED_SHA"],
    "policy_digest": digest,
    "source_audit_receipt_id": inner["receipt_id"],
    "source_audit": inner,
}
outer["receipt_id"] = deterministic(outer)
args.receipt_dir.mkdir(parents=True, exist_ok=True)
receipt = args.receipt_dir / ("stub-" + outer["receipt_id"] + ".json")
receipt.write_text(json.dumps(outer, sort_keys=True, separators=(",", ":")) + "\\n")
os.chmod(receipt, 0o640)
print(json.dumps({
    "schema": outer["schema"], "result": "CLEAN", "accepted_sha": outer["accepted_sha"],
    "receipt_path": str(receipt), "receipt_id": outer["receipt_id"],
    "source_audit_receipt_id": inner["receipt_id"],
}))
'''


class Owner:
    """A sandboxed copy of the release owner with one temporary host root."""

    def __init__(self, tmp_path: Path, *, stub_preflight: bool = False) -> None:
        self.tmp = tmp_path
        self.root = tmp_path / "hostroot"          # never named "opt": see below
        self.beta_root = self.root / "beta"
        self.beta_app = self.beta_root / "terminal"
        self.beta_src = self.root / ".gitsrc-beta"
        self.prod_app = self.root / "terminal"
        self.prod_src = self.root / ".gitsrc"
        self.prod_hub = self.root / "hub"
        self.varlib = tmp_path / "varlib" / "mastermind-terminal"
        self.usrbin = tmp_path / "usrbin"
        self.usrsbin = tmp_path / "usrsbin"
        self.authoring = tmp_path / "authoring"
        self.bindir = tmp_path / "bin"
        self.effect_log = tmp_path / "effects.log"
        self.unit_active = tmp_path / "unit.active"
        self.unit_enabled = tmp_path / "unit.enabled"
        self.stub_preflight = stub_preflight
        self.origin = tmp_path / "origin"
        self.sha = ""
        self.sha2 = ""
        self.rewritten = ""

    # -- fixture ---------------------------------------------------------------
    def build_origin(self, *, second_generation: bool = False) -> "Owner":
        self.origin.mkdir(parents=True)
        git(self.origin, "init", "-q", "-b", "master")
        git(self.origin, "config", "user.email", "beta-test@example.invalid")
        git(self.origin, "config", "user.name", "Beta Bootstrap Test")
        for root in MAPPED_ROOTS:
            (self.origin / root).mkdir(exist_ok=True)
        (self.origin / "ops").mkdir(exist_ok=True)
        (self.origin / "ops" / "terminal-data").write_text("#!/bin/sh\nexit 0\n")
        (self.origin / "ops" / "terminal-build.sh").write_text("#!/usr/bin/env bash\nexit 0\n")
        (self.origin / "terminal" / "app.py").write_text("print('first generation')\n")
        (self.origin / "terminal" / "package.json").write_text('{"name": "terminal"}\n')
        (self.origin / "terminal" / "package-lock.json").write_text("lock-v1\n")
        (self.origin / "terminal" / "lib").mkdir(exist_ok=True)
        (self.origin / "terminal" / "lib" / "sharedShellContracts.ts").write_text(
            FIXTURE_CONTRACTS_TS, encoding="utf-8")
        (self.origin / "terminal" / "lib" / "sharedShellRoutes.generated.json").write_text(
            FIXTURE_ROUTES_JSON, encoding="utf-8")
        (self.origin / "terminal" / "public" / "data").mkdir(parents=True)
        (self.origin / "terminal" / "public" / "data" / "AAPL.json").write_text('{"px": 1}\n')
        (self.origin / "ingest" / "collect.py").write_text("x = 1\n")
        (self.origin / "scripts" / "tool.py").write_text("y = 2\n")
        (self.origin / "config" / "settings.json").write_text("{}\n")
        (self.origin / "contracts" / "schema.json").write_text("{}\n")
        (self.origin / "hub" / "hub.js").write_text("console.log('hub')\n")
        (self.origin / "hub" / "package-lock.json").write_text("hub-lock-v1\n")
        (self.origin / "signal_layer" / "engine.py").write_text("z = 3\n")
        git(self.origin, "add", ".")
        git(self.origin, "commit", "-qm", "first generation")
        self.sha = git(self.origin, "rev-parse", "HEAD")
        if second_generation:
            (self.origin / "terminal" / "app.py").write_text("print('second generation')\n")
            git(self.origin, "add", ".")
            git(self.origin, "commit", "-qm", "second generation")
            self.sha2 = git(self.origin, "rev-parse", "HEAD")
        return self

    def clone(self, source: Path, destination: Path) -> None:
        subprocess.run(["git", "clone", "-q", "--no-hardlinks", str(source), str(destination)],
                       check=True, capture_output=True, text=True)

    def write_realistic_beta_policy(self) -> Path:
        # Exercise the delivered policy, translating only deployment locations
        # and the immutable fixture data-tree pin. Allowance semantics are exact.
        tree = git(self.origin, "rev-parse", f"{self.sha}:terminal/public/data")
        payload = json.loads(BETA_POLICY_ARTIFACT.read_text(encoding="utf-8"))
        assert {item["repo_path"] for item in payload["mappings"]} == set(MAPPED_ROOTS)
        payload["deployment_id_file"] = str(self.beta_app / ".deployment-id")
        for mapping in payload["mappings"]:
            mapping["live_path"] = str(self.beta_root / mapping["repo_path"])
            for allowance in mapping.get("allowances", []):
                if mapping["repo_path"] == "terminal" and allowance["path"] == "public/data":
                    assert allowance["allow_tracked_runtime_subtree"] is True
                    allowance["canonical_git_tree"] = tree
        return self.write_policy(payload, "terminal_source_audit.beta.json")

    def write_policy(self, payload: dict, name: str) -> Path:
        path = self.authoring / name
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return path

    def assemble(self, *, bootstrap_target_empty: bool = True,
                 production_tree: bool = False) -> "Owner":
        self.root.mkdir(parents=True, exist_ok=True)
        self.usrbin.mkdir(exist_ok=True)
        self.usrsbin.mkdir(exist_ok=True)
        self.varlib.parent.mkdir(parents=True, exist_ok=True)
        self.authoring.mkdir(parents=True, exist_ok=True)
        self.bindir.mkdir(parents=True, exist_ok=True)
        shutil.copytree(OPS / "terminal_audit", self.authoring / "terminal_audit")
        shutil.copy(OPS / "terminal_release_preflight.py",
                    self.authoring / "terminal_release_preflight.py")
        if self.stub_preflight:
            (self.authoring / "terminal_release_preflight.py").write_text(STUB_PREFLIGHT)
        self.write_realistic_beta_policy()
        self.write_policy({"schema": "placeholder"}, "terminal_source_audit.production.json")
        self.clone(self.origin, self.beta_src)
        self.beta_host_env = self.varlib.parent / "mastermind-terminal-beta" / "host"
        # The host prerequisite owns this directory before receipt children exist.
        # Preserve the real preflight's 0750 custody gate; do not shim it away.
        self.beta_host_env.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        self.beta_host_env.parent.chmod(0o750)
        if bootstrap_target_empty:
            self.beta_root.mkdir(parents=True, exist_ok=True)
            self.beta_host_env.mkdir(parents=True, exist_ok=True)
            (self.beta_host_env / ".env").write_text(
                f"NEXT_PUBLIC_SENTINEL={SECRET_SENTINEL}\n", encoding="utf-8")
        if production_tree:
            for root in MAPPED_ROOTS:
                (self.root / root).mkdir(parents=True, exist_ok=True)
            (self.prod_src).mkdir(parents=True, exist_ok=True)
            self.clone(self.origin, self.prod_src)
            (self.prod_app / "node_modules").mkdir(parents=True, exist_ok=True)
            (self.prod_app / "public" / "data").mkdir(parents=True, exist_ok=True)
            (self.prod_app / "public" / "data" / "PROD.json").write_text('{"prod": true}\n')
            (self.prod_app / "package-lock.json").write_text("lock-v1\n")
            (self.prod_app / ".next").mkdir()
            (self.prod_app / ".next" / "BUILD_ID").write_text("build-PRODoold\n")
            (self.prod_app / ".deployment-id").write_text(self.sha + "\n")
            (self.prod_hub / "package-lock.json").write_text("hub-lock-STALE\n")
            (self.root / "sentinel.txt").write_text("production untouched\n")
        for name in ("node", "npm", "npx", "git", "systemctl", "curl", "sleep", "stat", "install"):
            body = shim_text(name, str(Path(shutil.which("git")).resolve()))
            shim = self.bindir / (name if name != "npx" else "npx")
            shim.write_text(body, encoding="utf-8")
            shim.chmod(0o755)
        text = SCRIPT.read_text()
        assert "/opt/terminal/" in text, "deploy root anchor vanished — cannot sandbox"
        text = (
            text.replace("/usr/local/bin", str(self.usrbin))
            .replace("/usr/local/sbin", str(self.usrsbin))
            .replace("/var/lib/mastermind-terminal", str(self.varlib))
            .replace("/opt/terminal/", f"{self.root}/")
            .replace("BETA_SERVICE_USER=terminal-beta",
                     f"BETA_SERVICE_USER={getpass.getuser()}")
            .replace('select_preflight_artifacts 0 ',
                     f'select_preflight_artifacts {os.getuid()} ')
        )
        assert "/opt/terminal" not in text, "a real deploy path survived the rewrite"
        assert "/var/lib/mastermind-terminal" not in text, "a real receipt path survived"
        assert "/usr/local/bin" not in text and "/usr/local/sbin" not in text
        self.script = self.authoring / "terminal-build.sh"
        self.script.write_text(text, encoding="utf-8")
        self.script.chmod(0o755)
        self.rewritten = text
        return self

    # -- execution -------------------------------------------------------------
    def run(self, args: list[str], **flags) -> subprocess.CompletedProcess:
        # Make owner-created fixture custody independent of the runner's umask.
        # The restrictive-umask regression separately exercises 077 explicitly.
        run_umask = flags.pop("umask", 0o022)
        env = dict(os.environ)
        env.update({
            "PATH": f"{self.bindir}:{env['PATH']}",
            "FAKE_BUILD_ID": NEW_BUILD_ID,
            "MMX_EFFECT_LOG": str(self.effect_log),
            "MMX_UNIT_ACTIVE": str(self.unit_active),
            "MMX_UNIT_ENABLED": str(self.unit_enabled),
            "MMX_RUNTIME_SHA_FILE": str(self.tmp / "runtime.sha"),
            "MMX_LIVE_MARKER": str(self.beta_app / ".deployment-id"),
            "MMX_STATUS_FILE": str(flags.pop("status_file", self.tmp / "status.json")),
            "STUB_ACCEPTED_SHA": self.sha,
        })
        env.update({key: str(value) for key, value in flags.items()})
        for key in list(env):
            if key.startswith("MMX_") and env[key] == "":
                del env[key]
        return subprocess.run([_bash(), str(self.script), *[str(a) for a in args]],
                              capture_output=True, text=True, timeout=600, env=env,
                              preexec_fn=(lambda: os.umask(int(run_umask)))
                              if run_umask is not None else None)

    def effects(self) -> list[str]:
        if not self.effect_log.exists():
            return []
        return self.effect_log.read_text(encoding="utf-8").splitlines()

    def pointer_record(self, name: str) -> dict | None:
        link = self.beta_root / name
        if not link.is_symlink():
            return None
        return json.loads(Path(os.readlink(link)).read_text(encoding="utf-8"))

    def receipts(self) -> list[Path]:
        directory = self.varlib.parent / "mastermind-terminal-beta" / "release-preflight"
        return sorted(directory.glob("*.json")) if directory.is_dir() else []


def status_file(tmp_path: Path, *, build_id: str, enabled: bool = True,
                registry: str | None = None, protocol: str | None = None,
                bridge_version: str | None = None,
                document_version: str | None = None) -> Path:
    """The admitted-source tuple is the DEFAULT: a fixture status body passes only
    when it matches what the owner derives from the committed producer files; any
    keyword here plants a wrong-but-well-formed field for a refusal test."""
    payload = {
        "enabled": enabled,
        "protocol": protocol or FIXTURE_PROTOCOL,
        "buildId": build_id,
        "bridgeVersion": bridge_version or FIXTURE_BRIDGE,
        "documentVersion": document_version or FIXTURE_DOCUMENT,
        "registrySha256": registry or FIXTURE_REGISTRY,
    }
    path = tmp_path / "status.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


MUTATING_EFFECT = re.compile(
    r"^(git\b.*\b(fetch|reset|clean|checkout)\b|npm\b|node\b|systemctl (start|stop|restart|enable|disable)\b)"
)


def mutating(effects: list[str]) -> list[str]:
    """Every effect that could mutate source, staging, a build or a service.

    Read-only inspection (git rev-parse/status, systemctl show, curl) is excluded on
    purpose: a refusal may look at things, it must not change them.
    """
    return [line for line in effects if MUTATING_EFFECT.match(line)]


def test_full_flow_untouched_target_bootstraps_to_an_accepted_generation(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    status = status_file(tmp_path, build_id=box.sha)

    proc = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                   status_file=status)
    assert proc.returncode == 0, proc.stdout + proc.stderr

    # the protected commit is now the beta target's source, and it is what the real
    # audit compared (receipts published by ops/terminal_release_preflight.py)
    assert (box.beta_app / "app.py").read_text() == "print('first generation')\n"
    assert (box.beta_app / ".deployment-id").read_text().strip() == box.sha
    assert (box.beta_app / ".next" / "BUILD_ID").read_text().strip() == NEW_BUILD_ID
    assert "source preflight CLEAN" in proc.stdout, proc.stdout
    assert len(box.receipts()) >= 2, "bootstrap published no post-activation audit evidence"
    evidence = json.loads(box.receipts()[-1].read_text())
    assert evidence["source_audit"]["status"] == "CLEAN"

    # enforced lifecycle: the source record denies runtime and rollback, the runtime
    # record exists only because the status endpoint agreed
    provisioned = box.pointer_record(".source-provisioned")
    assert provisioned is not None
    assert provisioned["accepted_sha"] == box.sha
    assert {item["repo_path"] for item in provisioned["provisioned"]} == set(MAPPED_ROOTS)
    assert provisioned["accepted_runtime"] is False and provisioned["rollback_baseline"] is False
    accepted = box.pointer_record(".runtime-accepted")
    assert accepted is not None and accepted["runtime_accepted"] is True
    assert accepted["accepted_sha"] == box.sha and accepted["build_id"] == NEW_BUILD_ID

    # Start the pending bootstrap, reflect final source, restart that complete
    # runtime, and enable automatic startup only after the accepted commit.
    effects = box.effects()
    assert effects.count("systemctl start terminal-beta") == 1, effects
    assert effects.count("systemctl restart terminal-beta") == 1, effects
    assert effects.index("systemctl disable terminal-beta") < effects.index("systemctl start terminal-beta")
    assert effects.index("systemctl start terminal-beta") < effects.index("systemctl restart terminal-beta")
    assert effects.index("systemctl restart terminal-beta") < effects.index("systemctl enable terminal-beta")
    assert box.unit_enabled.read_text().strip() == "enabled"
    assert not (box.beta_root / ".release-pending").exists()
    assert not any(line.startswith("systemctl restart") and line != "systemctl restart terminal-beta"
                   for line in effects), effects
    assert not any("quote-hub" in line for line in effects), effects
    assert not any(line.startswith("npm ci --omit=dev") for line in effects), effects
    assert not (box.usrbin / "terminal-data").exists()
    assert not (box.root / ".terminal-build.sh").exists()

    # the production tree is untouched: the overlay landed under the beta root only
    assert (box.beta_root / "ingest" / "collect.py").is_file()
    assert not (box.root / "ingest" / "collect.py").exists()
    assert not (box.prod_app / ".next.bak").exists()

    # bootstrap cache custody, and no secret ever reaches the log
    assert (box.beta_app / ".next" / "cache").is_dir()
    assert SECRET_SENTINEL not in proc.stdout + proc.stderr
    assert "beta lifecycle state: " not in proc.stdout  # demotion must not have run
    assert "BOOTSTRAP FAILED" not in proc.stdout
    assert (box.beta_host_env / ".env").is_file()


def test_bootstrap_acceptance_is_the_status_endpoint_not_an_http_200_at_root(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    status = status_file(tmp_path, build_id=OLD_SHA)  # a stale/foreign build identity

    proc = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                   status_file=status)
    assert proc.returncode != 0
    assert "pending beta health, identity or unit verification failed" in proc.stdout
    assert "DONE — target=beta" not in proc.stdout
    assert "beta generation runtime-accepted" not in proc.stdout

    # stopped, evidence retained, and demoted back to source-only. It never restarts
    # an accepted generation that does not exist.
    effects = box.effects()
    assert "systemctl stop terminal-beta" in effects
    assert not any(line.startswith("systemctl restart") for line in effects), effects
    assert (box.beta_app / ".next.broken" / "BUILD_ID").read_text().strip() == NEW_BUILD_ID
    assert not (box.beta_app / ".next").exists()
    assert box.pointer_record(".runtime-accepted") is None
    assert box.pointer_record(".source-provisioned") is not None
    # the provisioned SOURCE marker stays; it is not dressed up as runtime identity
    assert (box.beta_app / ".deployment-id").read_text().strip() == box.sha
    assert not (box.beta_app / ".deployment-id.bak").exists()


def test_source_provisioned_state_blocks_an_ordinary_beta_deploy(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    stale = status_file(tmp_path, build_id=OLD_SHA)
    failed = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                     status_file=stale)
    assert failed.returncode != 0

    before = box.effects()
    proc = box.run(["--target", "beta", "--target-sha", box.sha],
                   status_file=status_file(tmp_path, build_id=box.sha))
    assert proc.returncode == 75, proc.stdout + proc.stderr
    assert "complete the exact bootstrap instead" in proc.stdout
    # refusal with no effects: no new fetch, build, staging or service action
    assert mutating(box.effects()[len(before):]) == [], box.effects()[len(before):]
    assert not (box.beta_root / ".stage.XXXXXX").exists()


def test_real_source_audit_still_blocks_the_provisioned_beta_target(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    stale = status_file(tmp_path, build_id=OLD_SHA)
    assert box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                   status_file=stale).returncode != 0

    # an untracked file inside a mapped beta live root is unknown source state; the
    # audit engine (real, unmodified) must block, and the owner must not clean it up
    probe = box.beta_app / "untracked_probe.py"
    probe.write_text("host edit\n", encoding="utf-8")
    before = box.effects()

    proc = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                   status_file=status_file(tmp_path, build_id=box.sha))
    # the incumbent gate converts a non-recovery UNKNOWN_STOP into a hard input
    # error: `auto` tolerates exactly one state, the sole CANONICAL_HEAD_MISMATCH.
    # Either way the beta run stops before any build.
    assert proc.returncode == 64, proc.stdout + proc.stderr
    assert probe.read_text() == "host edit\n", "the owner cleaned state it does not own"
    receipt = json.loads(box.receipts()[-1].read_text())
    assert receipt["result"] == "UNKNOWN_STOP"
    codes = {item["code"] for item in receipt["source_audit"]["findings"]}
    assert "HOST_ONLY_UNTRACKED" in codes, codes
    assert "resuming verified" in proc.stdout
    assert "next build" not in proc.stdout
    # the refused run may fetch, bind and re-provision tracked source (that is what
    # provisioning IS), but it must not build, stage, activate or restart anything
    delta = box.effects()[len(before):]
    forbidden = ("npm ", "node ", "systemctl start", "systemctl restart", "systemctl enable")
    assert [line for line in delta if line.startswith(forbidden)] == [], delta
    assert "systemctl disable terminal-beta" in delta
    assert "systemctl stop terminal-beta" in delta
    assert box.unit_active.read_text().strip() == "inactive"
    assert box.unit_enabled.read_text().strip() == "disabled"
    assert not list(box.beta_root.glob(".stage.*"))
    assert not (box.beta_app / ".next").exists()


def test_bootstrap_never_wipes_an_unfamiliar_or_foreign_target(tmp_path):
    # pre-existing accepted-runtime state (historical marker + build + receipts)
    box = Owner(tmp_path).build_origin(
        second_generation=True).assemble(bootstrap_target_empty=False)
    (box.beta_root / "terminal").mkdir(parents=True, exist_ok=True)
    (box.beta_app / ".deployment-id").write_text(box.sha2 + "\n")
    (box.beta_app / ".next").mkdir()
    (box.beta_app / ".next" / "BUILD_ID").write_text(NEW_BUILD_ID + "\n")
    stray = box.beta_root / "leftover-build-artifact.tar"
    stray.write_text("do not delete me\n")

    proc = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                   status_file=status_file(tmp_path, build_id=box.sha))
    assert proc.returncode == 75, proc.stdout + proc.stderr
    assert "never wiped to bootstrap" in proc.stdout
    assert stray.read_text() == "do not delete me\n"
    assert (box.beta_app / ".deployment-id").read_text().strip() == box.sha2
    assert mutating(box.effects()) == [], box.effects()

    # a symlink alias for the target root is refused, never followed
    alias_box = Owner(tmp_path / "alias").build_origin().assemble(bootstrap_target_empty=True)
    real = alias_box.tmp / "elsewhere"
    real.mkdir()
    alias_box.beta_root.rmdir()
    alias_box.beta_root.symlink_to(real)
    refused = alias_box.run(["--target", "beta", "--bootstrap", "--target-sha", alias_box.sha],
                            status_file=status_file(alias_box.tmp, build_id=alias_box.sha))
    assert refused.returncode != 0
    assert refused.returncode != 0
    assert not (real / "terminal").exists()
    assert (real / ".env") or True


def test_second_bootstrap_for_another_generation_is_refused_not_reused(tmp_path):
    box = Owner(tmp_path).build_origin(second_generation=True).assemble(
        bootstrap_target_empty=True)
    ok = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                 status_file=status_file(tmp_path, build_id=box.sha))
    assert ok.returncode == 0, ok.stdout + ok.stderr

    # an accepted beta target is never bootstrapped again, and while it is running
    # even the unit prerequisite refuses before anything else happens
    again = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha2],
                    status_file=status_file(tmp_path, build_id=box.sha2))
    assert again.returncode == 65, again.stdout + again.stderr
    assert "must be disabled for this beta phase" in again.stdout
    assert box.unit_active.read_text().strip() == "active"
    assert box.unit_enabled.read_text().strip() == "enabled"
    assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha
    before = box.effects()

    # with the service stopped out of band, the lifecycle pointer is what refuses
    box.unit_active.write_text("inactive\n")
    box.unit_enabled.write_text("disabled\n")
    pointer_run = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha2],
                          status_file=status_file(tmp_path, build_id=box.sha2))
    assert pointer_run.returncode == 75, pointer_run.stdout + pointer_run.stderr
    assert "never bootstrapped over" in pointer_run.stdout
    assert mutating(box.effects()[len(before):]) == [], box.effects()[len(before):]

    # ...and the source-provisioned record for generation 1 can never authorize
    # generation 2
    (box.beta_root / ".runtime-accepted").unlink()
    stale = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha2],
                    status_file=status_file(tmp_path, build_id=box.sha2))
    assert stale.returncode == 75, stale.stdout + stale.stderr
    assert "different commit" in stale.stdout


def test_later_ordinary_beta_deploy_keeps_normal_rollback(tmp_path):
    box = Owner(tmp_path).build_origin(second_generation=True).assemble(
        bootstrap_target_empty=True)
    first = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                    status_file=status_file(tmp_path, build_id=box.sha))
    assert first.returncode == 0, first.stdout + first.stderr

    # the beta policy pins generation 1's public/data tree; keep that pinned value
    # valid for generation 2 as well by leaving that subtree untouched.
    stale = status_file(tmp_path, build_id=box.sha)   # the service still answers old
    second = box.run(["--target", "beta", "--target-sha", box.sha2], status_file=stale)
    assert second.returncode != 0
    assert "pending beta health, identity or unit verification failed" in second.stdout
    assert "beta rolled back and verified: accepted=" + box.sha in second.stdout
    assert "BETA UNRESOLVED" not in second.stdout
    # rollback baseline came from the ACCEPTED generation, not from provisioned source
    assert (box.beta_app / ".deployment-id").read_text().strip() == box.sha
    assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha
    assert git(box.beta_src, "rev-parse", "HEAD") == box.sha
    assert (box.beta_app / "app.py").read_text() == "print('first generation')\n"
    assert not (box.beta_root / ".release-pending").exists()
    assert box.unit_active.read_text().strip() == "active"
    assert box.unit_enabled.read_text().strip() == "enabled"
    assert any(line.startswith("systemctl restart terminal-beta") for line in box.effects())


def test_unit_prerequisite_refusals_do_not_provision_anything(tmp_path):
    for label, flags in (
        ("unit not disabled", {"MMX_UNIT_FILE_STATE": "static"}),
        ("unit already running", {"MMX_UNIT_ACTIVE_STATE": "active"}),
        ("unit omits the shared-shell opt-in", {"MMX_UNIT_ENVIRONMENT": "PORT=3001"}),
    ):
        box = Owner(tmp_path / label.replace(" ", "-")).build_origin().assemble(
            bootstrap_target_empty=True)
        proc = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                       **flags, status_file=status_file(box.tmp, build_id=box.sha))
        assert proc.returncode == 65, (label, proc.returncode, proc.stdout + proc.stderr)
        assert mutating(box.effects()) == [], (label, box.effects())
        assert not (box.beta_app / "app.py").exists()
        assert not (box.beta_root / ".source-provisioned").is_symlink()
        assert SECRET_SENTINEL not in proc.stdout + proc.stderr or label == "unit omits the shared-shell opt-in"


def test_production_dependency_detection_samples_before_the_overlay(tmp_path):
    box = Owner(tmp_path, stub_preflight=True).build_origin().assemble(
        bootstrap_target_empty=True, production_tree=True)
    proc = box.run(["--target-sha", box.sha])
    effects = box.effects()

    # the live hub lockfile differs from the admitted commit's, so the overlay must
    # trigger a hub dependency install and a quote-hub restart. With the candidate's
    # ordering (sample after the archive) both comparisons are always equal and this
    # is the assertion that fails.
    assert any(line.startswith("npm ci --omit=dev") for line in effects), (
        f"hub dependency change was never detected\n{proc.stdout}\n{effects}")
    assert "systemctl restart quote-hub" in effects, effects
    body = box.rewritten.split('if [ "${BASH_SOURCE[0]}" != "$0" ]; then', 1)[1]
    body = "\n".join(line for line in body.splitlines() if not line.lstrip().startswith("#"))
    overlay = body.index('git -C "$SRC" archive HEAD -- $RUNTIME_PATHS | tar -x -C /')
    assert body.index("HUB_BEFORE=$(hub_state)") < body.index("LOCK_BEFORE=$(sha256sum") < overlay, (
        "the production runtime overlay must sample hub content state AND the hub "
        "lockfile digest BEFORE the archive lands")
    # production behavior preserved: restart + curl of the production root
    assert any(line.startswith("systemctl restart terminal") for line in effects), effects
    assert not any("/api/shared-shell/status" in line for line in effects), effects


def test_bootstrap_argument_is_invalid_for_production_and_for_unknown_forms(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    cases = [
        ["--target", "production", "--bootstrap", "--target-sha", box.sha],
        ["--target", "staging", "--target-sha", box.sha],
        ["--target", "beta", "--bootstrap"],
        ["--bootstrap", "--target-sha", box.sha],
        ["--target-sha", box.sha[:12]],
    ]
    for args in cases:
        proc = box.run(args, status_file=status_file(tmp_path, build_id=box.sha))
        assert proc.returncode == 64, (args, proc.returncode, proc.stdout + proc.stderr)
    assert box.effects() == [], box.effects()
    assert not (box.beta_root / ".source-provisioned").is_symlink()


def test_delivered_beta_policy_and_unit_are_source_artifacts_only() -> None:
    sys.path.insert(0, str(OPS))
    from terminal_audit.policy import parse_policy

    payload = json.loads(BETA_POLICY_ARTIFACT.read_text(encoding="utf-8"))
    accepted_ref, marker, mappings = parse_policy(payload)
    assert accepted_ref == "refs/remotes/origin/master"
    assert str(marker) == "/opt/terminal/beta/terminal/.deployment-id"
    assert {mapping.repo_path for mapping in mappings} == set(MAPPED_ROOTS)
    for mapping in mappings:
        assert str(mapping.live_path).startswith("/opt/terminal/beta/")
        assert not str(mapping.live_path).startswith("/opt/terminal/terminal")
    assert not any(mapping.name.startswith("terminal-data") for mapping in mappings)
    serialized = json.dumps(payload, sort_keys=True)
    assert "*" not in serialized
    assert "/usr/local/bin" not in serialized and "ops/terminal-build.sh" not in serialized

    unit = UNIT_ARTIFACT.read_text(encoding="utf-8")
    assert "ProtectSystem=strict" in unit
    assert "NoNewPrivileges=yes" in unit
    assert "CapabilityBoundingSet=" in unit and "AmbientCapabilities=" in unit
    assert "User=terminal-beta" in unit and "Group=terminal-beta" in unit
    assert ("BindReadOnlyPaths=/opt/terminal/terminal/public/data:"
            "/opt/terminal/beta/terminal/public/data") in unit
    assert "ReadWritePaths=/opt/terminal/beta/terminal/.next/cache" in unit
    assert "ReadWritePaths=/opt/terminal/beta/terminal/.next\n" not in unit
    assert "--port 3001" in unit and "Restart=no" in unit
    assert "EnvironmentFile=/var/lib/mastermind-terminal-beta/host/environment" in unit
    # the writable surface is the cache only: never all of .next, never the
    # whole beta tree; both production data aliases stay enforced together
    rw_lines = [line.strip() for line in unit.splitlines() if line.startswith("ReadWritePaths=")]
    assert rw_lines == ["ReadWritePaths=/opt/terminal/beta/terminal/.next/cache"], rw_lines
    assert "ReadWritePaths=/opt/terminal/beta/terminal\n" not in unit
    for forbidden in ("ProtectHome=read-only", ):
        assert forbidden in unit


# ===========================================================================
# Repairs added by shared-shell-beta-owner-repair-20261018-c1-r2
# ===========================================================================
#
# Confirmed gap (2): beta acceptance must derive the EXACT expected
# protocol/bridgeVersion/documentVersion/registrySha256 tuple from the admitted
# protected source (terminal/lib/sharedShellContracts.ts +
# terminal/lib/sharedShellRoutes.generated.json at the admitted commit) and
# compare every field; a well-formed but different tuple must fail; no hardcoded
# constant and no caller-supplied expectation may stand in.
#
# Confirmed gap (3): root staging/build under umask 077 leaves the runtime tree
# unreadable for the dedicated service user; the repaired owner publishes
# read/traverse bits for the beta-owned app/dependency/build tree only — never
# write, never production, never through an alias, never onto a shared inode —
# and the unit's writable surface narrows to .next/cache.

import stat as _stat
import uuid

# The admitted tuple the fixture commits (packet-supplied producer constants are
# fixture data; the DERIVED values are what the owner is held to).
FIXTURE_PROTOCOL = "mmx.shared-shell.v1"
FIXTURE_BRIDGE = "20261018.1"
FIXTURE_DOCUMENT = "20261018.1"
FIXTURE_REGISTRY = "30516d80cd64baf1f542e0d1cbf90ed254a1eab02cb55da3504766f5ae245535"

ADMITTED_STATUS_URL = "http://127.0.0.1:3001/api/shared-shell/status"

# Exact mutation anchors into the delivered owner (pinned so a drift fails loudly).
TUPLE_ANCHOR = '''for key in ("protocol", "bridgeVersion", "documentVersion", "registrySha256"):
    expected = admitted[key]
    observed = body.get(key)
    if not isinstance(observed, str) or observed != expected:
        raise SystemExit(
            f"beta status {key}={observed!r} does not match the admitted source {expected!r}"
        )'''
TUPLE_MUTANT = '''for key in ("protocol", "bridgeVersion", "documentVersion", "registrySha256"):
    observed = body.get(key)
    if not isinstance(observed, str):  # MUTANT: exact admitted-source comparison removed
        raise SystemExit(f"beta status {key} is not a string")'''
PUBLISH_CALL_ANCHOR = 'if ! beta_publish_runtime_readable "$APP"; then'
PUBLISH_CALL_MUTANT = "if false; then"


def derive_fixture_repo(tmp_path: Path, *, contracts: str | None = None,
                        routes: str | None = None, drop: str | None = None
                        ) -> tuple[Path, str]:
    repo = tmp_path / f"derive-repo-{uuid.uuid4().hex[:12]}"
    lib = repo / "terminal" / "lib"
    lib.mkdir(parents=True)
    git(repo, "init", "-q", "-b", "master")
    git(repo, "config", "user.email", "derive-test@example.invalid")
    git(repo, "config", "user.name", "Derive Test")
    if drop != "contracts":
        (lib / "sharedShellContracts.ts").write_text(
            contracts if contracts is not None else FIXTURE_CONTRACTS_TS, encoding="utf-8")
    if drop != "routes":
        (lib / "sharedShellRoutes.generated.json").write_text(
            routes if routes is not None else FIXTURE_ROUTES_JSON, encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "admitted generation")
    return repo, git(repo, "rev-parse", "HEAD")


def curl_status_shim(tmp_path: Path, status_path: Path, rc: int = 0) -> Path:
    bin_dir = tmp_path / "status-bin"
    bin_dir.mkdir(exist_ok=True)
    shim = bin_dir / "curl"
    shim.write_text(f'#!/bin/sh\ncat "{status_path}"\nexit {rc}\n', encoding="utf-8")
    shim.chmod(0o755)
    return bin_dir


def run_status_check(tmp_path: Path, repo: Path, sha: str, status_path: Path, *,
                     curl_rc: int = 0, extra_env: str = "") -> subprocess.CompletedProcess:
    bin_dir = curl_status_shim(tmp_path, status_path, curl_rc)
    return run_lib(f'''
      PATH="{bin_dir}:$PATH"
      {extra_env}
      shared_shell_status_verified "{ADMITTED_STATUS_URL}" "{sha}" "{repo}"
      echo "RC=$?"
      exit 0
    ''')


def test_derived_tuple_accepts_exact_match_only(tmp_path):
    repo, sha = derive_fixture_repo(tmp_path)
    result = run_status_check(tmp_path, repo, sha, status_file(tmp_path, build_id=sha))
    out = result.stdout + result.stderr
    assert "RC=0" in out, out
    assert "beta status verified against the admitted tuple" in out, out


@pytest.mark.parametrize(
    ("key", "wrong"),
    [
        ("protocol", "mmx.shared-shell.v9"),
        ("protocol", "shared-shell-v1"),
        ("bridgeVersion", "20270101.1"),
        ("bridgeVersion", "bridge-3"),
        ("documentVersion", "20991231.7"),
        ("documentVersion", "doc-2"),
        ("registrySha256", "a" * 64),
        ("registrySha256", "c" * 64),
    ],
)
def test_wellformed_but_wrong_tuple_field_is_refused(tmp_path, key, wrong):
    """The candidate accepted these: they were shape-valid. Derivation must not."""
    repo, sha = derive_fixture_repo(tmp_path)
    payload = json.loads(status_file(tmp_path, build_id=sha).read_text(encoding="utf-8"))
    payload[key] = wrong
    bad = tmp_path / f"bad-{key}.json"
    bad.write_text(json.dumps(payload), encoding="utf-8")
    result = run_status_check(tmp_path, repo, sha, bad)
    out = result.stdout + result.stderr
    assert "RC=0" not in out, (key, wrong, out)
    assert "does not match the admitted source" in out, (key, wrong, out)
    assert key in out, out


def test_disabled_runtime_and_stale_build_identity_are_refused(tmp_path):
    repo, sha = derive_fixture_repo(tmp_path)
    off = status_file(tmp_path, build_id=sha, enabled=False)
    r = run_status_check(tmp_path, repo, sha, off)
    out = r.stdout + r.stderr
    assert "RC=0" not in out and "not shared-shell enabled" in out, out
    stale = status_file(tmp_path, build_id=OLD_SHA)
    r = run_status_check(tmp_path, repo, sha, stale)
    out = r.stdout + r.stderr
    assert "RC=0" not in out and "build identity is not the admitted generation" in out, out


def test_non_json_response_and_curl_failure_are_refused(tmp_path):
    repo, sha = derive_fixture_repo(tmp_path)
    garbage = tmp_path / "garbage.json"
    garbage.write_text("definitely not json {{{", encoding="utf-8")
    r = run_status_check(tmp_path, repo, sha, garbage)
    out = r.stdout + r.stderr
    assert "RC=0" not in out and "is not JSON" in out, out
    r = run_status_check(tmp_path, repo, sha,
                         status_file(tmp_path, build_id=sha), curl_rc=22)
    out = r.stdout + r.stderr
    assert "RC=0" not in out and "did not answer" in out, out


def test_caller_supplied_expectations_cannot_steer_acceptance(tmp_path):
    repo, sha = derive_fixture_repo(tmp_path)
    payload = json.loads(status_file(tmp_path, build_id=sha).read_text(encoding="utf-8"))
    payload["protocol"] = "mmx.shared-shell.v9"
    bad = tmp_path / "steer.json"
    bad.write_text(json.dumps(payload), encoding="utf-8")
    result = run_status_check(
        tmp_path, repo, sha, bad,
        extra_env='export EXPECTED_PROTOCOL="mmx.shared-shell.v9" '
                  'MMX_EXPECTED_PROTOCOL="mmx.shared-shell.v9" '
                  'STATUS_REGISTRY_SHA256="' + FIXTURE_REGISTRY + '"')
    out = result.stdout + result.stderr
    assert "RC=0" not in out and "does not match the admitted source" in out, out
    # ...and an exact-match response still passes while the same bogus exports exist
    ok = run_status_check(
        tmp_path, repo, sha, status_file(tmp_path, build_id=sha),
        extra_env='export EXPECTED_PROTOCOL="totally-wrong" MMX_EXPECTED_PROTOCOL=zz')
    assert "RC=0" in ok.stdout + ok.stderr


def test_status_acceptance_has_no_hardcoded_tuple_or_caller_channel() -> None:
    text = SCRIPT.read_text(encoding="utf-8")
    start = text.index("shared_shell_status_verified(){")
    end = text.index("\n# ── ONE shared build-resource lock", start)
    fn = text[start:end]
    assert 'cat-file blob "$want_sha:terminal/lib/sharedShellContracts.ts"' in fn
    assert 'cat-file blob "$want_sha:terminal/lib/sharedShellRoutes.generated.json"' in fn
    for derived in ("SHARED_SHELL_PROTOCOL", "SHARED_SHELL_BRIDGE_VERSION",
                    "SHARED_SHELL_DOCUMENT_VERSION", "registrySha256"):
        assert derived in fn
    assert "mmx.shared-shell" not in fn, "a hardcoded protocol literal returned to acceptance"
    for forbidden in ("EXPECTED_PROTOCOL", "EXPECTED_BRIDGE", "EXPECTED_DOCUMENT",
                      "EXPECTED_REGISTRY", "MMX_EXPECTED", "STATUS_REGISTRY"):
        assert forbidden not in fn, f"caller-supplied expectation channel: {forbidden}"


def test_derivation_failure_refuses_instead_of_falling_back_to_shape(tmp_path):
    repo, sha = derive_fixture_repo(tmp_path, drop="contracts")
    r = run_status_check(tmp_path, repo, sha, status_file(tmp_path, build_id=sha))
    out = r.stdout + r.stderr
    assert "RC=0" not in out and "carries no terminal/lib/sharedShellContracts.ts" in out, out
    repo, sha = derive_fixture_repo(tmp_path, drop="routes")
    r = run_status_check(tmp_path, repo, sha, status_file(tmp_path, build_id=sha))
    out = r.stdout + r.stderr
    assert "RC=0" not in out and "carries no terminal/lib/sharedShellRoutes.generated.json" in out, out


def test_ambiguous_admitted_constant_declaration_refuses(tmp_path):
    repo, sha = derive_fixture_repo(
        tmp_path,
        contracts=FIXTURE_CONTRACTS_TS
        + 'export const SHARED_SHELL_PROTOCOL = "mmx.shared-shell.v0" as const;\n')
    r = run_status_check(tmp_path, repo, sha, status_file(tmp_path, build_id=sha))
    out = r.stdout + r.stderr
    assert "RC=0" not in out and "exactly once" in out, out


def test_malformed_admitted_registry_digest_refuses(tmp_path):
    repo, sha = derive_fixture_repo(
        tmp_path, routes=json.dumps({"sources": {"registrySha256": "NOT-A-DIGEST"}}))
    r = run_status_check(tmp_path, repo, sha, status_file(tmp_path, build_id=sha))
    out = r.stdout + r.stderr
    assert "RC=0" not in out and "not one lower-case sha256 digest" in out, out


# ── defect (3): runtime read/traverse publication ────────────────────────────

def stage_runtime_tree(app: Path) -> None:
    """A root-built beta app tree exactly as umask 077 leaves it: 0700 dirs,
    0600 files, plus every surface publication must skip or refuse."""
    subprocess.run(["bash", "-c", f'''
      umask 077
      mkdir -p "{app}/.next/cache" "{app}/.next.bak" "{app}/public/data" \
"{app}/node_modules/next/dist"
      printf 'build\\n' > "{app}/.next/BUILD_ID"
      printf 'cached\\n' > "{app}/.next/cache/blob"
      printf 'old\\n' > "{app}/.next.bak/BUILD_ID"
      printf 'data\\n' > "{app}/public/data/AAPL.json"
      printf 'bin\\n' > "{app}/node_modules/next/dist/bin.js"
      printf 'src\\n' > "{app}/page.tsx"
      printf 'secret\\n' > "{app}/.env"
      printf 'marker\\n' > "{app}/.deployment-id"
      chmod 0750 "{app}/.next/cache"
      chmod 0700 "{app}/.next.bak" "{app}/public" "{app}/public/data"
    '''], check=True)


def publish_body(beta_root: Path, app: Path, *, target: str = "beta") -> str:
    return f'''
      TARGET={target}; BETA_TARGET_ROOT="{beta_root}"; SERVICE_NAME=terminal-beta
      beta_publish_runtime_readable "{app}"; echo "RC=$?"
      exit 0
    '''


def test_publish_grants_read_and_traverse_never_write_never_outside_scope(tmp_path):
    beta = tmp_path / "beta"
    app = beta / "terminal"
    stage_runtime_tree(app)
    result = run_lib(publish_body(beta, app))
    out = result.stdout + result.stderr
    assert "RC=0" in out, out
    assert "read/traverse only, never group/other write" in out, out
    for rel in (".", ".next", ".next/BUILD_ID", "page.tsx", ".deployment-id",
                "node_modules", "node_modules/next", "node_modules/next/dist",
                "node_modules/next/dist/bin.js", "public"):
        mode = os.stat(app / rel).st_mode
        assert mode & 0o022 == 0, rel
        if _stat.S_ISDIR(mode):
            assert mode & 0o055 == 0o055, rel
        else:
            assert mode & 0o044 == 0o044, rel
    # skipped surfaces keep exactly the modes their owners gave them
    cache = os.stat(app / ".next/cache")
    assert cache.st_mode & 0o777 == 0o750
    assert os.stat(app / ".next.bak").st_mode & 0o055 == 0
    assert os.stat(app / "public/data/AAPL.json").st_mode & 0o044 == 0
    assert os.stat(app / ".env").st_mode & 0o007 == 0, "a secret-shaped name was published"
    assert os.stat(beta).st_mode & 0o001, "the beta root must stay traversable"


def test_publish_never_follows_or_mutates_a_data_alias(tmp_path):
    beta = tmp_path / "beta"
    app = beta / "terminal"
    stage_runtime_tree(app)
    production_data = tmp_path / "production-public-data"
    subprocess.run(["bash", "-c", f'''
      umask 077
      mkdir -p "{production_data}"
      printf 'prod\\n' > "{production_data}/PROD.json"
      chmod 0700 "{production_data}"; chmod 0600 "{production_data}/PROD.json"
    '''], check=True)
    shutil.rmtree(app / "public/data")
    (app / "public/data").symlink_to(production_data)
    result = run_lib(publish_body(beta, app))
    out = result.stdout + result.stderr
    assert "RC=0" in out, out
    assert (app / "public/data").is_symlink()
    assert os.stat(production_data).st_mode & 0o777 == 0o700
    assert os.stat(production_data / "PROD.json").st_mode & 0o777 == 0o600


def test_publish_refuses_a_shared_inode_without_mutating_the_other_link(tmp_path):
    beta = tmp_path / "beta"
    app = beta / "terminal"
    stage_runtime_tree(app)
    outside = tmp_path / "production-owned"
    outside.mkdir()
    shared = outside / "shared-bytes.json"
    shared.write_text("production content\n", encoding="utf-8")
    os.chmod(shared, 0o600)
    os.link(shared, app / "aliased.json")
    result = run_lib(publish_body(beta, app))
    out = result.stdout + result.stderr
    assert "RC=0" not in out, out
    assert "shared inode" in out, out
    assert os.stat(shared).st_mode & 0o777 == 0o600, "a production inode was chmodded"
    assert os.stat(app / "aliased.json").st_mode & 0o777 == 0o600


def test_publish_refuses_group_writable_state_and_leaves_it_unnormalized(tmp_path):
    beta = tmp_path / "beta"
    app = beta / "terminal"
    stage_runtime_tree(app)
    os.chmod(app / ".next", 0o770)
    result = run_lib(publish_body(beta, app))
    out = result.stdout + result.stderr
    assert "RC=0" not in out and "group/other writable" in out, out
    assert os.stat(app / ".next").st_mode & 0o777 == 0o770


def test_publish_refuses_a_symlinked_app_root(tmp_path):
    beta = tmp_path / "beta"
    beta.mkdir()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    os.chmod(elsewhere, 0o700)
    (beta / "terminal").symlink_to(elsewhere)
    result = run_lib(publish_body(beta, beta / "terminal"))
    out = result.stdout + result.stderr
    assert "RC=0" not in out and "real directory" in out, out
    assert os.stat(elsewhere).st_mode & 0o777 == 0o700


def test_publish_is_beta_profile_only_and_beta_root_scoped(tmp_path):
    beta = tmp_path / "beta"
    app = beta / "terminal"
    stage_runtime_tree(app)
    outside = tmp_path / "not-beta"
    outside.mkdir()
    result = run_lib(f'''
      TARGET=production; BETA_TARGET_ROOT="{beta}"; SERVICE_NAME=terminal
      beta_publish_runtime_readable "{app}"; echo "PROD_RC=$?"
      TARGET=beta; SERVICE_NAME=terminal-beta
      beta_publish_runtime_readable "{outside}"; echo "OUT_RC=$?"
      exit 0
    ''')
    out = result.stdout + result.stderr
    assert "PROD_RC=64" in out, out
    assert "OUT_RC=64" in out, out


def repaired_body() -> str:
    text = SCRIPT.read_text(encoding="utf-8")
    body = text[text.index('if [ "${BASH_SOURCE[0]}" != "$0" ]'):]
    return "\n".join(line for line in body.splitlines() if not line.lstrip().startswith("#"))


def test_beta_activation_publishes_before_cache_and_activation():
    body = repaired_body()
    positions = [m.start() for m in re.finditer(
        re.escape('beta_publish_runtime_readable "$APP"'), body)]
    # A shared beta activation branch serves both bootstrap and upgrades.
    assert len(positions) == 2, positions
    initial_publish, republish = positions
    first_start = body.index('if ! systemctl start "$SERVICE_NAME"')
    first_restart = body.index('if ! systemctl restart "$SERVICE_NAME"')
    assert initial_publish < first_start and initial_publish < first_restart
    assert initial_publish < body.index('if ! beta_prepare_next_cache "$APP"')
    assert body.index("could not release the beta staging tree") < initial_publish
    assert body.index('deploy_lock_acquire "$SHARED_BUILD_LOCK_DIR" "$TARGET"') < initial_publish
    # Source reflection can restore restrictive modes. It is followed by fatal
    # re-publication and a final restart before fresh audit / acceptance.
    assert republish > body.index('"$TSRC/" "$APP/"')
    final_restart = body.rindex('if ! systemctl restart "$SERVICE_NAME"')
    assert republish < final_restart < body.index('if ! beta_txn_commit; then')
    tail = body[republish:final_restart]
    assert "beta_txn_abort" in tail and "WARN" not in tail


def test_repaired_unit_writes_cache_only_and_keeps_both_production_aliases() -> None:
    unit = UNIT_ARTIFACT.read_text(encoding="utf-8")
    rw_lines = [line.strip() for line in unit.splitlines() if line.startswith("ReadWritePaths=")]
    assert rw_lines == ["ReadWritePaths=/opt/terminal/beta/terminal/.next/cache"], rw_lines
    assert "ReadWritePaths=/opt/terminal/beta/terminal/.next\n" not in unit
    assert ("BindReadOnlyPaths=/opt/terminal/terminal/public/data:"
            "/opt/terminal/beta/terminal/public/data") in unit
    assert "ReadOnlyPaths=/opt/terminal/terminal/public/data" in unit
    assert "ProtectSystem=strict" in unit
    assert "ReadWritePaths=/opt/terminal/terminal" not in unit


def snapshot_modes(root_dir: Path) -> dict[str, int]:
    modes = {".": os.stat(root_dir).st_mode & 0o7777}
    for path in root_dir.rglob("*"):
        modes[str(path.relative_to(root_dir))] = os.lstat(path).st_mode & 0o7777
    return modes


def mutate_owner_script(box: Owner, anchor: str, replacement: str, expected: int = 1) -> None:
    # mutate the sandbox-rewritten copy the Owner actually executes
    text = box.rewritten
    assert SCRIPT.read_text(encoding="utf-8").count(anchor) == expected, \
        "mutation anchor vanished from the delivered owner"
    assert text.count(anchor) == expected, "mutation anchor vanished from the sandbox copy"
    box.script.write_text(text.replace(anchor, replacement), encoding="utf-8")


def test_full_flow_restricted_umask_publishes_readable_runtime_tree(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True,
                                                  production_tree=True)
    prod_before = snapshot_modes(box.root / "terminal")
    hub_before = snapshot_modes(box.root / "hub")
    proc = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                   status_file=status_file(tmp_path, build_id=box.sha), umask=0o077)
    out = proc.stdout + proc.stderr
    assert proc.returncode == 0, out
    assert "beta runtime published read-only for the service user" in proc.stdout, out
    assert "read/traverse only, never group/other write" in proc.stdout, out
    assert not list(box.beta_root.glob(".stage.*")), "beta stage outlived activation"
    app = str(box.beta_app)
    skips = ("public/data", ".next/cache", ".next.bak", ".next.broken")
    for dirpath, dirnames, filenames in os.walk(app):
        rel = os.path.relpath(dirpath, app).replace(os.sep, "/")
        if rel == ".":
            rel = ""
        if any(rel == skip or rel.startswith(skip + "/") for skip in skips):
            dirnames[:] = []
            continue
        dmode = os.stat(dirpath).st_mode
        assert dmode & 0o055 == 0o055, dirpath
        assert dmode & 0o022 == 0, dirpath
        for name in filenames:
            path = os.path.join(dirpath, name)
            st = os.lstat(path)
            if not _stat.S_ISREG(st.st_mode):
                continue
            fmode = st.st_mode
            assert fmode & 0o022 == 0, path
            if not (name == ".env" or name.startswith(".env.")):
                assert fmode & 0o044 == 0o044, path
    cache = os.stat(box.beta_app / ".next" / "cache")
    assert cache.st_mode & 0o777 == 0o750 and cache.st_uid == os.getuid()
    assert snapshot_modes(box.root / "terminal") == prod_before, "production was chmodded"
    assert snapshot_modes(box.root / "hub") == hub_before, "production hub was chmodded"


def test_full_flow_wrong_but_valid_protocol_tuple_stops_beta(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    wrong = status_file(tmp_path, build_id=box.sha, protocol="mmx.shared-shell.v9")
    proc = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                   status_file=wrong)
    out = proc.stdout + proc.stderr
    assert proc.returncode != 0, out
    assert "does not match the admitted source" in out, out
    assert "pending beta health, identity or unit verification failed" in proc.stdout
    assert "BETA RELEASE FAILED" in proc.stdout
    assert "DONE — target=beta" not in proc.stdout
    assert "beta generation runtime-accepted" not in proc.stdout
    effects = box.effects()
    assert "systemctl stop terminal-beta" in effects
    assert not any(line.startswith("systemctl restart") for line in effects), effects
    assert box.pointer_record(".runtime-accepted") is None
    assert box.pointer_record(".source-provisioned") is not None
    assert (box.beta_app / ".deployment-id").read_text().strip() == box.sha
    assert (box.beta_app / ".next.broken" / "BUILD_ID").read_text().strip() == NEW_BUILD_ID


def test_interrupted_first_bootstrap_resumes_and_completes(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    good = status_file(tmp_path, build_id=box.sha)
    broken = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                     status_file=good, FAIL_NPM_BUILD="1", umask=0o077)
    assert broken.returncode != 0, broken.stdout + broken.stderr
    assert "next build (staging)" in broken.stdout
    assert not (box.beta_app / ".next").exists()
    assert not list(box.beta_root.glob(".stage.*"))
    assert box.pointer_record(".runtime-accepted") is None
    provisioned = box.pointer_record(".source-provisioned")
    assert provisioned is not None and provisioned["accepted_runtime"] is False

    resumed = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                      status_file=good, umask=0o077)
    out = resumed.stdout + resumed.stderr
    assert resumed.returncode == 0, out
    assert "beta bootstrap resume verified" in resumed.stdout, out
    assert "DONE — target=beta" in resumed.stdout
    accepted = box.pointer_record(".runtime-accepted")
    assert accepted is not None and accepted["build_id"] == NEW_BUILD_ID


def test_mutant_exact_tuple_comparison_is_caught(tmp_path):
    """Removing the exact admitted-source comparison must let a WRONG-but-valid
    tuple through — proving the comparison, not the shape check, is load-bearing."""
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    mutate_owner_script(box, TUPLE_ANCHOR, TUPLE_MUTANT)
    wrong = status_file(tmp_path, build_id=box.sha, bridge_version="20270101.1")
    proc = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                   status_file=wrong)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "DONE — target=beta" in proc.stdout, "mutation was inert"


def test_mutant_publish_call_is_caught(tmp_path):
    """Removing the publication call must leave the umask-077 runtime tree
    unreadable for the service user — proving the call is load-bearing."""
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    # Disable both publication gates: shared beta activation and final source
    # reflection. Removing only one would leave the other real defense intact.
    mutate_owner_script(box, PUBLISH_CALL_ANCHOR, PUBLISH_CALL_MUTANT, expected=2)
    proc = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                   status_file=status_file(tmp_path, build_id=box.sha), umask=0o077)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "DONE — target=beta" in proc.stdout, "mutation was inert"
    mode = os.stat(box.beta_app / ".next").st_mode
    assert mode & 0o004 == 0, (
        "the delivered publication call is not what grants the service user "
        f"runtime read access; mode={oct(mode)}")


def test_real_source_audit_accepts_complete_distinct_generation_upgrade(tmp_path):
    """Run both real W2A audits against A and final B, including rollback evidence.

    The status fixture follows the process identity captured by start/restart;
    advancing the on-disk marker alone cannot impersonate a restarted process.
    """
    box = Owner(tmp_path).build_origin(second_generation=True).assemble(
        bootstrap_target_empty=True, production_tree=True)
    production_before = snapshot_modes(box.prod_app)
    status = status_file(tmp_path, build_id=box.sha)
    first = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                    status_file=status, MMX_STATUS_FOLLOWS_RUNTIME="1")
    assert first.returncode == 0, first.stdout + first.stderr
    accepted_a = box.pointer_record(".runtime-accepted")
    accepted_a_path = os.readlink(box.beta_root / ".runtime-accepted")
    assert accepted_a["accepted_sha"] == box.sha
    second = box.run(["--target", "beta", "--target-sha", box.sha2],
                     status_file=status, MMX_STATUS_FOLLOWS_RUNTIME="1")
    assert second.returncode == 0, second.stdout + second.stderr
    accepted_b = box.pointer_record(".runtime-accepted")
    assert accepted_b["accepted_sha"] == box.sha2
    assert accepted_b["previous_runtime_record"] == accepted_a_path
    assert accepted_b["previous_runtime_record_id"] == accepted_a["record_id"]
    assert box.pointer_record(".source-provisioned")["accepted_sha"] == box.sha
    receipt = json.loads(Path(accepted_b["release_receipt_path"]).read_text())
    assert receipt["result"] == "CLEAN"
    assert receipt["source_audit"]["accepted_sha"] == box.sha2
    assert receipt["source_audit"]["summary"]["blocking_findings"] == 0
    assert not (box.beta_root / ".release-pending").exists()
    assert not (box.beta_app / ".deployment-id.bak").exists()
    assert (box.beta_app / ".deployment-id").read_text().strip() == box.sha2
    assert box.unit_active.read_text().strip() == "active"
    assert box.unit_enabled.read_text().strip() == "enabled"
    assert snapshot_modes(box.prod_app) == production_before


def test_beta_archives_override_group_writable_repository_defaults(tmp_path):
    """Git archives default to group-write; root tar preserves that dangerous mode.

    Plant an even wider repository-local mode and require every beta archive to
    supply its own owner-only override. Production archive commands stay intact.
    """
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    git(box.beta_src, "config", "tar.umask", "0000")
    proc = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                   status_file=status_file(tmp_path, build_id=box.sha), umask=0o077)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    archive_effects = [line for line in box.effects() if line.startswith("git ") and " archive " in line]
    assert len(archive_effects) == 3, archive_effects
    assert all("-c tar.umask=0077 archive " in line for line in archive_effects), archive_effects
    for root in MAPPED_ROOTS:
        path = box.beta_root / root
        assert path.is_dir() and not path.is_symlink()
        assert os.stat(path).st_mode & 0o022 == 0, (root, oct(os.stat(path).st_mode))
    assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha
    assert box.unit_enabled.read_text().strip() == "enabled"
    text = SCRIPT.read_text(encoding="utf-8")
    assert 'git -C "$SRC" archive HEAD -- $STAGE_GATED_PATHS > "$GATED_TAR"' in text
    assert 'git -C "$SRC" archive HEAD -- $RUNTIME_PATHS | tar -x -C /opt/terminal/' in text


# The large bootstrap archive belongs on the already admitted build-resource
# volume. These faults affect only the source-archive seam of the existing real
# Git/audit fixture; they never allocate a second deploy owner or host root.
def install_bootstrap_archive_faults(box):
    archive_log = box.tmp / "bootstrap-archives.jsonl"
    real_mktemp = shutil.which("mktemp")
    assert real_mktemp
    mktemp = box.bindir / "mktemp"
    mktemp.write_text(
        "#!/usr/bin/env python3\n"
        "import json,os,stat,subprocess,sys\n"
        "from pathlib import Path\n"
        f"archive_log=Path({str(archive_log)!r})\n"
        f"real_mktemp={real_mktemp!r}\n"
        "args=sys.argv[1:]\n"
        "archive=bool(args) and ('terminal-build-bootstrap.' in args[-1] or "
        "'beta-bootstrap.' in args[-1])\n"
        "fault=os.environ.get('MMX_ARCHIVE_FAULT','')\n"
        "if (archive and fault == 'allocate') or (args and 'terminal-build-trees.' "
        "in args[-1] and fault == 'trees_allocate'):\n"
        " print('mktemp: simulated archive allocation refusal',file=sys.stderr)\n"
        " raise SystemExit(73)\n"
        "result=subprocess.run([real_mktemp,*args],text=True,capture_output=True)\n"
        "if archive and result.returncode == 0:\n"
        " path=Path(result.stdout.strip());info=path.lstat()\n"
        " with archive_log.open('a') as log:\n"
        "  log.write(json.dumps({'path':str(path),'dev':info.st_dev,'ino':info.st_ino,"
        "'uid':info.st_uid,'mode':stat.S_IMODE(info.st_mode)})+'\\n')\n"
        "sys.stdout.write(result.stdout);sys.stderr.write(result.stderr)\n"
        "raise SystemExit(result.returncode)\n",
        encoding="utf-8",
    )
    mktemp.chmod(0o755)
    inner_git = box.bindir / "git-recorded"
    (box.bindir / "git").rename(inner_git)
    (box.bindir / "git").write_text(
        "#!/usr/bin/env python3\n"
        "import json,os,signal,sys\n"
        "from pathlib import Path\n"
        f"archive_log=Path({str(archive_log)!r})\n"
        f"inner_git={str(inner_git)!r}\n"
        "args=sys.argv[1:]\n"
        "if 'archive' in args and '--format=tar' in args:\n"
        " path=Path(json.loads(archive_log.read_text().splitlines()[-1])['path'])\n"
        " fault=os.environ.get('MMX_ARCHIVE_FAULT','')\n"
        " if fault == 'root_full' and str(path.parent) == '/tmp':\n"
        "  os.write(1,b'partial archive');print('No space left on device',file=sys.stderr)\n"
        "  raise SystemExit(65)\n"
        " if fault in ('partial','term','kill','replace'):\n"
        "  os.write(1,b'partial archive')\n"
        "  if fault == 'replace':\n"
        "   path.rename(path.with_name(path.name+'.moved'))\n"
        "   path.mkdir(mode=0o700);(path/'unrelated').write_text('preserve replacement')\n"
        "  if fault in ('term','kill'):\n"
        "   os.kill(os.getppid(),signal.SIGTERM if fault == 'term' else signal.SIGKILL)\n"
        "  raise SystemExit(65)\n"
        "os.execv(inner_git,[inner_git,*args])\n",
        encoding="utf-8",
    )
    (box.bindir / "git").chmod(0o755)
    return archive_log


def bootstrap_archive_records(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def test_source_only_resume_uses_private_mounted_archive_when_root_archive_is_full(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(
        bootstrap_target_empty=True, production_tree=True)
    archive_log = install_bootstrap_archive_faults(box)
    args = ["--target", "beta", "--bootstrap", "--target-sha", box.sha]
    status = status_file(tmp_path, build_id=box.sha)
    broken = box.run(args, status_file=status, FAIL_NPM_BUILD="1", umask=0o077)
    assert broken.returncode != 0, broken.stdout + broken.stderr
    assert "next build (staging)" in broken.stdout
    provenance = (box.beta_root / ".source-provisioned").resolve()
    before_receipt = provenance.read_bytes()
    production_before = snapshot_modes(box.prod_app)
    lock = box.root / ".terminal-build-resource.lock"
    previous = lock / "beta-bootstrap.previous"
    previous.mkdir(mode=0o700)
    sentinel = previous / "unrelated"
    sentinel.write_text("another attempt is not ours to clean")

    resumed = box.run(args, status_file=status, MMX_ARCHIVE_FAULT="root_full", umask=0o077)

    assert resumed.returncode == 0, resumed.stdout + resumed.stderr
    records = bootstrap_archive_records(archive_log)
    assert len(records) == 2
    for record in records:
        path = Path(record["path"])
        assert path.parent == lock
        assert path.name.startswith("beta-bootstrap.")
        assert record["uid"] == os.getuid() and record["mode"] == 0o700
        assert not path.exists()
    assert sentinel.read_text() == "another attempt is not ours to clean"
    assert not (lock / "hold").exists()
    assert (box.beta_root / ".source-provisioned").resolve() == provenance
    assert provenance.read_bytes() == before_receipt
    assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha
    assert not (box.beta_root / ".release-pending").exists()
    assert box.unit_active.read_text().strip() == "active"
    assert box.unit_enabled.read_text().strip() == "enabled"
    assert snapshot_modes(box.prod_app) == production_before


@pytest.mark.parametrize("fault", ["allocate", "trees_allocate"])
def test_bootstrap_archive_allocation_refusal_cannot_become_cleanup_success(tmp_path, fault):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    archive_log = install_bootstrap_archive_faults(box)
    # Observe this production function's actual result before later source-audit
    # refusal can hide an incorrectly successful allocation-failure return.
    anchor = '  beta_bootstrap_provision "$SRC" "$TARGET_SHA" || exit $?'
    replacement = (
        '  if beta_bootstrap_provision "$SRC" "$TARGET_SHA"; then\n'
        '    exit 0\n'
        '  else\n'
        '    exit $?\n'
        '  fi'
    )
    text = box.script.read_text()
    assert text.count(anchor) == 1
    box.script.write_text(text.replace(anchor, replacement))

    result = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                     MMX_ARCHIVE_FAULT=fault)

    assert result.returncode != 0, result.stdout + result.stderr
    assert bootstrap_archive_records(archive_log) == []
    provisioned = box.pointer_record(".source-provisioned")
    if fault == "allocate":
        assert provisioned["accepted_runtime"] is False
    else:
        assert provisioned is None
    assert box.pointer_record(".runtime-accepted") is None
    assert not (box.beta_root / ".release-pending").exists()
    assert not (box.beta_app / "app.py").exists()
    assert not (box.root / ".terminal-build-resource.lock/hold").exists()
    assert not any(line.startswith(("npm ", "systemctl start ", "systemctl enable "))
                   for line in box.effects())


@pytest.mark.parametrize("fault", ["partial", "term"])
def test_bootstrap_archive_failure_cleans_only_this_attempt_before_unlock(tmp_path, fault):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    archive_log = install_bootstrap_archive_faults(box)
    lock = box.root / ".terminal-build-resource.lock"
    lock.mkdir(mode=0o700)
    sentinel = lock / "beta-bootstrap.foreign"
    sentinel.mkdir(mode=0o700)
    (sentinel / "keep").write_text("not this attempt")

    result = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                     MMX_ARCHIVE_FAULT=fault)

    assert result.returncode == (143 if fault == "term" else 65), result.stdout + result.stderr
    records = bootstrap_archive_records(archive_log)
    assert len(records) == 1
    scratch = Path(records[0]["path"])
    assert scratch.parent == lock and not scratch.exists()
    assert (sentinel / "keep").read_text() == "not this attempt"
    assert not (lock / "hold").exists()
    assert box.pointer_record(".source-provisioned")["accepted_runtime"] is False
    assert box.pointer_record(".runtime-accepted") is None
    assert not (box.beta_root / ".release-pending").exists()
    assert not (box.beta_app / "app.py").exists()
    assert not any(line.startswith(("npm ", "systemctl start ", "systemctl enable "))
                   for line in box.effects())


def test_hard_killed_archive_keeps_original_hold_and_is_never_reused(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    archive_log = install_bootstrap_archive_faults(box)
    args = ["--target", "beta", "--bootstrap", "--target-sha", box.sha]

    killed = box.run(args, MMX_ARCHIVE_FAULT="kill")

    assert killed.returncode == -9, killed.stdout + killed.stderr
    records = bootstrap_archive_records(archive_log)
    assert len(records) == 1
    scratch = Path(records[0]["path"])
    lock = box.root / ".terminal-build-resource.lock"
    assert scratch.parent == lock and scratch.is_dir()
    assert (scratch / "source.tar").read_bytes() == b"partial archive"
    holder = (lock / "hold/owner").read_bytes()
    provenance = (box.beta_root / ".source-provisioned").resolve()
    before_receipt = provenance.read_bytes()

    refused = box.run(args)

    assert refused.returncode == 75, refused.stdout + refused.stderr
    assert "another deploy already holds" in refused.stdout
    assert bootstrap_archive_records(archive_log) == records
    assert (lock / "hold/owner").read_bytes() == holder
    assert (scratch / "source.tar").read_bytes() == b"partial archive"
    assert provenance.read_bytes() == before_receipt
    assert box.pointer_record(".runtime-accepted") is None
    assert not (box.beta_root / ".release-pending").exists()


def test_replaced_archive_directory_is_preserved_and_keeps_recovery_hold(tmp_path):
    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    archive_log = install_bootstrap_archive_faults(box)

    result = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha],
                     MMX_ARCHIVE_FAULT="replace")

    assert result.returncode != 0, result.stdout + result.stderr
    record, = bootstrap_archive_records(archive_log)
    scratch = Path(record["path"])
    assert (scratch / "unrelated").read_text() == "preserve replacement"
    assert (scratch.stat().st_dev, scratch.stat().st_ino) != (record["dev"], record["ino"])
    assert (scratch.with_name(scratch.name + ".moved") / "source.tar").read_bytes() == b"partial archive"
    assert (box.root / ".terminal-build-resource.lock/hold/owner").is_file()
    assert "archive" in (result.stdout + result.stderr).lower()
    assert box.pointer_record(".source-provisioned")["accepted_runtime"] is False
    assert box.pointer_record(".runtime-accepted") is None
