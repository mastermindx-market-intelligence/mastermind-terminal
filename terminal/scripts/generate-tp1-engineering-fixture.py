"""Regenerate one synthetic golden using the accepted Macro Python projector.

Run with --source-checkout pointing to the unchanged TP-1 source pin below.
This is local serializer compatibility evidence, not licensed tape or capture proof.
"""
import argparse
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import sys

SOURCE_SHA = "a3879855b943e1007e43750b38aedd185d745cb9"
GOLDEN_SHA = "9879018af385139f145067551aff97fbce5b242327826cd42bf01a8d26f80798"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source-checkout", required=True, type=Path)
args = parser.parse_args()
source = args.source_checkout.resolve()
head = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
if head != SOURCE_SHA:
    raise SystemExit("Refused: source checkout is not the pinned TP-1 implementation.")
if subprocess.run(["git", "-C", str(source), "diff", "--quiet", "HEAD", "--",
                   "engine", "tests/test_tick_plane_minute_projection.py"], check=False).returncode:
    raise SystemExit("Refused: source generator or imported source files differ from the pin.")

sys.dont_write_bytecode = True
sys.path.insert(0, str(source))
spec = importlib.util.spec_from_file_location(
    "tp1_synthetic_test_helpers", source / "tests/test_tick_plane_minute_projection.py")
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
from engine.tick_plane.private_minute_artifact import project_private_minute, verify_private_minute_bytes

sample = helpers.row("synthetic-engineering-1", gross="0.0000001")
sample["gross_source_shares"] = "0.0000001"
minute = helpers.run([sample])
receipt = project_private_minute(source_minute=minute, source_manifest_sha256="e" * 64)
blob = receipt["bytes_private_only"]
body = verify_private_minute_bytes(expected_sha256=receipt["sha256"],
    expected_byte_length=receipt["byte_length"], blob=blob)
assert body["notional_usd"]["gross_sampled_notional_usd"] == "100E-9"
assert body["volume_shares"]["source_all_printed_shares"] == "100E-9"
assert receipt["state"] == "NOT_PUBLISHED" and receipt["source_custody_proven"] is False
assert len(blob) == 2362 and hashlib.sha256(blob).hexdigest() == GOLDEN_SHA
target = Path(__file__).resolve().parent.parent / "lib/__tests__/fixtures/tp1PrivateEngineering.synthetic.v0.json"
if target.exists() and target.read_bytes() != blob:
    raise SystemExit("Refused: existing golden differs; preserve it for review.")
target.write_bytes(blob)
print(f"{target.name}: {len(blob)} bytes; SHA-256 {GOLDEN_SHA}")
print("Actual pinned Python projector and verifier; synthetic compatibility only.")
