"""The beta audit bundle is bound to the generation it audits.

The installed owner has no audit bundle beside it, so it selects the one in the
beta canonical checkout. That checkout is then reset to the admitted target, which
rewrites the selected policy in place. Before this change the digest pinned from
the PRIOR generation was carried to acceptance, where the unchanged execution
guard correctly refused the TARGET generation's policy file: every beta upgrade
whose target committed a different beta policy stopped unresolved after
activation.

These tests use the existing real-Git / real-audit owner fixture, with the bundle
committed into the fixture origin and removed from the authoring directory so the
owner selects it exactly the way the installed owner does. Only npm, the service
manager and HTTP are confined fixture effects.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import types
from pathlib import Path

import pytest

from test_terminal_beta_bootstrap import (
    BETA_POLICY_ARTIFACT,
    MAPPED_ROOTS,
    OPS,
    SCRIPT,
    Owner,
    _bash,
    git,
    status_file,
)

POLICY_NAME = "terminal_source_audit.beta.json"
GUARD_REFUSAL = "FATAL: selected preflight policy digest changed before execution"
CAPTURE_REFUSAL = "recovery cannot change the captured policy_digest"
PRIOR_POLICY_CAPTURE = "prior-generation-policy-capture"
BUNDLE_PREFIX = "/tmp/terminal-build-generation-bundle."

# The one statement that binds the acceptance bundle to the target generation on
# the ordinary beta entrance. Replacing it with a no-op is the pre-fix owner.
BIND_TARGET = '    bind_preflight_bundle_to_generation "$SRC" "$TARGET_SHA" target || exit $?\n'
UNBOUND_TARGET = "    : # pre-fix owner: the target generation bundle is never bound\n"
# The two commit-object comparisons that confine the legacy recovery admission.
PRIOR_BLOB_CHECK = "or generation_policy_digest(repo, prior_sha, policy_basename) != captured"
TARGET_BLOB_CHECK = "or generation_policy_digest(repo, sha, policy_basename) != policy_digest"


def canonical_digest(payload: dict) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def beta_policy(box: Owner, tree: str, *, variant: bool = False) -> dict:
    """The delivered beta policy translated to the fixture host. ``variant`` adds
    one valid, behaviour-neutral allowance so the canonical digest differs."""
    payload = json.loads(BETA_POLICY_ARTIFACT.read_text(encoding="utf-8"))
    payload["deployment_id_file"] = str(box.beta_app / ".deployment-id")
    for mapping in payload["mappings"]:
        mapping["live_path"] = str(box.beta_root / mapping["repo_path"])
        for allowance in mapping.get("allowances", []):
            if mapping["repo_path"] == "terminal" and allowance["path"] == "public/data":
                allowance["canonical_git_tree"] = tree
        if variant and mapping["repo_path"] == "scripts":
            mapping.setdefault("allowances", []).append(
                {"path": "__pycache__", "classification": "generated_python_cache"})
    return payload


def write_policy(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def commit_generation(box: Owner, message: str, *, data: str | None = None,
                      variant: bool = False) -> tuple[str, str, dict]:
    """Commit one generation that carries its own beta policy, pinned to that
    generation's own public/data tree. Returns (sha, policy digest, policy)."""
    if data is not None:
        (box.origin / "terminal" / "public" / "data" / "AAPL.json").write_text(data)
    git(box.origin, "add", "-A")
    tree = git(box.origin, "write-tree", "--prefix=terminal/public/data/")
    payload = beta_policy(box, tree, variant=variant)
    write_policy(box.origin / "ops" / POLICY_NAME, payload)
    git(box.origin, "add", "-A")
    git(box.origin, "commit", "-qm", message)
    sha = git(box.origin, "rev-parse", "HEAD")
    assert git(box.origin, "rev-parse", f"{sha}:terminal/public/data") == tree
    return sha, canonical_digest(payload), payload


def remove_authoring_bundle(box: Owner) -> None:
    for name in ("terminal_release_preflight.py", POLICY_NAME):
        (box.authoring / name).unlink(missing_ok=True)
    shutil.rmtree(box.authoring / "terminal_audit", ignore_errors=True)


def write_authoring_bundle(box: Owner, payload: dict) -> None:
    remove_authoring_bundle(box)
    shutil.copy(OPS / "terminal_release_preflight.py",
                box.authoring / "terminal_release_preflight.py")
    shutil.copytree(OPS / "terminal_audit", box.authoring / "terminal_audit",
                    ignore=shutil.ignore_patterns("__pycache__"))
    write_policy(box.authoring / POLICY_NAME, payload)


def installed_owner(tmp_path: Path):
    """A beta host whose owner has no bundle beside it: like the installed
    builder, it selects the bundle committed in the beta canonical checkout."""
    box = Owner(tmp_path).build_origin()
    shutil.copy(OPS / "terminal_release_preflight.py",
                box.origin / "ops" / "terminal_release_preflight.py")
    shutil.copytree(OPS / "terminal_audit", box.origin / "ops" / "terminal_audit",
                    ignore=shutil.ignore_patterns("__pycache__"))
    box.sha, box.d1, box.policy1 = commit_generation(
        box, "first generation carrying its own audit bundle")
    box.assemble(bootstrap_target_empty=True, production_tree=True)
    remove_authoring_bundle(box)
    box.bundles = tmp_path / "generation-bundles"
    box.bundles.mkdir()
    text = box.script.read_text()
    assert text.count(BUNDLE_PREFIX) == 1
    text = text.replace(BUNDLE_PREFIX, f"{box.bundles}/terminal-build-generation-bundle.")
    # The generated-output custody guard has its own Linux-only qualification;
    # Linux CI runs that real guard, macOS has no fd-xattr API to run it with.
    if not hasattr(os, "listxattr"):
        text = text.replace(
            "# Sourced -> expose the library and stop. Executed -> deploy.",
            "beta_prepare_build_output(){ return 0; }\n"
            "# Sourced -> expose the library and stop. Executed -> deploy.")
    assert text.count(BIND_TARGET) == 1
    assert text.count(PRIOR_BLOB_CHECK) == 1 and text.count(TARGET_BLOB_CHECK) == 1
    box.script.write_text(text)
    box.fixed = text
    npm = box.bindir / "npm"
    npm.write_text(npm.read_text().replace(
        "  mkdir -p .next && printf",
        "  mkdir -p .next\n  printf '{\"config\":{\"deploymentId\":\"%s\"}}\\n' \"$GIT_SHA\""
        " > .next/required-server-files.json\n  printf"))
    unit = box.bindir / "systemctl"
    unit.write_text(unit.read_text().replace(
        "      LoadState) echo loaded ;;",
        "      MainPID|ControlPID) echo 0 ;;\n      LoadState) echo loaded ;;"))
    box.common = {"status_file": status_file(tmp_path, build_id=box.sha),
                  "MMX_STATUS_FOLLOWS_RUNTIME": "1"}
    return box


