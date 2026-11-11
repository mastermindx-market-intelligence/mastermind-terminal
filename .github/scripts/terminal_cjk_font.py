#!/usr/bin/env python3
"""Provide one pinned CJK fallback in a private CI job, then revalidate it.

Browser/apt setup remains the existing workflow owner's responsibility. This
helper never installs system packages, changes product CSS, or writes shared
font directories. --verify performs no download or environment-file mutation.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET

if sys.flags.optimize:
    raise RuntimeError("Optimized Python cannot run CJK dependency verification")

REPO = Path(__file__).resolve().parents[2]
PIN_PATH = REPO / ".github/fonts/noto-cjk/pin.json"
PROBE = "sans-serif:lang=zh-cn"
FORMAT = "%{file}\n%{family[0]}\n%{postscriptname}\n%{charset}\n"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def regular_bytes(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Expected a regular, non-symlink file: {path}")
    return path.read_bytes()


def load_pin():
    raw = regular_bytes(PIN_PATH)
    pin = json.loads(raw)
    assert pin["schema"] == "terminal.cjk-font-pin.v1"
    assert re.fullmatch(r"[0-9a-f]{40}", pin["commit"])
    assert re.fullmatch(r"[0-9a-f]{64}", pin["sha256"])
    assert 0 < pin["bytes"] <= 32 * 1024 * 1024
    assert pin["fileName"] == Path(pin["fileName"]).name
    assert pin["url"] == (
        f"https://raw.githubusercontent.com/{pin['repository']}/{pin['commit']}/{pin['path']}"
    )
    license_bytes = regular_bytes(REPO / pin["license"]["path"])
    assert len(license_bytes) == pin["license"]["bytes"]
    assert git_blob_sha(license_bytes) == pin["license"]["gitBlobSha"]
    return pin, raw, license_bytes


def validate_font(data, pin):
    assert len(data) == pin["bytes"], "Pinned font byte length differs"
    assert sha256(data) == pin["sha256"], "Pinned font SHA-256 differs"
    assert git_blob_sha(data) == pin["gitBlobSha"], "Pinned upstream Git blob differs"


def download_font(pin):
    request = urllib.request.Request(pin["url"], headers={"User-Agent": "Terminal-CI-font-dependency"})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read(pin["bytes"] + 1)
    validate_font(data, pin)
    return data


def configuration(root, base, pin):
    family = pin["family"]
    document = ET.Element("fontconfig")
    # Fontconfig writes its first accessible cache. Keep this before the base
    # include so simultaneous ubuntu0 slots cannot share this job's cache.
    ET.SubElement(document, "cachedir").text = str(root / "cache")
    ET.SubElement(document, "include", {"ignore_missing": "no"}).text = str(base)
    ET.SubElement(document, "dir").text = str(root / "fonts")
    # A runner may already have another version of this family. Keep its files
    # untouched, but select only our pinned face within this private config.
    selection = ET.SubElement(document, "selectfont")
    rejected = ET.SubElement(ET.SubElement(selection, "rejectfont"), "pattern")
    property_ = ET.SubElement(rejected, "patelt", {"name": "family"})
    ET.SubElement(property_, "string").text = family
    accepted = ET.SubElement(ET.SubElement(selection, "acceptfont"), "pattern")
    property_ = ET.SubElement(accepted, "patelt", {"name": "file"})
    ET.SubElement(property_, "string").text = str(root / "fonts" / pin["fileName"])
    # Keep the base's Latin environment; prefer the pinned native fallback only
    # for Chinese generic sans requests. This does not inject a page stylesheet.
    match = ET.SubElement(document, "match", {"target": "pattern"})
    test = ET.SubElement(match, "test", {"name": "lang", "compare": "contains"})
    ET.SubElement(test, "string").text = "zh"
    test = ET.SubElement(match, "test", {"name": "family", "compare": "eq"})
    ET.SubElement(test, "string").text = "sans-serif"
    edit = ET.SubElement(match, "edit", {"name": "family", "mode": "prepend_first", "binding": "strong"})
    ET.SubElement(edit, "string").text = family
    return (b'<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n'
            + ET.tostring(document, encoding="utf-8") + b"\n")


def charset_ranges(value):
    ranges = []
    for token in value.split():
        if not re.fullmatch(r"[0-9a-fA-F]+(?:-[0-9a-fA-F]+)?", token):
            raise ValueError("Unrecognized Fontconfig charset")
        parts = token.split("-")
        low, high = int(parts[0], 16), int(parts[-1], 16)
        assert 0 <= low <= high <= 0x10FFFF
        ranges.append([low, high])
    assert ranges, "Fontconfig returned no glyph coverage"
    return ranges


def run_fontconfig(args, env):
    result = subprocess.run(args, env=env, capture_output=True, text=True, check=True, timeout=30)
    return result.stdout


def face(args, env, font_path, pin):
    rows = run_fontconfig(args, env).splitlines()
    assert len(rows) == 4, "Incomplete Fontconfig face record"
    assert Path(rows[0]).resolve() == font_path, "Fontconfig selected an unpinned fallback"
    assert rows[1] == pin["family"], "Font family differs"
    assert rows[2] == pin["postScriptName"], "PostScript face differs"
    ranges = charset_ranges(rows[3])
    missing = [f"U+{ord(char):04X}" for char in sorted(set(pin["requiredText"]))
               if not any(low <= ord(char) <= high for low, high in ranges)]
    assert not missing, "Missing required Chinese glyphs: " + ", ".join(missing)
    return {"file": str(font_path), "family": rows[1], "postScriptName": rows[2],
            "charsetRanges": ranges, "requiredText": pin["requiredText"]}


def snapshot(root, base, env, pin, pin_bytes, license_bytes):
    root, base = Path(root), Path(base)
    font_path = root / "fonts" / pin["fileName"]
    data = regular_bytes(font_path)
    validate_font(data, pin)
    config_path = root / "fonts.conf"
    config_bytes = regular_bytes(config_path)
    cache = root / "cache"
    assert cache.is_dir() and not cache.is_symlink() and os.access(cache, os.W_OK), "Private font cache is unavailable"
    assert config_bytes == configuration(root, base, pin), "Job font configuration changed"
    assert env.get("FONTCONFIG_FILE") == str(config_path), "Job font configuration is not active"
    assert regular_bytes(root / "fonts/OFL.txt") == license_bytes
    assert regular_bytes(root / "fonts/COPYRIGHT.txt").decode("utf-8") == pin["copyright"] + "\n"
    inspected = face(["fc-query", "--format", FORMAT, str(font_path)], env, font_path, pin)
    resolved = face(["fc-match", "--format", FORMAT, PROBE], env, font_path, pin)
    assert inspected == resolved, "Resolved CJK face differs from the inspected pinned face"
    return {"pinSha256": sha256(pin_bytes),
            "font": {"file": str(font_path), "sha256": sha256(data), "bytes": len(data),
                     "gitBlobSha": pin["gitBlobSha"], "licenseSha256": sha256(license_bytes)},
            "fontconfig": {"file": str(config_path), "sha256": sha256(config_bytes),
                           "baseFile": str(base), "baseSha256": sha256(regular_bytes(base)),
                           "cacheDirectory": str(root / "cache")},
            "resolvedFor": PROBE, "resolvedFace": resolved}


def verify(env=None):
    env = dict(os.environ if env is None else env)
    pin, pin_bytes, license_bytes = load_pin()
    receipt_path = Path(env["TERMINAL_CJK_FONT_RECEIPT"])
    receipt_bytes = regular_bytes(receipt_path)
    receipt = json.loads(receipt_bytes)
    assert receipt["schema"] == "terminal.cjk-font-setup.v1"
    assert receipt["workflow"] == {
        "repository": env.get("GITHUB_REPOSITORY"), "run": env.get("GITHUB_RUN_ID"),
        "attempt": env.get("GITHUB_RUN_ATTEMPT"), "job": env.get("GITHUB_JOB")}, "Font receipt belongs to another job"
    root = receipt_path.parent.resolve()
    assert root.is_relative_to(Path(env["RUNNER_TEMP"]).resolve()), "Font receipt is outside this runner's temp root"
    assert receipt_path.name == "receipt.json"
    observed = snapshot(root, receipt["snapshot"]["fontconfig"]["baseFile"], env, pin, pin_bytes, license_bytes)
    assert observed == receipt["snapshot"], "Prepared font environment changed"
    return {"schema": "terminal.cjk-font-runtime.v1", "receiptSha256": sha256(receipt_bytes),
            "workflow": receipt["workflow"], **observed}


def install(env=None):
    env = dict(os.environ if env is None else env)
    pin, pin_bytes, license_bytes = load_pin()
    temp_root = Path(env["RUNNER_TEMP"]).resolve(strict=True)
    env_file = Path(env["GITHUB_ENV"])
    assert env_file.is_absolute() and not env_file.is_symlink() and env_file.is_file()
    assert not any(char in str(temp_root) + str(env_file) for char in "\r\n")
    base = Path(env.get("FONTCONFIG_FILE") or "/etc/fonts/fonts.conf").resolve(strict=True)
    regular_bytes(base)
    for command in ["fc-cache", "fc-query", "fc-match"]:
        if not shutil.which(command, path=env.get("PATH")):
            raise RuntimeError(f"Required existing Fontconfig command is unavailable: {command}")
    root = Path(tempfile.mkdtemp(prefix="terminal-cjk-", dir=temp_root)).resolve()
    (root / "fonts").mkdir(); (root / "cache").mkdir()
    data = download_font(pin)
    temporary = root / "font.download"
    temporary.write_bytes(data)
    temporary.replace(root / "fonts" / pin["fileName"])
    (root / "fonts/OFL.txt").write_bytes(license_bytes)
    (root / "fonts/COPYRIGHT.txt").write_text(pin["copyright"] + "\n", encoding="utf-8")
    config_path = root / "fonts.conf"
    config_path.write_bytes(configuration(root, base, pin))
    scoped = {**env, "FONTCONFIG_FILE": str(config_path)}
    run_fontconfig(["fc-cache", "--force", str(root / "fonts")], scoped)
    observed = snapshot(root, base, scoped, pin, pin_bytes, license_bytes)
    receipt = {"schema": "terminal.cjk-font-setup.v1", "preparedAt": datetime.now(timezone.utc).isoformat(),
               "workflow": {"repository": env.get("GITHUB_REPOSITORY"), "run": env.get("GITHUB_RUN_ID"),
                            "attempt": env.get("GITHUB_RUN_ATTEMPT"), "job": env.get("GITHUB_JOB")},
               "snapshot": observed}
    receipt_path = root / "receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    scoped["TERMINAL_CJK_FONT_RECEIPT"] = str(receipt_path)
    verified = verify(scoped)
    # Export only after bytes, license, config, resolver and coverage all pass.
    with env_file.open("a", encoding="utf-8") as output:
        output.write(f"FONTCONFIG_FILE={config_path}\nTERMINAL_CJK_FONT_RECEIPT={receipt_path}\n")
    return verified


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("--install", "--verify"):
        raise SystemExit("Use --install or --verify")
    try:
        result = install() if sys.argv[1] == "--install" else verify()
        print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    except Exception as error:
        print(f"CJK font dependency verification failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
