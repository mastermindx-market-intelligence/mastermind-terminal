"""Hermetic pytest coverage for the beta_runtime_prune_owned fabric artifact.

The suite exercises the ACTUAL delivered bash function -- read from the
sibling ``prune-function.sh``, or from the ``MMX_RUNTIME_PRUNE_FUNCTION``
override the integrating parent may bind -- inside real bash, against real
temporary git commits and a real extracted runtime target root. It creates
no repository or CI/lifecycle files: everything lives under pytest's own
temporary directories. No network, no host paths, no service effects.
"""

import hashlib
import itertools
import os
import re
import shutil
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

_SCRIPT_SEQ = itertools.count(1)

HERE = Path(__file__).resolve().parent
FUNCTION_NAME = "beta_runtime_prune_owned"
SIBLING = HERE / "prune-function.sh"
ENV_OVERRIDE = "MMX_RUNTIME_PRUNE_FUNCTION"

GIT_ENV_BASE = {
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_SYSTEM": os.devnull,
    "GIT_AUTHOR_NAME": "Prune Test Owner",
    "GIT_AUTHOR_EMAIL": "prune-owner@example.invalid",
    "GIT_COMMITTER_NAME": "Prune Test Owner",
    "GIT_COMMITTER_EMAIL": "prune-owner@example.invalid",
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00+00:00",
    "GIT_COMMITTER_DATE": "2026-01-01T00:00:00+00:00",
    "GIT_TERMINAL_PROMPT": "0",
    "LC_ALL": "C",
}


@pytest.fixture(scope="session", autouse=True)
def require_tools():
    for tool in ("bash", "git", "python3"):
        if shutil.which(tool) is None:
            pytest.fail("required tool missing: " + tool)


# --------------------------------------------------------------------------
# fixture data


def _f(content, ex=False):
    return (content.encode() if isinstance(content, str) else content, ex)


PRIOR_FILES = {
    "ingest/loader.py": _f("print('ingest-loader-v1')\n"),
    "ingest/keep_ingestor.py": _f("INGEST_KEEP_V1\n"),
    "ingest/deep/old_ingestor.py": _f("INGEST_OLD_V1\n"),
    "scripts/run.sh": _f("#!/bin/sh\necho run-v1\n", ex=True),
    "scripts/legacy/old_task.sh": _f("#!/bin/sh\necho legacy-v1\n", ex=True),
    "config/settings.ini": _f("alpha=1\n"),
    "config/obsolete.ini": _f("obsolete=1\n"),
    "contracts/api/v1.json": _f('{"v":1}\n'),
    "hub/old_module.py": _f("HUB_OLD_V1\n"),
    "signal_layer/emit_old.py": _f("SIGNAL_OLD_V1\n"),
    "docs/README.md": _f("outside-roots-docs\n"),
    "vendor/libold/keep.py": _f("outside-roots-vendor\n"),
    "logs/app.log": _f("outside-roots-log\n"),
    "stale.txt": _f("outside-roots-toplevel\n"),
}

REMOVED_IN_TARGET = [
    "config/obsolete.ini",
    "contracts/api/v1.json",
    "hub/old_module.py",
    "ingest/deep/old_ingestor.py",
    "scripts/legacy/old_task.sh",
    "signal_layer/emit_old.py",
]

REMOVED_OUTSIDE_ROOTS = ["docs/README.md", "vendor/libold/keep.py", "logs/app.log", "stale.txt"]


def target_files():
    files = dict(PRIOR_FILES)
    for rel in REMOVED_IN_TARGET + REMOVED_OUTSIDE_ROOTS:
        del files[rel]
    files["ingest/new_ingestor.py"] = _f("INGEST_NEW_V1\n")
    return files


# --------------------------------------------------------------------------
# git helpers


def _git_env(home):
    env = dict(os.environ)
    env.update(GIT_ENV_BASE)
    env["HOME"] = str(home)
    return env


def init_repo(path, home):
    path.mkdir(parents=True)
    proc = subprocess.run(
        ["git", "-C", str(path), "-c", "init.defaultBranch=main", "init", "--quiet"],
        capture_output=True, env=_git_env(home))
    assert proc.returncode == 0, proc.stderr.decode()
    return path


def run_git(repo, home, *args):
    proc = subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, env=_git_env(home))
    assert proc.returncode == 0, proc.stderr.decode()
    return proc.stdout


