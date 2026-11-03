#!/usr/bin/env python3
"""Fail-closed CI fast-lane classifier for *static* Terminal changes.

This script is loaded from the pull request's trusted BASE tree in CI, never
from the proposed branch. It does not mint reviews, statuses or merge authority.
Only opt-in proof for tiny inert source changes is returned; every ambiguous,
unrecognised, executable, governing or cross-repository change takes full CI.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

MAX_FILES = 6
MAX_CHANGED_LINES = 80
MAX_ASSET_BYTES = 256 * 1024
ALLOWED_DOC_PREFIXES = (
    "terminal/docs/ux-notes/",
    "docs/product-previews/",
)
ALLOWED_ICON_PREFIXES = (
    "terminal/public/icons/",
    "terminal/public/brand-icons/",
)
ALLOWED_RASTER_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
NAME_RE = re.compile(r"^[A-Za-z0-9_./-]+$")
SVG_TAGS = {"svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "title"}
SVG_ATTRS = {
    "xmlns", "viewBox", "width", "height", "fill", "stroke", "stroke-width",
    "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity",
    "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
    "points", "transform", "role", "aria-label", "focusable",
}
SVG_FORBIDDEN = (b"<!", b"<?", b"javascript:", b"data:", b"url(", b"onload=")
SVG_PATH_RE = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9,.+\-\sEe]*$")
SVG_COLOR_RE = re.compile(r"^(?:#[0-9a-fA-F]{3,8}|none|currentColor)$")
SVG_NUMBER_RE = re.compile(r"^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
WEBP_HEAD = b"RIFF"


def _git(repo: Path, *args: str) -> bytes:
    p = subprocess.run(["git", "-C", str(repo), *args], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
    return p.stdout


def _changed_files(repo: Path, base: str, head: str) -> list[tuple[str, str, int, int]] | None:
    """No renames, type swaps, symlinks or submodules earn the fast route."""
    names = _git(repo, "diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", base, head).split(b"\x00")
    stats = _git(repo, "diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", base, head).split(b"\x00")
    if names[-1] != b"" or stats[-1] != b"":
        return None
    names.pop()
    stats.pop()
    if not names or len(names) % 2 or len(stats) != len(names) // 2:
        return None
    result = []
    for i in range(0, len(names), 2):
        try:
            status = names[i].decode("ascii")
            path = names[i + 1].decode("ascii")
            added, deleted, stat_path = stats[i // 2].decode("ascii").split("\t", 2)
        except (UnicodeDecodeError, ValueError):
            return None
        if status not in {"A", "M"} or path != stat_path:
            return None
        if not NAME_RE.fullmatch(path):
            return None
        parts = PurePosixPath(path).parts
        if not parts or "." in parts or ".." in parts or path.startswith("/"):
            return None
        if added == "-" and deleted == "-":
            changes = 0
        elif added.isdecimal() and deleted.isdecimal():
            changes = int(added) + int(deleted)
        else:
            return None
        result.append((status, path, changes, 0 if added == "-" else int(added)))
    return result


def _svg_ok(data: bytes) -> bool:
    if not data.lstrip().startswith(b"<svg") or any(x in data.lower() for x in SVG_FORBIDDEN):
        return False
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return False
    if root.tag.removeprefix("{http://www.w3.org/2000/svg}") != "svg":
        return False
    for node in root.iter():
        tag = node.tag.removeprefix("{http://www.w3.org/2000/svg}")
        if tag not in SVG_TAGS:
            return False
        if tag != "title" and (node.text or "").strip():
            return False
        if node.tail and node.tail.strip():
            return False
        for attr, value in node.attrib.items():
            if attr.startswith("{") or attr not in SVG_ATTRS or len(value) > 4096:
                return False
            if attr == "d" and not SVG_PATH_RE.fullmatch(value):
                return False
            if attr in {"fill", "stroke"} and not SVG_COLOR_RE.fullmatch(value):
                return False
            if attr in {"opacity", "fill-opacity", "stroke-opacity", "width", "height",
                        "stroke-width", "cx", "cy", "r", "rx", "ry", "x", "y",
                        "x1", "y1", "x2", "y2"} and not SVG_NUMBER_RE.fullmatch(value):
                return False
            if attr == "transform" and not re.fullmatch(r"[0-9A-Za-z(),.+\-\s]*", value):
                return False
    return True


def _asset_ok(path: str, data: bytes) -> bool:
    if len(data) == 0 or len(data) > MAX_ASSET_BYTES:
        return False
    if path.endswith(".svg"):
        return _svg_ok(data)
    if path.endswith(".png"):
        return len(data) >= 24 and data.startswith(PNG_SIGNATURE)
    if path.endswith((".jpg", ".jpeg")):
        return len(data) >= 4 and data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9")
    if path.endswith(".webp"):
        return len(data) >= 16 and data.startswith(WEBP_HEAD) and data[8:12] == b"WEBP"
    return False


def _eligible_path(path: str) -> str | None:
    if any(path.startswith(prefix) for prefix in ALLOWED_DOC_PREFIXES) and path.endswith(".md"):
        return "copy"
    if any(path.startswith(prefix) for prefix in ALLOWED_ICON_PREFIXES) and Path(path).suffix in (ALLOWED_RASTER_SUFFIXES | {".svg"}):
        return "asset"
    return None


def classify(repo: Path, base: str, head: str, event: str, head_repo: str, repository: str) -> tuple[str, str]:
    if event != "pull_request" or not repository or head_repo != repository:
        return "full", "non-PR or external head"
    try:
        changes = _changed_files(repo, base, head)
        if not changes or len(changes) > MAX_FILES:
            return "full", "missing, invalid or oversized file set"
        if sum(c[2] for c in changes) > MAX_CHANGED_LINES:
            return "full", "too many changed source lines"
        for _, path, _, _ in changes:
            kind = _eligible_path(path)
            if not kind:
                return "full", f"executable or sensitive path: {path}"
            info = _git(repo, "ls-tree", head, "--", path).decode("ascii").strip()
            if not info.startswith("100644 blob "):
                return "full", f"non-regular file: {path}"
            size = int(_git(repo, "cat-file", "-s", f"{head}:{path}").decode("ascii"))
            if size == 0 or size > MAX_ASSET_BYTES:
                return "full", f"invalid or oversized blob: {path}"
            data = _git(repo, "show", f"{head}:{path}")
            if kind == "asset" and not _asset_ok(path, data):
                return "full", f"unsafe or oversized asset: {path}"
            if kind == "copy" and (len(data) > MAX_ASSET_BYTES or b"\x00" in data):
                return "full", f"unsafe document: {path}"
        return "fast", f"{len(changes)} verified static asset/copy file(s)"
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, UnicodeDecodeError):
        return "full", "git/read error; fail closed"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--repository", required=True)
    p.add_argument("--event", required=True)
    p.add_argument("--head-repo", default="")
    p.add_argument("--repo-root", default=".")
    p.add_argument("--base", default="HEAD^1")
    p.add_argument("--head", default="HEAD")
    args = p.parse_args()
    lane, reason = classify(Path(args.repo_root).resolve(), args.base, args.head,
                            args.event, args.head_repo, args.repository)
    print(json.dumps({"lane": lane, "reason": reason}, sort_keys=True))
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a", encoding="utf-8") as stream:
            stream.write(f"lane={lane}\n")


if __name__ == "__main__":
    main()
