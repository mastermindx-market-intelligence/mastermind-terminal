"""Read-only qualification of one migration owner in one native merge group.

This deliberately supports only a serial, single-entry SQUASH queue. It never
infers membership from a queue ref, a supplied PR number, or the ledger alone.
Missing/changed GitHub state refuses qualification; the namespace guard keeps
its existing strict barrier. No queued or merged state is changed here.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Mapping


class OwnershipUnqualified(ValueError):
    pass


_READ_KINDS = frozenset({
    "forbidden", "rate_limited", "unauthorized", "not_found", "validation",
    "graphql_error", "mixed_errors", "malformed_errors", "response_shape",
    "json_decode", "transport", "http_unauthorized", "http_forbidden", "http_rate_limited", "http_other",
})
_GRAPHQL_KINDS = {
    "FORBIDDEN": "forbidden", "INSUFFICIENT_SCOPES": "forbidden",
    "RATE_LIMITED": "rate_limited", "UNAUTHORIZED": "unauthorized",
    "NOT_FOUND": "not_found", "GRAPHQL_VALIDATION_FAILED": "validation",
    "GRAPHQL_PARSE_FAILED": "validation",
}


class _ReadFailure(OwnershipUnqualified):
    """Only finite diagnostic data crosses the API-error boundary."""

    def __init__(self, kind: str, scope: str = "other") -> None:
        self.kind = kind if type(kind) is str and kind in _READ_KINDS else "graphql_error"
        self.scope = scope if type(scope) is str and scope in {"queue", "source"} else "other"
        super().__init__("GitHub ownership read failed" if self.kind in {
            "transport", "json_decode", "http_unauthorized", "http_forbidden", "http_rate_limited", "http_other",
        } else "GitHub ownership query did not succeed")


def _graphql_failure(errors: Any) -> _ReadFailure:
    if type(errors) is not list or not errors:
        return _ReadFailure("malformed_errors")
    # Do not traverse an unbounded error collection merely to enrich a refusal.
    if len(errors) > 8:
        return _ReadFailure("graphql_error")
    if any(type(e) is not dict for e in errors):
        return _ReadFailure("malformed_errors")
    kinds, scopes = set(), set()
    for error in errors:
        extension = error.get("extensions")
        code = error.get("type")
        if type(code) is not str and type(extension) is dict:
            code = extension.get("code")
        kinds.add(_GRAPHQL_KINDS.get(code, "graphql_error") if type(code) is str else "graphql_error")
        path = error.get("path")
        scope = "other"
        if type(path) is list and len(path) >= 2 and path[0] == "repository":
            field = path[1]
            if field == "mergeQueue":
                scope = "queue"
            elif type(field) is str and (field in {"ledger", "base_tree"}
                    or re.fullmatch(r"(?:file|base)[0-9]{1,5}", field)):
                scope = "source"
        scopes.add(scope)
    return _ReadFailure(next(iter(kinds)) if len(kinds) == 1 else "mixed_errors",
                        next(iter(scopes)) if len(scopes) == 1 else "other")


def _read_at_stage(read: Callable[[str, dict], dict], stage: str,
                   query: str, variables: dict) -> dict:
    require(type(stage) is str and stage in {"queue_snapshot", "immutable_source"},
            "ownership diagnostic stage invalid")
    try:
        return read(query, variables)
    except _ReadFailure as exc:
        # Never format the original API exception, body, query or path.
        raise OwnershipUnqualified(
            f"GitHub ownership read failed [stage={stage}; kind={exc.kind}; scope={exc.scope}]"
        ) from None


def require(value: Any, message: str) -> None:
    if not value:
        raise OwnershipUnqualified(message)


def oid(value: Any) -> str:
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value), "invalid commit identity")
    return value


def git_blob(raw: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


QUEUE_QUERY = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    defaultBranchRef { name target { oid } }
    mergeQueue(branch: "master") {
      configuration { mergeMethod mergingStrategy maximumEntriesToBuild maximumEntriesToMerge }
      entries(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id position baseCommit { oid }
          headCommit { oid tree { oid } parents(first: 3) { nodes { oid } } }
          pullRequest {
            number state baseRefName headRefOid
            baseRepository { nameWithOwner } headRepository { nameWithOwner }
            potentialMergeCommit { tree { oid } parents(first: 3) { nodes { oid } } }
          }
        }
      }
    }
  }
}
"""