def write_commit(repo, home, files, message):
    """Replace the repo working tree with exactly `files` and commit it."""
    for entry in repo.iterdir():
        if entry.name == ".git":
            continue
        if entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    for rel in sorted(files):
        content, is_exec = files[rel]
        dst = repo / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(content)
        dst.chmod(0o755 if is_exec else 0o644)
    run_git(repo, home, "add", "-A")
    run_git(repo, home, "commit", "--quiet", "--allow-empty", "-m", message)
    return run_git(repo, home, "rev-parse", "HEAD").decode().strip()


def materialize(repo, home, sha, dest):
    """Extract a commit tree onto disk the way the archive overlay would."""
    for line in run_git(repo, home, "ls-tree", "-r", sha).decode().splitlines():
        meta, rel = line.split("\t", 1)
        mode, otype, oid = meta.split()
        if otype != "blob":
            continue
        content = run_git(repo, home, "cat-file", "blob", oid)
        dst = dest / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(content)
        dst.chmod(0o755 if mode == "100755" else 0o644)


# --------------------------------------------------------------------------
# scene + function loading


class Scene:
    """A canonical git repo, the prior revision extracted into a destination
    root, and an outside-of-root area used for symlink/hardlink bait."""

    def __init__(self, tmp_path):
        self.home = tmp_path / "githome"
        self.home.mkdir(parents=True)
        self.repo = init_repo(tmp_path / "canonical", self.home)
        self.dest = tmp_path / "runtime-dest"
        self.outside = tmp_path / "outside"
        self.dest.mkdir()
        self.outside.mkdir()
        self.prior_sha = write_commit(self.repo, self.home, PRIOR_FILES,
                                      "prior accepted revision")
        self.target_sha = write_commit(self.repo, self.home, target_files(),
                                       "target revision (reverse deploy)")
        materialize(self.repo, self.home, self.prior_sha, self.dest)
        self.take_repo_baseline()
        self.snap = self.snapshot()

    def take_repo_baseline(self):
        self.head = run_git(self.repo, self.home, "rev-parse", "HEAD").decode().strip()
        self.refs = run_git(self.repo, self.home, "for-each-ref").decode()

    def snapshot(self):
        state = {}
        for base in (self.dest, self.outside):
            for path in sorted(base.rglob("*")):
                rel = base.name + "/" + str(path.relative_to(base))
                if path.is_symlink():
                    state[rel] = ("symlink", os.readlink(path))
                elif path.is_dir():
                    state[rel] = ("dir",)
                else:
                    mode = stat.S_IMODE(path.stat().st_mode)
                    state[rel] = ("file", hashlib.sha256(path.read_bytes()).hexdigest(), mode)
        return state

    def assert_repo_untouched(self):
        assert run_git(self.repo, self.home, "rev-parse", "HEAD").decode().strip() == self.head
        assert run_git(self.repo, self.home, "for-each-ref").decode() == self.refs
        assert run_git(self.repo, self.home, "status", "--porcelain") == b""
        assert not (self.repo / ".git" / "FETCH_HEAD").exists()


def function_text(env_function=None):
    if env_function is not None:
        return env_function
    owner = (HERE.parent / "ops/terminal-build.sh").read_text()
    start = owner.index("beta_runtime_prune_owned(){")
    end = owner.index("\n# End beta runtime source prune.", start)
    return owner[start:end]


def _shq(value):
    return "'" + str(value).replace("'", "'\\''") + "'"


