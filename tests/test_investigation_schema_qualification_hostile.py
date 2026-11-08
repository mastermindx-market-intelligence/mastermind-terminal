"""Hostile tests for the read-only native-participant catalog qualification.

Everything here is in-process and offline. The qualification module is driven
through the incumbent `scripts.supabase_apply.CurlRunner` subprocess seam
exactly as the owner binds it -- curl argv, `--data-binary @<tempfile>` body,
token only on the `--config -` stdin channel, HTTP status on the
`--write-out "\\n%{http_code}"` stdout tail -- so the real request shape is
what gets tested, never a parallel readyJSON entrance.

The pinned 0051 migration bytes are copied from this checkout into a throwaway
Git repository (`git init`/`config`/`add`/`commit` with local user args), and
the expected HEAD is taken from that fixture, so the module's Git identity
checks (`rev-parse`, `show`, worktree comparison) run for real.

The catalog snapshot returned by the fake transport is an explicitly
CONTROLLED fixture, not a runtime observation: function rows are copied
verbatim from the module's own `_definitions()` parse of the pinned source,
and the receipt-relation facts (RLS true, browser DML denied, the one enabled
type-27 trigger) are declared here. Negatives always mutate the raw catalog
rows, the raw envelope, or the real source bytes/HEAD -- they never recompute
an "expected" answer from mirrored internals.

What this file does NOT prove: that the live database answers with a
conforming snapshot, that the pinned migration was ever applied, or anything
about old operations, all-ingress drain, or OPEN. A positive result here only
says the module would qualify the declared native facet for exactly the facts
it is handed.
"""
from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.supabase_apply import API_URL, CurlRunner

# Parent integration: exact owned ops module; actual pinned migration bytes.
# Original worker artifact 078cd302 remains immutable beside the export receipt.
from ops import investigation_schema_qualification as MODULE
REPO_ROOT = Path(__file__).resolve().parents[1]

qualify_native_schema = MODULE.qualify_native_schema
CATALOG_QUERY = MODULE.CATALOG_QUERY
MIGRATION = MODULE.MIGRATION
MIGRATION_SHA256 = MODULE.MIGRATION_SHA256

# --------------------------------------------------------------------------
# Controlled constants
# --------------------------------------------------------------------------

PROJECT_REF = "abcdefghijabcdefghij"  # matches the binding check's [a-z0-9]{20}
OTHER_PROJECT_REF = "zzzzzzzzzzzzzzzzzzzz"
DATABASE = "postgres"
OTHER_DATABASE = "reporting"
TOKEN = "sbp_hostile_fixture_token_never_real"
LEAK_MARKER = "hostile-response-body-marker-DO-NOT-LEAK"
NOT_QUALIFIED = {
    "whole_schema_constraints_policies",
    "0030_application_or_T03k",
    "all_ingress_and_drain",
    "old_operations",
    "OPEN",
}
TRIGGER = {
    "name": "investigation_native_receipt_guard",
    "enabled": "O",
    "type": 27,
    "function": "investigation_native_receipt_guard_v1",
    "schema": "public",
    "unconditional": True, "columns": "", "args_hex": "", "internal": False,
    "constraint_oid": "0", "parent_oid": "0", "old_table": None, "new_table": None,
}
CLAIM = "claim_investigation_native_capture_v1"
COMPLETE = "complete_investigation_native_capture_v1"
READ = "read_investigation_native_capture_v1"
REVISION = "apply_investigation_revision_v2"

# --------------------------------------------------------------------------
# Git fixture: the pinned source committed into a throwaway repository
# --------------------------------------------------------------------------


def _git(repo, *args):
    env = dict(
        os.environ,
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_CONFIG_SYSTEM=os.devnull,
        GIT_NO_LAZY_FETCH="1",
        GIT_OPTIONAL_LOCKS="0",
        GIT_TERMINAL_PROMPT="0",
    )
    subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True, capture_output=True, text=True, timeout=60, env=env,
    )


def _head(repo):
    return subprocess.check_output(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True, timeout=60
    ).strip()


