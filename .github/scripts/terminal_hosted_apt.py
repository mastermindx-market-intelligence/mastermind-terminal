#!/usr/bin/env python3
"""Select the official Ubuntu transport on disposable hosted browser runners.

The browser cache has no system fonts. Keep Playwright's dependency installer;
only replace the recognized failing mirror indirection, never APT trust policy.
"""

import fcntl
import os
from pathlib import Path
import platform
import re
import stat


SOURCE = Path("/etc/apt/sources.list.d/ubuntu.sources")
MIRRORS = {
    "mirror+file:/etc/apt/apt-mirrors.txt",
    "http://azure.archive.ubuntu.com/ubuntu",
    "http://azure.archive.ubuntu.com/ubuntu/",
    "https://azure.archive.ubuntu.com/ubuntu",
    "https://azure.archive.ubuntu.com/ubuntu/",
}


def validate_runner(env, release, machine):
    if (env.get("GITHUB_ACTIONS") != "true"
            or env.get("RUNNER_ENVIRONMENT") != "github-hosted"
            or env.get("RUNNER_OS") != "Linux"
            or env.get("RUNNER_ARCH") != "X64"
            or release.get("ID") != "ubuntu"
            or release.get("VERSION_ID") != "24.04"
            or machine != "x86_64"):
        raise ValueError("expected GitHub-hosted Linux X64 Ubuntu 24.04")


def direct_ubuntu_sources(source):
    """Return a validated URI-only edit; reject unknown source shapes in full."""
    parts = re.split(r"(\r?\n[ \t]*\r?\n)", source)
    stanzas = 0
    for index in range(0, len(parts), 2):
        lines = parts[index].splitlines(keepends=True)
        fields = {}
        previous = None
        for line_index, line in enumerate(lines):
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if line[0].isspace():
                if previous is None or previous in {"uris", "suites"}:
                    raise ValueError("unsupported continued source field")
                continue
            match = re.fullmatch(r"([A-Za-z][A-Za-z-]*):[ \t]*(.*?)(?:\r?\n)?", line)
            if not match or match[1].lower() in fields:
                raise ValueError("malformed or duplicate source field")
            previous = match[1].lower()
            fields[previous] = (line_index, match[2])
        if not fields:
            continue
        if "uris" not in fields or "suites" not in fields:
            raise ValueError("missing Ubuntu URI or suite")
        uri_index, value = fields["uris"]
        uris = value.split()
        suites = fields["suites"][1].split()
        if len(uris) != 1 or not suites or len(set(suites)) != len(suites):
            raise ValueError("ambiguous Ubuntu URI or suite")
        if suites == ["noble-security"]:
            host = "security.ubuntu.com"
        elif set(suites) <= {"noble", "noble-updates", "noble-backports"}:
            host = "archive.ubuntu.com"
        else:
            raise ValueError("unsupported Ubuntu suite composition")
        target = f"https://{host}/ubuntu/"
        direct = {f"{scheme}://{host}/ubuntu{suffix}"
                  for scheme in ("http", "https") for suffix in ("", "/")}
        if uris[0] not in MIRRORS | direct:
            raise ValueError("unrecognized Ubuntu source URI")
        if uris[0] in MIRRORS:
            original = lines[uri_index]
            # Preserve the spelling, spacing, newline and every other field.
            lines[uri_index] = original.replace(uris[0], target, 1)
            parts[index] = "".join(lines)
        stanzas += 1
    if not stanzas:
        raise ValueError("no Ubuntu source stanza")
    return "".join(parts)


def validate_source_identity(original, opened, named):
    for current in (opened, named):
        if (not stat.S_ISREG(current.st_mode) or current.st_nlink != 1
                or current.st_uid != 0
                or (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino)):
            raise ValueError("Ubuntu source path or custody changed")


def main():
    validate_runner(os.environ, platform.freedesktop_os_release(), platform.machine())
    if os.geteuid() != 0:
        raise ValueError("hosted Ubuntu source preparation requires root")
    # Lock the original descriptor and reject observed pathname replacement.
    # Keeping this inode preserves its owner and mode.
    fd = os.open(SOURCE, os.O_RDWR | os.O_NOFOLLOW)
    with os.fdopen(fd, "r+b") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        meta = os.fstat(stream.fileno())
        if not stat.S_ISREG(meta.st_mode) or meta.st_nlink != 1 or meta.st_uid != 0:
            raise ValueError("unexpected Ubuntu source file custody")
        before = stream.read(65537)
        if len(before) > 65536:
            raise ValueError("unexpected Ubuntu source file size")
        after = direct_ubuntu_sources(before.decode("utf-8")).encode("utf-8")
        validate_source_identity(meta, os.fstat(stream.fileno()), SOURCE.stat(follow_symlinks=False))
        stream.seek(0)
        if stream.read() != before:
            raise ValueError("Ubuntu source preimage changed")
        if after != before:
            stream.seek(0)
            stream.write(after)
            stream.truncate()
            stream.flush()
            os.fsync(stream.fileno())
            stream.seek(0)
            if stream.read() != after:
                raise RuntimeError("Ubuntu source readback mismatch")
        validate_source_identity(meta, os.fstat(stream.fileno()), SOURCE.stat(follow_symlinks=False))
        print("Hosted Ubuntu sources: official archive transport verified; trust fields preserved.")


if __name__ == "__main__":
    main()
