"""Source preparation only: real release library, hermetic observation seams."""
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "ops/investigation-open-preflight.sh"
SHA = "a" * 40


def run_fixture(extra="", sha=SHA):
    # Every host-facing incumbent seam is replaced after sourcing; no host,
    # API, SQL, flags, service or production path is touched by this fixture.
    body = f'''
    . "{SCRIPT}"
    set +e
    select_release_target() {{ [ "$1" = beta ]; TARGET=beta; SRC=/fixture/repo; }}
    sanitize_git_environment() {{ :; }}
    git() {{
      case "$*" in
        "-C /fixture/repo merge-base --is-ancestor {SHA} refs/remotes/origin/master"|"-C /fixture/repo cat-file -e {SHA}:terminal/lib/investigationApiAdmission.ts") return 0;;
        *) return 1;;
      esac
    }}
    beta_ordinary_deploy_gate() {{
      BETA_PRIOR_SHA={SHA}; BETA_PRIOR_BUILD=fixture-build;
      BETA_PRIOR_RECORD_ID={'b' * 64};
    }}
    require_investigation_closed_after_start() {{
      [ "$1" = {SHA} ] && [ "$2" = fixture-build ];
    }}
    {extra}
    investigation_open_preflight beta "{sha}"
    '''
    return subprocess.run(["bash", "-c", body], capture_output=True, text=True, timeout=10)


def test_valid_incumbent_installation_reports_source_gaps_without_open():
    result = run_fixture()
    assert result.returncode == 78
    report = json.loads(result.stdout)
    assert report["status"] == "SOURCE_PREPARATION"
    assert report["open_transaction_implemented"] is False
    assert report["installed_sha"] == SHA
    assert report["missing_source_contracts"] == [
        "all-ingress-direct-rpc-drain-observer",
        "original-operation-inventory-and-live-receipt-binding",
        "lawfully-admitted-schema-grants-receipt-verifier",
        "unified-open-adoption-and-recovery-transaction",
    ]


def test_pending_or_unknown_installation_never_becomes_admission():
    result = run_fixture("beta_ordinary_deploy_gate() { return 75; }")
    assert result.returncode == 75 and not result.stdout


def test_mismatched_installed_target_refuses():
    result = run_fixture("beta_ordinary_deploy_gate() { BETA_PRIOR_SHA=" + "c" * 40 + "; }")
    assert result.returncode == 65 and not result.stdout


def test_current_source_containment_is_required():
    result = run_fixture("git() { return 1; }")
    assert result.returncode == 65 and not result.stdout


def test_old_target_without_common_primitive_refuses():
    result = run_fixture('git() { [ "$3" != cat-file ]; }')
    assert result.returncode == 65 and not result.stdout


def test_open_or_unknown_process_configuration_refuses():
    result = run_fixture("require_investigation_closed_after_start() { return 65; }")
    assert result.returncode == 65 and not result.stdout


def test_no_production_or_arbitrary_profile():
    result = subprocess.run(["bash", str(SCRIPT), "--target", "production", "--target-sha", SHA], capture_output=True, text=True)
    assert result.returncode == 64 and not result.stdout


def test_no_ready_json_override_or_activation_entrance():
    result = subprocess.run(["bash", str(SCRIPT), "--target", "beta", "--target-sha", SHA, "--ready=true"], capture_output=True, text=True)
    assert result.returncode == 64 and not result.stdout


def test_invalid_target_has_no_observer_calls():
    result = run_fixture("select_release_target() { echo FORBIDDEN; return 99; }", "not-a-sha")
    assert result.returncode == 64 and "FORBIDDEN" not in result.stdout
