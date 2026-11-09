"""Prospective protected-default-code owner of migration namespace checks.

No candidate executable, cache, artifact, environment file or event-shaped proof
is consumed. workflow_run is a NEW origin: it does not attest the old event base.
Only a freshly authenticated native queue supplies that base and membership.
The installation token stays in this process; HTTP mutations are never retried.

`execute_recovery` is the manually invoked recovery entry of this SAME
publisher: a separate workflow_dispatch workflow executes exactly the
dispatch-time default-branch revision (github.sha, asserted by the workflow's
rev-parse check) and refuses as a stale run unless those bytes still carry the
current master validator/issuer-law identity. No caller-selected revision
exists. It records authenticated dispatch provenance, reconciles the original
operation before any write, and never forges workflow_run identity.
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
ISSUER_WORKFLOW = ".github/workflows/trusted-migration-ownership.yml"
ISSUER_NAME = "Protected migration ownership issuer"
# The recovery entry is a SEPARATE manually dispatched workflow, so a broken
# default-branch ISSUER_WORKFLOW cannot disable it. It executes exactly the
# dispatch-time master tip (github.sha); no caller-selected revision exists.
RECOVERY_ISSUER_WORKFLOW = ".github/workflows/trusted-migration-ownership-recovery.yml"
RECOVERY_ISSUER_NAME = "Protected migration ownership recovery"
# Staleness identity covers the validator law AND this issuer module itself:
# a recovery dispatch may execute only bytes whose content-addressed identity
# still equals current master's, so older/weaker law can never be selected.
VALIDATOR_PATHS = ("scripts/check_supabase_migration_namespace.py",
                   "scripts/migration_merge_group.py",
                   "scripts/trusted_migration_ownership.py")
# Every Actions run status that is not "completed": a live scan must see each
# of them separately, because the list endpoint has no not-completed filter.
_LIVE_ISSUER_STATUSES = ("queued", "requested", "pending", "waiting",
                         "in_progress", "action_required")
# The recovery workflow's final publication step; a prior recovery dispatch
# whose jobs show this step executed has already taken its one write turn.
RECOVERY_PUBLISH_STEP = "Recover namespace ownership publication"
RECOVERY_WRITE_PERMISSIONS = frozenset({"admin", "maintain", "write"})
CONTEXT = "Migration namespace / protected owner"
API = "https://api.github.com"
MAX_RESPONSE = 8 * 1024 * 1024
MAX_BLOB = 1024 * 1024
MAX_FILES = 512
_COMPLETED_CONCLUSIONS = frozenset({"success", "failure", "neutral", "cancelled", "skipped",
                                    "timed_out", "action_required", "stale", "startup_failure"})
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


@dataclass(frozen=True)
class _VerifiedIssuer:
    run_id: int
    attempt: int
    workflow_id: int

    @property
    def original_details_url(self):
        return f"https://github.com/{REPO}/actions/runs/{self.run_id}/attempts/1"


def _issuer_title(origin: _VerifiedRun):
    return f"Migration owner {origin.run_id}/{origin.attempt} {origin.head}"


def _issuer_record(value, origin: _VerifiedRun, issuer_id, attempt, *, completed=False):
    """An authentic Actions record binds the actual issuer to its whole target."""
    require(isinstance(value, dict) and positive(value.get("id")) == issuer_id
            and positive(value.get("run_attempt")) == attempt, "issuer attempt identity changed")
    for key in ("repository", "head_repository"):
        repo = value.get(key) or {}
        require(repo.get("full_name") == REPO and positive(repo.get("id")) == origin.repository_id,
                "foreign issuer repository")
    require(value.get("event") == "workflow_run" and value.get("path") == ISSUER_WORKFLOW
            and value.get("name") == ISSUER_NAME and value.get("head_branch") == "master"
            and value.get("head_sha") == origin.protected_code
            and value.get("display_title") == _issuer_title(origin), "issuer target or protected code differs")
    if completed:
        require(value.get("status") == "completed" and value.get("conclusion") == "success",
                "original issuer attempt has not passed")
    else:
        require(value.get("status") == "in_progress", "issuer is not the actual running attempt")
    return _VerifiedIssuer(issuer_id, attempt, positive(value.get("workflow_id")))


def _issuer_workflow(issuer: _VerifiedIssuer, api):
    workflow = api.request("GET", f"/repos/{REPO}/actions/workflows/{issuer.workflow_id}")
    require(positive(workflow.get("id")) == issuer.workflow_id
            and workflow.get("path") == ISSUER_WORKFLOW and workflow.get("name") == ISSUER_NAME
            and workflow.get("state") == "active", "issuer workflow identity differs")


def _qualify_issuer(origin: _VerifiedRun, env: dict, api):
    values = []
    for name in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        raw = env.get(name)
        require(isinstance(raw, str) and re.fullmatch(r"[1-9][0-9]{0,18}", raw), "issuer identity unavailable")
        values.append(positive(int(raw)))
    issuer_id, attempt = values
    current = api.request("GET", f"/repos/{REPO}/actions/runs/{issuer_id}")
    issuer = _issuer_record(current, origin, issuer_id, attempt)
    _issuer_workflow(issuer, api)
    return issuer


def _run_identity(value: dict) -> tuple:
    """Immutable source identity; each caller owns its lifecycle policy."""
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
    return (positive(value.get("id")), positive(value.get("run_attempt")),
            positive(value.get("workflow_id")), group.oid(value.get("head_sha")),
            branch, event, positive(repo.get("id")))


def _qualify_run(event: dict, env: dict, api) -> _VerifiedRun:
    require(env.get("GITHUB_ACTIONS") == "true" and env.get("GITHUB_EVENT_NAME") == "workflow_run"
            and env.get("GITHUB_REPOSITORY") == REPO and env.get("GITHUB_REF") == "refs/heads/master",
            "issuer is not a default-branch workflow run")
    code = group.oid(env.get("GITHUB_SHA"))
    require(event.get("action") == "in_progress", "wrong issuer activity")
    repository = event.get("repository") or {}
    require(repository.get("full_name") == REPO and repository.get("default_branch") == "master",
            "wrong issuer repository")
    source = event.get("workflow_run")
    identity = _run_identity(source)
    require(source.get("status") == "in_progress" and "conclusion" in source
            and source["conclusion"] is None, "inconsistent source start event")
    require(positive(repository.get("id")) == identity[-1]
            and env.get("GITHUB_REPOSITORY_ID") == str(identity[-1]), "repository identity changed")
    run_id, attempt, workflow_id, head, branch, source_event, repo_id = identity
    # These are service reads, not artifacts or caller-supplied source pointers.
    current = api.request("GET", f"/repos/{REPO}/actions/runs/{run_id}")
    require(_run_identity(current) == identity, "original run replaced or changed")
    # The same CI attempt may finish before this supplementary issuer starts.
    # Namespace validity is independent of its result; required CI still gates
    # release, and the transition verifier separately requires successful CI.
    require((current.get("status") == "in_progress" and "conclusion" in current
             and current["conclusion"] is None)
            or (current.get("status") == "completed"
                and current.get("conclusion") in _COMPLETED_CONCLUSIONS),
            "source lifecycle is inconsistent or not started")
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
        # The validator sorts a local copy; API node order is not proof order.
        ordered = sorted(repository["mergeQueue"]["entries"]["nodes"],
                         key=lambda entry: entry["position"])
        candidate = next(entry for entry in ordered if entry["headCommit"]["oid"] == origin.head)
        prefix = ordered[:candidate["position"]]
    else:
        number, source, verified_base = group._validate_serial_queue(snapshot, REPO, origin.head, base)
        owners = {number: source}
        candidate = next(entry for entry in repository["mergeQueue"]["entries"]["nodes"]
                         if isinstance(entry, dict)
                         and (entry.get("headCommit") or {}).get("oid") == origin.head)
        prefix = [candidate]
    # The integrated candidate tree is the queue entry's head commit ROOT
    # tree: the head-commit read below must land on exactly that root tree,
    # never a same-named other one. (Commit.tree is the root tree, not the
    # supabase/migrations subtree the material read returns.)
    integrated_tree = group.oid(((candidate.get("headCommit") or {}).get("tree") or {}).get("oid"))
    # Validate the response before trimming. Only the proven prefix contributes
    # to this candidate; unrelated suffix churn is not drift.
    queue = repository["mergeQueue"]
    projection = {"repository": {
        "nameWithOwner": repository["nameWithOwner"],
        "defaultBranchRef": repository["defaultBranchRef"],
        "mergeQueue": {"configuration": queue["configuration"],
                       "entries": {"nodes": prefix}}}}
    return projection, owners, verified_base, integrated_tree


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
query($owner: String!, $name: String!, $path: String!, $head: GitObjectID!) {
 repository(owner: $owner, name: $name) {
  nameWithOwner
  head: object(oid: $head) { __typename ... on Commit { oid tree { oid } } }
  object(expression: $path) { __typename ... on Tree {
   oid entries { name type mode object { __typename ... on Blob { oid byteSize isBinary isTruncated text } } }
  } }
 }
}
"""


