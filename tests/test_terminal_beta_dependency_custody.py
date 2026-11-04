"""Executable release regression for npm's beta-local dependency hardlinks.

The missing preparation used to stop a completed first-install build before
service activation. These fixtures run the real owner against confined effects;
they do not execute npm, contact a host, or substitute a green source check for
public beta acceptance.
"""
import hashlib
import os
import stat
import subprocess

from test_terminal_beta_transaction import A, Fixture


def make_dependency_pair(app):
    first = app / "node_modules/esbuild/bin/esbuild"
    second = app / "node_modules/@esbuild/linux-x64/bin/esbuild"
    first.parent.mkdir(parents=True, exist_ok=True)
    second.parent.mkdir(parents=True, exist_ok=True)
    first.write_bytes(b"#!/bin/sh\nprintf 'dependency-ok\\n'\n")
    first.chmod(0o700)
    os.link(first, second)
    assert first.stat().st_nlink == 2
    return first, second


def source_only_with_reusable_dependencies(tmp_path):
    box = Fixture(tmp_path)
    box.flag("fail_build")
    failed = box.run(A, True)
    assert failed.returncode != 0
    assert box.read("active") == "inactive"
    assert box.read("enabled") == "disabled"
    assert not (box.target / ".release-pending").exists()
    (box.root / "fail_build").unlink()
    return box


def test_resume_prepares_package_local_hardlinks_before_runtime_publication(tmp_path):
    """Omitting dependency preparation must recreate the actual release refusal."""
    box = source_only_with_reusable_dependencies(tmp_path)
    provenance = (box.target / ".source-provisioned").resolve()
    before_receipt = provenance.read_bytes()
    first, second = make_dependency_pair(box.app)
    before = {p: (p.read_bytes(), p.stat().st_uid, p.stat().st_gid) for p in (first, second)}
    before_effects = len(box.effects())

    result = box.run(A, True)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "deps unchanged" in result.stdout
    assert not any(line.startswith("npm:ci") or line.startswith("npm:install")
                   for line in box.effects()[before_effects:])
    assert provenance.read_bytes() == before_receipt
    assert (box.target / ".source-provisioned").resolve() == provenance
    assert box.accepted()["accepted_sha"] == A
    assert box.read("active") == "active" and box.read("enabled") == "enabled"
    assert not (box.target / ".release-pending").exists()
    assert first.stat().st_ino != second.stat().st_ino
    for path in (first, second):
        info = path.stat()
        assert info.st_nlink == 1
        assert (path.read_bytes(), info.st_uid, info.st_gid) == before[path]
        assert stat.S_IMODE(info.st_mode) == 0o744
        assert subprocess.check_output([str(path)], text=True) == "dependency-ok\n"


def test_prepare_internal_pair_preserves_mode_owner_bytes_and_executable(tmp_path):
    box = Fixture(tmp_path)
    first, second = make_dependency_pair(box.app)
    before = {p: (p.read_bytes(), p.stat().st_uid, p.stat().st_gid,
                  stat.S_IMODE(p.stat().st_mode)) for p in (first, second)}
    result = box.lib('beta_prepare_dependency_inodes "$APP" apply')
    assert "groups=1 replacements=1" in result.stdout
    assert first.stat().st_ino != second.stat().st_ino
    for path in (first, second):
        info = path.stat()
        assert info.st_nlink == 1
        assert (path.read_bytes(), info.st_uid, info.st_gid,
                stat.S_IMODE(info.st_mode)) == before[path]
        assert subprocess.check_output([str(path)], text=True) == "dependency-ok\n"


def test_inventory_refuses_external_group_before_changing_a_valid_group(tmp_path):
    box = Fixture(tmp_path)
    first, second = make_dependency_pair(box.app)
    outside = tmp_path / "outside-beta"
    outside.write_bytes(b"outside must stay private\n")
    outside.chmod(0o600)
    alias = box.app / "node_modules/unaccounted"
    os.link(outside, alias)
    watched = (first, second, outside, alias)
    before = {p: (p.read_bytes(), p.stat().st_ino, p.stat().st_nlink,
                  p.stat().st_uid, p.stat().st_gid, stat.S_IMODE(p.stat().st_mode))
              for p in watched}

    result = box.lib('beta_prepare_dependency_inodes "$APP" apply', check=False)

    assert result.returncode != 0
    assert "unaccounted dependency hardlink" in result.stdout + result.stderr
    for path in watched:
        info = path.stat()
        assert (path.read_bytes(), info.st_ino, info.st_nlink, info.st_uid, info.st_gid,
                stat.S_IMODE(info.st_mode)) == before[path]
    assert not list(box.app.rglob(".mmx-dependency-*"))


def test_prepare_does_not_admit_a_secret_alias_as_an_internal_member(tmp_path):
    box = Fixture(tmp_path)
    first, second = make_dependency_pair(box.app)
    secret = box.app / "node_modules/.env.private"
    os.link(first, secret)
    before = first.stat().st_ino
    result = box.lib('beta_prepare_dependency_inodes "$APP" apply', check=False)
    assert result.returncode != 0
    assert "unaccounted dependency hardlink" in result.stdout + result.stderr
    assert all(p.stat().st_ino == before and p.stat().st_nlink == 3
               for p in (first, second, secret))


