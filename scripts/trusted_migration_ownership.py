"""Prospective protected-default-code owner of migration namespace checks.

No candidate executable, cache, artifact, environment file or event-shaped proof
is consumed. workflow_run is a NEW origin: it does not attest the old event base.
Only a freshly authenticated native queue supplies that base and membership.
The installation token stays in this process; HTTP mutations are never retried.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from scripts import migration_merge_group as group
from scripts import check_supabase_migration_namespace as namespace

REPO = "mastermindx-market-intelligence/mastermind-terminal"
WORKFLOW = ".github/workflows/ci.yml"
CONTEXT = "Migration namespace / protected owner"
API = "https://api.github.com"
MAX_RESPONSE = 8 * 1024 * 1024
MAX_BLOB = 1024 * 1024
MAX_FILES = 512
require = group.require


class CapabilityUnavailable(group.OwnershipUnqualified):
    def __init__(self, kind, stage="http"):
        require(kind in {"forbidden", "rate_limited", "unavailable", "malformed"}
                and stage in {"http", "queue_snapshot", "source_pr", "candidate_data", "immutable_source"},
                "invalid diagnostic projection")
        self.kind, self.stage = kind, stage
        super().__init__(f"{stage}/{kind}; no retry")


def positive(value: Any) -> int:
    require(type(value) is int and 0 < value < 2**63, "invalid service identity")
    return value


def decode(raw: bytes) -> Any:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate JSON field")
            result[key] = value
        return result
    require(len(raw) <= MAX_RESPONSE, "response exceeds bound")
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON")))


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


class Api:
    """Fixed-origin, bounded, no-redirect, no-retry GitHub client."""
    def __init__(self, token: str):
        require(bool(token), "installation token unavailable")
        self._token = token

    def request(self, method: str, path: str, body=None):
        require(method in {"GET", "POST", "PATCH"} and path.startswith("/")
                and not path.startswith("//") and "#" not in path, "invalid API operation")
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        request = urllib.request.Request(
            API + path, method=method,
            data=None if body is None else json.dumps(body, allow_nan=False).encode(),
            headers={"Authorization": "Bearer " + self._token,
                     "Accept": "application/vnd.github+json", "Content-Type": "application/json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "terminal-protected-migration-owner"})
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
                raw = response.read(MAX_RESPONSE + 1)
            return decode(raw)
        except urllib.error.HTTPError as exc:
            kind = "forbidden" if exc.code in {401, 403} else "rate_limited" if exc.code == 429 else "unavailable"
            raise CapabilityUnavailable(kind) from None
        except Exception:
            # Do not expose exception chains, raw responses, URLs or tokens.
            raise CapabilityUnavailable("unavailable") from None

    def graphql(self, query: str, variables: dict) -> dict:
        stage = ("queue_snapshot" if query == group.QUEUE_QUERY else "source_pr" if query == PR_QUERY
                 else "candidate_data" if query == CONTENTS_QUERY else "immutable_source")
        try:
            value = self.request("POST", "/graphql", {"query": query, "variables": variables})
        except CapabilityUnavailable as exc:
            raise CapabilityUnavailable(exc.kind, stage) from None
        if isinstance(value, dict) and value.get("errors"):
            errors = value["errors"]
            forbidden = isinstance(errors, list) and any(isinstance(e, dict)
                and e.get("type") in {"FORBIDDEN", "INSUFFICIENT_SCOPES"} for e in errors)
            raise CapabilityUnavailable("forbidden" if forbidden else "malformed", stage) from None
        require(isinstance(value, dict) and not value.get("errors")
                and isinstance(value.get("data"), dict), "GitHub query refused")
        return value["data"]


class IssuerApi:
    """Keep Actions metadata reads separate from proposed installation grants."""
    def __init__(self, installation_token: str, run_token: str):
        self._installation = Api(installation_token)
        self._runs = Api(run_token)

    def request(self, method, path, body=None):
        if path.startswith(f"/repos/{REPO}/actions/"):
            require(method == "GET" and body is None, "run metadata is read-only")
            return self._runs.request(method, path)
        return self._installation.request(method, path, body)

    def graphql(self, query, variables):
        return self._installation.graphql(query, variables)


@dataclass(frozen=True)
class _VerifiedRun:
    run_id: int
    attempt: int
    workflow_id: int
    head: str
    branch: str
    event: str
    protected_code: str
    repository_id: int

    @property
    def external_id(self):
        return f"migration-owner:v1:{self.run_id}:{self.attempt}:{self.head}:{self.protected_code}"


def _run_identity(value: dict) -> tuple:
    require(isinstance(value, dict), "missing workflow run")
    repo = value.get("repository") or {}
    head_repo = value.get("head_repository") or {}
    require(repo.get("full_name") == head_repo.get("full_name") == REPO
            and positive(repo.get("id")) == positive(head_repo.get("id")), "foreign run repository")
    branch = value.get("head_branch")
    require(isinstance(branch, str) and re.fullmatch(r"[A-Za-z0-9_./-]{1,240}", branch)
            and ".." not in branch, "invalid source ref")
    require(value.get("path") == WORKFLOW and value.get("name") == "CI", "wrong source workflow")
    event = value.get("event")
    require(event in {"merge_group", "pull_request", "workflow_dispatch"}, "wrong source event")
    if event == "merge_group":
        require(branch.startswith("gh-readonly-queue/master/"), "wrong native queue ref")
    else:
        require(not branch.startswith("gh-readonly-queue/"), "mixed source scope")
    require(value.get("status") == "completed" and value.get("conclusion") == "success",
            "original CI has not passed")
    return (positive(value.get("id")), positive(value.get("run_attempt")),
            positive(value.get("workflow_id")), group.oid(value.get("head_sha")),
            branch, event, positive(repo.get("id")))


def _qualify_run(event: dict, env: dict, api) -> _VerifiedRun:
    require(env.get("GITHUB_ACTIONS") == "true" and env.get("GITHUB_EVENT_NAME") == "workflow_run"
            and env.get("GITHUB_REPOSITORY") == REPO and env.get("GITHUB_REF") == "refs/heads/master",
            "issuer is not a default-branch workflow run")
    code = group.oid(env.get("GITHUB_SHA"))
    require(event.get("action") == "completed", "wrong issuer activity")
    repository = event.get("repository") or {}
    require(repository.get("full_name") == REPO and repository.get("default_branch") == "master",
            "wrong issuer repository")
    identity = _run_identity(event.get("workflow_run"))
    require(positive(repository.get("id")) == identity[-1]
            and env.get("GITHUB_REPOSITORY_ID") == str(identity[-1]), "repository identity changed")
    run_id, attempt, workflow_id, head, branch, source_event, repo_id = identity
    # These are service reads, not artifacts or caller-supplied source pointers.
    current = api.request("GET", f"/repos/{REPO}/actions/runs/{run_id}")
    require(_run_identity(current) == identity, "original run replaced or changed")
    workflow = api.request("GET", f"/repos/{REPO}/actions/workflows/{workflow_id}")
    require(positive(workflow.get("id")) == workflow_id and workflow.get("path") == WORKFLOW
            and workflow.get("name") == "CI" and workflow.get("state") == "active",
            "source workflow identity changed")
    # The checkout is always the trusted workflow_run default SHA, never H.
    require(env.get("TRUSTED_CHECKOUT_SHA") == code, "issuer checkout differs")
    return _VerifiedRun(run_id, attempt, workflow_id, head, branch, source_event, code, repo_id)


def _variables():
    owner, name = REPO.split("/")
    return {"owner": owner, "name": name}


def _queue(origin: _VerifiedRun, api):
    require(type(origin) is _VerifiedRun and origin.event == "merge_group", "wrong verified origin")
    snapshot = api.graphql(group.QUEUE_QUERY, _variables())
    repository = snapshot.get("repository") or {}
    base = group.oid(((repository.get("defaultBranchRef") or {}).get("target") or {}).get("oid"))
    profile = ((repository.get("mergeQueue") or {}).get("configuration") or {})
    # B comes from this authenticated snapshot. It is NOT an old event.base_sha.
    if (profile.get("maximumEntriesToBuild"), profile.get("maximumEntriesToMerge")) == (8, 4):
        owners, verified_base = group._validate_parallel_queue(snapshot, REPO, origin.head, base)
    else:
        number, source, verified_base = group._validate_serial_queue(snapshot, REPO, origin.head, base)
        owners = {number: source}
    return snapshot, owners, verified_base


PR_QUERY = """
query($owner: String!, $name: String!, $head: GitObjectID!) {
 repository(owner: $owner, name: $name) {
  nameWithOwner defaultBranchRef { name target { oid } }
  object(oid: $head) { __typename ... on Commit {
   oid associatedPullRequests(first: 100) {
    pageInfo { hasNextPage } nodes { number state headRefOid baseRefName
     headRepository { nameWithOwner } baseRepository { nameWithOwner }
    }
   }
  } }
 }
}
"""


def _pr(origin: _VerifiedRun, api):
    require(type(origin) is _VerifiedRun and origin.event != "merge_group", "wrong verified origin")
    snapshot = api.graphql(PR_QUERY, _variables() | {"head": origin.head})
    repo = snapshot.get("repository") or {}
    require(repo.get("nameWithOwner") == REPO, "foreign PR repository")
    default = repo.get("defaultBranchRef") or {}
    require(default.get("name") == "master", "wrong protected branch")
    group.oid((default.get("target") or {}).get("oid"))
    obj = repo.get("object") or {}
    require(obj.get("__typename") == "Commit" and obj.get("oid") == origin.head, "wrong source commit")
    prs = obj.get("associatedPullRequests") or {}
    require(prs.get("pageInfo", {}).get("hasNextPage") is False
            and isinstance(prs.get("nodes"), list), "incomplete source PR page")
    matches = [p for p in prs["nodes"] if isinstance(p, dict)
               and p.get("headRefOid") == origin.head and p.get("state") == "OPEN"
               and p.get("baseRefName") == "master"
               and (p.get("headRepository") or {}).get("nameWithOwner") == REPO
               and (p.get("baseRepository") or {}).get("nameWithOwner") == REPO]
    require(len(matches) == 1, "no unique current source PR")
    return snapshot, positive(matches[0].get("number"))


CONTENTS_QUERY = """
query($owner: String!, $name: String!, $path: String!) {
 repository(owner: $owner, name: $name) {
  nameWithOwner object(expression: $path) { __typename ... on Tree {
   oid entries { name type mode object { __typename ... on Blob { oid byteSize isBinary isTruncated text } } }
  } }
 }
}
"""


def _candidate_data(origin: _VerifiedRun, api):
    data = api.graphql(CONTENTS_QUERY, _variables() | {"path": origin.head + ":supabase/migrations"})
    repo = data.get("repository") or {}
    require(repo.get("nameWithOwner") == REPO, "foreign candidate repository")
    tree = repo.get("object") or {}
    require(tree.get("__typename") == "Tree", "candidate migration tree unavailable")
    group.oid(tree.get("oid"))
    entries = tree.get("entries")
    require(isinstance(entries, list) and 0 < len(entries) <= MAX_FILES, "incomplete candidate tree")
    names = set()
    blobs = {}
    for entry in entries:
        name = entry.get("name") if isinstance(entry, dict) else None
        require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,180}", name)
                and name not in {".", ".."} and name not in names, "invalid candidate tree name")
        names.add(name)
        if name != "RESERVATIONS.json" and not name.endswith((".sql", ".md")):
            continue
        blob = entry.get("object") or {}
        require(entry.get("type") == "blob" and entry.get("mode") == 0o100644
                and blob.get("__typename") == "Blob" and blob.get("isBinary") is False
                and blob.get("isTruncated") is False and isinstance(blob.get("text"), str),
                "candidate data is not a complete ordinary blob")
        raw = blob["text"].encode("utf-8")
        require(type(blob.get("byteSize")) is int and len(raw) == blob["byteSize"] <= MAX_BLOB
                and group.git_blob(raw) == blob.get("oid"), "candidate blob identity differs")
        blobs[name] = raw
    require("RESERVATIONS.json" in blobs, "candidate ledger absent")
    doc = decode(blobs["RESERVATIONS.json"])
    require(isinstance(doc, dict), "candidate ledger malformed")
    sql = {n: b for n, b in blobs.items() if n.endswith(".sql")}
    markdown = {n: b.decode() for n, b in blobs.items() if n.endswith(".md")}
    return doc, sql, markdown, digest(data)


def _qualify_contents(origin: _VerifiedRun, api):
    doc, sql, markdown, material_digest = _candidate_data(origin, api)
    if origin.event == "merge_group":
        snapshot, owners, base = _queue(origin, api)
        open_files = {n: b for n, b in sql.items()
                      if (doc.get("prefixes", {}).get(namespace.parse_prefix(n)) or {}).get("pr_state") == "open"}
        if open_files:
            verified = group.validate_parallel_migrations(owners, base, doc, open_files,
                                                         api.graphql, _variables())
        else:
            verified = frozenset(owners)
        findings = namespace.check_all(sorted(sql), {n: b.decode() for n, b in sql.items()}, doc,
                                       markdown, verified_group_prs=verified)
    else:
        snapshot, number = _pr(origin, api)
        findings = namespace.check_all(sorted(sql), {n: b.decode() for n, b in sql.items()}, doc,
                                       markdown, pr_number=number)
    require(not findings, "migration namespace refused")
    return digest(snapshot), material_digest


def _assert_current(origin: _VerifiedRun, event: dict, env: dict, api, evidence):
    require(_qualify_run(event, env, api) == origin, "source run changed before publication")
    require(_qualify_contents(origin, api) == evidence, "source or queue changed before publication")


def _check_identity(check: dict, origin: _VerifiedRun, app_id: int):
    require(isinstance(check, dict) and positive(check.get("id"))
            and check.get("name") == CONTEXT and check.get("head_sha") == origin.head
            and type((check.get("app") or {}).get("id")) is int
            and (check.get("app") or {}).get("id") == app_id
            and check.get("external_id") == origin.external_id, "wrong check producer or selection")


def execute(event: dict, env: dict, api, app_id: int):
    """Actual owner entry. api is fixed Api in main; tests supply inert service."""
    positive(app_id)
    require(app_id != 15368, "independent check App required")
    origin = _qualify_run(event, env, api)
    prior = api.request("GET", f"/repos/{REPO}/commits/{origin.head}/check-runs?filter=all&per_page=100")
    checks = prior.get("check_runs")
    require(isinstance(checks, list) and type(prior.get("total_count")) is int
            and prior["total_count"] == len(checks) < 100, "incomplete prior checks")
    operation_prefix = origin.external_id.rsplit(":", 1)[0] + ":"
    matches = [c for c in checks if c.get("name") == CONTEXT
               and (c.get("app") or {}).get("id") == app_id
               and isinstance(c.get("external_id"), str)
               and c["external_id"].startswith(operation_prefix)]
    require(len(matches) <= 1, "duplicate owner operation")
    if matches:
        _check_identity(matches[0], origin, app_id)
        require(matches[0].get("status") == "completed", "original check outcome unsettled; no replay")
        return {"state": "RECONCILED", "conclusion": matches[0].get("conclusion")}
    # Produce no success until both checks of the current origin and full data pass.
    # An unknown POST response ends this invocation: there is no retry path.
    evidence = _qualify_contents(origin, api)
    check = api.request("POST", f"/repos/{REPO}/check-runs", {
        "name": CONTEXT, "head_sha": origin.head, "external_id": origin.external_id,
        "status": "in_progress", "output": {"title": "Migration ownership", "summary": "Qualification in progress."}})
    _check_identity(check, origin, app_id)
    _assert_current(origin, event, env, api, evidence)
    result = api.request("PATCH", f"/repos/{REPO}/check-runs/{check['id']}", {
        "status": "completed", "conclusion": "success",
        "output": {"title": "Migration ownership qualified", "summary":
                   f"Run {origin.run_id}, attempt {origin.attempt}; protected guard {origin.protected_code}; "
                   f"namespace material {evidence[1]}."}})
    _check_identity(result, origin, app_id)
    require(result.get("status") == "completed" and result.get("conclusion") == "success",
            "check publication unconfirmed; no retry")
    return {"state": "PUBLISHED", "head": origin.head}


def main():
    try:
        event = decode(Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
        if sys.argv[1:] == ["--preflight"]:
            require(positive(int(os.environ["OWNERSHIP_APP_ID"])) != 15368
                    and positive(int(os.environ["EXPECTED_INSTALLATION"])), "independent installation not configured")
            _qualify_run(event, dict(os.environ), Api(os.environ.get("OWNERSHIP_RUN_TOKEN", "")))
            print("migration-owner: protected run origin qualified")
            return 0
        require(not sys.argv[1:], "unsupported issuer command")
        app_id = int(os.environ["OWNERSHIP_APP_ID"])
        execute(event, dict(os.environ), IssuerApi(os.environ.get("OWNERSHIP_TOKEN", ""),
                                                 os.environ.get("OWNERSHIP_RUN_TOKEN", "")), app_id)
        print("migration-owner: complete")
        return 0
    except CapabilityUnavailable as exc:
        print(f"migration-owner: {exc.stage}/{exc.kind}; original outcome retained, no retry", file=sys.stderr)
        return 1
    except Exception:
        print("migration-owner: qualification or publication unavailable; original outcome retained", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