def _candidate_data(origin: _VerifiedRun, api, integrated_tree=None):
    data = api.graphql(CONTENTS_QUERY, _variables() | {"path": origin.head + ":supabase/migrations",
                                                       "head": origin.head})
    repo = data.get("repository") or {}
    require(repo.get("nameWithOwner") == REPO, "foreign candidate repository")
    # The head commit's ROOT tree is the integrated tree the queue snapshot
    # reported; the migration material is then read from inside that same
    # immutable commit. A root tree and the supabase/migrations subtree are
    # different git objects, so only root-tree-to-root-tree equality binds.
    commit = repo.get("head") or {}
    require(commit.get("__typename") == "Commit" and commit.get("oid") == origin.head,
            "candidate head commit unavailable")
    root_tree = group.oid((commit.get("tree") or {}).get("oid"))
    if integrated_tree is not None:
        require(root_tree == integrated_tree,
                "candidate head tree differs from the integrated queue tree")
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
    if origin.event == "merge_group":
        snapshot, owners, base, integrated_tree = _queue(origin, api)
        doc, sql, markdown, material_digest = _candidate_data(origin, api, integrated_tree)
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
        doc, sql, markdown, material_digest = _candidate_data(origin, api)
        findings = namespace.check_all(sorted(sql), {n: b.decode() for n, b in sql.items()}, doc,
                                       markdown, pr_number=number)
    require(not findings, "migration namespace refused")
    return digest(snapshot), material_digest