def run_prune(scene, tmp_path, prior, target, *, target_name="beta", alias=None,
              root=None, src=None, env_function=None):
    """Execute the loaded function in bash with the frozen global binding."""
    lines = [function_text(env_function).rstrip("\n")]
    lines.append("TARGET=" + _shq(target_name if target_name is not None else ""))
    lines.append("SRC=" + _shq(str(scene.repo if src is None else src)))
    lines.append("RUNTIME_SYNC_ROOT=" + _shq(str(scene.dest if root is None else root)))
    lines.append("BETA_TARGET_ROOT=" + _shq(str(scene.dest if alias is None else alias)))
    lines.append("%s %s %s" % (FUNCTION_NAME, _shq(prior), _shq(target)))
    lines.append("prune_rc=$?")
    lines.append("printf 'PRUNE_RC:%s\\n' \"$prune_rc\"")
    script = tmp_path / ("invoke-%d.sh" % next(_SCRIPT_SEQ))
    fd = os.open(str(script), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    env = dict(os.environ)
    env.pop(ENV_OVERRIDE, None)
    proc = subprocess.run(["bash", str(script)], capture_output=True, text=True,
                          timeout=300, env=env)
    match = re.search(r"^PRUNE_RC:(-?\d+)\s*$", proc.stdout, re.M)
    assert match, "runner produced no return code marker\nstdout=%r\nstderr=%r" % (
        proc.stdout, proc.stderr)
    return SimpleNamespace(rc=int(match.group(1)), out=proc.stdout, err=proc.stderr)


# --------------------------------------------------------------------------
# tests


def test_reverse_deploy_deletes_exactly_the_in_scope_removed_files(tmp_path):
    scene = Scene(tmp_path)
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc == 0, run.err
    assert "deleted_count=6" in run.out
    for rel in REMOVED_IN_TARGET:
        assert ("deleted " + rel) in run.out
        assert not (scene.dest / rel).exists()
    # exact six roots only: tracked removals outside the roots survive verbatim
    for rel in REMOVED_OUTSIDE_ROOTS:
        assert (scene.dest / rel).read_bytes() == PRIOR_FILES[rel][0], rel
    # tracked overlap untouched, byte-identical, exec bit preserved
    assert (scene.dest / "config/settings.ini").read_bytes() == b"alpha=1\n"
    assert (scene.dest / "ingest/loader.py").read_bytes() == b"print('ingest-loader-v1')\n"
    assert stat.S_IMODE((scene.dest / "scripts/run.sh").stat().st_mode) & 0o111
    # the helper never writes: target-side addition is not materialized
    assert not (scene.dest / "ingest/new_ingestor.py").exists()
    # never deletes a whole directory: emptied dirs remain
    assert (scene.dest / "ingest/deep").is_dir()
    assert (scene.dest / "contracts/api").is_dir()
    assert (scene.dest / "scripts/legacy").is_dir()
    # evidence is compact and carries no file content or secrets
    assert "alpha=1" not in run.out and "INGEST_OLD_V1" not in run.out
    scene.assert_repo_untouched()


def test_forward_sync_deletes_nothing(tmp_path):
    scene = Scene(tmp_path)
    forward_next = write_commit(
        scene.repo, scene.home,
        {**target_files(), "scripts/extra.sh": _f("#!/bin/sh\nexit 0\n", ex=True)},
        "forward next revision")
    run = run_prune(scene, tmp_path, scene.target_sha, forward_next)
    assert run.rc == 0, run.err
    assert "deleted_count=0" in run.out
    assert scene.snapshot() == scene.snap


def test_identical_revisions_are_a_full_noop(tmp_path):
    scene = Scene(tmp_path)
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.prior_sha)
    assert run.rc == 0, run.err
    assert "deleted_count=0" in run.out
    assert scene.snapshot() == scene.snap


def test_unknown_cache_and_secret_files_are_preserved(tmp_path):
    scene = Scene(tmp_path)
    extras = {
        "hub/__pycache__/old_module.cpython-311.pyc": b"\x00cache-bytes",
        "config/runtime-secrets.env": b"TOKEN=do-not-print\n",
        "ingest/cache.db": b"sqlite-ish-local-cache",
        "signal_layer/.env.local": b"LOCAL=1\n",
        "scripts/user-hook.sh": b"#!/bin/sh\nexit 0\n",
        "contracts/local-overlay.json": b"{}\n",
    }
    for rel, data in extras.items():
        path = scene.dest / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc == 0, run.err
    assert "deleted_count=6" in run.out
    for rel, data in extras.items():
        assert (scene.dest / rel).read_bytes() == data, rel
    assert "TOKEN=do-not-print" not in run.out and "do-not-print" not in run.err


def test_missing_obsolete_file_is_a_safe_idempotent_noop(tmp_path):
    scene = Scene(tmp_path)
    (scene.dest / "config/obsolete.ini").unlink()
    (scene.dest / "hub/old_module.py").unlink()
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc == 0, run.err
    assert "deleted_count=4" in run.out
    assert "config/obsolete.ini" not in run.out
    assert "hub/old_module.py" not in run.out
    # re-running on the fully pruned tree deletes nothing and still succeeds
    run2 = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run2.rc == 0, run2.err
    assert "deleted_count=0" in run2.out