def _fixture(tmp_path, *, drift=False, extra_file=None):
    """Commit this checkout's pinned 0051 bytes; return repo, HEAD, and bytes."""
    source = (REPO_ROOT / MIGRATION).read_bytes()
    digest = sha256(source).hexdigest()
    if digest != MIGRATION_SHA256:
        pytest.fail(
            f"{MIGRATION} in this checkout hashes to {digest} but the module "
            f"pins {MIGRATION_SHA256}; the qualification contract can never "
            "qualify against this tree, so the fixture refuses to pretend otherwise"
        )
    repo = tmp_path / "repo"
    migration_path = repo / MIGRATION
    migration_path.parent.mkdir(parents=True)
    migration_path.write_bytes(source + (b"\n-- hostile: post-pin content drift\n" if drift else b""))
    if extra_file is not None:
        (repo / extra_file).parent.mkdir(parents=True, exist_ok=True)
        (repo / extra_file).write_text("fixture marker\n", encoding="utf-8")
    _git(repo, "init", "-q", "-b", "master")
    _git(repo, "config", "user.name", "Qualification Fixture")
    _git(repo, "config", "user.email", "qualification-fixture@example.invalid")
    _git(repo, "add", ".")
    _git(repo, "-c", "commit.gpgsign=false", "commit", "-q",
         "-m", "pinned 0051 native capture fixture")
    return SimpleNamespace(repo=repo, head=_head(repo), source=source)


# --------------------------------------------------------------------------
# Controlled catalog fixture built from the module's own source parse
# --------------------------------------------------------------------------


def _expected_definitions(source):
    """The module's own parser is the single source of expected function facts."""
    return MODULE._definitions(source)


def _valid_catalog(defs):
    functions = []
    for name in sorted(defs):
        spec = defs[name]
        functions.append({
            "name": name,
            "arguments": spec["arguments"],
            "returns": spec["returns"],
            "owner": spec["owner"],
            "security_definer": spec["security_definer"],
            "language": spec["language"],
            "config": list(spec["config"]),
            "body": spec["body"],
            "public_execute": False,
            # Follow the declared ACL exactly; the two revision v2 entries are
            # unconstrained (None), and PUBLIC-style inheritance gives
            # service_role EXECUTE, so those carry True.
            "effective_execute": {
                role: (True if allowed is None else allowed)
                for role, allowed in MODULE.ACL[name].items()
            },
        })
    return {
        "database": DATABASE,
        "schema": "public",
        "current_role": "postgres",
        "session_role": "postgres",
        "server_version_num": "180000",
        "observed_at": "2026-11-05T00:00:00.000000+00:00",
        "functions": functions,
        "receipt_relation": {
            "rls": True,
            "anon_write": False,
            "authenticated_write": False,
            "constraints": [],
            "triggers": [dict(TRIGGER)],
        },
    }


def _conforming_response(fixture, fake):
    """Give the fake transport a fully conforming snapshot for this fixture."""
    fake.rows = [{"catalog": _valid_catalog(_expected_definitions(fixture.source))}]


# --------------------------------------------------------------------------
# Fake curl subprocess standing in for the incumbent transport
# --------------------------------------------------------------------------


class FakeCurl:
    """The subprocess seam of scripts.supabase_apply.CurlRunner.

    It re-verifies the invocation contract it emulates and fails loudly if the
    incumbent ever changes shape underneath it: element-wise token absence
    from argv (list membership cannot catch a token inside one longer
    element), token present only on the stdin config channel, the body read
    from the `--data-binary @<tempfile>` path (owner-only mode), the fixed
    endpoint carrying the project ref, and the write-out status tail that the
    responses below are encoded against.
    """

    def __init__(self, *, rows=None, http_status=200, error_body=None,
                 unreachable=False, garbage=False, empty_ok=False,
                 exc=None, on_request=None):
        self.token = TOKEN
        self.project_ref = PROJECT_REF
        self.rows = rows
        self.http_status = http_status
        self.error_body = error_body
        self.unreachable = unreachable
        self.garbage = garbage
        self.empty_ok = empty_ok
        self.exc = exc
        self.on_request = on_request
        self.calls = []
        self.requests = []

    def __call__(self, argv, input=None, capture_output=False, text=False, **kwargs):
        self.calls.append({"argv": list(argv), "input": input,
                           "capture_output": capture_output, "text": text,
                           "kwargs": dict(kwargs)})
        if self.exc is not None:
            raise self.exc
        assert capture_output is True, "CurlRunner must capture child output"
        assert text is True, "CurlRunner must decode child output as text"
        assert isinstance(argv, list) and argv
        assert all(isinstance(element, str) for element in argv)
        assert not any(self.token in element for element in argv), \
            "the token must never travel in argv"
        assert isinstance(input, str) and self.token in input, \
            "the token must travel only on the stdin config channel"
        for key, value in kwargs.items():
            if isinstance(value, str):
                assert self.token not in value
        assert argv[0] == "curl"
        assert argv[argv.index("--write-out") + 1] == "\n%{http_code}", \
            "status-tail convention: responses below are encoded against it"
        assert argv[argv.index("--config") + 1] == "-", "stdin config channel"
        assert "--fail-with-body" in argv, "error bodies must survive --fail"
        url = next(element for element in argv if element.startswith("https://"))
        assert url == API_URL.format(ref=self.project_ref)
        body_spec = argv[argv.index("--data-binary") + 1]
        assert body_spec.startswith("@"), "the body must be read from a temp file"
        body_path = body_spec[1:]
        assert stat.S_IMODE(os.stat(body_path).st_mode) == 0o600, \
            "the query body temp file stays owner-only"
        request = json.loads(Path(body_path).read_text(encoding="utf-8"))
        assert set(request) == {"query"}
        assert request["query"] == CATALOG_QUERY, \
            "the submitted body query must be the module's one fixed catalog query"
        self.requests.append(request)
        if self.on_request is not None:
            self.on_request(request)
        if self.unreachable:
            # curl never reached the API: write-out still emits 000, the error
            # text goes to stderr, and the exit code is 7.
            return subprocess.CompletedProcess(
                argv, 7, stdout="\n000",
                stderr=f"curl: (7) Failed to connect to api.supabase.com -- {LEAK_MARKER}")
        if self.http_status == 200:
            payload = "not json at all" if self.garbage else json.dumps(self.rows)
            if self.empty_ok:
                payload = ""
            return subprocess.CompletedProcess(argv, 0, stdout=payload + "\n200", stderr="")
        # Non-2xx under --fail-with-body: the body survives on stdout, curl
        # exits 22, and the write-out tail carries the real status.
        return subprocess.CompletedProcess(
            argv, 22,
            stdout=json.dumps(self.error_body) + f"\n{self.http_status}",
            stderr="")