def _assert_current(origin: _VerifiedRun, issuer: _VerifiedIssuer, event: dict, env: dict, api, evidence):
    require(_qualify_run(event, env, api) == origin, "source run changed before publication")
    require(_qualify_issuer(origin, env, api) == issuer, "issuer attempt changed before publication")
    require(_qualify_contents(origin, api) == evidence, "source or queue changed before publication")


def _check_identity(check: dict, origin: _VerifiedRun, issuer: _VerifiedIssuer, app_id: int):
    require(isinstance(check, dict) and positive(check.get("id"))
            and check.get("name") == CONTEXT and check.get("head_sha") == origin.head
            and type((check.get("app") or {}).get("id")) is int
            and (check.get("app") or {}).get("id") == app_id
            and check.get("external_id") == origin.external_id
            and check.get("details_url") == issuer.original_details_url, "wrong check producer or selection")


def execute(event: dict, env: dict, api, app_id: int):
    """Actual owner entry. api is fixed Api in main; tests supply inert service."""
    positive(app_id)
    require(app_id != 15368, "independent check App required")
    origin = _qualify_run(event, env, api)
    issuer = _qualify_issuer(origin, env, api)
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
        _check_identity(matches[0], origin, issuer, app_id)
        require(matches[0].get("status") == "completed", "original check outcome unsettled; no replay")
        return {"state": "RECONCILED", "conclusion": matches[0].get("conclusion")}
    # A later issuer attempt is never evidence NOT_SENT, even if the service
    # currently exposes no check after the original POST/response loss.
    require(issuer.attempt == 1, "original issuer outcome unknown; later attempts are reconcile-only")
    # Produce no success until both checks of the current origin and full data pass.
    # An unknown POST response ends this invocation: there is no retry path.
    evidence = _qualify_contents(origin, api)
    require(_qualify_run(event, env, api) == origin, "source run changed before check creation")
    require(_qualify_issuer(origin, env, api) == issuer, "issuer attempt changed before check creation")
    check = api.request("POST", f"/repos/{REPO}/check-runs", {
        "name": CONTEXT, "head_sha": origin.head, "external_id": origin.external_id,
        "details_url": issuer.original_details_url,
        "status": "in_progress", "output": {"title": "Migration ownership", "summary": "Qualification in progress."}})
    _check_identity(check, origin, issuer, app_id)
    require(check.get("status") == "in_progress" and "conclusion" in check
            and check["conclusion"] is None, "created check state unconfirmed; no retry")
    try:
        _assert_current(origin, issuer, event, env, api, evidence)
    except CapabilityUnavailable:
        # A missing read is not a proved qualification failure.
        raise
    except group.OwnershipUnqualified:
        # Only a known, acknowledged check can be failed, and only while both
        # original principals still qualify. Superseded or unavailable origins
        # leave the original outcome unsettled; they never authorize a replay.
        require(_qualify_run(event, env, api) == origin, "source superseded; no settlement")
        require(_qualify_issuer(origin, env, api) == issuer, "issuer superseded; no settlement")
        result = api.request("PATCH", f"/repos/{REPO}/check-runs/{check['id']}", {
            "status": "completed", "conclusion": "failure",
            "output": {"title": "Migration ownership changed", "summary":
                       "Current namespace or ownership qualification changed before publication. "
                       "No successful ownership proof was issued."}})
        _check_identity(result, origin, issuer, app_id)
        require(result.get("id") == check["id"] and result.get("status") == "completed"
                and result.get("conclusion") == "failure", "failure settlement unconfirmed; no retry")
        raise
    # Currentness includes content reads. Refresh both principals once more at
    # the write boundary rather than letting a long data read outlive an attempt.
    require(_qualify_run(event, env, api) == origin, "source run changed before success")
    require(_qualify_issuer(origin, env, api) == issuer, "issuer changed before success")
    result = api.request("PATCH", f"/repos/{REPO}/check-runs/{check['id']}", {
        "status": "completed", "conclusion": "success",
        "output": {"title": "Migration ownership qualified", "summary":
                   f"Run {origin.run_id}, attempt {origin.attempt}; protected guard {origin.protected_code}; "
                   f"namespace material {evidence[1]}."}})
    _check_identity(result, origin, issuer, app_id)
    require(result.get("id") == check["id"] and result.get("status") == "completed"
            and result.get("conclusion") == "success",
            "check publication unconfirmed; no retry")
    return {"state": "PUBLISHED", "head": origin.head}