def test_modified_candidate_blocks_all_deletions(tmp_path):
    scene = Scene(tmp_path)
    # modify the candidate that sorts LAST, so a delete-as-you-go
    # implementation would leave a partially pruned tree
    (scene.dest / "signal_layer/emit_old.py").write_bytes(b"SIGNAL_LOCAL_HOTFIX\n")
    before = scene.snapshot()
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc != 0
    assert "signal_layer/emit_old.py" in run.err
    assert "deleted_count" not in run.out
    assert scene.snapshot() == before  # zero deletions, zero writes


def test_symlinked_parent_directory_is_rejected_without_outside_effect(tmp_path):
    scene = Scene(tmp_path)
    bait_dir = scene.outside / "bait-deep"
    bait_dir.mkdir()
    prior_bytes = PRIOR_FILES["ingest/deep/old_ingestor.py"][0]
    (bait_dir / "old_ingestor.py").write_bytes(prior_bytes)  # naive follow would delete it
    shutil.rmtree(scene.dest / "ingest/deep")
    (scene.dest / "ingest/deep").symlink_to(bait_dir)
    before = scene.snapshot()
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc != 0
    assert "ingest/deep/old_ingestor.py" in run.err
    assert "deleted_count" not in run.out
    assert (bait_dir / "old_ingestor.py").is_file()
    assert (bait_dir / "old_ingestor.py").read_bytes() == prior_bytes
    assert (scene.dest / "ingest/deep").is_symlink()
    assert scene.snapshot() == before


def test_symlinked_candidate_file_is_rejected_and_target_untouched(tmp_path):
    scene = Scene(tmp_path)
    prior_bytes = PRIOR_FILES["config/obsolete.ini"][0]
    bait_file = scene.outside / "bait-file.txt"
    bait_file.write_bytes(prior_bytes)
    (scene.dest / "config/obsolete.ini").unlink()
    (scene.dest / "config/obsolete.ini").symlink_to(bait_file)
    before = scene.snapshot()
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc != 0
    assert "config/obsolete.ini" in run.err
    assert "deleted_count" not in run.out
    assert bait_file.is_file() and bait_file.read_bytes() == prior_bytes
    assert (scene.dest / "config/obsolete.ini").is_symlink()
    assert scene.snapshot() == before


def test_candidate_replaced_by_directory_is_rejected(tmp_path):
    scene = Scene(tmp_path)
    (scene.dest / "config/obsolete.ini").unlink()
    (scene.dest / "config/obsolete.ini").mkdir()
    before = scene.snapshot()
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc != 0
    assert "config/obsolete.ini" in run.err
    assert (scene.dest / "config/obsolete.ini").is_dir()
    assert scene.snapshot() == before


def test_outside_the_exact_six_roots_is_never_touched(tmp_path):
    scene = Scene(tmp_path)
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc == 0, run.err
    for rel in REMOVED_OUTSIDE_ROOTS:
        assert (scene.dest / rel).read_bytes() == PRIOR_FILES[rel][0], rel
        assert ("deleted " + rel) not in run.out
    assert (scene.dest / "docs").is_dir()
    assert (scene.dest / "vendor/libold").is_dir()


def test_first_bootstrap_with_empty_prior_is_a_noop(tmp_path):
    scene = Scene(tmp_path)
    run = run_prune(scene, tmp_path, "", scene.target_sha)
    assert run.rc == 0, run.err
    assert "deleted_count=0" in run.out
    assert "first_bootstrap" in run.out
    assert scene.snapshot() == scene.snap


def test_invalid_sha_forms_are_refused_before_any_write(tmp_path):
    scene = Scene(tmp_path)
    good = scene.target_sha
    bad_shapes = [
        ("0" * 39, good),          # short prior
        (good + "0", good),        # long prior
        (good.upper(), good),      # uppercase prior
        ("HEAD", good),            # refname instead of commit id
        (good, "0" * 39),          # short target
        (good, good.upper()),      # uppercase target
        (good, "HEAD"),            # refname target
        ("", "0" * 39 + "g"),      # non-hex target
        ("b" * 40, good),          # well-formed but nonexistent object
        (good, "z" * 40),          # non-hex target
    ]
    for prior, target in bad_shapes:
        run = run_prune(scene, tmp_path, prior, target)
        assert run.rc != 0, (prior, target, run.out)
        assert "deleted_count" not in run.out
    assert scene.snapshot() == scene.snap


