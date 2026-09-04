#!/usr/bin/env python3
"""Merge explicitly armed pull requests only after the current head is truly green.

Terminal protects master with the same three required checks and supports native
auto-merge as the fastest server-side path. This controller is the fallback for a
ready pull request that was labelled but never natively armed. It only considers
same-repository, non-draft pull requests carrying the
``merge-on-green`` label; requires the latest trusted instance of all three CI jobs
to have completed successfully; refreshes a stale branch onto current master before
merge; and pins the squash merge to the head SHA it evaluated.

The controller is deliberately label-gated. ``hold`` and ``do-not-merge`` are hard
vetoes. A genuine trusted red or conflict is labelled ``merge-blocked`` with one
comment; pending, missing, or wrong-App evidence simply waits. One sweep may merge
a green pull request and then update the next stale one, but it never merges two
pull requests against the same base snapshot.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterable, Protocol


ARM_LABEL = "merge-on-green"
BLOCK_LABEL = "merge-blocked"
HOLD_LABELS = frozenset({"hold", "do-not-merge"})
REQUIRED_CHECKS = (
    "Quote Hub tests",
    "Terminal typecheck + tests",
    "Ingest + signal-layer tests",
)
# Native master protection binds every required context to the GitHub Actions App.
# The fallback must mirror that authority rather than accepting same-named checks
# from another App.
REQUIRED_CHECK_APP_ID = 15368
BLOCK_MARKER = "<!-- mastermind-terminal-merge-sweeper -->"


class ApiError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"GitHub API {status}: {message}")
        self.status = status


class GitHubApi:
    def __init__(self, repo: str, token: str):
        self.repo = repo
        self.base = f"https://api.github.com/repos/{repo}"
        self.token = token

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        body = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(
            f"{self.base}{path}",
            data=body,
            method=method,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "mastermind-terminal-merge-sweeper",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read().decode(errors="replace")
            try:
                message = json.loads(raw).get("message", raw)
            except json.JSONDecodeError:
                message = raw
            raise ApiError(error.code, str(message)) from error

    def list_pulls(self) -> list[dict[str, Any]]:
        return self.request("GET", "/pulls?state=open&per_page=100&sort=created&direction=asc")

    def pull(self, number: int) -> dict[str, Any]:
        return self.request("GET", f"/pulls/{number}")

    def check_runs(self, sha: str) -> list[dict[str, Any]]:
        quoted = urllib.parse.quote(sha, safe="")
        data = self.request("GET", f"/commits/{quoted}/check-runs?per_page=100")
        return data.get("check_runs", [])

    def compare(self, base_sha: str, head_sha: str) -> str:
        base = urllib.parse.quote(base_sha, safe="")
        head = urllib.parse.quote(head_sha, safe="")
        return str(self.request("GET", f"/compare/{base}...{head}").get("status", "unknown"))

    def update_branch(self, number: int, head_sha: str) -> None:
        self.request("PUT", f"/pulls/{number}/update-branch", {"expected_head_sha": head_sha})

    def dispatch_ci(self, branch: str) -> None:
        # GITHUB_TOKEN-authored branch updates do not recursively fire pull_request
        # workflows. workflow_dispatch is the documented exception, so the sweeper
        # explicitly orders the fresh proof it just made necessary.
        self.request("POST", "/actions/workflows/ci.yml/dispatches", {"ref": branch})

    def merge(self, number: int, head_sha: str) -> dict[str, Any]:
        return self.request(
            "PUT",
            f"/pulls/{number}/merge",
            {"merge_method": "squash", "sha": head_sha},
        )

    def add_labels(self, number: int, labels: list[str]) -> None:
        self.request("POST", f"/issues/{number}/labels", {"labels": labels})

    def remove_label(self, number: int, label: str) -> None:
        encoded = urllib.parse.quote(label, safe="")
        try:
            self.request("DELETE", f"/issues/{number}/labels/{encoded}")
        except ApiError as error:
            if error.status != 404:
                raise

    def comment(self, number: int, body: str) -> None:
        self.request("POST", f"/issues/{number}/comments", {"body": body})

    def delete_branch(self, branch: str) -> None:
        encoded = urllib.parse.quote(f"heads/{branch}", safe="/")
        try:
            self.request("DELETE", f"/git/refs/{encoded}")
        except ApiError as error:
            if error.status not in {404, 422}:  # already absent
                raise


class MergeApi(Protocol):
    repo: str

    def list_pulls(self) -> list[dict[str, Any]]: ...
    def pull(self, number: int) -> dict[str, Any]: ...
    def check_runs(self, sha: str) -> list[dict[str, Any]]: ...
    def compare(self, base_sha: str, head_sha: str) -> str: ...
    def update_branch(self, number: int, head_sha: str) -> None: ...
    def dispatch_ci(self, branch: str) -> None: ...
    def merge(self, number: int, head_sha: str) -> dict[str, Any]: ...
    def add_labels(self, number: int, labels: list[str]) -> None: ...
    def remove_label(self, number: int, label: str) -> None: ...
    def comment(self, number: int, body: str) -> None: ...
    def delete_branch(self, branch: str) -> None: ...


@dataclass(frozen=True)
class CheckVerdict:
    state: str
    detail: str


def label_names(pull: dict[str, Any]) -> set[str]:
    return {str(label.get("name", "")) for label in pull.get("labels", [])}


def trusted_check_app_id(run: dict[str, Any]) -> int | None:
    app = run.get("app")
    if not isinstance(app, dict):
        return None
    app_id = app.get("id")
    # bool is an int subclass, so require the exact response type GitHub emits.
    return app_id if type(app_id) is int else None


def latest_named_checks(check_runs: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for run in check_runs:
        name = str(run.get("name", ""))
        if name not in REQUIRED_CHECKS:
            continue
        if trusted_check_app_id(run) != REQUIRED_CHECK_APP_ID:
            continue
        prior = latest.get(name)
        if prior is None or int(run.get("id", 0)) > int(prior.get("id", 0)):
            latest[name] = run
    return latest


def check_verdict(check_runs: Iterable[dict[str, Any]]) -> CheckVerdict:
    latest = latest_named_checks(check_runs)
    missing = [name for name in REQUIRED_CHECKS if name not in latest]
    if missing:
        return CheckVerdict(
            "pending",
            f"missing trusted App {REQUIRED_CHECK_APP_ID} checks: {', '.join(missing)}",
        )

    waiting = [name for name, run in latest.items() if run.get("status") != "completed"]
    if waiting:
        return CheckVerdict("pending", f"pending: {', '.join(waiting)}")

    red = [
        f"{name}={latest[name].get('conclusion') or 'unknown'}"
        for name in REQUIRED_CHECKS
        if latest[name].get("conclusion") != "success"
    ]
    if red:
        return CheckVerdict("red", ", ".join(red))
    return CheckVerdict("green", "all required checks completed successfully")


def is_armed_candidate(pull: dict[str, Any], repo: str) -> bool:
    labels = label_names(pull)
    return (
        ARM_LABEL in labels
        and not pull.get("draft", False)
        and not labels.intersection(HOLD_LABELS)
        and pull.get("head", {}).get("repo", {}).get("full_name") == repo
        and pull.get("base", {}).get("ref") == "master"
    )


def mark_blocked(api: MergeApi, pull: dict[str, Any], reason: str) -> None:
    number = int(pull["number"])
    if BLOCK_LABEL in label_names(pull):
        return
    api.add_labels(number, [BLOCK_LABEL])
    api.comment(
        number,
        f"{BLOCK_MARKER}\nAutomatic merge paused: {reason}. Fix the branch or rerun CI; "
        f"the sweeper will re-evaluate the latest head without an admin bypass.",
    )


def sweep(api: MergeApi, trigger_number: int | None = None) -> list[str]:
    pulls = [pull for pull in api.list_pulls() if is_armed_candidate(pull, api.repo)]
    if trigger_number is not None:
        pulls.sort(key=lambda pull: (int(pull["number"]) != trigger_number, pull.get("created_at", "")))
    else:
        pulls.sort(key=lambda pull: pull.get("created_at", ""))

    actions: list[str] = []
    merged_this_sweep = False
    for listed in pulls:
        number = int(listed["number"])
        pull = api.pull(number)  # refresh head/base after any earlier merge in this sweep
        if not is_armed_candidate(pull, api.repo):
            continue

        if pull.get("mergeable") is False or pull.get("mergeable_state") == "dirty":
            mark_blocked(api, pull, "the head conflicts with current master")
            actions.append(f"#{number}: conflict")
            continue
        if pull.get("mergeable") is None:
            actions.append(f"#{number}: mergeability pending")
            continue

        head_sha = str(pull["head"]["sha"])
        verdict = check_verdict(api.check_runs(head_sha))
        if verdict.state == "pending":
            actions.append(f"#{number}: {verdict.detail}")
            continue
        if verdict.state == "red":
            mark_blocked(api, pull, f"the latest required CI is red ({verdict.detail})")
            actions.append(f"#{number}: red")
            continue

        if BLOCK_LABEL in label_names(pull):
            api.remove_label(number, BLOCK_LABEL)

        base_sha = str(pull["base"]["sha"])
        relation = api.compare(base_sha, head_sha)
        if relation not in {"ahead", "identical"}:
            branch = str(pull["head"]["ref"])
            api.update_branch(number, head_sha)
            api.dispatch_ci(branch)
            actions.append(f"#{number}: updated onto current master; awaiting fresh CI")
            # An update creates the next safe wake-up. Stop so no other green is
            # judged against a base snapshot this mutation just invalidated.
            break

        result = api.merge(number, head_sha)
        if not result.get("merged"):
            # The head/base may have moved between proof and the SHA-pinned write.
            # That is a wait, not permission to force an admin merge.
            actions.append(f"#{number}: merge declined ({result.get('message', 'state changed')})")
            continue

        branch = str(pull["head"]["ref"])
        if branch != "master":
            api.delete_branch(branch)
        actions.append(f"#{number}: merged and deleted {branch}")
        merged_this_sweep = True
        # Continue only to refresh the next stale green branch. It cannot merge
        # against the pre-merge base because api.pull() is re-read above.

    if merged_this_sweep and not any("updated onto" in action for action in actions):
        actions.append("no additional armed green branch required a base refresh")
    return actions


def main() -> int:
    repo = os.environ.get("GH_REPO", "").strip()
    token = (os.environ.get("MERGE_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    if not repo or not token:
        print("::error::GH_REPO and MERGE_TOKEN or GITHUB_TOKEN are required", file=sys.stderr)
        return 2
    trigger_raw = os.environ.get("TRIGGER_PR_NUMBER", "").strip()
    trigger = int(trigger_raw) if trigger_raw.isdigit() else None
    try:
        actions = sweep(GitHubApi(repo, token), trigger)
    except (ApiError, KeyError, TypeError, ValueError) as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1
    if not actions:
        print(f"::notice::No open pull request is armed with {ARM_LABEL}")
    else:
        for action in actions:
            print(f"::notice::{action}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