VALIDATOR_QUERY = """
query($owner: String!, $name: String!, $p0: String!, $p1: String!, $p2: String!) {
 repository(owner: $owner, name: $name) {
  nameWithOwner
  p0: object(expression: $p0) { __typename ... on Blob { oid } }
  p1: object(expression: $p1) { __typename ... on Blob { oid } }
  p2: object(expression: $p2) { __typename ... on Blob { oid } }
 }
}
"""


@dataclass(frozen=True)
class _VerifiedRecovery:
    run_id: int
    attempt: int
    workflow_id: int

    @property
    def original_details_url(self):
        return f"https://github.com/{REPO}/actions/runs/{self.run_id}/attempts/1"


def _recovery_title(origin: _VerifiedRun):
    return f"Migration owner recovery {origin.run_id} {origin.protected_code}"


def _recovery_context(event: dict, env: dict):
    """A manual default-branch dispatch is a new origin; nothing is inherited.

    The dispatch-time default-branch commit (GITHUB_SHA on refs/heads/master)
    is the only revision this run may execute: caller-selected issuer
    revisions are structurally impossible, and the checkout must land on
    exactly that anchor."""
    require(env.get("GITHUB_ACTIONS") == "true" and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and env.get("GITHUB_REPOSITORY") == REPO and env.get("GITHUB_REF") == "refs/heads/master",
            "recovery is not a default-branch manual dispatch")
    anchor = group.oid(env.get("GITHUB_SHA"))
    raw = env.get("RECOVERY_TARGET_RUN")
    require(isinstance(raw, str) and re.fullmatch(r"[1-9][0-9]{0,18}", raw), "invalid recovery target")
    require(env.get("TRUSTED_CHECKOUT_SHA") == anchor,
            "recovery checkout is not the dispatch-time master revision")
    repository = event.get("repository") or {}
    require(repository.get("full_name") == REPO and repository.get("default_branch") == "master",
            "wrong dispatch repository")
    return anchor, positive(int(raw))