def bootstrap(box) -> None:
    first = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha], **box.common)
    assert first.returncode == 0, first.stdout + first.stderr
    assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha


def second_generation(box, *, variant: bool = False) -> None:
    """The incident shape: the target changes host-owned market data, so the
    policy it commits must pin a different public/data tree than the prior one."""
    box.sha2, box.d2, box.policy2 = commit_generation(
        box, "second generation: new market data and its policy pin",
        data='{"px": 2}\n', variant=variant)
    assert box.d2 != box.d1


def upgrade(box, sha: str, **flags):
    return box.run(["--target", "beta", "--target-sha", sha], **{**box.common, **flags})


def recover(box, failed: dict, **flags):
    return box.run(["--target", "beta", "--recover-attempt", failed["attempt_id"],
                    "--pending-record-id", failed["record_id"],
                    "--target-sha", failed["target_sha"]], **{**box.common, **flags})


def canonical_policy_path(box) -> str:
    return str((box.beta_src / "ops").resolve() / POLICY_NAME)


def assert_no_private_bundle_left(box) -> None:
    assert list(box.bundles.iterdir()) == [], list(box.bundles.iterdir())


def failed_under_prior_policy(tmp_path: Path):
    """Reproduce the stranded attempt with the pre-fix owner, then install the
    fixed owner. The returned record is what the recovery entrance must admit."""
    box = installed_owner(tmp_path)
    bootstrap(box)
    second_generation(box)
    box.script.write_text(box.fixed.replace(BIND_TARGET, UNBOUND_TARGET))
    stranded = upgrade(box, box.sha2)
    assert stranded.returncode != 0, stranded.stdout + stranded.stderr
    assert GUARD_REFUSAL in stranded.stdout, stranded.stdout + stranded.stderr
    assert "BETA UNRESOLVED: live source/dependencies may have changed" in stranded.stdout
    failed = box.pointer_record(".release-pending")
    assert failed["phase"] == "failed" and failed["mode"] == "upgrade"
    assert failed["live_inputs_dirty"] is True
    assert failed.get("recovery_from_record_id") is None
    assert failed["policy_digest"] == box.d1          # the PRIOR generation's policy
    assert failed["target_sha"] == box.sha2 and failed["prior_sha"] == box.sha
    assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha
    assert box.unit_active.read_text().strip() == "inactive"
    assert box.unit_enabled.read_text().strip() == "disabled"
    assert git(box.beta_src, "rev-parse", "HEAD") == box.sha2
    assert git(box.beta_src, "status", "--porcelain=v1", "--untracked-files=all") == ""
    assert (box.beta_app / ".deployment-id").read_text().strip() == box.sha2
    box.script.write_text(box.fixed)
    return box, failed


# ---------------------------------------------------------------------------
# ordinary upgrade entrance
# ---------------------------------------------------------------------------

def test_upgrade_commits_when_the_target_generation_changes_the_beta_policy(tmp_path):
    box = installed_owner(tmp_path)
    bootstrap(box)
    provisioned = box.pointer_record(".source-provisioned")
    assert provisioned["policy_digest"] == box.d1
    assert provisioned["policy_path"] == canonical_policy_path(box)
    second_generation(box)
    production = (box.prod_app / "public" / "data" / "PROD.json").read_bytes()

    result = upgrade(box, box.sha2)

    assert result.returncode == 0, result.stdout + result.stderr
    assert GUARD_REFUSAL not in result.stdout
    assert f"preflight bundle bound to target generation {box.sha2}" in result.stdout
    assert f"policy_digest={box.d2}" in result.stdout
    accepted = box.pointer_record(".runtime-accepted")
    assert accepted["accepted_sha"] == box.sha2
    # acceptance is the TARGET generation audited under the TARGET policy
    assert accepted["policy_digest"] == box.d2
    # durable records name the persistent canonical policy, never a private copy
    assert accepted["policy_path"] == canonical_policy_path(box)
    assert "recovery_policy_basis" not in accepted
    receipt = json.loads(Path(accepted["release_receipt_path"]).read_text())
    assert receipt["result"] == "CLEAN"
    assert receipt["policy_digest"] == box.d2
    assert receipt["source_audit"]["accepted_sha"] == box.sha2
    assert receipt["source_audit"]["summary"]["blocking_findings"] == 0
    # the current-generation gate still judged the PRIOR generation under ITS policy
    current = [json.loads(path.read_text()) for path in box.receipts()]
    assert any(item["accepted_sha"] == box.sha and item["policy_digest"] == box.d1
               and item["result"] == "CLEAN" for item in current), current
    assert not (box.beta_root / ".release-pending").exists()
    assert (box.beta_app / ".deployment-id").read_text().strip() == box.sha2
    assert git(box.beta_src, "rev-parse", "HEAD") == box.sha2
    assert box.unit_active.read_text().strip() == "active"
    assert box.unit_enabled.read_text().strip() == "enabled"
    assert (box.prod_app / "public" / "data" / "PROD.json").read_bytes() == production
    assert_no_private_bundle_left(box)


def test_mutant_unbound_target_bundle_strands_the_upgrade_as_observed(tmp_path):
    """Old behaviour restored: the same upgrade stops unresolved after activation,
    with the prior policy digest captured for the new target."""
    box, failed = failed_under_prior_policy(tmp_path)
    assert failed["policy_digest"] != box.d2