def _runner(fake, *, project_ref=PROJECT_REF):
    """Bind the fake seam through the incumbent CurlRunner, as the owner does."""
    return CurlRunner(project_ref, TOKEN, runner=fake)


_UNSET = object()


def _qualify(fixture, fake, *, head=_UNSET, project_ref=PROJECT_REF, database=DATABASE):
    return qualify_native_schema(
        runner=_runner(fake, project_ref=project_ref),
        source_root=str(fixture.repo),
        expected_source_sha=fixture.head if head is _UNSET else head,
        expected_project_ref=project_ref,
        expected_database=database,
    )


def _assert_void(result):
    """A void outcome never carries a qualification, an attestation, or a target."""
    assert result["schema"] == "investigation.native_catalog_qualification.v1"
    assert result["state"] != "declared_native_facet_qualified"
    assert result["cutover_qualified"] is False
    assert result["application_provenance"] == "not_attested"
    assert result["errors"]


def _assert_no_leak(result, *secrets):
    rendered = json.dumps(result)
    for secret in secrets:
        assert secret not in rendered, f"leaked {secret[:24]}... into the result"


# --------------------------------------------------------------------------
# Positive: a conforming snapshot qualifies the declared facet -- no further
# --------------------------------------------------------------------------


def test_positive_qualification_runs_the_real_curl_seam(tmp_path):
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))
    fake = FakeCurl(rows=[{"catalog": catalog}])
    result = _qualify(fixture, fake)

    assert result["state"] == "declared_native_facet_qualified"
    assert result["errors"] == []
    assert result["cutover_qualified"] is False
    assert result["application_provenance"] == "not_attested"
    assert result["source_sha"] == fixture.head
    assert result["migration_sha256"] == MIGRATION_SHA256
    assert result["query_sha256"] == sha256(CATALOG_QUERY.encode()).hexdigest()
    assert result["target"] == {
        "project_ref": PROJECT_REF, "database": DATABASE, "schema": "public"}
    assert result["observations"] == [[{"catalog": catalog}]]

    # Exactly one seam invocation, shaped exactly as the incumbent binds it.
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert not any(TOKEN in element for element in call["argv"])
    assert call["input"] == f'header = "Authorization: Bearer {TOKEN}"\n'
    assert call["capture_output"] is True
    assert call["text"] is True
    assert fake.requests[0]["query"] == CATALOG_QUERY
    assert sha256(fake.requests[0]["query"].encode()).hexdigest() == result["query_sha256"]


def test_positive_result_never_attests_cutover_or_application(tmp_path):
    fixture = _fixture(tmp_path)
    fake = FakeCurl()
    _conforming_response(fixture, fake)
    result = _qualify(fixture, fake)

    assert result["state"] == "declared_native_facet_qualified"
    assert result["errors"] == []
    # The facet verdict is the whole verdict: no cutover, no application
    # provenance, and the explicit not-qualified list stays intact.
    assert result["cutover_qualified"] is False
    assert result["application_provenance"] == "not_attested"
    assert set(result["not_qualified"]) == NOT_QUALIFIED
    assert "0051" in result["coverage"]