def _validator_identity(api, ref: str):
    """Content-addressed identity of the three executed modules at one revision.

    `ref` is the dispatch-time anchor SHA or the moving "master" tip; comparing
    the two refuses a dispatch whose executing bytes are no longer current
    protected law (any of the three modules differing makes the run stale)."""
    data = api.graphql(VALIDATOR_QUERY, _variables()
                       | {f"p{i}": f"{ref}:{path}" for i, path in enumerate(VALIDATOR_PATHS)})
    repo = data.get("repository") or {}
    require(repo.get("nameWithOwner") == REPO, "foreign validator repository")
    identities = []
    for i in range(len(VALIDATOR_PATHS)):
        value = repo.get(f"p{i}") or {}
        require(value.get("__typename") == "Blob", "protected validator module unavailable")
        identities.append(group.oid(value.get("oid")))
    return tuple(identities)


def _recovery_origin(target_id: int, anchor: str, api) -> _VerifiedRun:
    value = api.request("GET", f"/repos/{REPO}/actions/runs/{target_id}")
    identity = _run_identity(value)
    run_id, attempt, workflow_id, head, branch, event, repo_id = identity
    workflow = api.request("GET", f"/repos/{REPO}/actions/workflows/{workflow_id}")
    require(positive(workflow.get("id")) == workflow_id and workflow.get("path") == WORKFLOW
            and workflow.get("name") == "CI" and workflow.get("state") == "active",
            "source workflow identity changed")
    # Only a completed target may be recovered: the original issuer fires on
    # CI start, so an absent check for a finished run proves that issuer attempt
    # will never mint. A still-running target keeps its original issuer's turn.
    require(value.get("status") == "completed" and value.get("conclusion") in _COMPLETED_CONCLUSIONS,
            "recovery target has not completed; the original issuer may still publish")
    return _VerifiedRun(run_id, attempt, workflow_id, head, branch, event, anchor, repo_id)


def _recovery_record(value, origin: _VerifiedRun, anchor: str, issuer_id: int, attempt: int):
    require(isinstance(value, dict) and positive(value.get("id")) == issuer_id
            and positive(value.get("run_attempt")) == attempt, "recovery attempt identity changed")
    for key in ("repository", "head_repository"):
        repo = value.get(key) or {}
        require(repo.get("full_name") == REPO and positive(repo.get("id")) == origin.repository_id,
                "foreign recovery repository")
    require(value.get("event") == "workflow_dispatch" and value.get("path") == RECOVERY_ISSUER_WORKFLOW
            and value.get("name") == RECOVERY_ISSUER_NAME and value.get("head_branch") == "master"
            and value.get("head_sha") == anchor and value.get("display_title") == _recovery_title(origin)
            and value.get("status") == "in_progress",
            "recovery run target or dispatch revision differs")
    return _VerifiedRecovery(issuer_id, attempt, positive(value.get("workflow_id")))


def _qualify_recovery(origin: _VerifiedRun, anchor: str, env: dict, api):
    values = []
    for name in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        raw = env.get(name)
        require(isinstance(raw, str) and re.fullmatch(r"[1-9][0-9]{0,18}", raw),
                "recovery identity unavailable")
        values.append(positive(int(raw)))
    issuer_id, attempt = values
    current = api.request("GET", f"/repos/{REPO}/actions/runs/{issuer_id}")
    recovery = _recovery_record(current, origin, anchor, issuer_id, attempt)
    workflow = api.request("GET", f"/repos/{REPO}/actions/workflows/{recovery.workflow_id}")
    require(positive(workflow.get("id")) == recovery.workflow_id
            and workflow.get("path") == RECOVERY_ISSUER_WORKFLOW
            and workflow.get("name") == RECOVERY_ISSUER_NAME and workflow.get("state") == "active",
            "recovery workflow identity differs")
    return recovery, current


def _actor(event: dict, record: dict, api):
    """Authenticated dispatch provenance; never a forged workflow_run identity."""
    sender = event.get("sender") or {}
    login = sender.get("login")
    require(isinstance(login, str) and re.fullmatch(r"[A-Za-z0-9-]{1,39}", login)
            and sender.get("type") == "User", "dispatching actor is not an authenticated user")
    require((record.get("triggering_actor") or {}).get("login") == login,
            "dispatching actor differs from the authenticated trigger")
    permission = api.request("GET", f"/repos/{REPO}/collaborators/{login}/permission")
    require((permission.get("user") or {}).get("login") == login,
            "permission read returned another principal")
    level = permission.get("permission")
    require(level in RECOVERY_WRITE_PERMISSIONS, "dispatching actor lacks repository write authority")
    return login, level