def test_failed_target_restores_the_prior_generation_under_the_prior_policy(tmp_path):
    """The restoration audit after a failed target is the PRIOR generation judged
    by the PRIOR generation's bundle, not by the target bundle bound for acceptance."""
    box = installed_owner(tmp_path)
    bootstrap(box)
    second_generation(box)
    accepted_before = os.readlink(box.beta_root / ".runtime-accepted")
    before = len(box.receipts())

    result = upgrade(box, box.sha2, FAIL_NPM_BUILD="1")

    assert result.returncode != 0
    assert f"preflight bundle bound to target generation {box.sha2}" in result.stdout
    assert "beta rolled back and verified: accepted=" + box.sha in result.stdout, (
        result.stdout + result.stderr)
    assert "BETA UNRESOLVED" not in result.stdout and GUARD_REFUSAL not in result.stdout
    assert os.readlink(box.beta_root / ".runtime-accepted") == accepted_before
    assert not (box.beta_root / ".release-pending").exists()
    assert git(box.beta_src, "rev-parse", "HEAD") == box.sha
    assert (box.beta_app / ".deployment-id").read_text().strip() == box.sha
    restored = [json.loads(path.read_text()) for path in box.receipts()[before:]]
    assert restored and all(item["accepted_sha"] == box.sha and item["policy_digest"] == box.d1
                            and item["result"] == "CLEAN" for item in restored), restored
    assert box.unit_active.read_text().strip() == "active"
    assert_no_private_bundle_left(box)


# ---------------------------------------------------------------------------
# the other two checkout movements that precede an audit
# ---------------------------------------------------------------------------

BIND_BOOTSTRAP_TARGET = '\n  bind_preflight_bundle_to_generation "$SRC" "$TARGET_SHA" target || exit $?\n'
BIND_CURRENT = '    bind_preflight_bundle_to_generation "$SRC" "$PREFLIGHT_ACCEPTED_SHA" current || exit $?\n'


@pytest.mark.parametrize("bound", [True, False])
def test_bootstrap_of_a_target_ahead_of_the_checkout_uses_the_target_policy(tmp_path, bound):
    """First installation where the canonical checkout still holds an older
    generation: the provisioned record and the gate after it are the target's."""
    box = installed_owner(tmp_path)
    second_generation(box)
    assert git(box.beta_src, "rev-parse", "HEAD") == box.sha
    assert box.fixed.count(BIND_BOOTSTRAP_TARGET) == 1
    if not bound:
        box.script.write_text(box.fixed.replace(BIND_BOOTSTRAP_TARGET, "\n  :\n"))

    result = box.run(["--target", "beta", "--bootstrap", "--target-sha", box.sha2], **box.common)

    if bound:
        assert result.returncode == 0, result.stdout + result.stderr
        assert f"preflight bundle bound to target generation {box.sha2}" in result.stdout
        provisioned = box.pointer_record(".source-provisioned")
        accepted = box.pointer_record(".runtime-accepted")
        assert provisioned["accepted_sha"] == accepted["accepted_sha"] == box.sha2
        assert provisioned["policy_digest"] == accepted["policy_digest"] == box.d2
        assert provisioned["policy_path"] == accepted["policy_path"] == canonical_policy_path(box)
        assert box.unit_active.read_text().strip() == "active"
        assert_no_private_bundle_left(box)
    else:
        # pre-fix owner: the older generation's digest is recorded for the target
        # and the unchanged guard then refuses the target's policy file
        assert result.returncode != 0
        assert GUARD_REFUSAL in result.stdout, result.stdout + result.stderr
        assert box.pointer_record(".source-provisioned")["policy_digest"] == box.d1
        assert box.pointer_record(".runtime-accepted") is None


@pytest.mark.parametrize("bound", [True, False])
def test_canonical_head_recovery_audits_the_accepted_generation_with_its_own_bundle(
        tmp_path, bound):
    """The checkout is found ahead of the live accepted generation and is put
    back. The gate that follows must run the accepted generation's bundle, not
    the one that was selected from the mismatched head."""
    box = installed_owner(tmp_path)
    bootstrap(box)
    # same data tree, so the head's policy can still describe the live generation
    box.sha2, box.d2, box.policy2 = commit_generation(
        box, "second generation: policy variant only", variant=True)
    assert box.d2 != box.d1
    git(box.beta_src, "fetch", "-q", "origin")
    git(box.beta_src, "reset", "-q", "--hard", box.sha2)
    assert box.fixed.count(BIND_CURRENT) == 2
    if not bound:
        box.script.write_text(box.fixed.replace(BIND_CURRENT, "    :\n"))
    before = len(box.receipts())

    result = upgrade(box, box.sha2)

    out = result.stdout + result.stderr
    assert "admitted the sole canonical-head mismatch recovery state" in out, out
    if bound:
        assert result.returncode == 0, out
        assert f"preflight bundle bound to current generation {box.sha}" in result.stdout
        assert f"preflight bundle bound to target generation {box.sha2}" in result.stdout
        receipts = [json.loads(path.read_text()) for path in box.receipts()[before:]]
        assert any(item["accepted_sha"] == box.sha and item["policy_digest"] == box.d1
                   and item["result"] == "CLEAN" for item in receipts), receipts
        accepted = box.pointer_record(".runtime-accepted")
        assert accepted["accepted_sha"] == box.sha2 and accepted["policy_digest"] == box.d2
        assert accepted["policy_path"] == canonical_policy_path(box)
        assert_no_private_bundle_left(box)
    else:
        assert result.returncode != 0
        assert GUARD_REFUSAL in result.stdout, out
        assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha
        assert not (box.beta_root / ".release-pending").exists()


# ---------------------------------------------------------------------------
# recovery entrance: an attempt captured under the prior generation's policy
# ---------------------------------------------------------------------------