def test_non_beta_profile_is_refused(tmp_path):
    scene = Scene(tmp_path)
    for profile in ("prod", "BETA", "beta2", " canonical", "", None):
        run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha,
                        target_name=profile)
        assert run.rc != 0, profile
        assert "beta" in run.err
        assert "deleted_count" not in run.out
    assert scene.snapshot() == scene.snap


def test_destination_root_mismatch_and_alias_are_refused(tmp_path):
    scene = Scene(tmp_path)
    other = tmp_path / "other-root"
    other.mkdir()
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha, alias=other)
    assert run.rc != 0
    assert "mismatch/alias" in run.err
    # same directory spelled differently is an alias and must be refused
    run2 = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha,
                     alias=str(scene.dest) + "/")
    assert run2.rc != 0
    assert "mismatch/alias" in run2.err
    # empty alias global is also a refusal (unset global)
    run3 = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha, alias="")
    assert run3.rc != 0
    assert "must both be set" in run3.err
    assert scene.snapshot() == scene.snap


def test_non_physical_symlinked_root_or_src_is_refused(tmp_path):
    scene = Scene(tmp_path)
    root_link = tmp_path / "root-link"
    root_link.symlink_to(scene.dest)
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha,
                    root=root_link, alias=root_link)
    assert run.rc != 0
    assert "not a physical directory" in run.err
    src_link = tmp_path / "src-link"
    src_link.symlink_to(scene.repo)
    run2 = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha, src=src_link)
    assert run2.rc != 0
    assert "not a physical directory" in run2.err
    assert scene.snapshot() == scene.snap
    scene.assert_repo_untouched()


def test_shared_inode_hardlink_is_rejected_with_no_deletions(tmp_path):
    scene = Scene(tmp_path)
    link = scene.outside / "hardlink-copy.py"
    os.link(scene.dest / "hub/old_module.py", link)
    before = scene.snapshot()
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc != 0
    assert "hub/old_module.py" in run.err
    assert "st_nlink" in run.err
    assert "deleted_count" not in run.out
    assert link.is_file()
    assert link.read_bytes() == PRIOR_FILES["hub/old_module.py"][0]
    assert scene.snapshot() == before


def test_world_writable_candidate_is_rejected_with_no_deletions(tmp_path):
    scene = Scene(tmp_path)
    os.chmod(scene.dest / "hub/old_module.py", 0o666)
    before = scene.snapshot()
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc != 0
    assert "world-writable" in run.err
    assert scene.snapshot() == before


def test_executable_bit_compatibility_is_enforced(tmp_path):
    # prior mode 100755 but exec bit stripped on disk
    scene = Scene(tmp_path)
    os.chmod(scene.dest / "scripts/legacy/old_task.sh", 0o644)
    before = scene.snapshot()
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert run.rc != 0
    assert "executable bit" in run.err
    assert scene.snapshot() == before
    # prior mode 100644 but exec bit added on disk
    scene2 = Scene(tmp_path / "second")
    os.chmod(scene2.dest / "config/obsolete.ini", 0o755)
    before2 = scene2.snapshot()
    run2 = run_prune(scene2, tmp_path / "second", scene2.prior_sha, scene2.target_sha)
    assert run2.rc != 0
    assert "executable bit" in run2.err
    assert scene2.snapshot() == before2


def test_tracked_symlink_in_scope_is_never_a_deletion_candidate(tmp_path):
    scene = Scene(tmp_path)
    # a later revision where the removed regular file reappears as a git
    # symlink (mode 120000): the path is still tracked, so it is not "absent
    # from target", and non-regular entries are not deletion candidates
    os.symlink("/etc/hostname", str(scene.repo / "config/obsolete.ini"))
    run_git(scene.repo, scene.home, "add", "-A")
    run_git(scene.repo, scene.home, "commit", "--quiet", "-m", "symlink revision")
    symlink_sha = run_git(scene.repo, scene.home, "rev-parse", "HEAD").decode().strip()
    modes = run_git(scene.repo, scene.home, "ls-tree", "-r", symlink_sha).decode()
    assert "120000 blob" in modes  # the repo really tracks a symlink there
    run = run_prune(scene, tmp_path, scene.prior_sha, symlink_sha)
    assert run.rc == 0, run.err
    assert "deleted_count=5" in run.out
    assert "config/obsolete.ini" not in run.out
    assert (scene.dest / "config/obsolete.ini").read_bytes() == b"obsolete=1\n"