def _prior_operation(checks, origin: _VerifiedRun, app_id: int):
    operation_prefix = origin.external_id.rsplit(":", 1)[0] + ":"
    matches = [c for c in checks if c.get("name") == CONTEXT
               and (c.get("app") or {}).get("id") == app_id
               and isinstance(c.get("external_id"), str)
               and c["external_id"].startswith(operation_prefix)]
    require(len(matches) <= 1, "duplicate owner operation")
    return matches[0] if matches else None


def _prior_issuer(check: dict, origin: _VerifiedRun, api):
    """Authenticate the prior check's claimed issuer run against real metadata."""
    match = re.fullmatch(re.escape(f"https://github.com/{REPO}/actions/runs/")
                         + r"([1-9][0-9]{0,18})/attempts/1", check.get("details_url", ""))
    require(match is not None, "prior check issuer selection missing")
    issuer_id = positive(int(match[1]))
    code = group.oid(check["external_id"].rsplit(":", 1)[1])
    current = api.request("GET", f"/repos/{REPO}/actions/runs/{issuer_id}")
    require(isinstance(current, dict) and positive(current.get("id")) == issuer_id
            and positive(current.get("run_attempt")) == 1, "prior issuer attempt differs")
    for key in ("repository", "head_repository"):
        repo = current.get(key) or {}
        require(repo.get("full_name") == REPO and positive(repo.get("id")) == origin.repository_id,
                "foreign prior issuer repository")
    if current.get("path") == ISSUER_WORKFLOW:
        require(current.get("name") == ISSUER_NAME and current.get("event") == "workflow_run"
                and current.get("head_sha") == code
                and current.get("display_title") == _issuer_title(origin),
                "prior original issuer is not bound to this operation")
    elif current.get("path") == RECOVERY_ISSUER_WORKFLOW:
        require(current.get("name") == RECOVERY_ISSUER_NAME
                and current.get("event") == "workflow_dispatch"
                and current.get("head_branch") == "master"
                and current.get("display_title") == f"Migration owner recovery {origin.run_id} {code}",
                "prior recovery issuer is not bound to this operation")
    else:
        require(False, "prior check issuer is not a qualified ownership publisher")


def _no_live_issuer(origin: _VerifiedRun, api):
    """Any not-yet-completed automatic issuer run for this operation owns it.

    The list endpoint has no not-completed filter, so every non-completed
    status is scanned separately: a queued, waiting, pending, requested,
    action-required or in-progress issuer attempt still gets its turn, and
    recovery must not publish over it."""
    title = _issuer_title(origin)
    for status in _LIVE_ISSUER_STATUSES:
        value = api.request("GET",
                            f"/repos/{REPO}/actions/runs?event=workflow_run&status={status}&per_page=100")
        runs = value.get("workflow_runs")
        require(isinstance(runs, list) and type(value.get("total_count")) is int
                and value["total_count"] == len(runs) <= 100, "incomplete live issuer scan")
        require(not any(isinstance(run, dict) and run.get("path") == ISSUER_WORKFLOW
                        and run.get("display_title") == title for run in runs),
                "a pending or live issuer owns this operation")


def _prior_recovery_completed(origin: _VerifiedRun, recovery: _VerifiedRecovery, api):
    """Duplicate-publication guard: an earlier recovery dispatch for the same
    target (matched by run title) must be settled and must not have reached
    the publication step, unless its check was already reconciled above."""
    value = api.request("GET",
                        f"/repos/{REPO}/actions/runs?event=workflow_dispatch&per_page=100")
    runs = value.get("workflow_runs")
    require(isinstance(runs, list) and type(value.get("total_count")) is int
            and value["total_count"] == len(runs) <= 100, "incomplete prior recovery scan")
    prefix = f"Migration owner recovery {origin.run_id} "
    for run in runs:
        if not (isinstance(run, dict) and run.get("path") == RECOVERY_ISSUER_WORKFLOW
                and isinstance(run.get("display_title"), str)
                and run.get("display_title").startswith(prefix)):
            continue
        prior_id = positive(run.get("id"))
        if prior_id == recovery.run_id:
            continue
        require(run.get("status") == "completed", "an earlier recovery for this target is not settled")
        jobs = api.request("GET", f"/repos/{REPO}/actions/runs/{prior_id}/jobs?per_page=100")
        listed = jobs.get("jobs")
        require(isinstance(listed, list) and type(jobs.get("total_count")) is int
                and jobs["total_count"] == len(listed) <= 100, "incomplete prior recovery job scan")
        reached = any(isinstance(job, dict) and isinstance(job.get("steps"), list)
                      and any(isinstance(step, dict) and step.get("name") == RECOVERY_PUBLISH_STEP
                              and step.get("conclusion") not in (None, "skipped")
                              for step in job["steps"]) for job in listed)
        require(not reached, "an earlier recovery reached publication for this target")