def test_sparse_omitted_worktree_file_still_qualifies_from_git_bytes(tmp_path):
    fixture = _fixture(tmp_path)
    (fixture.repo / MIGRATION).unlink()
    fake = FakeCurl()
    _conforming_response(fixture, fake)
    result = _qualify(fixture, fake)
    assert result["state"] == "declared_native_facet_qualified"
    assert result["errors"] == []


# --------------------------------------------------------------------------
# Negative: incumbent target binding, rejected before any IO
# --------------------------------------------------------------------------


class _DuckRunner:
    """Satisfies the QueryRunner protocol but is not the incumbent runner."""

    def __init__(self):
        self.calls = []

    def __call__(self, sql):
        self.calls.append(sql)
        return []


class _CurlRunnerSubclass(CurlRunner):
    """Even a subclass is not the incumbent binding (exact type check)."""


def _make_plain_function():
    calls = []

    def runner(sql):
        calls.append(sql)
        return []
    return runner, calls


def _make_duck_runner():
    duck = _DuckRunner()
    return duck, duck.calls


def _make_subclass_runner():
    fake = FakeCurl()
    return _CurlRunnerSubclass(PROJECT_REF, TOKEN, runner=fake), fake.calls


@pytest.mark.parametrize("label, factory", [
    ("plain_function", _make_plain_function),
    ("query_protocol_duck_type", _make_duck_runner),
    ("curlrunner_subclass", _make_subclass_runner),
])
def test_non_incumbent_runners_are_rejected_before_any_io(tmp_path, label, factory):
    fixture = _fixture(tmp_path)
    runner, calls = factory()
    result = qualify_native_schema(
        runner=runner,
        source_root=str(fixture.repo),
        expected_source_sha=fixture.head,
        expected_project_ref=PROJECT_REF,
        expected_database=DATABASE,
    )
    assert result["state"] == "unavailable"
    assert result["errors"] == ["incumbent_target_binding_invalid"]
    assert "target" not in result
    assert result["observations"] == []
    _assert_void(result)
    assert calls == [], "a rejected runner must never be invoked"


def test_wrong_project_binding_is_rejected_before_any_io(tmp_path):
    fixture = _fixture(tmp_path)
    mismatched = FakeCurl()
    result = qualify_native_schema(
        runner=_runner(mismatched, project_ref=OTHER_PROJECT_REF),
        source_root=str(fixture.repo),
        expected_source_sha=fixture.head,
        expected_project_ref=PROJECT_REF,
        expected_database=DATABASE,
    )
    assert result["errors"] == ["incumbent_target_binding_invalid"]
    assert mismatched.calls == []

    # The legacy-shaped ref is caught by the binding mismatch too...
    legacy_fake = FakeCurl()
    legacy = CurlRunner("ref123", TOKEN, runner=legacy_fake)
    result = qualify_native_schema(
        runner=legacy,
        source_root=str(fixture.repo),
        expected_source_sha=fixture.head,
        expected_project_ref=PROJECT_REF,
        expected_database=DATABASE,
    )
    assert result["errors"] == ["incumbent_target_binding_invalid"]
    assert legacy_fake.calls == []

    # ...and an identically-named legacy pair is caught by the format check,
    # which is the branch the mismatch above cannot reach.
    same_fake = FakeCurl()
    same = CurlRunner("ref123", TOKEN, runner=same_fake)
    result = qualify_native_schema(
        runner=same,
        source_root=str(fixture.repo),
        expected_source_sha=fixture.head,
        expected_project_ref="ref123",
        expected_database=DATABASE,
    )
    assert result["errors"] == ["incumbent_target_binding_invalid"]
    assert same_fake.calls == []
    _assert_void(result)


@pytest.mark.parametrize("label, project_ref", [
    ("empty", ""),
    ("none", None),
    ("nineteen_chars", "abcdefghijabcdefghi"),
    ("twenty_one_chars", "abcdefghijabcdefghij1"),
    ("uppercase", "ABCDEFGH" "abcdefghij"),
    ("with_dash", "abcdefgh-ijabcdefghij"),
])
def test_invalid_expected_project_ref_formats_are_rejected(tmp_path, label, project_ref):
    fixture = _fixture(tmp_path)
    fake = FakeCurl()
    result = qualify_native_schema(
        runner=_runner(fake),
        source_root=str(fixture.repo),
        expected_source_sha=fixture.head,
        expected_project_ref=project_ref,
        expected_database=DATABASE,
    )
    assert result["errors"] == ["incumbent_target_binding_invalid"]
    assert "target" not in result
    assert fake.calls == []
    _assert_void(result)