def validate_snapshot(data: dict, event: dict, env: Mapping[str, str], checkout_head: str) -> tuple[int, str, str]:
    """Bind GitHub's candidate and current PR merge tree to the actual event."""
    require(env.get("GITHUB_EVENT_NAME") == "merge_group", "not a merge-group event")
    require(event.get("action") == "checks_requested", "wrong merge-group action")
    repo = env.get("GITHUB_REPOSITORY", "")
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo), "invalid repository identity")
    require(event.get("repository", {}).get("full_name") == repo, "event repository differs")
    group = event.get("merge_group", {})
    head, base = oid(group.get("head_sha")), oid(group.get("base_sha"))
    require(checkout_head == head == env.get("GITHUB_SHA"), "event and checkout heads differ")
    require(group.get("base_ref") == "refs/heads/master", "wrong base ref")
    ref = group.get("head_ref", "")
    require(isinstance(ref, str) and ref.startswith("refs/heads/gh-readonly-queue/master/")
            and ref == env.get("GITHUB_REF"), "event and checkout refs differ")
    repository = data.get("repository") or {}
    require(repository.get("nameWithOwner") == repo, "API repository differs")
    default = repository.get("defaultBranchRef") or {}
    require(default.get("name") == "master" and default.get("target", {}).get("oid") == base,
            "group base is no longer the protected branch tip")
    queue = repository.get("mergeQueue") or {}
    config = queue.get("configuration") or {}
    require(config.get("mergeMethod") == "SQUASH"
            and type(config.get("maximumEntriesToBuild")) is int
            and type(config.get("maximumEntriesToMerge")) is int
            and config.get("maximumEntriesToBuild") == 1
            and config.get("maximumEntriesToMerge") == 1,
            "only a serial single-entry SQUASH queue is qualified")
    entries = queue.get("entries") or {}
    require(entries.get("pageInfo", {}).get("hasNextPage") is False, "incomplete queue snapshot")
    nodes = entries.get("nodes")
    require(isinstance(nodes, list), "missing queue entries")
    matches = [n for n in nodes if isinstance(n, dict) and (n.get("headCommit") or {}).get("oid") == head]
    require(len(matches) == 1, "candidate has no unique native queue entry")
    entry = matches[0]
    require(type(entry.get("position")) is int and entry["position"] == 1, "candidate is not the first queue entry")
    require((entry.get("baseCommit") or {}).get("oid") == base, "queue base differs from event")
    candidate = entry["headCommit"]
    require(candidate.get("parents", {}).get("nodes") == [{"oid": base}], "candidate is not a single-parent squash")
    pr = entry.get("pullRequest") or {}
    number = pr.get("number")
    require(type(number) is int and number > 0, "invalid owner PR")
    source_head = oid(pr.get("headRefOid"))
    require(pr.get("state") == "OPEN" and pr.get("baseRefName") == "master", "owner PR is not open against master")
    require((pr.get("baseRepository") or {}).get("nameWithOwner") == repo
            and (pr.get("headRepository") or {}).get("nameWithOwner") == repo, "foreign PR repository")
    merge = pr.get("potentialMergeCommit") or {}
    require(merge.get("parents", {}).get("nodes") == [{"oid": base}, {"oid": source_head}],
            "PR merge is not bound to the exact base and source head")
    tree = oid((candidate.get("tree") or {}).get("oid"))
    require((merge.get("tree") or {}).get("oid") == tree, "PR merge tree differs from the queued candidate")
    return number, source_head, base


