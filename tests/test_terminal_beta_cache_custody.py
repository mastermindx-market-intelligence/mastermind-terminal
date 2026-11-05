"""Cache-custody regressions against the owner's actual embedded Python helper.

Run with unittest or pytest. MMX_TERMINAL_BUILD_SCRIPT overrides the default
../ops/terminal-build.sh, so this file has no scratch-source dependencies.

Fixtures use the current effective UID as BETA_SERVICE_USER. They prove requested
modes, refusal behavior and unchanged sentinel custody for that same UID. They do
not prove a distinct terminal-beta user's access or systemd mount isolation.
"""
from __future__ import annotations

import os
from pathlib import Path
import pwd
import shlex
import shutil
import stat
import subprocess
import tempfile
import textwrap
import unittest


SCRIPT = Path(os.environ.get(
    "MMX_TERMINAL_BUILD_SCRIPT",
    str(Path(__file__).resolve().parents[1] / "ops" / "terminal-build.sh"),
)).resolve()


def run_lib(body: str, script: Path = SCRIPT) -> subprocess.CompletedProcess[str]:
    """Source the real library, as in the r2 run_lib harness; never run main."""
    bash = shutil.which("bash")
    if bash is None:
        raise AssertionError("bash is required to exercise the cache owner")
    driver = textwrap.dedent(f"""\
        . {shlex.quote(str(script))}
        set +e
        {textwrap.dedent(body)}
    """)
    return subprocess.run(
        [bash, "-c", driver], capture_output=True, text=True, timeout=20,
    )


def snapshot(path: Path) -> tuple:
    """Read known fixture objects without following a symlink."""
    metadata = path.lstat()
    if stat.S_ISLNK(metadata.st_mode):
        content = ("symlink", os.readlink(path))
    elif stat.S_ISREG(metadata.st_mode):
        content = ("file", path.read_bytes())
    elif stat.S_ISDIR(metadata.st_mode):
        content = ("directory", tuple(sorted(p.name for p in path.iterdir())))
    else:
        content = ("special", None)
    return (
        stat.S_IFMT(metadata.st_mode), stat.S_IMODE(metadata.st_mode),
        metadata.st_uid, metadata.st_gid, metadata.st_dev, metadata.st_ino,
        metadata.st_nlink, content,
    )


class BetaCacheCustodyTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="mmx-beta-cache-custody-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.beta = self.root / "beta"
        self.app = self.beta / "terminal"
        self.next = self.app / ".next"
        self.cache = self.next / "cache"
        self.next.mkdir(parents=True)
        for path in (self.beta, self.app, self.next):
            path.chmod(0o700)
        self.account = pwd.getpwuid(os.geteuid())
        # This executable build sentinel must never become cache-owned/writable.
        self.build = self.next / "BUILD_ID"
        self.build.write_bytes(b"immutable build outside the cache\n")
        self.build.chmod(0o600)
        self.build_before = snapshot(self.build)

    def make_cache(self) -> tuple[list[Path], list[Path]]:
        nested = self.cache / "fetch-cache" / "nested"
        nested.mkdir(parents=True)
        directories = [self.cache, self.cache / "fetch-cache", nested]
        files = [self.cache / "root.bin", nested / "payload.bin"]
        for directory in directories:
            directory.chmod(0o700)
        for index, path in enumerate(files):
            path.write_bytes(f"cache fixture {index}\n".encode())
            path.chmod(0o600)
        return directories, files

    def external_sentinel(self) -> tuple[Path, Path]:
        external = self.root / "external-publication"
        external.mkdir(mode=0o700)
        external.chmod(0o700)
        sentinel = external / "published.bin"
        sentinel.write_bytes(b"external bytes must remain unchanged\n")
        sentinel.chmod(0o400)
        return external, sentinel

    def prepare(self) -> subprocess.CompletedProcess[str]:
        result = run_lib(f"""\
            TARGET=beta
            BETA_TARGET_ROOT={shlex.quote(str(self.beta))}
            BETA_SERVICE_USER={shlex.quote(self.account.pw_name)}
            beta_prepare_next_cache {shlex.quote(str(self.app))}
        """)
        self.assertEqual(snapshot(self.build), self.build_before,
                         "cache preparation changed executable build custody")
        return result

    def assert_refused_without_changes(self, paths: list[Path], reason: str) -> None:
        before = {path: snapshot(path) for path in paths}
        result = self.prepare()
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn(reason, output)
        self.assertNotIn("beta Next cache prepared:", output)
        for path, expected in before.items():
            self.assertEqual(snapshot(path), expected,
                             f"refused cache preparation mutated {path}")

    def test_nested_restrictive_cache_gets_exact_service_modes(self) -> None:
        directories, files = self.make_cache()
        original_bytes = {path: path.read_bytes() for path in files}
        result = self.prepare()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for path, mode in [(p, 0o750) for p in directories] + [(p, 0o640) for p in files]:
            metadata = path.lstat()
            self.assertEqual(stat.S_IMODE(metadata.st_mode), mode, str(path))
            self.assertEqual((metadata.st_uid, metadata.st_gid),
                             (self.account.pw_uid, self.account.pw_gid), str(path))
        for path, expected in original_bytes.items():
            self.assertEqual(path.read_bytes(), expected)

    def test_nested_symlink_is_refused_without_mutating_external_sentinel(self) -> None:
        directories, files = self.make_cache()
        external, sentinel = self.external_sentinel()
        alias = directories[-1] / "publication-link"
        alias.symlink_to(external, target_is_directory=True)
        self.assert_refused_without_changes(
            directories + files + [alias, external, sentinel], "cannot contain symlinks",
        )

    def test_hardlinked_regular_file_is_refused_without_mutating_external_sentinel(self) -> None:
        directories, files = self.make_cache()
        external, sentinel = self.external_sentinel()
        alias = directories[-1] / "shared-publication.bin"
        os.link(sentinel, alias)
        self.assertEqual(alias.lstat().st_ino, sentinel.lstat().st_ino)
        self.assertEqual(sentinel.lstat().st_nlink, 2)
        self.assert_refused_without_changes(
            directories + files + [alias, external, sentinel], "cannot contain a shared inode",
        )

    def test_cache_root_symlink_is_refused_without_mutating_external_sentinel(self) -> None:
        external, sentinel = self.external_sentinel()
        self.cache.symlink_to(external, target_is_directory=True)
        self.assert_refused_without_changes(
            [self.cache, external, sentinel], "cache must be a real directory",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