def test_prepare_does_not_follow_a_dependency_directory_alias(tmp_path):
    box = Fixture(tmp_path)
    outside = tmp_path / "outside-directory"
    outside.mkdir()
    file = outside / "bin"
    file.write_bytes(b"do not read or change through an alias")
    file.chmod(0o600)
    (box.app / "node_modules").mkdir(parents=True)
    (box.app / "node_modules/external").symlink_to(outside, target_is_directory=True)
    before = (file.read_bytes(), file.stat().st_ino, stat.S_IMODE(file.stat().st_mode))
    result = box.lib('beta_prepare_dependency_inodes "$APP" apply')
    assert "groups=0 replacements=0" in result.stdout
    assert (file.read_bytes(), file.stat().st_ino, stat.S_IMODE(file.stat().st_mode)) == before


def test_prepare_refuses_writable_dependency_custody(tmp_path):
    box = Fixture(tmp_path)
    first, second = make_dependency_pair(box.app)
    first.chmod(0o770)
    inode = first.stat().st_ino
    result = box.lib('beta_prepare_dependency_inodes "$APP" apply', check=False)
    assert result.returncode != 0
    assert "custody is not exclusive" in result.stdout + result.stderr
    assert first.stat().st_ino == second.stat().st_ino == inode
    assert stat.S_IMODE(first.stat().st_mode) == 0o770


def test_dependency_check_is_read_only_and_production_is_refused(tmp_path):
    box = Fixture(tmp_path)
    first, second = make_dependency_pair(box.app)
    inode = first.stat().st_ino
    result = box.lib('beta_prepare_dependency_inodes "$APP" check')
    assert result.stdout.strip() == "1"
    assert first.stat().st_ino == second.stat().st_ino == inode
    assert first.stat().st_nlink == 2
    refused = box.lib('TARGET=production; beta_prepare_dependency_inodes "$APP" apply',
                      check=False)
    assert refused.returncode == 64
    assert first.stat().st_ino == second.stat().st_ino == inode


def run_embedded_preparer(box, monkeypatch):
    """Execute the shipped Python boundary with deterministic filesystem races."""
    import sys
    source = box.owner.read_text().split("<<'PY_DEPENDENCIES'\n", 1)[1].split(
        "\nPY_DEPENDENCIES", 1)[0]
    monkeypatch.setattr(sys, "argv", ["prepare", str(box.app), str(box.target), "apply"])
    exec(compile(source, str(box.owner) + ":PY_DEPENDENCIES", "exec"), {})


def test_new_external_alias_after_staging_refuses_before_any_replacement(tmp_path, monkeypatch):
    import pytest
    box = Fixture(tmp_path)
    first, second = make_dependency_pair(box.app)
    before = (first.read_bytes(), first.stat().st_ino)
    outside = tmp_path / "racing-outside-alias"
    real_fsync = os.fsync
    fired = []

    def add_alias_after_staging(fd):
        real_fsync(fd)
        if not fired and stat.S_ISREG(os.fstat(fd).st_mode):
            fired.append(True)
            os.link(first, outside)

    monkeypatch.setattr(os, "fsync", add_alias_after_staging)
    with pytest.raises(SystemExit, match="membership changed"):
        run_embedded_preparer(box, monkeypatch)
    assert fired
    for path in (first, second, outside):
        assert (path.read_bytes(), path.stat().st_ino) == before
        assert path.stat().st_nlink == 3
    assert not list(box.app.rglob(".mmx-dependency-*"))


def test_changed_private_stage_refuses_before_replacing_a_dependency(tmp_path, monkeypatch):
    import pytest
    box = Fixture(tmp_path)
    first, second = make_dependency_pair(box.app)
    before = (first.read_bytes(), first.stat().st_ino)
    real_fsync = os.fsync
    fired = []

    def change_staged_bytes(fd):
        real_fsync(fd)
        if not fired and stat.S_ISREG(os.fstat(fd).st_mode):
            fired.append(True)
            os.lseek(fd, 0, os.SEEK_SET)
            os.write(fd, b"X")

    monkeypatch.setattr(os, "fsync", change_staged_bytes)
    with pytest.raises(SystemExit, match="private dependency"):
        run_embedded_preparer(box, monkeypatch)
    assert fired
    for path in (first, second):
        assert (path.read_bytes(), path.stat().st_ino) == before
        assert path.stat().st_nlink == 2
    assert not list(box.app.rglob(".mmx-dependency-*"))