def _recovery_check_identity(check: dict, origin: _VerifiedRun, recovery: _VerifiedRecovery, app_id: int):
    require(isinstance(check, dict) and positive(check.get("id"))
            and check.get("name") == CONTEXT and check.get("head_sha") == origin.head
            and type((check.get("app") or {}).get("id")) is int
            and (check.get("app") or {}).get("id") == app_id
            and check.get("external_id") == origin.external_id
            and check.get("details_url") == recovery.original_details_url,
            "wrong check producer or selection")


def execute_recovery(event: dict, env: dict, api, app_id: int):
    """Manual recovery entry of the same ownership publisher.

    The dispatch-time default-branch revision supplies the executed bytes, and
    the run is refused as stale once current master carries different protected
    module bytes. No candidate code, SQL, cache or artifact is ever executed
    here: candidate material is fetched as bounded, hash-checked data.
    """
    positive(app_id)
    require(app_id != 15368, "independent check App required")
    anchor, target_id = _recovery_context(event, env)
    # ANTI-ROLLBACK/STALENESS: the executing bytes must still be exactly the
    # current protected law on master; older or divergent law cannot be selected.
    require(_validator_identity(api, anchor) == _validator_identity(api, "master"),
            "dispatch-time protected law differs from current master")
    origin = _recovery_origin(target_id, anchor, api)
    require(env.get("GITHUB_REPOSITORY_ID") == str(origin.repository_id), "repository identity changed")
    recovery, record = _qualify_recovery(origin, anchor, env, api)
    actor, level = _actor(event, record, api)
    prior_response = api.request("GET", f"/repos/{REPO}/commits/{origin.head}/check-runs?filter=all&per_page=100")
    checks = prior_response.get("check_runs")
    require(isinstance(checks, list) and type(prior_response.get("total_count")) is int
            and prior_response["total_count"] == len(checks) < 100, "incomplete prior checks")
    prior = _prior_operation(checks, origin, app_id)
    if prior is not None:
        # Original-operation reconciliation: a settled operation is only read
        # back; an unsettled one can never be replayed over.
        _prior_issuer(prior, origin, api)
        require(prior.get("status") == "completed", "original check outcome unsettled; no replay")
        return {"state": "RECONCILED", "conclusion": prior.get("conclusion")}
    _no_live_issuer(origin, api)
    _prior_recovery_completed(origin, recovery, api)
    require(recovery.attempt == 1, "original recovery outcome unknown; later attempts are reconcile-only")
    evidence = _qualify_contents(origin, api)
    require(_recovery_origin(target_id, anchor, api) == origin, "target changed before check creation")
    require(_qualify_recovery(origin, anchor, env, api)[0] == recovery,
            "recovery attempt changed before check creation")
    # M1: the live-issuer scan repeats immediately before the write, so an
    # issuer attempt that appeared during the material read still keeps the turn.
    _no_live_issuer(origin, api)
    check = api.request("POST", f"/repos/{REPO}/check-runs", {
        "name": CONTEXT, "head_sha": origin.head, "external_id": origin.external_id,
        "details_url": recovery.original_details_url,
        "status": "in_progress",
        "output": {"title": "Migration ownership (recovery)", "summary":
                   f"Manual recovery by {actor} ({level}); protected law {anchor}; "
                   f"target run {origin.run_id}; qualification in progress."}})
    _recovery_check_identity(check, origin, recovery, app_id)
    require(check.get("status") == "in_progress" and "conclusion" in check
            and check["conclusion"] is None, "created check state unconfirmed; no retry")
    try:
        require(_recovery_origin(target_id, anchor, api) == origin, "target superseded; no settlement")
        require(_qualify_recovery(origin, anchor, env, api)[0] == recovery,
                "recovery superseded; no settlement")
        require(_qualify_contents(origin, api) == evidence, "source or queue changed before publication")
    except CapabilityUnavailable:
        # A missing read is not a proved qualification failure.
        raise
    except group.OwnershipUnqualified:
        # Only a known, acknowledged check can be failed, and only while both
        # principals still qualify; otherwise the outcome stays unsettled.
        require(_recovery_origin(target_id, anchor, api) == origin, "target superseded; no settlement")
        require(_qualify_recovery(origin, anchor, env, api)[0] == recovery,
                "recovery superseded; no settlement")
        result = api.request("PATCH", f"/repos/{REPO}/check-runs/{check['id']}", {
            "status": "completed", "conclusion": "failure",
            "output": {"title": "Migration ownership changed", "summary":
                       "Current namespace or ownership qualification changed before recovery "
                       "publication. No successful ownership proof was issued."}})
        _recovery_check_identity(result, origin, recovery, app_id)
        require(result.get("id") == check["id"] and result.get("status") == "completed"
                and result.get("conclusion") == "failure", "failure settlement unconfirmed; no retry")
        raise
    result = api.request("PATCH", f"/repos/{REPO}/check-runs/{check['id']}", {
        "status": "completed", "conclusion": "success",
        "output": {"title": "Migration ownership qualified (recovery)", "summary":
                   f"Recovery run {recovery.run_id}, attempt {recovery.attempt}; actor {actor} "
                   f"({level}); protected law {origin.protected_code}; target run {origin.run_id}, "
                   f"attempt {origin.attempt}; namespace material {evidence[1]}."}})
    _recovery_check_identity(result, origin, recovery, app_id)
    require(result.get("id") == check["id"] and result.get("status") == "completed"
            and result.get("conclusion") == "success",
            "check publication unconfirmed; no retry")
    return {"state": "PUBLISHED", "head": origin.head, "by": actor, "protected_code": origin.protected_code}