@pytest.mark.parametrize("label, database", [
    ("empty", ""),
    ("none", None),
    ("injection", "postgres; drop table x"),
    ("leading_digit", "9postgres"),
    ("with_space", "postgres db"),
    ("with_dash", "postgres-db"),
    ("sixty_four_chars", "a" * 64),
])
def test_invalid_expected_database_names_are_rejected(tmp_path, label, database):
    fixture = _fixture(tmp_path)
    fake = FakeCurl()
    result = qualify_native_schema(
        runner=_runner(fake),
        source_root=str(fixture.repo),
        expected_source_sha=fixture.head,
        expected_project_ref=PROJECT_REF,
        expected_database=database,
    )
    assert result["errors"] == ["incumbent_target_binding_invalid"]
    assert "target" not in result
    assert fake.calls == []
    _assert_void(result)


# --------------------------------------------------------------------------
# Negative: source identity -- head, format, content, and worktree state
# --------------------------------------------------------------------------


def test_wrong_head_commit_is_rejected(tmp_path):
    fixture = _fixture(tmp_path, extra_file="README.md")
    stray = _fixture(tmp_path / "stray")
    assert stray.head != fixture.head
    fake = FakeCurl()
    _conforming_response(fixture, fake)
    result = _qualify(fixture, fake, head=stray.head)
    assert result["state"] == "unavailable"
    assert result["errors"] == ["source_or_catalog_unavailable"]
    assert result["observations"] == []
    assert fake.calls == [], "an unqualified source must never reach the query"
    _assert_void(result)


@pytest.mark.parametrize("label, source_sha", [
    ("empty", ""),
    ("none", None),
    ("not_hex", "not-a-source-sha-at-all"),
    ("thirty_nine", "0" * 39),
    ("forty_one", "0" * 41),
    ("uppercase", "A" * 40),
    ("valid_format_wrong_value", "0" * 40),
])
def test_malformed_or_wrong_expected_source_sha_is_rejected(tmp_path, label, source_sha):
    fixture = _fixture(tmp_path)
    fake = FakeCurl()
    _conforming_response(fixture, fake)
    result = _qualify(fixture, fake, head=source_sha)
    assert result["state"] == "unavailable"
    assert result["errors"] == ["source_or_catalog_unavailable"]
    assert fake.calls == []
    assert result["observations"] == []
    _assert_void(result)


def test_post_pin_content_drift_in_git_is_rejected(tmp_path):
    """A migration that legitimately evolved past the pin can never qualify."""
    fixture = _fixture(tmp_path, drift=True)
    fake = FakeCurl()
    _conforming_response(fixture, fake)
    result = _qualify(fixture, fake)
    assert result["state"] == "unavailable"
    assert result["errors"] == ["source_or_catalog_unavailable"]
    assert fake.calls == []
    _assert_void(result)


def test_worktree_migration_mutation_is_rejected(tmp_path):
    fixture = _fixture(tmp_path)
    with open(fixture.repo / MIGRATION, "a", encoding="utf-8") as handle:
        handle.write("\n-- hostile worktree drift\n")
    fake = FakeCurl()
    _conforming_response(fixture, fake)
    result = _qualify(fixture, fake)
    assert result["state"] == "unavailable"
    assert result["errors"] == ["source_or_catalog_unavailable"]
    assert fake.calls == []
    _assert_void(result)


def test_content_identical_symlink_is_still_rejected(tmp_path):
    """The materialized path must be a regular file, byte-identical or not."""
    fixture = _fixture(tmp_path)
    target = fixture.repo / "hostile-target.sql"
    target.write_bytes(fixture.source)
    (fixture.repo / MIGRATION).unlink()
    (fixture.repo / MIGRATION).symlink_to(target)
    fake = FakeCurl()
    _conforming_response(fixture, fake)
    result = _qualify(fixture, fake)
    assert result["state"] == "unavailable"
    assert result["errors"] == ["source_or_catalog_unavailable"]
    assert fake.calls == []
    _assert_void(result)


