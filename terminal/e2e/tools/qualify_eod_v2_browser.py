"""PR895 fixture export in its existing unit job; never selects current proof.

The original native/browser owners produce the observations. A later immutable
import must validate this export and the same-run PL6/Batch3 artifact together.
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import time
from types import SimpleNamespace
import zipfile

import qualify_r5_alignment_browser as shared

REPO = shared.REPO
TERMINAL = shared.TERMINAL
BRIDGE = TERMINAL / "e2e/tools/qualify_eod_v2_successor.cjs"


def require_cli_result(result):
    # serverSettled from serverRequired=False is intentionally not used here.
    return (result.get("closed") is True and result.get("status") == 0 and
            result.get("signal") is None and result.get("timedOut") is False and not result.get("error"))


def retained_bundle(root):
    """ZIP preserves hidden result members under the existing artifact upload."""
    files = {}
    for file in sorted(root.rglob("*")):
        shared.require(not file.is_symlink(), "symlink in raw export")
        if file.is_file():
            relative = file.relative_to(root).as_posix()
            shared.require(relative not in {"export.zip", "export-inventory.json", "archive-receipt.json"}, "export bundle already exists")
            files[relative] = {"sha256": shared.sha(file), "bytes": file.stat().st_size}
    shared.put(root / "export-inventory.json", {"schema": "terminal_pr895_raw_inventory.v1", "files": files})
    with zipfile.ZipFile(root / "export.zip", "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in [*files, "export-inventory.json"]:
            archive.write(root / name, name)
    with zipfile.ZipFile(root / "export.zip") as archive:
        shared.require(set(archive.namelist()) == {*files, "export-inventory.json"}, "incomplete export archive")
        for name, record in files.items():
            content = archive.read(name)
            shared.require(len(content) == record["bytes"] and hashlib.sha256(content).hexdigest() == record["sha256"], "archive member changed")
    shared.put(root / "archive-receipt.json", {"schema": "terminal_pr895_archive.v1", "archive": "export.zip",
        "sha256": shared.sha(root / "export.zip"), "bytes": (root / "export.zip").stat().st_size,
        "members": len(files) + 1, "hiddenMembers": [p for p in files if any(part.startswith(".") for part in Path(p).parts)]})


def main():
    context = shared.checkout_identity("eod-v2")
    context.update({"sharedExporter": context["exporter"], "sharedExporterSha256": context["exporterSha256"],
                    "exporter": str(Path(__file__).resolve().relative_to(REPO)), "exporterSha256": shared.sha(Path(__file__)),
                    "deadlineEpochMs": int((time.time() + 50 * 60) * 1000)})
    runner = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    root = runner / "terminal-ci-evidence" / f"pr895-{context['workflowRunId']}-{context['workflowRunAttempt']}"
    shared.require(not root.exists(), "original run/attempt export already exists")
    root.mkdir(parents=True)
    shared.require(root.resolve() == root, "symlink export parent")
    proof = root / "proof"
    proof.mkdir()
    context_file = root / "context.json"
    shared.put(context_file, context)
    overall = {"schema": "terminal_pr895_raw_export.v1", "state": "RUNNING", **context,
               "startedAt": shared.now(), "currentPairQualified": False, "results": {}}
    forbidden = [*shared.OVERRIDES, "CAPTURE_ONLY", "CAPTURE_HEAD", "UPDATE_HEATMAP_EVIDENCE", "TERMINAL_CROP_OUTPUT_DIR",
                 "PLAYWRIGHT_JSON_OUTPUT_FILE", "TERMINAL_EVIDENCE_MODE", "TERMINAL_EVIDENCE_COMPOSITION",
                 "TERMINAL_PL6_EVIDENCE_OPERATION_ID"]
    def bridge(mode, *, env=None, request=None, timeout=180):
        args = ["node", str(BRIDGE), mode, str(context_file), str(root)]
        if request is not None:
            args.append(str(request))
        return subprocess.run(args, cwd=REPO, env=env, timeout=timeout, check=True)
    try:
        shared.require(all(key not in os.environ for key in forbidden), "unexpected fixture/evidence override")
        raw_port = os.environ.get("TERMINAL_E2E_PORT", "")
        shared.require(raw_port == "3108", "unexpected owned unit-job browser port")
        port, allowed = int(raw_port), shared.own_ancestors()
        shared.require(shared.port_closed(port) and shared.port_closed(3566) and
                       not (TERMINAL / ".next/dev/lock").exists() and not shared.workspace_holders(allowed),
                       "previous process/server is not settled")
        bridge("--prepare")
        preflight = json.loads((root / "prerequisites.json").read_text())
        inputs = preflight["inputSets"]
        shared.require(preflight["currentPairQualified"] is False and len(preflight["expectedPassed"]) == 144,
                       "unexpected export prerequisite")
        tracked = subprocess.run(["git", "-C", str(REPO), "ls-files", "--error-unmatch", "--", *inputs["expiry"]],
                                 text=True, capture_output=True, timeout=30)
        clean = subprocess.run(["git", "-C", str(REPO), "diff", "--no-ext-diff", "--exit-code", "HEAD", "--", *inputs["expiry"]],
                               text=True, capture_output=True, timeout=30)
        shared.require(tracked.returncode == clean.returncode == 0, "source inputs differ from checkout")
        baseline = shared.snapshot(inputs["expiry"])
        shared.put(root / "whole-source-before.json", baseline)
        native_lifecycle = root / "native-lifecycle"
        native_lifecycle.mkdir()
        try:
            bridge("--native", timeout=20 * 60 + 30)
        finally:
            # Retain independent listener/CWD/lock proof even after a failed native child.
            shared.settled(3566, allowed, native_lifecycle)
        native = json.loads((root / "native/capture-execution.json").read_text())
        shared.require(native["successfulFiles"] == 126 and native["currentPairQualified"] is False,
                       "incomplete native export")
        shared.require(shared.snapshot(inputs["expiry"]) == baseline, "source changed during native capture")
        overall["results"]["native"] = {"state": native["state"], "passed": 126,
            "executionSha256": shared.sha(root / "native/capture-execution.json")}
        shared.put(root / "export-status.json", overall)
        env = {**os.environ, "CI": "1", "MMX_SHARED_SHELL": "0", "MMX_INVESTOR_SHELL_PREVIEW": "0",
               "TERMINAL_VISUAL_EVIDENCE_OPERATION": f"pr895-eod-v2-{context['workflowRunId']}-{context['workflowRunAttempt']}"}
        counter = 0
        def execute(command, child_env, log, selection):
            nonlocal counter
            counter += 1
            remaining = context["deadlineEpochMs"] - int(time.time() * 1000) - 120_000
            shared.require(remaining > 0, "export budget exhausted before browser child")
            budget = min(60_000, remaining) if selection else remaining
            receipt = proof / f"cli-{counter}.json"
            request = proof / f"cli-{counter}-request.json"
            shared.put(request, {"command": command, "log": str(log), "receipt": str(receipt), "deadlineMs": budget})
            try:
                bridge("--browser", env=child_env, request=request, timeout=(budget / 1000) + 100)
            except Exception:
                failed_settlement = proof / f"cli-{counter}-failed-settlement"
                failed_settlement.mkdir()
                shared.settled(port, allowed, failed_settlement)
                raise
            result = json.loads(receipt.read_text())
            if selection:
                selection_settlement = proof / f"cli-{counter}-selection-settlement"
                selection_settlement.mkdir()
                shared.settled(port, allowed, selection_settlement)
            content = log.read_text(errors="replace") if log.exists() else ""
            return SimpleNamespace(returncode=0 if require_cli_result(result) else 1, stdout=content, stderr="")
        titles = ["Exposure desk carries expiry Vanna/Charm through bars and drawer in en",
                  "Exposure desk carries expiry Vanna/Charm through bars and drawer in zh",
                  "Exposure desk renders expiry VEX and CHEX from the enriched owner payload"]
        expected_expiry = [project + "|" + title for project in ["desktop", "tablet", "mobile"] for title in titles]
        stages = [
            ("integration", root / "browser", [p.removeprefix("terminal/") for p in preflight["specs"]], [],
             preflight["expectedPassed"], inputs["browser"], ("exposure_master_integration_browser_execution.v1", "exposure_master_integration_browser.v1")),
            ("expiry", root / "browser/expiry-journeys", ["e2e/exposure-expiry-greeks.spec.ts", "e2e/responsive.spec.ts"],
             ["--grep", "Exposure desk (carries expiry Vanna/Charm through bars and drawer in (en|zh)|renders expiry VEX and CHEX from the enriched owner payload)$", "--trace=on"],
             expected_expiry, inputs["expiry"], ("exposure_expiry_greeks_browser_execution.v1", "exposure_expiry_greeks_browser.v1")),
        ]
        for name, out, specs, extra, expected, current, schemas in stages:
            overall["results"][name] = shared.run_stage(name, out, specs, extra, expected, current, schemas, context,
                inputs["expiry"], baseline, env, port, allowed, proof_root=proof,
                output_prefix=f"pr895-eod-v2-{context['workflowRunId']}-{context['workflowRunAttempt']}", execute=execute)
            shared.put(root / "export-status.json", overall)
        after = shared.snapshot(inputs["expiry"])
        shared.put(root / "whole-source-after.json", after)
        shared.require(after == baseline, "source changed after export")
        overall.update({"state": "RAW_CAPTURES_QUALIFIED_PENDING_SUCCESSOR_IMPORT",
                        "batch3": {"state": "SAME_RUN_PL6_ARTIFACT_REQUIRED", "artifact": f"evidence-shard-{context['workflowRunId']}-pl6"}})
    except Exception as error:
        overall.update({"state": "FAILED", "error": str(error)})
        raise
    finally:
        overall["completedAt"] = shared.now()
        shared.put(root / "export-status.json", overall)
        retained_bundle(root)


if __name__ == "__main__":
    main()