def main():
    try:
        event = decode(Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
        if sys.argv[1:] == ["--preflight"]:
            require(positive(int(os.environ["OWNERSHIP_APP_ID"])) != 15368
                    and positive(int(os.environ["EXPECTED_INSTALLATION"])), "independent installation not configured")
            api = Api(os.environ.get("OWNERSHIP_RUN_TOKEN", ""))
            origin = _qualify_run(event, dict(os.environ), api)
            issuer = _qualify_issuer(origin, dict(os.environ), api)
            # The configured workflow refuses reruns BEFORE key/mint access.
            require(issuer.attempt == 1, "issuer rerun retained; no mint or mutation")
            print("migration-owner: protected run origin qualified")
            return 0
        if sys.argv[1:] == ["--recover-preflight"]:
            app_id = int(os.environ["OWNERSHIP_APP_ID"])
            require(0 < app_id != 15368 and positive(int(os.environ["EXPECTED_INSTALLATION"])),
                    "recovery requires an enrolled independent installation")
            api = Api(os.environ.get("OWNERSHIP_RUN_TOKEN", ""))
            anchor, target_id = _recovery_context(event, dict(os.environ))
            require(_validator_identity(api, anchor) == _validator_identity(api, "master"),
                    "dispatch-time protected law differs from current master")
            origin = _recovery_origin(target_id, anchor, api)
            recovery, record = _qualify_recovery(origin, anchor, dict(os.environ), api)
            # m3: dispatcher provenance must qualify here too, BEFORE the key
            # mint step that runs only after this preflight succeeds.
            _actor(event, record, api)
            # Recovery reruns reconcile only; they never reach the key/mint step.
            require(recovery.attempt == 1, "recovery rerun retained; no mint or mutation")
            print("migration-owner: recovery origin qualified")
            return 0
        if sys.argv[1:] == ["--recover"]:
            app_id = int(os.environ["OWNERSHIP_APP_ID"])
            execute_recovery(event, dict(os.environ), IssuerApi(os.environ.get("OWNERSHIP_TOKEN", ""),
                                                               os.environ.get("OWNERSHIP_RUN_TOKEN", "")), app_id)
            print("migration-owner: recovery complete")
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