def validate_migrations(number: int, doc: dict, files: Mapping[str, bytes], source: dict) -> None:
    """Require every open migration to originate, byte-for-byte, in that PR."""
    prefixes = doc.get("prefixes", {})
    ledger_object = source.get("ledger") or {}
    require(ledger_object.get("__typename") == "Blob", "source ledger is not a blob")
    try:
        ledger = json.loads(ledger_object["text"])
    except (KeyError, TypeError, ValueError) as exc:
        raise OwnershipUnqualified("source ledger is unreadable") from exc
    # Tree.entries is the complete, non-paginated immediate directory at the
    # immutable base commit. A null/malformed directory cannot prove absence.
    base_tree = source.get("base_tree") or {}
    require(base_tree.get("__typename") == "Tree", "protected-base migration directory is unavailable")
    entries = base_tree.get("entries")
    require(isinstance(entries, list), "protected-base migration directory is incomplete")
    occupied = set()
    for entry in entries:
        require(isinstance(entry, dict) and isinstance(entry.get("name"), str)
                and bool(entry["name"]) and "/" not in entry["name"] and "\0" not in entry["name"]
                and entry.get("type") in {"blob", "tree", "commit"},
                "protected-base migration directory has an invalid entry")
        match = re.fullmatch(r"(\d{4})_.*\.sql", entry["name"])
        if match:
            occupied.add(match[1])
    for i, (name, raw) in enumerate(sorted(files.items())):
        prefix = name.split("_", 1)[0]
        require(prefix not in occupied, "migration prefix already exists on the protected base")
        row = prefixes.get(prefix) or {}
        require(row.get("state") == "taken" and row.get("pr_state") == "open"
                and type(row.get("pr")) is int and row["pr"] == number and row.get("file") == name,
                "present open migration is not owned by the verified PR")
        require(ledger.get("prefixes", {}).get(prefix) == row, "source and candidate ledger rows differ")
        original = source.get(f"file{i}") or {}
        require(original.get("__typename") == "Blob" and original.get("oid") == git_blob(raw),
                "source and candidate migration bytes differ")
        require(f"base{i}" in source and source[f"base{i}"] is None,
                "protected-base migration absence is not proven")



