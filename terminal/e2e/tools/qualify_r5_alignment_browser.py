"""Earn the R5 browser successor in PR646's existing serial CI job.

This exports actual execution records. It does not change a declaration, qualify
the normal evidence reader, launch a different browser, or recapture native EOD/GEX.
The temporary workflow hook is removed after the immutable proof is consumed.
"""
from pathlib import Path
import datetime
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import time

REPO = Path(__file__).resolve().parents[3]
TERMINAL = REPO / "terminal"
PROOF = REPO / "docs/verification/pr646-r5-browser-ci-20261110"
BROWSER = TERMINAL / "docs/verification/exposure-workspace-20261103/r5-alignment-20261110"
OVERRIDES = [
    "EXPOSURE_P09_CURRENT_WITNESS", "EXPOSURE_P09_PREVIOUS_WITNESS", "EXPOSURE_NATIVE_WITNESS",
    "TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE", "TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE", "TERMINAL_EXPOSURE_PAINT_PROBE",
]


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha(path):
    require(path.is_file() and not path.is_symlink(), "non-regular evidence input: " + str(path))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def git(*args):
    return subprocess.check_output(["git", "-C", str(REPO), *args], text=True).strip()


def node(script, *args):
    return json.loads(subprocess.check_output(["node", "-e", script, *args], cwd=REPO, text=True))


def observe(args):
    # The census process itself must not appear as a repository CWD holder.
    result = subprocess.run(args, cwd="/", text=True, capture_output=True)
    return {"command": args, "exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr}


def checkout_parents():
    header = git("cat-file", "-p", "HEAD").split("\n\n", 1)[0]
    return re.findall(r"^parent ([0-9a-f]{40})$", header, re.M)


def qualify_base_ancestry(event_base, actual_base, identity):
    evidence = {"state": "UNPROVEN", "fetchAttempted": False}
    try:
        if event_base == actual_base:
            evidence["state"] = "EXACT_EVENT_BASE"
            return evidence
        command = ["git", "-C", str(REPO), "merge-base", "--is-ancestor", event_base, actual_base]
        result = subprocess.run(command, text=True, capture_output=True, timeout=60)
        evidence["initialAncestryExit"] = result.returncode
        if result.returncode != 0:
            require(git("rev-parse", "--is-shallow-repository") == "true", "event base ancestry is unproven")
            # Obtain bounded history for this exact first parent; do not move a
            # branch, write FETCH_HEAD, or resolve a moving remote branch name.
            evidence["fetchAttempted"] = True
            fetched = subprocess.run([
                "git", "-C", str(REPO), "fetch", "--no-tags", "--no-write-fetch-head",
                "--no-recurse-submodules", "--no-auto-maintenance", "--refmap=", "--depth=64", "origin", actual_base,
            ], text=True, capture_output=True, timeout=60)
            evidence["fetchExit"] = fetched.returncode
            require(fetched.returncode == 0, "bounded exact-base ancestry fetch failed")
            result = subprocess.run(command, text=True, capture_output=True, timeout=60)
        evidence["ancestryExit"] = result.returncode
        require(result.returncode == 0, "event base is not a proven ancestor of actual merge base")
        evidence["state"] = "EVENT_BASE_ANCESTOR"
        return evidence
    except Exception:
        print(json.dumps({"state": "CHECKOUT_BASE_ANCESTRY_REJECTED", **identity, "baseRelationship": evidence}), flush=True)
        raise


def checkout_identity():
    require(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("GITHUB_EVENT_NAME") == "pull_request",
            "exporter is restricted to the incumbent pull_request job")
    require(os.environ.get("GITHUB_JOB") == "terminal-e2e", "unexpected CI job")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    pr = event.get("pull_request", {})
    repo_name = "mastermindx-market-intelligence/mastermind-terminal"
    require(os.environ.get("GITHUB_REPOSITORY") == repo_name, "unexpected workflow repository")
    require(event.get("number") == 646 and pr.get("number") == 646, "not the owned PR646 operation")
    require(pr.get("head", {}).get("repo", {}).get("full_name") == repo_name and
            pr.get("base", {}).get("repo", {}).get("full_name") == repo_name and
            pr.get("base", {}).get("ref") == "master", "unexpected repository or base")
    head, event_base = pr["head"]["sha"], pr["base"]["sha"]
    require(all(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) for value in [head, event_base]),
            "invalid event source identity")
    actual = git("rev-parse", "HEAD")
    require(actual == os.environ.get("GITHUB_SHA") and os.environ.get("GITHUB_REF") == "refs/pull/646/merge",
            "checkout differs from the actual workflow source")
    parents = checkout_parents()
    require(len(parents) == 2 and parents[1] == head, "checkout is not the declared PR merge")
    base, tree = parents[0], git("rev-parse", "HEAD^{tree}")
    require(not git("diff", "--name-only", "--diff-filter=U"), "unresolved checkout")
    run_id, attempt = os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"]
    require(run_id.isdecimal() and attempt.isdecimal() and int(attempt) > 0, "invalid run identity")
    identity = {"checkoutCommit": actual, "checkoutTree": tree, "checkoutParents": parents,
                "observedEventBase": event_base, "observedEventHead": head}
    relationship = qualify_base_ancestry(event_base, base, identity)
    require(git("rev-parse", "HEAD") == actual and git("rev-parse", "HEAD^{tree}") == tree and
            checkout_parents() == parents, "checkout changed during ancestry qualification")
    return {
        "branchHead": head, "protectedMaster": base, "integratedDependency": base,
        **identity, "baseRelationship": relationship,
        "workflowRunId": run_id, "workflowRunAttempt": attempt, "workflowJob": "terminal-e2e", "shard": "serial",
        "workflowUrl": f"https://github.com/{repo_name}/actions/runs/{run_id}",
        "exporter": str(Path(__file__).resolve().relative_to(REPO)), "exporterSha256": sha(Path(__file__)),
    }