def test_source_changed_during_query_voids_a_perfect_catalog(tmp_path):
    """A source that moves mid-flight voids even a fully conforming response.

    The post-query re-read raises through `_source`'s Git identity checks
    (the physical file no longer matches the committed bytes), so the
    observable contract is source_or_catalog_unavailable; either way the
    qualification attempt is voided and cutover stays False.
    """
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))

    def mutate(request):
        with open(fixture.repo / MIGRATION, "a", encoding="utf-8") as handle:
            handle.write("\n-- hostile mid-flight drift\n")

    fake = FakeCurl(rows=[{"catalog": catalog}], on_request=mutate)
    result = _qualify(fixture, fake)
    assert len(fake.calls) == 1
    assert result["state"] == "unavailable"
    assert result["errors"] == ["source_or_catalog_unavailable"]
    assert result["cutover_qualified"] is False
    assert result["application_provenance"] == "not_attested"
    _assert_no_leak(result, TOKEN, LEAK_MARKER)


# --------------------------------------------------------------------------
# Negative: raw catalog facts, mutated one field at a time
# --------------------------------------------------------------------------


def _mutation(name, field, transform):
    def apply(catalog):
        for row in catalog["functions"]:
            if row["name"] == name:
                row[field] = transform(row[field])
                return
        raise AssertionError(f"no function row {name!r} to mutate")
    return apply


def _swap(*values):
    return lambda current: values[0] if current != values[0] else values[1]


FIELD_DRIFT = [
    ("body", _mutation(READ, "body", lambda body: body + "\n-- hostile body drift\n"),
     f"function_body_mismatch:{READ}"),
    ("signature", _mutation(CLAIM, "arguments", lambda args: args + ", boolean"),
     f"function_arguments_mismatch:{CLAIM}"),
    ("owner", _mutation(CLAIM, "owner", _swap("postgres", "hostile_other_role")),
     f"function_owner_mismatch:{CLAIM}"),
    ("search_path", _mutation(CLAIM, "config",
                              _swap(["search_path=pg_catalog"], ["search_path=public"])),
     f"function_config_mismatch:{CLAIM}"),
    ("security_definer", _mutation(CLAIM, "security_definer", lambda flag: not flag),
     f"function_security_definer_mismatch:{CLAIM}"),
    ("language", _mutation(CLAIM, "language", _swap("sql", "plpgsql")),
     f"function_language_mismatch:{CLAIM}"),
    ("returns", _mutation(CLAIM, "returns", _swap("trigger", "jsonb")),
     f"function_returns_mismatch:{CLAIM}"),
]


@pytest.mark.parametrize("label, mutate, expected_error", FIELD_DRIFT)
def test_function_fact_drift_is_reported_and_never_qualifies(
        tmp_path, label, mutate, expected_error):
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))
    mutate(catalog)
    fake = FakeCurl(rows=[{"catalog": catalog}])
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == [expected_error]
    assert len(result["observations"]) == 1
    _assert_void(result)


def _append_extra_overload(catalog):
    row = dict(next(r for r in catalog["functions"] if r["name"] == COMPLETE))
    row["name"] = "apply_investigation_revision_v1"
    row["arguments"] = "uuid, integer, text"
    catalog["functions"].append(row)


def _drop_one_row(catalog):
    catalog["functions"].pop()


def _rename_to_unknown(catalog):
    catalog["functions"][0]["name"] = "apply_investigation_revision_v1"


def _duplicate_first_row(catalog):
    # Replace (not append) so the row count still matches and the duplicate
    # identity is what gets caught, not the set size.
    catalog["functions"][-1] = dict(catalog["functions"][0])


@pytest.mark.parametrize("label, mutate, expected_error", [
    ("extra_old_overload", _append_extra_overload,
     "function_set_missing_or_extra_overload"),
    ("missing_row", _drop_one_row, "function_set_missing_or_extra_overload"),
    ("unknown_identity", _rename_to_unknown, "function_identity_invalid"),
    ("duplicate_identity", _duplicate_first_row, "function_identity_invalid"),
])
def test_function_set_and_identity_drift_is_rejected(
        tmp_path, label, mutate, expected_error):
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))
    mutate(catalog)
    fake = FakeCurl(rows=[{"catalog": catalog}])
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == [expected_error]
    _assert_void(result)


@pytest.mark.parametrize("label, mutate", [
    ("missing_body_key", lambda catalog: catalog["functions"][0].pop("body")),
    ("extra_row_key", lambda catalog: catalog["functions"][0].update(
        {"hostile_extra": True})),
])
def test_malformed_function_row_is_rejected(tmp_path, label, mutate):
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))
    mutate(catalog)
    fake = FakeCurl(rows=[{"catalog": catalog}])
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == ["function_row_invalid"]
    _assert_void(result)


