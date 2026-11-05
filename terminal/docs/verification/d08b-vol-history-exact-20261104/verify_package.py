#!/usr/bin/env python3
"""Verify this immutable proof package; --write explicitly generates its metadata."""
from pathlib import Path
import hashlib
import json
import struct
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = "ee40d56dfdd447ec7f01e4075aac70275195f160"


def digest(path):
    data = path.read_bytes()
    result = {
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "gitBlob": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest(),
    }
    if path.suffix == ".png":
        result["dimensions"] = list(struct.unpack(">II", data[16:24]))
    return result


review = json.loads((HERE / "source-review.json").read_text())
sources = {name: digest(ROOT / name) for name in review["current_blobs"]}
for name, expected in review["current_blobs"].items():
    assert sources[name]["gitBlob"] == expected, name
owner_paths = [
    "components/vol/volShared.tsx", "components/vol/volTypes.ts",
    "components/vol/VolView.tsx", "components/vol/volStrings.ts",
    "components/charts/svgChart.ts", "lib/exposureSurface.ts",
    "e2e/d08bPanelPresentation.ts",
    "components/vol/VolTermPanel.tsx", "components/vol/VolTermPanel.module.css", "components/vol/volTermStrings.ts",
    "components/vol/VolSkewPanel.tsx", "components/vol/VolSkewPanel.module.css", "components/vol/volSkewStrings.ts",
]
owners = {}
for name in owner_paths:
    original = subprocess.check_output(["git", "show", f"{BASE}:terminal/{name}"], cwd=ROOT)
    assert (ROOT / name).read_bytes() == original, name
    owners[name] = digest(ROOT / name)
assert "100 passed" in (HERE / "unit.log").read_text()
browser = (HERE / "browser.log").read_text()
assert "8 passed" in browser and "4 skipped" in browser
combined = (HERE / "browser-combined.log").read_text()
assert "32 passed" in combined and "10 skipped" in combined
assert (HERE / "eslint.log").stat().st_size == 0
build = (HERE / "build.log").read_text()
assert "Compiled successfully" in build and "Generating static pages" in build and "Failed to" not in build
captures = list((HERE / "browser").glob("*.png"))
assert len(captures) == 51
metadata = list((HERE / "capture-metadata").glob("*.json"))
assert len(metadata) == 51
for path in metadata:
    item = json.loads(path.read_text())
    image_path = HERE / "browser" / path.name.replace("-capture.json", ".png")
    viewport = item["viewport"]
    assert item["fullPage"] is False
    assert digest(image_path)["dimensions"] == [int(viewport["width"] * item["devicePixelRatio"]), int(viewport["height"] * item["devicePixelRatio"])], path
    rect = item["target"]
    assert rect["left"] >= -1 and rect["top"] >= -1
    assert rect["left"] + rect["width"] <= item["innerWidth"] + 1
    assert rect["top"] + rect["height"] <= item["innerHeight"] + 1
for path in captures:
    assert tuple(digest(path)["dimensions"]) in {(1440, 900), (820, 1180), (390, 844), (320, 844)}, path
samples = [json.loads(path.read_text()) for path in (HERE / "contrast").glob("*.json")]
assert len(samples) == 24
texts = [item for sample in samples for item in sample["text"]]
marks = [item for sample in samples for item in sample["marks"]]
assert len(texts) == 764 and min(item["ratio"] for item in texts) >= 4.5
assert len(marks) == 60 and min(item["ratio"] for item in marks) >= 3
result = {
    "schema": "d08b.vol_history_verification.v1",
    "outcome": "BUILT_NOT_PROVEN",
    "unit_passed": 100, "lint": "PASS", "build": "PASS",
    "browser": {"final_history_passed": 8, "intentional_skips": 4, "combined_passed": 32, "combined_intentional_skips": 10},
    "captures": {"current_viewport_pngs": 51, "bound_metadata": 51, "before_phone_pngs": 1},
    "contrast": {
        "text_samples": len(texts), "text_min": min(item["ratio"] for item in texts),
        "mark_samples": len(marks), "mark_min": min(item["ratio"] for item in marks),
    },
    "source_review": "Independent source PASS plus explicitly root-reviewed final CSS/test delta",
    "limits": ["Controlled source fixture through actual route", "Panel light-token compatibility only", "CSS zoom2, not native/text zoom or full400percent audit", "No production deployment or whole-program acceptance"],
    "held_actions": ["merge", "Ready", "un-draft", "enqueue", "held relabel", "deployment"],
}
if "--write" in sys.argv:
    (HERE / "source-blobs.json").write_text(json.dumps({"source": sources, "unchanged_owners": owners}, indent=2) + "\n")
    (HERE / "VERIFICATION_RESULT.json").write_text(json.dumps(result, indent=2) + "\n")
    files = {str(path.relative_to(HERE)): digest(path) for path in sorted(HERE.rglob("*")) if path.is_file() and path.name != "MANIFEST.json"}
    (HERE / "MANIFEST.json").write_text(json.dumps({"schema": "d08b.proof_manifest.v1", "selfHashExcluded": True, "files": files}, indent=2) + "\n")
else:
    manifest = json.loads((HERE / "MANIFEST.json").read_text())
    for name, expected in manifest["files"].items():
        assert digest(HERE / name) == expected, name
    assert json.loads((HERE / "VERIFICATION_RESULT.json").read_text()) == result
print(json.dumps(result, indent=2))