def validate_parallel_snapshot(
    data: dict, event: dict, env: Mapping[str, str], checkout_head: str
) -> tuple[dict[int, str], str]:
    """Bind the exact ordered queue prefix to this candidate's real Git tree.

    ALLGREEN currently builds up to eight candidates at once; each accepted
    candidate is a single-parent squash of its predecessor. The open migration
    may belong to ANY verified preceding PR, not necessarily the final PR.
    """
    require(env.get("GITHUB_EVENT_NAME") == "merge_group", "not a merge-group event")
    require(event.get("action") == "checks_requested", "wrong merge-group action")
    repo = env.get("GITHUB_REPOSITORY", "")
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo), "invalid repository identity")
    require(event.get("repository", {}).get("full_name") == repo, "event repository differs")
    group = event.get("merge_group", {})
    head, event_base = oid(group.get("head_sha")), oid(group.get("base_sha"))
    require(checkout_head == head == env.get("GITHUB_SHA"), "event and checkout heads differ")
    require(group.get("base_ref") == "refs/heads/master", "wrong protected base ref")
    ref = group.get("head_ref", "")
    require(isinstance(ref, str) and ref.startswith("refs/heads/gh-readonly-queue/master/")
            and ref == env.get("GITHUB_REF"), "event and checkout refs differ")
    repository = data.get("repository") or {}
    require(repository.get("nameWithOwner") == repo, "API repository differs")
    default = repository.get("defaultBranchRef") or {}
    require(default.get("name") == "master", "queue target is not protected master")
    protected_tip = oid((default.get("target") or {}).get("oid"))
    queue = repository.get("mergeQueue") or {}
    config = queue.get("configuration") or {}
    require(
        config.get("mergeMethod") == "SQUASH"
        and config.get("mergingStrategy") == "ALLGREEN"
        and type(config.get("maximumEntriesToBuild")) is int
        and type(config.get("maximumEntriesToMerge")) is int
        and (config["maximumEntriesToBuild"], config["maximumEntriesToMerge"]) == (8, 4),
        "parallel queue profile is not qualified",
    )
    entries = queue.get("entries") or {}
    require(entries.get("pageInfo", {}).get("hasNextPage") is False, "incomplete queue snapshot")
    nodes = entries.get("nodes")
    require(isinstance(nodes, list) and nodes, "missing queue entries")
    require(all(isinstance(n, dict) and type(n.get("position")) is int
                and n["position"] > 0 for n in nodes), "invalid queue position")
    ordered = sorted(nodes, key=lambda n: n["position"])
    require(all(n["position"] == i for i, n in enumerate(ordered, 1)),
            "non-contiguous or duplicate queue positions")
    matches = [n for n in ordered if (n.get("headCommit") or {}).get("oid") == head]
    require(len(matches) == 1, "candidate has no unique native queue entry")
    candidate = matches[0]
    prefix = ordered[:candidate["position"]]
    require(prefix and prefix[-1] is candidate, "candidate position differs")
    owners: dict[int, str] = {}
    prev = protected_tip
    for entry in prefix:
        require((entry.get("baseCommit") or {}).get("oid") == prev,
                "native predecessor chain differs")
        commit = entry.get("headCommit") or {}
        current = oid(commit.get("oid"))
        oid((commit.get("tree") or {}).get("oid"))
        require(commit.get("parents", {}).get("nodes") == [{"oid": prev}],
                "native candidate is not a single-parent squash")
        pr = entry.get("pullRequest") or {}
        number = pr.get("number")
        require(type(number) is int and number > 0 and number not in owners,
                "invalid or duplicate queue owner")
        source_head = oid(pr.get("headRefOid"))
        require(pr.get("state") == "OPEN" and pr.get("baseRefName") == "master",
                "queue owner PR is not open against master")
        require((pr.get("baseRepository") or {}).get("nameWithOwner") == repo
                and (pr.get("headRepository") or {}).get("nameWithOwner") == repo,
                "foreign queue owner repository")
        if entry["position"] == 1:
            # A later queue entry may have a different synthetic predecessor
            # from its PR's ordinary potentialMergeCommit. First entry does not.
            merge = pr.get("potentialMergeCommit") or {}
            require(merge.get("parents", {}).get("nodes")
                    == [{"oid": prev}, {"oid": source_head}],
                    "first PR merge has wrong protected base/source")
            require((merge.get("tree") or {}).get("oid") == (commit.get("tree") or {}).get("oid"),
                    "first PR merge tree differs from native candidate")
        owners[number] = source_head
        prev = current
    # merge_group.base_sha is the protected target branch SHA, not the
    # predictive predecessor (which comes only from the native queue chain).
    # Exact candidate ancestry was checked above on each immutable commit.
    require(event_base == protected_tip and prev == head,
            "event protected base/head do not match native queue")
    return owners, protected_tip


def validate_parallel_migrations(
    owners: Mapping[int, str], protected_tip: str, doc: dict,
    files: Mapping[str, bytes], read: Callable[[str, dict], dict], variables: dict,
) -> frozenset[int]:
    """Authenticate each present open migration against its native owner PR.

    Reuses the existing full provenance gate: source ledger row exactness,
    source-file blob hash and protected-base absence. Never rely on a ledger PR
    number alone. Supports multiple distinct migration owners in one queue.
    """
    groups: dict[int, dict[str, bytes]] = {}
    for name, raw in sorted(files.items()):
        require(bool(re.fullmatch(r"\d{4}_[a-z0-9_]+\.sql", name)),
                "invalid migration filename")
        row = (doc.get("prefixes") or {}).get(name.split("_", 1)[0]) or {}
        number = row.get("pr")
        require(type(number) is int and number in owners
                and row.get("state") == "taken" and row.get("pr_state") == "open"
                and row.get("file") == name,
                "open migration not owned by an immutable queue member")
        groups.setdefault(number, {})[name] = raw
    require(bool(groups), "no open migration requires group qualification")
    for number, subset in sorted(groups.items()):
        source_head = owners[number]
        expressions = {"ledger": f"{source_head}:supabase/migrations/RESERVATIONS.json",
                       "base_tree": f"{protected_tip}:supabase/migrations"}
        for i, filename in enumerate(sorted(subset)):
            expressions[f"file{i}"] = f"{source_head}:supabase/migrations/{filename}"
            expressions[f"base{i}"] = f"{protected_tip}:supabase/migrations/{filename}"
        fields = " ".join(
            f"{key}: object(expression: " + "$" + f"{key}) {{ __typename "
            + ("... on Tree { entries { name type } }"
               if key == "base_tree" else "... on Blob { oid text }")
            + " }" for key in expressions
        )
        declarations = ", ".join("$" + f"{key}: String!" for key in expressions)
        query = ("query($owner: String!, $name: String!, " + declarations
                 + ") { repository(owner: $owner, name: $name) { "
                 + fields + " } }")
        source = read(query, variables | expressions).get("repository") or {}
        validate_migrations(number, doc, subset, source)
    return frozenset(groups)


