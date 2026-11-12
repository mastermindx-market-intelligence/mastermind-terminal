"""Exercise the actual CJK dependency owner without a network or a browser.

Synthetic faces discriminate missing-glyph/closest-font false positives. The
optional native Fontconfig case uses a local Latin font only to verify private
configuration and duplicate-family isolation; it is not Chinese browser proof.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from types import SimpleNamespace
import xml.etree.ElementTree as ET

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".github/scripts/terminal_cjk_font.py"
FONT_STEP = "Prepare pinned CJK font for browser proof"
spec = importlib.util.spec_from_file_location("terminal_cjk_font_contract", SCRIPT)
font = importlib.util.module_from_spec(spec)
spec.loader.exec_module(font)


@pytest.fixture
def rig(tmp_path, monkeypatch):
    data, license_bytes = b"pinned font fixture", b"synthetic license fixture\n"
    pin = {"fileName": "Fixture.otf", "family": "Fixture CJK", "postScriptName": "FixtureCJK-Regular",
           "bytes": len(data), "sha256": font.sha256(data), "gitBlobSha": font.git_blob_sha(data),
           "requiredText": "新闻暂时不可用", "copyright": "Synthetic fixture only",
           "url": "https://raw.githubusercontent.com/notofonts/noto-cjk/pinned/fixture.otf"}
    base = tmp_path / "base.conf"; base.write_text("<fontconfig/>\n")
    exports = tmp_path / "github-env"; exports.write_text("EXISTING=retained\n")
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "RUNNER_TEMP": str(tmp_path),
           "GITHUB_ENV": str(exports), "FONTCONFIG_FILE": str(base),
           "GITHUB_REPOSITORY": "owner/repo", "GITHUB_RUN_ID": "42",
           "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "terminal-e2e"}
    requests, commands = [], []
    original_which, original_run = shutil.which, font.run_fontconfig

    def fake_open(request, timeout):
        requests.append((request.full_url, timeout))
        return io.BytesIO(data)

    def fake_fontconfig(args, scoped):
        commands.append((args, dict(scoped)))
        if args[0] == "fc-cache":
            return ""
        directory = ET.parse(scoped["FONTCONFIG_FILE"]).getroot().find("dir").text
        return f"{Path(directory) / pin['fileName']}\n{pin['family']}\n{pin['postScriptName']}\n3400-9fff\n"

    monkeypatch.setattr(font, "load_pin", lambda: (pin, json.dumps(pin).encode(), license_bytes))
    monkeypatch.setattr(font.urllib.request, "urlopen", fake_open)
    monkeypatch.setattr(font, "run_fontconfig", fake_fontconfig)
    monkeypatch.setattr(font.shutil, "which", lambda command, path=None: "/usr/bin/" + command)
    return SimpleNamespace(pin=pin, data=data, env=env, exports=exports, base=base,
                           requests=requests, commands=commands, fake_fontconfig=fake_fontconfig,
                           original_which=original_which, original_run=original_run)


def exported_env(rig):
    return {**rig.env, **dict(line.split("=", 1) for line in rig.exports.read_text().splitlines())}


def test_verified_private_setup_exports_only_after_success_and_can_be_revalidated(rig):
    result = font.install(rig.env)
    active = exported_env(rig)
    assert font.verify(active) == result
    assert active["EXISTING"] == "retained"
    assert Path(result["font"]["file"]).is_relative_to(Path(rig.env["RUNNER_TEMP"]))
    assert result["fontconfig"]["baseFile"] == str(rig.base)
    assert rig.requests == [(rig.pin["url"], 20)]
    assert all(Path(env["FONTCONFIG_FILE"]).parent.name.startswith("terminal-cjk-")
               for _, env in rig.commands)
    before = rig.exports.read_bytes()
    font.verify(active)
    assert rig.exports.read_bytes() == before
    assert len(rig.requests) == 1


@pytest.mark.parametrize("bad", [b"short", b"x" * 19, b"too long for this pinned font"])
def test_invalid_download_cannot_export_a_browser_environment(rig, monkeypatch, bad):
    monkeypatch.setattr(font.urllib.request, "urlopen", lambda *args, **kwargs: io.BytesIO(bad))
    with pytest.raises(AssertionError):
        font.install(rig.env)
    assert rig.exports.read_text() == "EXISTING=retained\n"
    assert rig.commands == []


def test_transport_failure_does_not_retry_or_export(rig, monkeypatch):
    attempts = []
    def failed(*args, **kwargs):
        attempts.append(1)
        raise TimeoutError("fixture transport timeout")
    monkeypatch.setattr(font.urllib.request, "urlopen", failed)
    with pytest.raises(TimeoutError):
        font.install(rig.env)
    assert attempts == [1]
    assert rig.exports.read_text() == "EXISTING=retained\n"


@pytest.mark.parametrize("kind", ["path", "family", "postscript", "missing-glyphs"])
def test_successful_closest_match_without_the_required_face_is_rejected(rig, monkeypatch, kind):
    def wrong(args, env):
        result = rig.fake_fontconfig(args, env)
        if args[0] != "fc-match":
            return result
        rows = result.splitlines()
        index, value = {"path": (0, "/unowned/fallback.ttf"), "family": (1, "Last Resort"),
                        "postscript": (2, "WrongFace"), "missing-glyphs": (3, "20-7e")}[kind]
        rows[index] = value
        return "\n".join(rows) + "\n"
    monkeypatch.setattr(font, "run_fontconfig", wrong)
    with pytest.raises(AssertionError):
        font.install(rig.env)
    assert rig.exports.read_text() == "EXISTING=retained\n"


@pytest.mark.parametrize("kind", ["font", "config", "base", "license", "workflow"])
def test_capture_revalidation_rejects_changed_dependency_state(rig, kind):
    result = font.install(rig.env)
    active = exported_env(rig)
    if kind == "font":
        Path(result["font"]["file"]).write_bytes(b"changed font")
    elif kind == "config":
        Path(active["FONTCONFIG_FILE"]).write_text("<fontconfig/>\n")
    elif kind == "base":
        rig.base.write_text("<fontconfig><!-- changed --></fontconfig>\n")
    elif kind == "license":
        (Path(result["font"]["file"]).parent / "OFL.txt").write_text("changed license")
    else:
        active["GITHUB_JOB"] = "another-job"
    with pytest.raises(AssertionError):
        font.verify(active)


def test_optimized_python_is_explicitly_rejected(tmp_path):
    result = subprocess.run([sys.executable, "-O", str(SCRIPT), "--verify"], cwd=tmp_path,
                            capture_output=True, text=True, timeout=5)
    assert result.returncode != 0
    assert "Optimized Python cannot run CJK dependency verification" in result.stderr


@pytest.mark.skipif(not all(shutil.which(x) for x in ["fc-cache", "fc-query", "fc-match"]),
                    reason="Optional real Fontconfig integration requires its native CLI")
def test_real_fontconfig_uses_the_private_copy_even_when_the_family_already_exists(rig, monkeypatch):
    pattern = subprocess.check_output(["fc-match", "--format", "%{file}\n%{family[0]}\n%{postscriptname}\n",
                                       "DejaVu Sans:style=Book"], text=True).splitlines()
    source, family, postscript = pattern
    if family != "DejaVu Sans":
        pytest.skip("Optional native test requires the existing libre DejaVu Sans fixture")
    data = Path(source).read_bytes()
    rig.pin.update(bytes=len(data), sha256=font.sha256(data), gitBlobSha=font.git_blob_sha(data),
                   family=family, postScriptName=postscript, requiredText="ABC123", fileName="Fixture.ttf")
    monkeypatch.setattr(font.urllib.request, "urlopen", lambda *args, **kwargs: io.BytesIO(data))
    monkeypatch.setattr(font, "run_fontconfig", rig.original_run)
    monkeypatch.setattr(font.shutil, "which", rig.original_which)
    rig.env["FONTCONFIG_FILE"] = "/etc/fonts/fonts.conf"
    result = font.install(rig.env)
    assert result["resolvedFace"]["file"] != source
    assert Path(result["resolvedFace"]["file"]).is_relative_to(Path(rig.env["RUNNER_TEMP"]))
    assert result["font"]["sha256"] == hashlib.sha256(data).hexdigest()
    assert font.verify(exported_env(rig)) == result


CONSUMERS = [("ci.yml", "terminal-unit", "Capture current-source E18 alert-management evidence"),
             ("ci.yml", "terminal-e2e", None),
             ("ci.yml", "terminal-e2e-prodbuild", "Run allowlisted specs against next start"),
             ("e2e-prodbuild-canary.yml", "canary-legs", "Run Playwright (timed)")]


def font_steps():
    found = []
    for filename, job, consumer in CONSUMERS:
        workflow = yaml.safe_load((ROOT / ".github/workflows" / filename).read_text())
        steps = workflow["jobs"][job]["steps"]
        indices = [i for i, step in enumerate(steps) if step.get("name") == FONT_STEP]
        assert len(indices) == 1
        index = indices[0]
        browser = [i for i, step in enumerate(steps)
                   if step.get("name") in ["Prepare Chromium for original mock captures",
                                           "Install Playwright browsers (apt bounded, browser-only fallback)",
                                           "Ensure browser present on cache hit"]]
        assert browser and max(browser) < index
        consumer_index = next(i for i, step in enumerate(steps)
                              if (step.get("name") == consumer if consumer else
                                  step.get("run", "").startswith("npm run test:e2e:responsive")))
        assert index < consumer_index
        found.append(steps[index])
    return found


def test_all_four_browser_consumers_require_the_same_bounded_font_step():
    steps = font_steps()
    assert all(step == steps[0] for step in steps)
    assert "if" not in steps[0] and not steps[0].get("continue-on-error", False)
    assert steps[0]["working-directory"] == "terminal"
    assert steps[0]["timeout-minutes"] == 3
    assert steps[0]["run"] == (
        "timeout --signal=TERM --kill-after=15s 120s python3 -I ../.github/scripts/terminal_cjk_font.py --install")
    assert 120 + 15 < 3 * 60


@pytest.mark.parametrize("exit_code", [0, 1, 124])
def test_actual_font_step_failure_blocks_the_browser_consumer(exit_code):
    mocks = r'''
timeout() {
  [ "$1 $2 $3" = "--signal=TERM --kill-after=15s 120s" ] || return 96
  shift 3
  "$@"
}
python3() {
  [ "$*" = "-I ../.github/scripts/terminal_cjk_font.py --install" ] || return 97
  return "$FONT_EXIT"
}
'''
    result = subprocess.run(["bash", "-e", "-c", mocks + font_steps()[0]["run"] + "\necho REACHED_BROWSER\n"],
                            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "FONT_EXIT": str(exit_code)},
                            capture_output=True, text=True, timeout=5)
    assert (result.returncode == 0) is (exit_code == 0)
    assert ("REACHED_BROWSER" in result.stdout) is (exit_code == 0)