def port_closed(port):
    result = observe(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"])
    require(result["exit"] in (0, 1) and not result["stderr"].strip(), "listener census failed")
    return result["exit"] == 1


def own_ancestors():
    allowed = set()
    pid = os.getpid()
    while pid > 0 and pid not in allowed:
        allowed.add(pid)
        result = observe(["ps", "-p", str(pid), "-o", "ppid="])
        require(result["exit"] == 0 and result["stdout"].strip().isdigit() and not result["stderr"].strip(),
                "cannot establish exporter ancestry")
        pid = int(result["stdout"].strip())
    return allowed


def workspace_holders(allowed):
    result = observe(["lsof", "-a", "-u", str(os.getuid()), "-d", "cwd", "-F", "pcn"])
    require(result["exit"] == 0 and not result["stderr"].strip(), "workspace census failed")
    holders, pid = [], None
    for line in result["stdout"].splitlines():
        if line.startswith("p"):
            pid = int(line[1:])
        elif line.startswith("n") and (line[1:] == str(REPO) or line[1:].startswith(str(REPO) + "/")) and pid not in allowed:
            holders.append(pid)
    return sorted(set(holders))


def settled(port, allowed, out):
    receipt = {"at": now(), "port": port, "state": "SETTLEMENT_UNPROVEN", "allowedExporterAncestors": sorted(allowed)}
    try:
        for _ in range(20):
            if port_closed(port):
                break
            time.sleep(.25)
        require(port_closed(port), "owned listener remains")
        receipt["listenerClosed"] = True
        holders = workspace_holders(allowed)
        receipt["workspaceCwdHolders"] = holders
        require(not holders, "workspace process remains; no cleanup attempted")
        lock = TERMINAL / ".next/dev/lock"
        receipt["lockPresent"] = lock.exists()
        if lock.exists():
            initial, inode = lock.read_bytes(), lock.lstat()
            data = json.loads(initial)
            require(stat.S_ISREG(inode.st_mode) and inode.st_uid == os.getuid() and data.get("port") == port and
                    isinstance(data.get("pid"), int) and data["pid"] > 0, "unqualified lock owner")
            checks = {
                "pid": observe(["ps", "-p", str(data["pid"]), "-o", "pid=,ppid=,comm="]),
                "lock": observe(["lsof", str(lock)]),
            }
            require(all(x["exit"] == 1 and not x["stdout"].strip() and not x["stderr"].strip() for x in checks.values()),
                    "lock owner absence unproved")
            receipt.update({"lock": data, "lockSha256": hashlib.sha256(initial).hexdigest(), "checks": checks})
            put(out / "lifecycle.json", receipt)
            require(lock.read_bytes() == initial and lock.lstat().st_ino == inode.st_ino and port_closed(port), "lock changed")
            lock.unlink()
            receipt["lockUnlinked"] = True
        require(not lock.exists(), "lock remains")
        receipt.update({"state": "OWNED_SERVER_STOPPED", "completedAt": now(), "lockAbsent": True})
    except Exception as error:
        receipt["error"] = str(error)
        raise
    finally:
        put(out / "lifecycle.json", receipt)
    return receipt


def snapshot(inputs):
    paths = set(git("ls-files", "--cached", "--others", "--exclude-standard").splitlines())
    selected = {p for p in paths if p.startswith("terminal/") and
                not p.startswith(("terminal/docs/", "terminal/test-results/", "terminal/node_modules/", "terminal/.next/")) and
                re.search(r"\.(?:ts|tsx|css|js|cjs|mjs|json|py)$", p)}
    selected.update(node("console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"))
    selected.update(inputs)
    return {p: sha(REPO / p) for p in sorted(selected)}


def report_cases(report):
    cases = []

    def visit(suite):
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                cases.append({"key": test["projectName"] + "|" + spec["title"], "attempts": [
                    {"status": result.get("status"), "retry": result.get("retry")} for result in test.get("results", [])]})
        for child in suite.get("suites", []):
            visit(child)

    visit(report)
    return cases


def run_stage(name, out, specs, extra, expected, current_inputs, schemas, context, inputs, baseline, env, port, allowed):
    out.mkdir(parents=True, exist_ok=False)
    require(port_closed(port) and not (TERMINAL / ".next/dev/lock").exists(), "previous server is not settled")
    require(not workspace_holders(allowed), "unknown workspace writer or process")
    output = TERMINAL / f"test-results/pr646-r5-browser-{name}"
    require(not output.exists(), "capture output already exists")
    prior_root = PROOF / ("prior-browser-root-" + name)
    prior_root.mkdir()
    results = TERMINAL / "test-results"
    results.mkdir(exist_ok=True)
    inventory = {}
    for file in sorted(results.iterdir()):
        if file.is_file() and file.suffix in (".png", ".json"):
            require(not file.is_symlink(), "symlink in prior results")
            shutil.copy2(file, prior_root / file.name)
            inventory[file.name] = {"sha256": sha(file), "mtimeNs": file.stat().st_mtime_ns, "bytes": file.stat().st_size}
    put(PROOF / ("prior-browser-root-" + name + ".json"), inventory)
    env = {**env, "PLAYWRIGHT_JSON_OUTPUT_FILE": str(out / "browser-report.json")}
    command = ["node", "node_modules/@playwright/test/cli.js", "test", *specs, *extra,
               "--project=desktop", "--project=tablet", "--project=mobile", "--workers=1", "--retries=0",
               "--reporter=list,json", "--output=" + str(output)]
    listed = subprocess.run([*command, "--list", "--reporter=list"], cwd=TERMINAL, env=env, capture_output=True, text=True)
    (PROOF / (name + "-selection.log")).write_text(listed.stdout + listed.stderr)
    require(listed.returncode == 0 and re.search(r"Total: " + str(len(expected)) + r" tests? in ", listed.stdout), "incorrect test selection")
    before = snapshot(inputs)
    require(before == baseline, "source changed before execution")
    put(out / "source-before.json", before)
    start, start_ns, started_at = time.monotonic(), time.time_ns(), now()
    log = out / "browser.log"
    print(json.dumps({"starting": name, "cases": len(expected), "port": port, "checkoutCommit": context["checkoutCommit"]}), flush=True)
    with log.open("w") as handle:
        result = subprocess.run(command, cwd=TERMINAL, env=env, stdout=handle, stderr=subprocess.STDOUT)
    after = snapshot(inputs)
    put(out / "source-after.json", after)
    lifecycle = settled(port, allowed, out)
    report_path = out / "browser-report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {"errors": [{"message": "missing report"}], "stats": {}}
    artifacts = {}

    def retain(src, relative):
        require(src.is_file() and not src.is_symlink(), "non-regular browser artifact")
        dest = out / "browser-artifacts" / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        artifacts[str(dest.relative_to(out))] = sha(dest)

    if output.exists():
        for file in sorted(output.rglob("*")):
            if file.is_file():
                retain(file, Path("playwright") / file.relative_to(output))
    for file in sorted(results.iterdir()):
        if file.is_file() and file.suffix in (".png", ".json") and file.stat().st_mtime_ns >= start_ns:
            retain(file, Path("direct") / file.name)
    stats = report.get("stats", {})
    execution = {
        "schema": schemas[0], **context, "command": command, "port": port, "startedAt": started_at, "completedAt": now(),
        "seconds": round(time.monotonic() - start, 2), "exit": result.returncode, "retries": 0,
        "sourceStable": before == after, "ownedServerStopped": lifecycle["state"] == "OWNED_SERVER_STOPPED",
        "passed": stats.get("expected", 0), "failed": stats.get("unexpected", 0), "skipped": stats.get("skipped", 0),
        "flaky": stats.get("flaky", 0), "fixtureOverrides": {key: env.get(key) for key in OVERRIDES},
        "artifactFiles": artifacts, "logSha256": sha(log), "lifecycleSha256": sha(out / "lifecycle.json"),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
    }
    put(out / "browser-execution.json", execution)
    cases = report_cases(report)
    require(result.returncode == 0 and before == after and execution["ownedServerStopped"] and not report.get("errors") and
            execution["passed"] == len(expected) and execution["failed"] == execution["skipped"] == execution["flaky"] == 0 and
            sorted(case["key"] for case in cases) == sorted(expected) and
            all(case["attempts"] == [{"status": "passed", "retry": 0}] for case in cases) and bool(artifacts), "browser execution did not qualify")
    expected_record = {"expectedPassed": expected, "expectedSkipped": []}
    put(out / "expected-cases.json", expected_record)
    validation = """
      const fs=require('node:fs'), api=require('./terminal/e2e/tools/optionsExposureEvidence.cjs');
      const report=JSON.parse(fs.readFileSync(process.argv[1])), expected=JSON.parse(fs.readFileSync(process.argv[2]));
      if(process.argv[3]==='integration') api.requireIntegrationBrowserReport(report,expected);
      else { api.requireExpiryGreeksBrowserCases(expected); api.requireExpiryGreeksScreenshotSet(JSON.parse(fs.readFileSync(process.argv[4])).artifactFiles); }
      console.log(JSON.stringify({state:'REPORT_CONTRACT_VALIDATED'}));
    """
    node(validation, str(report_path), str(out / "expected-cases.json"), name, str(out / "browser-execution.json"))
    if name == "expiry":
        require(len([path for path in artifacts if path.endswith("/trace.zip")]) == 9, "expiry traces incomplete")
    files = ["browser-report.json", "browser-execution.json", "source-before.json", "source-after.json", "browser.log"]
    qualification = {"schema": schemas[1], **context, "files": {p: sha(out / p) for p in files},
                     "currentSources": {p: before[p] for p in current_inputs}, **expected_record}
    put(out / "qualification.json", qualification)
    summary = {"state": "CAPTURE_QUALIFIED_PENDING_SUCCESSOR_READER", "passed": len(expected), "artifacts": len(artifacts),
               "seconds": execution["seconds"], "qualificationSha256": sha(out / "qualification.json")}
    print(json.dumps({"finished": name, **summary}), flush=True)
    return summary


def main():
    context = checkout_identity()
    require(not PROOF.exists() and not BROWSER.exists(), "immutable output already exists")
    PROOF.mkdir(parents=True)
    overall = {"schema": "terminal_pr646_browser_successor_validation.v1", "state": "RUNNING", **context, "startedAt": now(), "results": {}}
    put(PROOF / "browser-validation.json", overall)
    try:
        raw_port = os.environ.get("TERMINAL_E2E_PORT", "")
        require(raw_port.isdecimal() and 1024 <= int(raw_port) <= 65535, "missing qualified lane port")
        port, allowed = int(raw_port), own_ancestors()
        require(port_closed(port) and not (TERMINAL / ".next/dev/lock").exists() and not workspace_holders(allowed), "previous server is not settled")
        preflight = node("""
          const fs=require('node:fs'), api=require('./terminal/e2e/tools/optionsExposureEvidence.cjs');
          const native=api.verifyExpiryIntegrationNativePrerequisites(process.cwd());
          const prior=JSON.parse(fs.readFileSync('./terminal/docs/verification/exposure-workspace-20261103/options-integration-20261109/qualification.json'));
          const historical=JSON.parse(fs.readFileSync('./terminal/docs/verification/exposure-workspace-20261103/ui-copy-integration-20261109/qualification.json'));
          api.requireOptionsIntegrationBrowserCases(prior,historical);
          console.log(JSON.stringify({native,browser:api.optionsIntegrationBrowserInputs(),expiry:api.expiryGreeksJourneyInputs(),specs:api.OPTIONS_INTEGRATION_BROWSER_SPECS,expectedPassed:prior.expectedPassed}));
        """)
        require(preflight["native"]["state"] == "NATIVE_ONLY_VALIDATED" and preflight["native"]["currentBrowserQualified"] is False and
                len(preflight["browser"]) == 71 and len(preflight["expiry"]) == 76 and len(preflight["specs"]) == 6 and
                len(set(preflight["expectedPassed"])) == 144, "native or input contract mismatch")
        put(PROOF / "native-prerequisites.json", preflight)
        tracked = subprocess.run(["git", "-C", str(REPO), "ls-files", "--error-unmatch", "--", *preflight["expiry"]],
                                 text=True, capture_output=True)
        clean = subprocess.run(["git", "-C", str(REPO), "diff", "--no-ext-diff", "--exit-code", "HEAD", "--", *preflight["expiry"]],
                               text=True, capture_output=True)
        require(tracked.returncode == 0 and clean.returncode == 0, "locked application sources differ from checkout")
        baseline = snapshot(preflight["expiry"])
        env = os.environ.copy()
        forbidden = [*OVERRIDES, "PLAYWRIGHT_JSON_OUTPUT_FILE", "TERMINAL_EVIDENCE_MODE", "TERMINAL_EVIDENCE_COMPOSITION", "TERMINAL_PL6_EVIDENCE_OPERATION_ID"]
        require(all(key not in env for key in forbidden), "unexpected fixture or evidence override")
        env.update({"CI": "1", "MMX_SHARED_SHELL": "0", "MMX_INVESTOR_SHELL_PREVIEW": "0", "TERMINAL_E2E_PORT": str(port),
                    "TERMINAL_VISUAL_EVIDENCE_OPERATION": "pr646-r5-alignment-20261110"})
        titles = ["Exposure desk carries expiry Vanna/Charm through bars and drawer in en",
                  "Exposure desk carries expiry Vanna/Charm through bars and drawer in zh",
                  "Exposure desk renders expiry VEX and CHEX from the enriched owner payload"]
        expected_expiry = [project + "|" + title for project in ["desktop", "tablet", "mobile"] for title in titles]
        stages = [
            ("integration", BROWSER, [p.removeprefix("terminal/") for p in preflight["specs"]], [], preflight["expectedPassed"], preflight["browser"],
             ("exposure_master_integration_browser_execution.v1", "exposure_master_integration_browser.v1")),
            ("expiry", BROWSER / "expiry-journeys", ["e2e/exposure-expiry-greeks.spec.ts", "e2e/responsive.spec.ts"],
             ["--grep", "Exposure desk (carries expiry Vanna/Charm through bars and drawer in (en|zh)|renders expiry VEX and CHEX from the enriched owner payload)$", "--trace=on"],
             expected_expiry, preflight["expiry"], ("exposure_expiry_greeks_browser_execution.v1", "exposure_expiry_greeks_browser.v1")),
        ]
        for name, out, specs, extra, expected, current_inputs, schemas in stages:
            overall["results"][name] = run_stage(name, out, specs, extra, expected, current_inputs, schemas, context, preflight["expiry"], baseline, env, port, allowed)
            put(PROOF / "browser-validation.json", overall)
        require(snapshot(preflight["expiry"]) == baseline, "source changed after capture")
        overall["state"] = "BROWSER_PROOFS_QUALIFIED_PENDING_SUCCESSOR_READER"
    except Exception as error:
        overall.update({"state": "FAILED", "error": str(error)})
        raise
    finally:
        overall["completedAt"] = now()
        put(PROOF / "browser-validation.json", overall)


if __name__ == "__main__":
    main()