def test_unsafe_traversal_path_is_refused_when_git_permits_building_one(tmp_path):
    scene = Scene(tmp_path)
    blob = subprocess.run(
        ["git", "-C", str(scene.repo), "hash-object", "-w", "--stdin"],
        input=b"escape\n", capture_output=True, env=_git_env(scene.home))
    assert blob.returncode == 0
    oid = blob.stdout.decode().strip()
    tree = subprocess.run(
        ["git", "-C", str(scene.repo), "mktree", "-z"],
        input=("100644 blob %s\t../escaped.txt\0" % oid).encode(),
        capture_output=True, env=_git_env(scene.home))
    if tree.returncode != 0:
        pytest.skip("this git refuses to build traversal tree entries")
    commit = subprocess.run(
        ["git", "-C", str(scene.repo), "commit-tree", tree.stdout.decode().strip(),
         "-m", "unsafe tree"],
        capture_output=True, env=_git_env(scene.home))
    assert commit.returncode == 0, commit.stderr
    run = run_prune(scene, tmp_path, scene.prior_sha, commit.stdout.decode().strip())
    assert run.rc != 0
    assert "unsafe git path" in run.err
    assert "deleted_count" not in run.out
    assert scene.snapshot() == scene.snap


def test_function_is_loaded_from_the_parent_bound_override(tmp_path):
    stub = FUNCTION_NAME + "(){ echo 'stub-refusal'; return 7; }"
    scene = Scene(tmp_path)
    run = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha,
                    env_function=stub)
    assert run.rc == 7
    assert "stub-refusal" in run.out
    assert scene.snapshot() == scene.snap  # stub deleted nothing


def test_delivered_artifact_defines_the_expected_function(tmp_path):
    text = function_text()
    assert re.search(r"^%s\s*\(\)\s*\{" % FUNCTION_NAME, text, re.M), \
        "delivered function text does not define " + FUNCTION_NAME
    script = tmp_path / "probe.sh"
    fd = os.open(str(script), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(text.rstrip("\n") + "\n")
        handle.write('declare -F %s >/dev/null && echo FUNCTION_DEFINED\n' % FUNCTION_NAME)
        handle.write('type -t %s\n' % FUNCTION_NAME)
    proc = subprocess.run(["bash", str(script)], capture_output=True, text=True,
                          timeout=60, env={k: v for k, v in os.environ.items()
                                           if k != ENV_OVERRIDE})
    assert proc.returncode == 0, proc.stderr
    assert "FUNCTION_DEFINED" in proc.stdout
    assert "function" in proc.stdout


def test_fifo_candidate_refuses_without_blocking_or_deleting_other_paths(tmp_path):
    scene = Scene(tmp_path)
    path = scene.dest / REMOVED_IN_TARGET[0]
    path.unlink()
    os.mkfifo(path)
    result = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert result.rc != 0
    assert stat.S_ISFIFO(path.lstat().st_mode)
    assert (scene.dest / REMOVED_IN_TARGET[-1]).is_file()


def test_group_writable_parent_is_not_admitted_for_source_deletion(tmp_path):
    scene = Scene(tmp_path)
    parent = (scene.dest / REMOVED_IN_TARGET[0]).parent
    parent.chmod(0o775)
    result = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha)
    assert result.rc != 0
    assert all((scene.dest / name).is_file() for name in REMOVED_IN_TARGET)


def test_regular_candidate_changed_after_plan_is_not_unlinked(tmp_path):
    scene = Scene(tmp_path)
    source = function_text()
    anchor = '        deleted = delete_planned(root_fd, plan)'
    assert source.count(anchor) == 1
    mutant = source.replace(anchor, '''        with open(os.path.join(root, plan[0][0]), "ab") as changed:
            changed.write(b"changed after plan")
''' + anchor)
    result = run_prune(scene, tmp_path, scene.prior_sha, scene.target_sha, env_function=mutant)
    assert result.rc != 0
    assert all((scene.dest / name).is_file() for name in REMOVED_IN_TARGET)