def test_fresh_npm_install_prepares_internal_links_before_first_activation(tmp_path):
    box = Fixture(tmp_path)
    shim = box.root / "bin/npm"
    original = "elif args[0] in ('ci','install'): (cwd/'node_modules').mkdir(exist_ok=True)"
    install = """elif args[0] in ('ci','install'):
  first=cwd/'node_modules/esbuild/bin/esbuild'
  second=cwd/'node_modules/@esbuild/linux-x64/bin/esbuild'
  first.parent.mkdir(parents=True,exist_ok=True)
  second.parent.mkdir(parents=True,exist_ok=True)
  first.write_bytes(b"#!/bin/sh\\nprintf 'dependency-ok\\\\n'\\n")
  first.chmod(0o700)
  os.link(first,second)"""
    body = shim.read_text()
    assert body.count(original) == 1
    shim.write_text(body.replace(original, install))

    result = box.run(A, True)

    assert result.returncode == 0, result.stdout + result.stderr
    assert any(line.startswith("npm:ci") for line in box.effects())
    assert "groups=1 replacements=1" in result.stdout
    assert box.accepted()["accepted_sha"] == A
    for path in (box.app / "node_modules/esbuild/bin/esbuild",
                 box.app / "node_modules/@esbuild/linux-x64/bin/esbuild"):
        assert path.stat().st_nlink == 1
        assert subprocess.check_output([str(path)], text=True) == "dependency-ok\n"


def test_script_only_adoption_resumes_the_original_canonical_policy_receipt(tmp_path):
    """The owner artifact may advance; the admitted source and policy path may not."""
    import shutil
    from test_terminal_beta_bootstrap import Owner, git, mutating, status_file

    box = Owner(tmp_path).build_origin().assemble(bootstrap_target_empty=True)
    # The fixture's immutable canonical commit carries its real audit bundle.
    # Only deployment paths and the fixture data-tree pin were translated by Owner.
    ops = box.origin / "ops"
    bundle_files = ("terminal_release_preflight.py", "terminal_source_audit.beta.json")
    for name in bundle_files:
        shutil.copy2(box.authoring / name, ops / name)
    shutil.copytree(box.authoring / "terminal_audit", ops / "terminal_audit")
    (ops / "terminal-build.sh").write_text(box.rewritten)
    git(box.origin, "add", "ops")
    git(box.origin, "commit", "-qm", "fixture canonical release owner and beta policy")
    box.sha = git(box.origin, "rev-parse", "HEAD")
    git(box.beta_src, "fetch", "origin", "master")
    git(box.beta_src, "reset", "--hard", box.sha)
    box.script = box.beta_src / "ops/terminal-build.sh"
    args = ["--target", "beta", "--bootstrap", "--target-sha", box.sha]
    failed = box.run(args, FAIL_NPM_BUILD="1",
                     status_file=status_file(tmp_path, build_id=box.sha))
    assert failed.returncode != 0, failed.stdout + failed.stderr
    assert "next build (staging)" in failed.stdout, failed.stdout + failed.stderr
    provenance = (box.beta_root / ".source-provisioned").resolve()
    before = provenance.read_bytes()
    canonical_policy = box.beta_src / "ops/terminal_source_audit.beta.json"
    assert str(canonical_policy) in before.decode()
    policy_digest = hashlib.sha256(canonical_policy.read_bytes()).hexdigest()
    first, second = make_dependency_pair(box.beta_app)

    # A separately located complete bundle selects a different policy path and
    # cannot borrow the canonical source receipt, even when its bytes match.
    artifact_dir = tmp_path / "qualified-release-owner"
    artifact_dir.mkdir(mode=0o700)
    box.script = artifact_dir / "terminal-build.sh"
    box.script.write_text(box.rewritten)
    for name in bundle_files:
        shutil.copy2(box.authoring / name, artifact_dir / name)
    shutil.copytree(box.authoring / "terminal_audit", artifact_dir / "terminal_audit")
    prior_effects = len(box.effects())
    refused = box.run(args, status_file=status_file(tmp_path, build_id=box.sha))
    assert refused.returncode != 0, refused.stdout + refused.stderr
    assert "policy" in (refused.stdout + refused.stderr).lower()
    assert provenance.read_bytes() == before
    assert mutating(box.effects()[prior_effects:]) == []
    assert box.pointer_record(".runtime-accepted") is None

    # Publish only the exact newer shell artifact. The real selection code falls
    # through to the original canonical bundle; no receipt or policy is rewritten.
    for name in bundle_files:
        (artifact_dir / name).unlink()
    shutil.rmtree(artifact_dir / "terminal_audit")
    assert [p.name for p in artifact_dir.iterdir()] == ["terminal-build.sh"]
    result = box.run(args, status_file=status_file(tmp_path, build_id=box.sha))

    assert result.returncode == 0, result.stdout + result.stderr
    assert "deps unchanged" in result.stdout
    assert "groups=1 replacements=1" in result.stdout
    assert provenance.read_bytes() == before
    assert (box.beta_root / ".source-provisioned").resolve() == provenance
    assert hashlib.sha256(canonical_policy.read_bytes()).hexdigest() == policy_digest
    assert git(box.beta_src, "rev-parse", "HEAD") == box.sha
    assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha
    assert not (box.beta_root / ".release-pending").exists()
    assert first.stat().st_nlink == second.stat().st_nlink == 1
    assert first.stat().st_ino != second.stat().st_ino