def test_recovery_completes_an_attempt_captured_under_the_prior_policy_exactly_once(tmp_path):
    box, failed = failed_under_prior_policy(tmp_path)
    failed_path = (box.beta_root / ".release-pending").resolve()
    failed_bytes = failed_path.read_bytes()
    prior_path = (box.beta_root / ".runtime-accepted").resolve()
    prior_bytes = prior_path.read_bytes()

    result = recover(box, failed)

    assert result.returncode == 0, result.stdout + result.stderr
    accepted = box.pointer_record(".runtime-accepted")
    assert accepted["accepted_sha"] == box.sha2
    assert accepted["acceptance_attempt_id"] == failed["attempt_id"]
    assert accepted["recovery_from_record_id"] == failed["record_id"]
    assert accepted["recovery_from_record"] == str(failed_path)
    assert accepted["previous_runtime_record"] == str(prior_path)
    # accepted under the TARGET policy; the captured prior digest stays as history
    assert accepted["policy_digest"] == box.d2
    assert accepted["recovery_policy_basis"] == PRIOR_POLICY_CAPTURE
    assert accepted["recovery_captured_policy_digest"] == box.d1
    assert accepted["policy_path"] == canonical_policy_path(box)
    receipt = json.loads(Path(accepted["release_receipt_path"]).read_text())
    assert receipt["result"] == "CLEAN" and receipt["policy_digest"] == box.d2
    assert receipt["source_audit"]["accepted_sha"] == box.sha2
    assert failed_path.read_bytes() == failed_bytes and prior_path.read_bytes() == prior_bytes
    assert not (box.beta_root / ".release-pending").exists()
    assert box.unit_active.read_text().strip() == "active"
    assert box.unit_enabled.read_text().strip() == "enabled"

    accepted_path = (box.beta_root / ".runtime-accepted").resolve()
    accepted_bytes = accepted_path.read_bytes()
    effects = len(box.effects())
    again = recover(box, failed)
    assert again.returncode != 0
    assert (box.beta_root / ".runtime-accepted").resolve() == accepted_path
    assert accepted_path.read_bytes() == accepted_bytes
    assert not any(line.startswith("npm run build") for line in box.effects()[effects:])


def test_mutant_strict_capture_comparison_refuses_the_stranded_attempt(tmp_path):
    """Old behaviour restored on the recovery entrance: any captured digest other
    than the selected one is refused, so the stranded attempt has no way out."""
    box, failed = failed_under_prior_policy(tmp_path)
    box.script.write_text(box.fixed.replace(PRIOR_BLOB_CHECK, "or True"))
    pending = (box.beta_root / ".release-pending").resolve()
    pending_bytes = pending.read_bytes()
    effects = len(box.effects())

    result = recover(box, failed)

    assert result.returncode != 0
    assert CAPTURE_REFUSAL in result.stdout + result.stderr
    assert (box.beta_root / ".release-pending").resolve() == pending
    assert pending.read_bytes() == pending_bytes
    assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha
    assert not any(line.startswith("npm run build") for line in box.effects()[effects:])


def test_legacy_recovery_that_fails_its_audit_is_consumed_and_never_replayed(tmp_path):
    box, failed = failed_under_prior_policy(tmp_path)
    original = (box.beta_root / ".release-pending").resolve()
    original_bytes = original.read_bytes()
    prior = (box.beta_root / ".runtime-accepted").resolve()
    unknown = box.beta_root / "hub" / "private-host-cache.json"
    unknown.write_text('{"preserve":"unknown host data"}\n')

    result = recover(box, failed)

    assert result.returncode != 0
    assert unknown.read_text() == '{"preserve":"unknown host data"}\n'
    assert (box.beta_root / ".runtime-accepted").resolve() == prior
    assert original.read_bytes() == original_bytes
    pending = box.pointer_record(".release-pending")
    assert pending["attempt_id"] == failed["attempt_id"] and pending["phase"] == "failed"
    assert pending["recovery_from_record_id"] == failed["record_id"]
    assert pending["policy_digest"] == box.d1
    assert pending["recovery_policy_digest"] == box.d2
    assert pending["recovery_policy_basis"] == PRIOR_POLICY_CAPTURE
    receipt = json.loads(box.receipts()[-1].read_text())
    assert receipt["result"] == "UNKNOWN_STOP" and receipt["policy_digest"] == box.d2
    assert box.unit_active.read_text().strip() == "inactive"
    assert box.unit_enabled.read_text().strip() == "disabled"

    unknown.unlink()
    effects = len(box.effects())
    # neither the consumed original record nor the consumed recovery is replayable
    for record, refusal in ((failed, "not the exact failed record selected for recovery"),
                            (pending, "one recovery entrance")):
        again = recover(box, {**failed, "record_id": record["record_id"]})
        assert again.returncode != 0
        assert refusal in again.stdout + again.stderr, again.stdout + again.stderr
    assert (box.beta_root / ".runtime-accepted").resolve() == prior
    assert not any(line.startswith("npm run build") for line in box.effects()[effects:])


def recovery_check(box, failed: dict, policy_digest: str, *, script: str | None = None):
    """Ask the owner's own state control whether this exact record is recoverable
    under one selected policy digest. Read-only: it claims nothing."""
    library = box.tmp / "recovery-check-owner.sh"
    library.write_text(script if script is not None else box.fixed)
    body = f'''
        . "{library}"
        set +e
        select_release_target beta
        beta_statectl attempt-recovery-check "$BETA_TARGET_ROOT" "$SOURCE_PROVISIONED_STATE_DIR" \\
          "$APP" "$SRC" "{failed["target_sha"]}" "{policy_digest}" "$PRODUCTION_APP_DEFAULT" \\
          "{failed["attempt_id"]}" "{failed["record_id"]}" "$PREFLIGHT_POLICY_BASENAME"
        echo "CHECK_RC=$?"
    '''
    return subprocess.run([_bash(), "-c", body], capture_output=True, text=True, timeout=120)


def test_prior_policy_capture_is_admitted_only_for_the_exact_committed_policies(tmp_path):
    box, failed = failed_under_prior_policy(tmp_path)
    pending = (box.beta_root / ".release-pending").resolve()
    pending_bytes = pending.read_bytes()

    admitted = recovery_check(box, failed, box.d2)
    assert "CHECK_RC=0" in admitted.stdout, admitted.stdout + admitted.stderr
    assert "RECOVERABLE\t" + failed["attempt_id"] in admitted.stdout

    # any selected policy other than the one the captured TARGET committed
    for selected in (canonical_digest(beta_policy(box, "0" * 40)),
                     canonical_digest({**box.policy2, "accepted_ref": "refs/heads/other"}),
                     "f" * 64):
        refused = recovery_check(box, failed, selected)
        assert "CHECK_RC=0" not in refused.stdout
        assert CAPTURE_REFUSAL in refused.stderr, refused.stdout + refused.stderr
    # Presenting the captured digest itself is the incumbent unchanged-policy
    # admission, which this change leaves alone; the exception is not involved.
    assert "CHECK_RC=0" in recovery_check(box, failed, box.d1).stdout

    # Mutants: each commit-object comparison is load-bearing.
    no_target = box.fixed.replace(TARGET_BLOB_CHECK, "or False")
    assert "CHECK_RC=0" in recovery_check(box, failed, "f" * 64, script=no_target).stdout
    assert pending.read_bytes() == pending_bytes


