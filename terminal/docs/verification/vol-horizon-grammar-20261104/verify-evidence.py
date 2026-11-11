#!/usr/bin/env python3
"""Check the actual recaptured packets and record portable file provenance."""
import hashlib
import json
import re
import struct
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
TERMINAL = HERE.parents[2]
REPO = TERMINAL.parent
PACKS = {
    "options-r1-w3": 24,
    "options-ac40-tenor-asof": 18,
    "options-ac40-tenor-asof-light": 18,
    "vol-load-failure": 48,
}
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def image_row(path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path
    width, height = struct.unpack(">II", data[16:24])
    assert width > 0 and height > 0, path
    return {"path": str(path.relative_to(REPO)), "sha256": sha(path),
            "bytes": len(data), "width": width, "height": height}

packets = []
for name, expected_count in PACKS.items():
    folder = TERMINAL / "docs/pr-crops" / name
    evidence = folder / "EVIDENCE.yml"
    text = evidence.read_text()
    pairs = re.findall(r"^  - path: (.+)\n    sha256: ([a-f0-9]{64})$", text, re.M)
    pairs += re.findall(r'^  (terminal/[^:]+): "?([a-f0-9]{64})"?$', text, re.M)
    assert pairs, name
    for relative, expected in pairs:
        assert sha(REPO / relative) == expected, (name, relative)
    blocks = {}
    current = None
    for line in text.splitlines():
        if line.startswith("  - file: "):
            current = line[len("  - file: "):]
        elif current and line.startswith("    sha256: "):
            blocks[current] = line[len("    sha256: "):]
    for filename, expected in blocks.items():
        assert sha(folder / filename) == expected, (name, filename)
    images = [image_row(p) for p in sorted(folder.glob("*.png"))]
    assert len(images) == expected_count, (name, len(images), expected_count)
    for row in images:
        assert Path(row["path"]).name in text, (name, row["path"])
    packets.append({"name": name, "evidence_sha256": sha(evidence),
                    "verified_source_pins": len(pairs), "crops": images})

browser = [image_row(p) for p in sorted((HERE / "browser").glob("*.png"))]
assert len(browser) == 24, len(browser)
history = subprocess.check_output(
    ["git", "diff", "--name-only", "--", "terminal/docs/pr-crops/*/EVIDENCE.json"],
    cwd=REPO, text=True,
)
assert not history.strip(), history
source_paths = [
    "terminal/components/vol/VolComparePanel.tsx",
    "terminal/components/vol/volStrings.ts",
    "terminal/lib/__tests__/volCompareTenorAsofClock.test.tsx",
    "terminal/lib/__tests__/volCompareHorizonGrammar.test.tsx",
    "terminal/e2e/vol-horizon-grammar.spec.ts",
]
manifest = {
    "base_sha": "0f03615e86ed63f00ad9b294c7a5c909bad7b70a",
    "source_files": [{"path": p, "sha256": sha(REPO / p)} for p in source_paths],
    "packets": packets,
    "focused_browser_crops": browser,
    "historical_evidence_json_unchanged": True,
    "result": "PASS",
}
(HERE / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("PASS: 4 real packets / 108 crops, 24 focused browser crops; all source and crop pins match; historical JSON unchanged.")