@pytest.mark.parametrize("label, mutate, name", [
    ("public_execute_granted", _mutation(CLAIM, "public_execute", lambda flag: True), CLAIM),
    ("anon_inherits_execute",
     _mutation(CLAIM, "effective_execute", lambda eff: {**eff, "anon": True}), CLAIM),
    ("authenticated_escalated",
     _mutation(COMPLETE, "effective_execute", lambda eff: {**eff, "authenticated": True}),
     COMPLETE),
    ("service_role_grant_drift",
     _mutation(READ, "effective_execute", lambda eff: {**eff, "service_role": True}), READ),
])
def test_browser_execute_leaks_are_rejected(tmp_path, label, mutate, name):
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))
    mutate(catalog)
    fake = FakeCurl(rows=[{"catalog": catalog}])
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == [f"effective_execute_mismatch:{name}"]
    _assert_void(result)


@pytest.mark.parametrize("label, mutate, name", [
    ("effective_execute_none",
     _mutation(CLAIM, "effective_execute", lambda eff: None), CLAIM),
    ("role_value_none",
     _mutation(REVISION, "effective_execute", lambda eff: {**eff, "service_role": None}),
     REVISION),
    ("missing_anon_key",
     _mutation(CLAIM, "effective_execute",
               lambda eff: {k: v for k, v in eff.items() if k != "anon"}), CLAIM),
    ("role_value_not_bool",
     _mutation(CLAIM, "effective_execute", lambda eff: {**eff, "anon": "false"}), CLAIM),
])
def test_malformed_effective_execute_is_rejected(tmp_path, label, mutate, name):
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))
    mutate(catalog)
    fake = FakeCurl(rows=[{"catalog": catalog}])
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == [f"effective_execute_mismatch:{name}"]
    _assert_void(result)


# --------------------------------------------------------------------------
# Negative: receipt relation, RLS, and the one guard trigger
# --------------------------------------------------------------------------


def _relation(**overrides):
    def apply(catalog):
        catalog["receipt_relation"].update(overrides)
    return apply


def _trigger(**overrides):
    def apply(catalog):
        catalog["receipt_relation"]["triggers"][0].update(overrides)
    return apply


def _extra_trigger(catalog):
    catalog["receipt_relation"]["triggers"].append(
        dict(TRIGGER, name="investigation_legacy_receipt_guard"))


def _drop_relation_key(key):
    def apply(catalog):
        del catalog["receipt_relation"][key]
    return apply


@pytest.mark.parametrize("label, mutate, expected_error", [
    ("rls_disabled", _relation(rls=False), "receipt_relation_access_mismatch"),
    ("anon_write_granted", _relation(anon_write=True), "receipt_relation_access_mismatch"),
    ("authenticated_write_granted", _relation(authenticated_write=True),
     "receipt_relation_access_mismatch"),
    ("trigger_disabled", _trigger(enabled="D"), "receipt_trigger_mismatch"),
    ("trigger_missing", _relation(triggers=[]), "receipt_trigger_mismatch"),
    ("trigger_extra", _extra_trigger, "receipt_trigger_mismatch"),
    ("trigger_type_drift", _trigger(type=17), "receipt_trigger_mismatch"),
    ("trigger_function_moved",
     _trigger(function="investigation_native_receipt_guard_v2"), "receipt_trigger_mismatch"),
    ("trigger_schema_moved", _trigger(schema="private"), "receipt_trigger_mismatch"),
])
def test_receipt_relation_and_trigger_drift_is_rejected(
        tmp_path, label, mutate, expected_error):
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))
    mutate(catalog)
    fake = FakeCurl(rows=[{"catalog": catalog}])
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == [expected_error]
    _assert_void(result)


@pytest.mark.parametrize("label, mutate, expected_error", [
    ("relation_none", lambda catalog: catalog.update({"receipt_relation": None}),
     "receipt_relation_unavailable"),
    ("relation_missing_trigger_key", _drop_relation_key("triggers"),
     "receipt_relation_unavailable"),
    ("constraints_not_a_list", _relation(constraints=None),
     "constraint_observation_invalid"),
])
def test_receipt_relation_unavailable_and_constraint_observation(
        tmp_path, label, mutate, expected_error):
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))
    mutate(catalog)
    fake = FakeCurl(rows=[{"catalog": catalog}])
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == [expected_error]
    _assert_void(result)


# --------------------------------------------------------------------------
# Negative: envelope, shape, target, and identity
# --------------------------------------------------------------------------