def test_capture_that_is_not_the_prior_generations_policy_is_still_refused(tmp_path):
    """An attempt begun under a policy that is NOT what its prior generation
    committed keeps the incumbent refusal: only the exact lineage is admitted."""
    box = installed_owner(tmp_path)
    bootstrap(box)
    second_generation(box)
    tree1 = git(box.origin, "rev-parse", f"{box.sha}:terminal/public/data")
    foreign = beta_policy(box, tree1, variant=True)
    foreign_digest = canonical_digest(foreign)
    assert foreign_digest not in (box.d1, box.d2)
    # A bundle beside the owner is selected first and is never rebound, so this
    # attempt captures the foreign digest and its target audit cannot pass.
    write_authoring_bundle(box, foreign)
    stranded = upgrade(box, box.sha2)
    assert stranded.returncode != 0, stranded.stdout + stranded.stderr
    assert "preflight bundle bound to" not in stranded.stdout
    failed = box.pointer_record(".release-pending")
    assert failed["phase"] == "failed" and failed["live_inputs_dirty"] is True
    assert failed["policy_digest"] == foreign_digest and failed["prior_sha"] == box.sha
    remove_authoring_bundle(box)
    pending = (box.beta_root / ".release-pending").resolve()
    pending_bytes = pending.read_bytes()
    effects = len(box.effects())

    result = recover(box, failed)

    assert result.returncode != 0
    assert CAPTURE_REFUSAL in result.stdout + result.stderr
    assert (box.beta_root / ".release-pending").resolve() == pending
    assert pending.read_bytes() == pending_bytes
    assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha
    assert not any(line.startswith("npm run build") for line in box.effects()[effects:])
    # Mutant: without the prior-generation comparison this foreign capture would
    # be admitted, so the refusal above is that comparison and nothing else.
    no_prior = box.fixed.replace(PRIOR_BLOB_CHECK, "or False")
    assert "CHECK_RC=0" in recovery_check(box, failed, box.d2, script=no_prior).stdout
    assert "CHECK_RC=0" not in recovery_check(box, failed, box.d2).stdout


def test_recovery_under_a_policy_the_target_did_not_commit_is_refused(tmp_path):
    box, failed = failed_under_prior_policy(tmp_path)
    tree2 = git(box.origin, "rev-parse", f"{box.sha2}:terminal/public/data")
    foreign = beta_policy(box, tree2, variant=True)
    assert canonical_digest(foreign) not in (box.d1, box.d2)
    write_authoring_bundle(box, foreign)
    pending = (box.beta_root / ".release-pending").resolve()
    pending_bytes = pending.read_bytes()
    effects = len(box.effects())

    result = recover(box, failed)

    assert result.returncode != 0
    assert CAPTURE_REFUSAL in result.stdout + result.stderr
    assert (box.beta_root / ".release-pending").resolve() == pending
    assert pending.read_bytes() == pending_bytes
    assert box.pointer_record(".runtime-accepted")["accepted_sha"] == box.sha
    assert not any(line.startswith("npm run build") for line in box.effects()[effects:])


# ---------------------------------------------------------------------------
# state control, in isolation
# ---------------------------------------------------------------------------

def statectl():
    text = SCRIPT.read_text(encoding="utf-8")
    start = text.index("<<'PY_STATECTL' || return $?\n") + len("<<'PY_STATECTL' || return $?\n")
    module = types.ModuleType("beta_statectl_under_test")
    exec(compile(text[start:text.index("\nPY_STATECTL\n", start)], "beta_statectl", "exec"),
         module.__dict__)
    return module


def policy_repository(tmp_path: Path, blobs: list[bytes | None]) -> tuple[Path, list[str]]:
    repo = tmp_path / "policy-repo"
    (repo / "ops").mkdir(parents=True)
    git(repo, "init", "-q", "-b", "master")
    git(repo, "config", "user.email", "policy-test@example.invalid")
    git(repo, "config", "user.name", "Policy Generation Test")
    shas = []
    for index, blob in enumerate(blobs):
        (repo / "marker").write_text(f"{index}\n")
        path = repo / "ops" / POLICY_NAME
        if blob is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(blob)
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", f"generation {index}")
        shas.append(git(repo, "rev-parse", "HEAD"))
    return repo, shas


def test_generation_policy_digest_reads_only_one_well_formed_committed_policy(tmp_path, monkeypatch):
    module = statectl()
    policy = {"schema": "s", "mappings": [], "b": 1, "a": {"y": 2, "x": 1}}
    reordered = b'{\n "mappings": [], "a": {"x": 1, "y": 2},\n "b": 1, "schema": "s"}\n'
    repo, shas = policy_repository(tmp_path, [
        json.dumps(policy).encode(), reordered, None, b'{"a": 1, "a": 2}\n', b"[1]\n",
        b"not json\n", b"", b"\xff\xfe{}\n",
        b'{"pad": "' + b"x" * (1024 * 1024) + b'"}\n'])
    digest = canonical_digest(policy)
    assert module.generation_policy_digest(str(repo), shas[0], POLICY_NAME) == digest
    # canonical: formatting and key order of the committed bytes do not matter
    assert module.generation_policy_digest(str(repo), shas[1], POLICY_NAME) == digest
    for sha in shas[2:]:
        assert module.generation_policy_digest(str(repo), sha, POLICY_NAME) is None, sha
    for bad in (None, "", "HEAD", shas[0][:12], shas[0].upper(), "0" * 40, shas[0] + "\n"):
        assert module.generation_policy_digest(str(repo), bad, POLICY_NAME) is None, bad
    assert module.generation_policy_digest(str(repo), shas[0], "absent.json") is None
    assert module.generation_policy_digest(str(tmp_path / "no-repo"), shas[0], POLICY_NAME) is None
    # an inherited Git environment cannot redirect the read to another repository
    other, other_shas = policy_repository(tmp_path / "other", [b'{"other": true}\n'])
    monkeypatch.setenv("GIT_DIR", str(other / ".git"))
    monkeypatch.setenv("GIT_WORK_TREE", str(other))
    assert module.generation_policy_digest(str(repo), shas[0], POLICY_NAME) == digest
    assert module.generation_policy_digest(str(repo), other_shas[0], POLICY_NAME) is None