def graphql_reader(token: str) -> Callable[[str, dict], dict]:
    require(bool(token), "read-only GitHub token is unavailable")

    def read(query: str, variables: dict) -> dict:
        request = urllib.request.Request(
            "https://api.github.com/graphql",
            data=json.dumps({"query": query, "variables": variables}).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                     "User-Agent": "terminal-migration-ownership"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as exc:
            kind = ({401: "http_unauthorized", 403: "http_forbidden", 429: "http_rate_limited"}.get(exc.code, "http_other")
                    if type(exc.code) is int else "http_other")
            raise _ReadFailure(kind) from None
        except json.JSONDecodeError:
            raise _ReadFailure("json_decode") from None
        except Exception:
            raise _ReadFailure("transport") from None
        if not isinstance(payload, dict):
            raise _ReadFailure("response_shape")
        if payload.get("errors"):
            raise _graphql_failure(payload["errors"])
        if not isinstance(payload.get("data"), dict):
            raise _ReadFailure("response_shape")
        return payload["data"]
    return read


def qualify_owner(root: Path, env: Mapping[str, str], doc: dict, files: Mapping[str, bytes]) -> int:
    try:
        event = json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text())
        checkout = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
        read = graphql_reader(env.get("GH_TOKEN", ""))
        owner, name = env["GITHUB_REPOSITORY"].split("/", 1)
        variables = {"owner": owner, "name": name}
        snapshot = _read_at_stage(read, "queue_snapshot", QUEUE_QUERY, variables)
        def read_source(query: str, source_variables: dict) -> dict:
            return _read_at_stage(read, "immutable_source", query, source_variables)
        config = ((snapshot.get("repository") or {}).get("mergeQueue") or {}).get("configuration") or {}
        if (config.get("maximumEntriesToBuild"), config.get("maximumEntriesToMerge")) == (8, 4):
            members, protected_tip = validate_parallel_snapshot(snapshot, event, env, checkout)
            return validate_parallel_migrations(
                members, protected_tip, doc, files, read_source, variables
            )
        number, source_head, base = validate_snapshot(snapshot, event, env, checkout)
        expressions = {"ledger": f"{source_head}:supabase/migrations/RESERVATIONS.json",
                       "base_tree": f"{base}:supabase/migrations"}
        for i, filename in enumerate(sorted(files)):
            require(re.fullmatch(r"\d{4}_[a-z0-9_]+\.sql", filename), "invalid migration filename")
            expressions[f"file{i}"] = f"{source_head}:supabase/migrations/{filename}"
            expressions[f"base{i}"] = f"{base}:supabase/migrations/{filename}"
        fields = " ".join(
            f'{key}: object(expression: ${key}) {{ __typename '
            + ('... on Tree { entries { name type } }' if key == "base_tree" else '... on Blob { oid text }')
            + ' }' for key in expressions)
        declarations = ", ".join(f"${key}: String!" for key in expressions)
        query = f"query($owner: String!, $name: String!, {declarations}) {{ repository(owner: $owner, name: $name) {{ {fields} }} }}"
        source = read_source(query, variables | expressions).get("repository") or {}
        validate_migrations(number, doc, files, source)
        return number
    except OwnershipUnqualified:
        raise
    except Exception as exc:
        raise OwnershipUnqualified("merge-group ownership inputs are unavailable") from exc