@pytest.mark.parametrize("label, build_raw, expected_error", [
    ("empty_rows", lambda catalog: [], "catalog_envelope_invalid"),
    ("unwrapped_catalog", lambda catalog: catalog, "catalog_envelope_invalid"),
    ("extra_envelope_key",
     lambda catalog: [{"catalog": catalog, "hostile_extra": []}],
     "catalog_envelope_invalid"),
    ("catalog_missing_functions_key",
     lambda catalog: [{"catalog": {k: v for k, v in catalog.items() if k != "functions"}}],
     "catalog_shape_invalid"),
    ("catalog_extra_key",
     lambda catalog: [{"catalog": {**catalog, "hostile_extra": {}}}],
     "catalog_shape_invalid"),
])
def test_catalog_envelope_and_shape_is_rejected(
        tmp_path, label, build_raw, expected_error):
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))
    fake = FakeCurl(rows=build_raw(catalog))
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == [expected_error]
    _assert_void(result)


@pytest.mark.parametrize("label, overrides, expected_error", [
    ("database_mismatch", {"database": OTHER_DATABASE}, "catalog_target_mismatch"),
    ("schema_mismatch", {"schema": "private"}, "catalog_target_mismatch"),
    ("observed_at_oversized", {"observed_at": "x" * 200}, "catalog_identity_invalid"),
    ("current_role_not_a_string", {"current_role": None}, "catalog_identity_invalid"),
    ("server_version_empty", {"server_version_num": ""}, "catalog_identity_invalid"),
])
def test_catalog_target_and_identity_is_rejected(
        tmp_path, label, overrides, expected_error):
    fixture = _fixture(tmp_path)
    catalog = _valid_catalog(_expected_definitions(fixture.source))
    catalog.update(overrides)
    fake = FakeCurl(rows=[{"catalog": catalog}])
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == [expected_error]
    _assert_void(result)


# --------------------------------------------------------------------------
# Negative: denial and ambiguous transport, never leaking the response body
# --------------------------------------------------------------------------


@pytest.mark.parametrize("status, expected_error", [
    (401, "owner_query_denied"),
    (403, "owner_query_denied"),
    (500, "owner_query_unavailable"),
])
def test_http_denial_stays_unavailable_and_never_leaks_the_body(
        tmp_path, status, expected_error):
    fixture = _fixture(tmp_path)
    fake = FakeCurl(
        http_status=status,
        error_body={"error": LEAK_MARKER, "message": f"denied for token {TOKEN}"},
    )
    result = _qualify(fixture, fake)
    assert result["state"] == "unavailable"
    assert result["errors"] == [expected_error]
    assert result["http_status"] == status
    assert result["observations"] == []
    _assert_void(result)
    # Neither the body marker nor the bearer token may surface anywhere in
    # the returned payload; exact denial provenance stays with the owner's
    # retained receipt, not this qualification result.
    _assert_no_leak(result, LEAK_MARKER, TOKEN, "denied for token")


def test_unreachable_transport_stays_unavailable_without_leaking_stderr(tmp_path):
    fixture = _fixture(tmp_path)
    fake = FakeCurl(unreachable=True)
    result = _qualify(fixture, fake)
    assert len(fake.calls) == 1
    assert result["state"] == "unavailable"
    assert result["errors"] == ["owner_query_unavailable"]
    assert result["http_status"] == 0
    assert result["observations"] == []
    _assert_void(result)
    _assert_no_leak(result, LEAK_MARKER, TOKEN)


def test_timeout_transport_maps_to_source_or_catalog_unavailable(tmp_path):
    fixture = _fixture(tmp_path)
    fake = FakeCurl(exc=subprocess.TimeoutExpired(cmd=["curl"], timeout=120))
    result = _qualify(fixture, fake)
    assert len(fake.calls) == 1, "the attempt did reach the seam"
    assert result["state"] == "unavailable"
    assert result["errors"] == ["source_or_catalog_unavailable"]
    assert "http_status" not in result
    assert result["observations"] == []
    _assert_void(result)
    _assert_no_leak(result, TOKEN)


def test_2xx_with_unparseable_payload_is_a_mismatch_not_a_qualification(tmp_path):
    """The incumbent returns an unparseable 2xx body as a raw string, so the
    module sees an envelope-shaped observation and voids it as a mismatch."""
    fixture = _fixture(tmp_path)
    fake = FakeCurl(garbage=True)
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == ["catalog_envelope_invalid"]
    assert result["observations"] == ["not json at all"]
    _assert_void(result)


def test_2xx_with_empty_payload_is_a_mismatch_not_a_qualification(tmp_path):
    """A 200 with no body is an empty observation, voided -- never a pass."""
    fixture = _fixture(tmp_path)
    fake = FakeCurl(empty_ok=True)
    result = _qualify(fixture, fake)
    assert result["state"] == "mismatch"
    assert result["errors"] == ["catalog_envelope_invalid"]
    assert len(result["observations"]) == 1
    _assert_void(result)