def runtime_args(sha: str, policy_digest: str, build: str, attempt_id: str) -> list[str]:
    return ["/t", "/t/state", "/t/app", "/t/repo", sha, policy_digest, "/t/repo/ops/p.json",
            "/t/prod", "", "/t/receipt.json", "r" * 8, "s" * 8, build, attempt_id]


@pytest.mark.parametrize("case, presented, admitted", [
    ("ordinary", "captured", True),
    ("ordinary", "target", False),
    ("ordinary-with-planted-recovery-policy", "target", False),
    ("ordinary-with-planted-recovery-policy", "captured", True),
    ("equal-policy-recovery", "captured", True),
    ("equal-policy-recovery", "target", False),
    ("prior-capture-recovery", "target", True),
    ("prior-capture-recovery", "captured", False),
    ("prior-capture-recovery", "other", False),
    ("recovery-with-unknown-basis", "target", False),
    ("recovery-with-unknown-basis", "captured", False),
    ("recovery-with-missing-basis", "target", False),
])
def test_runtime_acceptance_presents_exactly_the_policy_the_attempt_is_bound_to(
        monkeypatch, case, presented, admitted):
    module = statectl()
    sha, build, attempt_id = "a" * 40, "build-1", "b" * 32
    digests = {"captured": "1" * 64, "target": "2" * 64, "other": "3" * 64}
    attempt = {"attempt_id": attempt_id, "phase": "committing", "target_sha": sha,
               "build_id": build, "policy_digest": digests["captured"],
               "app_root": "/t/app", "canonical_repo": "/t/repo",
               "recovery_from_record_id": None}
    recovering = {"recovery_from_record_id": "c" * 64, "recovery_build_id": build,
                  "build_id": "stale-build"}
    if case == "ordinary-with-planted-recovery-policy":
        attempt.update({"recovery_policy_digest": digests["target"],
                        "recovery_policy_basis": PRIOR_POLICY_CAPTURE})
    elif case == "equal-policy-recovery":
        attempt.update(recovering)
    elif case == "prior-capture-recovery":
        attempt.update({**recovering, "recovery_policy_digest": digests["target"],
                        "recovery_policy_basis": PRIOR_POLICY_CAPTURE})
    elif case == "recovery-with-unknown-basis":
        attempt.update({**recovering, "recovery_policy_digest": digests["target"],
                        "recovery_policy_basis": "operator-says-so"})
    elif case == "recovery-with-missing-basis":
        attempt.update({**recovering, "recovery_policy_digest": digests["target"]})

    class ReachedAnchor(Exception):
        pass

    def anchor(*_):
        raise ReachedAnchor()

    monkeypatch.setattr(module, "read_attempt", lambda *_: ("/t/state/attempt.json", dict(attempt)))
    monkeypatch.setattr(module, "provision_anchor", anchor)
    arguments = runtime_args(sha, digests[presented], build, attempt_id)
    if admitted:
        with pytest.raises(ReachedAnchor):
            module.action_runtime(arguments)
    else:
        with pytest.raises(SystemExit) as refusal:
            module.action_runtime(arguments)
        assert "not the validated pending beta transaction" in str(refusal.value)


# ---------------------------------------------------------------------------
# the binding primitive and the unchanged execution guard, in isolation
# ---------------------------------------------------------------------------

