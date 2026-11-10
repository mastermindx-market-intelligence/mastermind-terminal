"""Prepare, never apply, the second-stage source patch after real gate proof.

Run only by the separately authorized release administrator. This module makes
no GitHub mutation and has no secret/App enrollment or queue operation. It does
not accept a supplied readiness receipt/boolean. All proof is read anew from the
fixed repository. Output is a source patch for normal review and protected merge.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
from pathlib import Path

from scripts import migration_merge_group as group
from scripts.trusted_migration_ownership import (
    Api, CONTEXT, REPO, WORKFLOW, positive, _run_identity, _variables,
    _VerifiedRun, _issuer_record, _issuer_workflow,
)

OLD_CONTEXTS = ("Quote Hub tests", "Terminal typecheck + tests", "Ingest + signal-layer tests")
SOURCE_PATHS = ("scripts/trusted_migration_ownership.py", "scripts/migration_merge_group.py",
                "scripts/check_supabase_migration_namespace.py", ".github/workflows/trusted-migration-ownership.yml")
TARGET_PATHS = ("tests/test_supabase_migration_namespace.py", "scripts/merge_on_green.py",
                "AGENTS.md", "CLAUDE.md", ".github/workflows/merge-on-green.yml",
                "tests/test_merge_on_green.py")
require = group.require


def _blobs(api, sha, paths):
    group.oid(sha)
    fields = " ".join(f"f{i}: object(expression: $f{i}) {{ __typename ... on Blob {{ oid text }} }}"
                      for i in range(len(paths)))
    args = ", ".join(f"$f{i}: String!" for i in range(len(paths)))
    data = api.graphql("query($owner: String!, $name: String!, " + args
                       + ") { repository(owner: $owner, name: $name) { nameWithOwner " + fields + " } }",
                       _variables() | {f"f{i}": sha + ":" + p for i, p in enumerate(paths)})
    repo = data.get("repository") or {}
    require(repo.get("nameWithOwner") == REPO, "foreign source repository")
    result = {}
    for i, path in enumerate(paths):
        value = repo.get(f"f{i}") or {}
        require(value.get("__typename") == "Blob" and isinstance(value.get("text"), str)
                and group.git_blob(value["text"].encode()) == value.get("oid"), "source blob unavailable")
        result[path] = value["text"]
    return result


def _protection(api, app_id):
    protection = api.request("GET", f"/repos/{REPO}/branches/master/protection")
    status = protection.get("required_status_checks") or {}
    require(status.get("strict") is True and isinstance(status.get("checks"), list),
            "strict required gate unavailable")
    checks = status["checks"]
    require(all(isinstance(c, dict) for c in checks), "invalid required checks")
    expected = dict.fromkeys(OLD_CONTEXTS, 15368) | {CONTEXT: app_id}
    for name, owner in expected.items():
        selected = [c for c in checks if c.get("context") == name]
        require(len(selected) == 1 and type(selected[0].get("app_id")) is int
                and selected[0]["app_id"] == owner, "required producer is not ON and pinned")
    # Keep the incumbent native merge queue. Its rules are not changed here.
    rules = api.request("GET", f"/repos/{REPO}/rules/branches/master")
    require(isinstance(rules, list) and any(r.get("type") == "merge_queue" for r in rules),
            "native merge queue missing")
    return protection, rules


def _proof(api, run_id, app_id):
    value = api.request("GET", f"/repos/{REPO}/actions/runs/{positive(run_id)}")
    rid, attempt, wid, head, branch, event, repo_id = _run_identity(value)
    # Supplementary issuance may run while CI is active or failed. Transferring
    # the existing enforcement still requires a completed, successful CI proof.
    require(value.get("status") == "completed" and value.get("conclusion") == "success",
            "original CI has not passed")
    workflow = api.request("GET", f"/repos/{REPO}/actions/workflows/{wid}")
    require(positive(workflow.get("id")) == wid and workflow.get("path") == WORKFLOW
            and workflow.get("state") == "active" and workflow.get("name") == "CI", "wrong proof workflow")
    response = api.request("GET", f"/repos/{REPO}/commits/{head}/check-runs?filter=all&per_page=100")
    checks = response.get("check_runs")
    require(isinstance(checks, list) and response.get("total_count") == len(checks) < 100,
            "incomplete producer evidence")
    prefix = f"migration-owner:v1:{rid}:{attempt}:{head}:"
    selected = [c for c in checks if c.get("name") == CONTEXT
                and type((c.get("app") or {}).get("id")) is int
                and (c.get("app") or {}).get("id") == app_id
                and isinstance(c.get("external_id"), str) and c["external_id"].startswith(prefix)]
    require(len(selected) == 1, "no unique actual producer proof")
    check = selected[0]
    require(check.get("head_sha") == head and check.get("status") == "completed"
            and check.get("conclusion") == "success", "producer has not passed")
    code = group.oid(check["external_id"][len(prefix):])
    original = re.fullmatch(re.escape(f"https://github.com/{REPO}/actions/runs/")
                            + r"([1-9][0-9]{0,18})/attempts/1", check.get("details_url", ""))
    require(original is not None, "original issuer selection missing")
    issuer_id = positive(int(original[1]))
    origin = _VerifiedRun(rid, attempt, wid, head, branch, event, code, repo_id)
    issuer_record = api.request("GET", f"/repos/{REPO}/actions/runs/{issuer_id}/attempts/1")
    issuer = _issuer_record(issuer_record, origin, issuer_id, 1, completed=True)
    _issuer_workflow(issuer, api)
    return event, code, value, check, issuer_record


def _source_patch(sources, app_id):
    """Exact finite handoff; current public source is not modified by this tool."""
    test = sources[TARGET_PATHS[0]]
    old = "    findings, _notes, mode = collect_for_event()\n"
    new = ("    if os.environ.get(\"GITHUB_EVENT_NAME\") == \"merge_group\":\n"
           "        # Membership is enforced by the separately required, App-pinned\n"
           "        # protected owner. This branch asserts all remaining content law.\n"
           "        findings, _notes = collect()\n"
           "        mode = \"MERGE_GROUP_CONTENT (protected ownership gate required)\"\n"
           "    else:\n"
           "        findings, _notes, mode = collect_for_event()\n")
    require(test.count(old) == 1 and "MERGE_GROUP_CONTENT" not in test, "unexpected namespace preimage")
    controller = sources[TARGET_PATHS[1]]
    key = "REQUIRED_CHECK_APP_ID = 15368\n"
    require(controller.count(key) == 1 and "REQUIRED_CHECK_APP_IDS" not in controller,
            "unexpected controller preimage")
    controller = controller.replace(key, key + f"REQUIRED_CHECKS += ({CONTEXT!r},)\n"
                                    + "REQUIRED_CHECK_APP_IDS = dict.fromkeys(REQUIRED_CHECKS, REQUIRED_CHECK_APP_ID)\n"
                                    + f"REQUIRED_CHECK_APP_IDS[{CONTEXT!r}] = {app_id}\n")
    compare = "trusted_check_app_id(run) != REQUIRED_CHECK_APP_ID"
    require(controller.count(compare) == 1, "unexpected check identity preimage")
    controller = controller.replace(compare, "trusted_check_app_id(run) != REQUIRED_CHECK_APP_IDS[name]")
    controller = controller.replace('f"missing trusted App {REQUIRED_CHECK_APP_ID} checks: {\', \'.join(missing)}"',
                                    'f"missing pinned producer checks: {\', \'.join(missing)}"')
    agents = sources["AGENTS.md"]
    anchor = "master` protects the exact three CI checks;"
    require(agents.count(anchor) == 1 and "<!-- migration-owner-transfer-v1 -->" not in agents,
            "unexpected release guide preimage")
    agents = agents.replace(anchor, "master` retains the three original GitHub Actions CI checks and also requires\n"
                            f"  `{CONTEXT}` from App `{app_id}`;")
    agents += ("\n<!-- migration-owner-transfer-v1 -->\n"
               "## Protected migration ownership\n\n"
               f"The required `{CONTEXT}` check is bound to App `{app_id}`. The three original\n"
               "GitHub Actions checks remain bound to App15368; the incumbent controller\n"
               "checks each context against its own exact producer. Same names from other\n"
               "Apps or Any source do not satisfy release. The protected default-code\n"
               "issuer owns full native membership and migration content qualification;\n"
               "candidate Ingest retains content and pure negative checks. No candidate\n"
               "code receives the issuer key. Restore the original strict Ingest owner\n"
               "before withdrawing the new required gate; failure stops migration release.\n")
    claude = sources["CLAUDE.md"]
    require(claude.startswith("@AGENTS.md\n") and "migration-owner-transfer-v1" not in claude,
            "unexpected imported guide preimage")
    claude += (f"<!-- migration-owner-transfer-v1: AGENTS.md now includes the distinct App{app_id} "
               "migration ownership gate. The import remains the single release-law source. -->\n")
    workflow = sources[".github/workflows/merge-on-green.yml"]
    comment = "# master is protected by the same three checks, so native auto-merge is the fast"
    require(workflow.count(comment) == 1, "unexpected incumbent workflow preimage")
    workflow = workflow.replace(comment,
        f"# Required producers: three original Actions checks plus migration owner App{app_id}.\n"
        "# No issuer key is added here; checks:read observes each pinned producer.\n"
        "# master keeps native auto-merge as the fast")
    tests = sources["tests/test_merge_on_green.py"]
    changes = {
        "    REQUIRED_CHECK_APP_ID,\n": "    REQUIRED_CHECK_APP_ID,\n    REQUIRED_CHECK_APP_IDS,\n",
        "\ndef checks(\n": "\n_DEFAULT_CHECK_APP = object()\n\n\ndef checks(\n",
        "    app_id: int | str | bool | None = REQUIRED_CHECK_APP_ID,\n": "    app_id: object = _DEFAULT_CHECK_APP,\n",
        'run["app"] = {"id": app_id}': 'run["app"] = {"id": REQUIRED_CHECK_APP_IDS[name] if app_id is _DEFAULT_CHECK_APP else app_id}',
        '    runs[2]["app"] = {"id": True}\n': '    runs[2]["app"] = {"id": True}\n    runs[3]["app"] = {"id": None}\n',
        'assert f"trusted App {REQUIRED_CHECK_APP_ID}" in verdict.detail': 'assert "pinned producer" in verdict.detail',
        'f"#7: missing trusted App {REQUIRED_CHECK_APP_ID} checks: "': '"#7: missing pinned producer checks: "',
        '"missing trusted App" in result[0]': '"missing pinned producer" in result[0]',
    }
    for before, after in changes.items():
        require(before in tests, "unexpected controller test preimage")
        tests = tests.replace(before, after)
    tests += ("\n\ndef test_migration_owner_requires_its_distinct_producer():\n"
              f"    context = {CONTEXT!r}\n"
              "    assert check_verdict(checks()).state == 'green'\n"
              "    absent = [r for r in checks() if r['name'] != context]\n"
              "    assert check_verdict(absent).state == 'pending'\n"
              "    wrong = checks()\n"
              "    next(r for r in wrong if r['name'] == context)['app']['id'] = REQUIRED_CHECK_APP_ID\n"
              "    assert check_verdict(wrong).state == 'pending'\n")
    changed = {TARGET_PATHS[0]: test.replace(old, new), TARGET_PATHS[1]: controller,
               "AGENTS.md": agents, "CLAUDE.md": claude,
               ".github/workflows/merge-on-green.yml": workflow, "tests/test_merge_on_green.py": tests}
    return "".join("".join(difflib.unified_diff(sources[p].splitlines(True), changed[p].splitlines(True),
                                                fromfile="a/" + p, tofile="b/" + p)) for p in TARGET_PATHS)


def prepare(api, app_id, run_ids):
    """Real service reads only. No caller-shaped gate DTO can authorize transfer."""
    positive(app_id)
    require(app_id != 15368 and len(run_ids) == 2 and len(set(run_ids)) == 2, "independent proofs required")
    protection = _protection(api, app_id)
    proofs = [_proof(api, r, app_id) for r in run_ids]
    require({p[0] for p in proofs} in ({"pull_request", "merge_group"}, {"workflow_dispatch", "merge_group"}),
            "both PR and group producer proof required")
    branch = api.request("GET", f"/repos/{REPO}/branches/master")
    tip = group.oid((branch.get("commit") or {}).get("sha"))
    sources = _blobs(api, tip, SOURCE_PATHS + TARGET_PATHS)
    for _, code, _, _, _ in proofs:
        require(_blobs(api, code, SOURCE_PATHS) == {p: sources[p] for p in SOURCE_PATHS},
                "producer code differs from current protected issuer")
    patch = _source_patch(sources, app_id)
    # Actual fresh proof before handing a patch to the normal source reviewer.
    require(_protection(api, app_id) == protection
            and api.request("GET", f"/repos/{REPO}/branches/master") == branch,
            "required gate or protected source changed")
    require([_proof(api, r, app_id) for r in run_ids] == proofs, "producer evidence changed")
    return patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-id", type=int, required=True)
    parser.add_argument("--run", type=int, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        patch = prepare(Api(os.environ.get("MIGRATION_TRANSITION_TOKEN", "")), args.app_id, args.run)
        # Exclusive source-preparation artifact, never apply it or alter GitHub.
        with args.output.open("x") as stream:
            stream.write(patch)
        print("migration-owner: reviewed-source patch prepared; not applied")
        return 0
    except Exception:
        print("migration-owner: transfer refused; old enforcement retained")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