def bundle_repository(tmp_path: Path) -> dict:
    """Two generations with different committed policies, a third with a
    different audit runtime, and one that carries no bundle at all."""
    repo = tmp_path / "canonical"
    (repo / "ops").mkdir(parents=True)
    git(repo, "init", "-q", "-b", "master")
    git(repo, "config", "user.email", "bundle-test@example.invalid")
    git(repo, "config", "user.name", "Bundle Generation Test")
    (repo / "README").write_text("no bundle yet\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "no bundle")
    state = {"repo": repo, "none": git(repo, "rev-parse", "HEAD")}
    shutil.copy(OPS / "terminal_release_preflight.py", repo / "ops" / "terminal_release_preflight.py")
    shutil.copytree(OPS / "terminal_audit", repo / "ops" / "terminal_audit",
                    ignore=shutil.ignore_patterns("__pycache__"))
    for name in ("a", "b"):
        payload = {"schema": "fixture", "generation": name}
        write_policy(repo / "ops" / POLICY_NAME, payload)
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", f"generation {name}")
        state[name] = git(repo, "rev-parse", "HEAD")
        state["d" + name] = canonical_digest(payload)
    state["bundles"] = tmp_path / "bundles"
    state["bundles"].mkdir()
    text = SCRIPT.read_text(encoding="utf-8")
    assert text.count(BUNDLE_PREFIX) == 1
    text = (text.replace(BUNDLE_PREFIX, f"{state['bundles']}/terminal-build-generation-bundle.")
            .replace("select_preflight_artifacts 0 ", f"select_preflight_artifacts {os.getuid()} "))
    state["script"] = tmp_path / "owner-library.sh"
    state["script"].write_text(text)
    return state


def bind_lib(state: dict, body: str) -> subprocess.CompletedProcess:
    driver = f'''
        . "{state["script"]}"
        set +e
        select_release_target beta
        REPO="{state["repo"]}"
        show(){{ echo "$1|$PREFLIGHT_SCRIPT|$PREFLIGHT_POLICY|$PREFLIGHT_RUNTIME_DIR|$PREFLIGHT_POLICY_DIGEST|$PREFLIGHT_POLICY_RECORD_PATH|$PREFLIGHT_CURRENT_POLICY|$PREFLIGHT_CURRENT_POLICY_DIGEST"; }}
        {body}
    '''
    return subprocess.run([_bash(), "-c", driver], capture_output=True, text=True, timeout=120)


def shown(result: subprocess.CompletedProcess, label: str) -> list[str]:
    lines = [line for line in result.stdout.splitlines() if line.startswith(label + "|")]
    assert len(lines) == 1, result.stdout + result.stderr
    return lines[0].split("|")[1:]


def test_target_binding_selects_the_target_bundle_and_keeps_the_current_one(tmp_path):
    state = bundle_repository(tmp_path)
    git(state["repo"], "reset", "-q", "--hard", state["a"])
    canonical = (state["repo"] / "ops").resolve()
    result = bind_lib(state, f'''
        select_preflight_artifacts {os.getuid()} "$REPO/ops"; echo "SELECT_RC=$?"
        show before
        bind_preflight_bundle_to_generation "$REPO" "{state["b"]}" target; echo "BIND_RC=$?"
        show bound
        stat_mode(){{ python3 -I -c 'import os,stat,sys; print(oct(stat.S_IMODE(os.lstat(sys.argv[1]).st_mode)))' "$1"; }}
        echo "PRIVATE_MODE=$(stat_mode "${{PREFLIGHT_GENERATION_BUNDLE_DIRS[0]}}")"
        echo "POLICY_MODE=$(stat_mode "$PREFLIGHT_POLICY")"
        git -C "$REPO" reset -q --hard "{state["b"]}"
        run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$REPO" "{tmp_path}/absent/receipts" >/dev/null 2>&1
        echo "TARGET_PIN_AFTER_RESET=$PREFLIGHT_POLICY_DIGEST"
        restore_current_generation_preflight_bundle; echo "RESTORE_RC=$?"
        show restored
        run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$REPO" "{tmp_path}/absent/receipts"
        echo "STALE_CURRENT_RC=$?"
        preflight_generation_bundle_cleanup; echo "CLEAN_RC=$?"
    ''')
    out = result.stdout + result.stderr
    assert "SELECT_RC=0" in out and "BIND_RC=0" in out and "RESTORE_RC=0" in out, out
    before, bound, restored = shown(result, "before"), shown(result, "bound"), shown(result, "restored")
    assert before[0] == f"{canonical}/terminal_release_preflight.py"
    assert before[3] == state["da"] and before[4] == "" and before[5] == ""
    private = Path(bound[1]).parent
    assert private.parent.parent == state["bundles"].resolve() or private.parent.parent == state["bundles"]
    assert bound[0] == f"{private}/terminal_release_preflight.py"
    assert bound[2] == f"{private}/terminal_audit"
    assert bound[3] == state["db"]                          # the TARGET generation's policy
    assert bound[4] == f"{canonical}/{POLICY_NAME}"         # what durable records name
    assert bound[5] == before[1] and bound[6] == state["da"]  # CURRENT kept for restoration
    assert f"preflight bundle bound to target generation {state['b']}" in out
    assert "PRIVATE_MODE=0o700" in out and "POLICY_MODE=0o600" in out, out
    # the checkout moving to the target does not disturb the bound private copy
    assert f"TARGET_PIN_AFTER_RESET={state['db']}" in out
    assert restored[:4] == before[:4]
    # ...while the canonical file selected for the prior generation HAS changed,
    # and the unchanged guard refuses to execute it against the prior pin
    assert "STALE_CURRENT_RC=64" in out and GUARD_REFUSAL in out, out
    assert "CLEAN_RC=0" in out and list(state["bundles"].iterdir()) == []


def test_current_binding_replaces_a_selection_made_from_a_mismatched_head(tmp_path):
    state = bundle_repository(tmp_path)
    git(state["repo"], "reset", "-q", "--hard", state["b"])
    result = bind_lib(state, f'''
        select_preflight_artifacts {os.getuid()} "$REPO/ops"
        show before
        git -C "$REPO" reset -q --hard "{state["a"]}"
        bind_preflight_bundle_to_generation "$REPO" "{state["a"]}" current; echo "CURRENT_RC=$?"
        show current
        bind_preflight_bundle_to_generation "$REPO" "{state["b"]}" target; echo "TARGET_RC=$?"
        show target
        echo "DIRS=${{#PREFLIGHT_GENERATION_BUNDLE_DIRS[@]}}"
    ''')
    out = result.stdout + result.stderr
    assert "CURRENT_RC=0" in out and "TARGET_RC=0" in out and "DIRS=2" in out, out
    before, current, target = shown(result, "before"), shown(result, "current"), shown(result, "target")
    assert before[3] == state["db"]
    assert current[3] == state["da"] and current[5] == "" and current[6] == ""
    assert current[1] != before[1] and str(state["bundles"].name) in current[1]
    # a later target binding keeps the bound CURRENT bundle, not the mismatched one
    assert target[3] == state["db"] and target[5] == current[1] and target[6] == state["da"]
    assert target[4] == current[4] == f"{(state['repo'] / 'ops').resolve()}/{POLICY_NAME}"


def test_a_bundle_selected_beside_the_owner_is_never_rebound(tmp_path):
    state = bundle_repository(tmp_path)
    git(state["repo"], "reset", "-q", "--hard", state["a"])
    authoring = tmp_path / "authoring"
    shutil.copytree(state["repo"] / "ops", authoring)
    result = bind_lib(state, f'''
        select_preflight_artifacts {os.getuid()} "{authoring}" "$REPO/ops"
        show before
        bind_preflight_bundle_to_generation "$REPO" "{state["b"]}" target; echo "TARGET_RC=$?"
        bind_preflight_bundle_to_generation "$REPO" "{state["b"]}" current; echo "CURRENT_RC=$?"
        show after
        echo "BOUND=$PREFLIGHT_BUNDLE_GENERATION_BOUND DIRS=${{#PREFLIGHT_GENERATION_BUNDLE_DIRS[@]}}"
        restore_current_generation_preflight_bundle
        show restored
    ''')
    out = result.stdout + result.stderr
    assert "TARGET_RC=0" in out and "CURRENT_RC=0" in out and "BOUND=0 DIRS=0" in out, out
    assert shown(result, "before") == shown(result, "after") == shown(result, "restored")
    assert shown(result, "before")[1] == f"{authoring.resolve()}/{POLICY_NAME}"
    assert "preflight bundle bound to" not in out
    assert list(state["bundles"].iterdir()) == []


def test_binding_fails_closed_and_never_falls_back_to_the_stale_selection(tmp_path):
    state = bundle_repository(tmp_path)
    git(state["repo"], "reset", "-q", "--hard", state["a"])
    select = f'select_preflight_artifacts {os.getuid()} "$REPO/ops"'
    result = bind_lib(state, f'''
        {select}
        bind_preflight_bundle_to_generation "$REPO" "{state["none"]}" target; echo "NO_BUNDLE_RC=$?"
        show nobundle
        run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$REPO" "{tmp_path}/absent/receipts"
        echo "EMPTY_SELECTION_RC=$?"
        preflight_generation_bundle_cleanup
        PREFLIGHT_BUNDLE_GENERATION_BOUND=0
        {select}
        bind_preflight_bundle_to_generation "$REPO" "{"0" * 40}" target; echo "UNKNOWN_COMMIT_RC=$?"
        show unknown
        preflight_generation_bundle_cleanup
        PREFLIGHT_BUNDLE_GENERATION_BOUND=0
        {select}
        for bad in HEAD "{state["b"][:12]}" "{state["b"].upper()}" ""; do
          bind_preflight_bundle_to_generation "$REPO" "$bad" target; echo "BAD_SHA_RC=$?"
        done
        bind_preflight_bundle_to_generation "$REPO" "{state["b"]}" acceptance; echo "BAD_ROLE_RC=$?"
        bind_preflight_bundle_to_generation "$REPO" "{state["b"]}"; echo "NO_ROLE_RC=$?"
        show refused
    ''')
    out = result.stdout + result.stderr
    assert "NO_BUNDLE_RC=66" in out and "UNKNOWN_COMMIT_RC=66" in out, out
    assert f"FATAL: generation {state['none']} carries no complete release-preflight bundle" in out
    for label in ("nobundle", "unknown"):
        assert shown(result, label)[:4] == ["", "", "", ""], out
    # nothing is selected, so nothing can be executed either
    assert "EMPTY_SELECTION_RC=64" in out, out
    assert out.count("BAD_SHA_RC=64") == 4 and "BAD_ROLE_RC=64" in out and "NO_ROLE_RC=64" in out
    # argument refusals happen before anything is withdrawn or allocated
    assert shown(result, "refused")[3] == state["da"]
    assert list(state["bundles"].iterdir()) == []


def test_execution_guard_still_refuses_a_bound_policy_that_changes(tmp_path):
    """The digest check is unchanged and still load-bearing for a bound bundle."""
    state = bundle_repository(tmp_path)
    git(state["repo"], "reset", "-q", "--hard", state["a"])
    result = bind_lib(state, f'''
        select_preflight_artifacts {os.getuid()} "$REPO/ops"
        bind_preflight_bundle_to_generation "$REPO" "{state["b"]}" target; echo "BIND_RC=$?"
        chmod u+w "$PREFLIGHT_POLICY"
        printf '{{"schema": "fixture", "generation": "tampered"}}\\n' > "$PREFLIGHT_POLICY"
        run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "$REPO" "{tmp_path}/absent/receipts"
        echo "GUARD_RC=$?"
        echo "PIN=$PREFLIGHT_POLICY_DIGEST"
    ''')
    out = result.stdout + result.stderr
    assert "BIND_RC=0" in out and "GUARD_RC=64" in out and GUARD_REFUSAL in out, out
    assert f"PIN={state['db']}" in out      # the refusal does not adopt the new digest


def test_cleanup_removes_only_this_runs_own_private_directories(tmp_path):
    state = bundle_repository(tmp_path)
    git(state["repo"], "reset", "-q", "--hard", state["a"])
    keep = tmp_path / "keep"
    keep.mkdir()
    (keep / "evidence").write_text("retained\n")
    foreign = state["bundles"] / "terminal-build-generation-bundle.FOREIGN"
    foreign.mkdir()
    link = state["bundles"] / "terminal-build-generation-bundle.LINKED"
    link.symlink_to(keep)
    result = bind_lib(state, f'''
        select_preflight_artifacts {os.getuid()} "$REPO/ops"
        bind_preflight_bundle_to_generation "$REPO" "{state["b"]}" target
        echo "OWN=${{PREFLIGHT_GENERATION_BUNDLE_DIRS[0]}}"
        PREFLIGHT_GENERATION_BUNDLE_DIRS+=("{keep}" "{link}" "{state["bundles"]}/terminal-build-generation-bundle.absent" "/")
        preflight_generation_bundle_cleanup; echo "CLEAN_RC=$?"
        echo "LEFT=${{#PREFLIGHT_GENERATION_BUNDLE_DIRS[@]}}"
    ''')
    out = result.stdout + result.stderr
    assert "CLEAN_RC=0" in out and "LEFT=0" in out, out
    own = Path(next(line for line in out.splitlines() if line.startswith("OWN=")).split("=", 1)[1])
    assert not own.exists()
    assert (keep / "evidence").read_text() == "retained\n"
    assert link.is_symlink() and foreign.is_dir()


def test_owner_binds_every_checkout_movement_that_precedes_an_audit() -> None:
    text = SCRIPT.read_text(encoding="utf-8")
    deploy = text[text.index("# 0b) canonical checkout, the trusted preflight bundle"):]
    ordinary = deploy[:deploy.index('elif [ "$BOOTSTRAP_REQUESTED" = 1 ]; then')]
    bootstrap_branch = deploy[len(ordinary):deploy.index("  beta_recovery_check || exit $?")]
    recovered = ('recover_canonical_head_mismatch "$SRC" "$DEPLOYMENT_MARKER" || exit $?')
    current = 'bind_preflight_bundle_to_generation "$SRC" "$PREFLIGHT_ACCEPTED_SHA" current || exit $?'
    target = 'bind_preflight_bundle_to_generation "$SRC" "$TARGET_SHA" target || exit $?'
    for branch in (ordinary, bootstrap_branch):
        # canonical-head recovery -> bind the restored generation -> second audit
        assert branch.count(recovered) == 1 and branch.count(current) == 1
        after = branch[branch.index(recovered):]
        assert after.index(current) < after.index("run_release_preflight ")
        # admitted target -> bind it -> only then move the checkout
        assert branch.count(target) == 1
        assert (branch.index("admit_target_sha ") < branch.index(target)
                < branch.index('reset -q --hard "$TARGET_SHA"'))
    # production never audits after its target reset; only beta binds the target
    before_target = ordinary[:ordinary.index(target)]
    assert before_target.rstrip().splitlines()[-4].strip() == 'if [ "$TARGET" = beta ]; then'
    # the restoration audit uses the bundle selected for the prior generation
    abort = text[text.index("beta_txn_abort(){"):text.index("beta_txn_commit(){")]
    assert (abort.index("restore_current_generation_preflight_bundle || rc=1")
            < abort.index('run_release_preflight "$PREFLIGHT_SCRIPT"'))
    # the refusal and its guard are present exactly once and unconditional
    assert text.count(GUARD_REFUSAL) == 1
    assert text.count(f'fail("{CAPTURE_REFUSAL}")') == 1
