"""Hostile contract for the deployment-identity rollback in ops/terminal-build.sh.

THE DEFECT THIS PINS (release integrity, not logging cosmetics)
--------------------------------------------------------------
`ops/terminal-build.sh` installs the new `.deployment-id` BEFORE it swaps `.next`.
When the post-restart health check fails it restores `.next.bak` — and nothing else.
After that automatic rollback the box is left in an incoherent state:

    live build      = the OLD one (restored from .next.bak)
    .gitsrc HEAD    = the NEW commit
    .deployment-id  = the NEW commit

Only `.next/BUILD_ID` still witnesses what is actually being served. Any verifier
that trusts "source HEAD == .deployment-id" therefore CERTIFIES A DEPLOY THAT WAS
ROLLED BACK. That is the bug; these tests exist so it cannot come back.

WHAT IS ASSERTED
----------------
The marker and the build move as ONE deploy generation, and deployment verification
fails closed unless all THREE identities agree: the intended full Git SHA, the live
`.deployment-id`, and the live `.next/BUILD_ID`.

HERMETIC BY CONSTRUCTION
------------------------
`ops/terminal-build.sh` hardcodes /opt/terminal, so the rollback state machine is
sourced — not executed — and driven against a temporary directory. The seam is
sourced-ness itself, never an environment variable: a variable could be inherited
into a real root deploy and turn it into a silent `exit 0`. Nothing here contacts the
VPS, SSH, systemd, GitHub, Supabase or the public site, and nothing reads or writes
any real deploy root.

Structure is not trusted on its own: the static tests below assert the deploy body
performs no raw `$APP/.deployment-id` mutation outside the generation functions, so
re-inlining the original defect fails this contract. The two mutation tests prove the
restoration and the BUILD_ID comparison are load-bearing rather than decorative.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "ops" / "terminal-build.sh"

OLD_SHA = "1111111111111111111111111111111111111111"
NEW_SHA = "2222222222222222222222222222222222222222"
OLD_BUILD_ID = "build-OLDoldOLDoldOL"
NEW_BUILD_ID = "build-NEWnewNEWnewNE"


# `bash` is present on every CI runner and on macOS. Requiring it rather than
# skipping is deliberate: a skip here would turn this whole contract into a silent
# no-op and the job would go green having proven nothing.
def _bash() -> str:
    found = shutil.which("bash")
    assert found, "bash is required to exercise the deploy contract"
    return found


def run_gen(script: Path, body: str) -> subprocess.CompletedProcess:
    """Source the deploy script as a library and run `body` against it."""
    driver = textwrap.dedent(
        f"""
        . "{script}"
        set +e            # the script sets -e; the driver tests failure paths on purpose
        {textwrap.dedent(body)}
        """
    )
    return subprocess.run(
        [_bash(), "-c", driver], capture_output=True, text=True, timeout=60
    )


def make_app(tmp_path: Path, marker: str | None, marker_mode: int = 0o644,
             build_id: str | None = None) -> Path:
    app = tmp_path / "app"
    app.mkdir(exist_ok=True)
    if marker is not None:
        m = app / ".deployment-id"
        m.write_text(marker + "\n")
        m.chmod(marker_mode)
    if build_id is not None:
        nxt = app / ".next"
        nxt.mkdir()
        (nxt / "BUILD_ID").write_text(build_id + "\n")
    return app


def staged_marker(tmp_path: Path, sha: str) -> Path:
    p = tmp_path / "staged-deployment-id"
    p.write_text(sha + "\n")
    return p


def simulate_swap(app: Path, new_build_id: str) -> None:
    """The step-6 atomic swap: current .next -> .next.bak, new build -> .next."""
    nxt = app / ".next"
    if nxt.exists():
        nxt.rename(app / ".next.bak")
    nxt.mkdir()
    (nxt / "BUILD_ID").write_text(new_build_id + "\n")


def marker_of(app: Path) -> str | None:
    m = app / ".deployment-id"
    return m.read_text().strip() if m.exists() else None


def live_build_id(app: Path) -> str | None:
    b = app / ".next" / "BUILD_ID"
    return b.read_text().strip() if b.exists() else None


def artifacts(app: Path) -> list[str]:
    return sorted(
        p.name for p in app.iterdir()
        if p.name in (".deployment-id.bak", ".deployment-id.absent", ".deployment-id.new")
    )


# --------------------------------------------------------------------------
# the sourceable seam
# --------------------------------------------------------------------------

def test_sourcing_does_not_run_the_deploy():
    """Sourcing must expose the state machine without deploying anything."""
    r = run_gen(SCRIPT, 'echo SOURCED_OK')
    assert r.returncode == 0, f"sourcing failed:\n{r.stdout}\n{r.stderr}"
    assert "SOURCED_OK" in r.stdout
    # No step of the real deploy may have run.
    assert "[build]" not in r.stdout, f"deploy body executed while sourcing:\n{r.stdout}"


def test_generation_contract_is_exposed():
    r = run_gen(SCRIPT, """
        for fn in deploy_generation_reset deploy_generation_begin \\
                  deploy_generation_commit deploy_generation_rollback \\
                  deploy_identity_verified deploy_generation_abort; do
          type -t "$fn" >/dev/null || { echo "MISSING:$fn"; exit 1; }
        done
        echo ALL_PRESENT
    """)
    assert "ALL_PRESENT" in r.stdout, f"contract not exposed:\n{r.stdout}\n{r.stderr}"


# --------------------------------------------------------------------------
# the rollback-state matrix required by issue #503
# --------------------------------------------------------------------------

def test_healthy_deploy_keeps_new_identity_and_clears_artifacts(tmp_path):
    app = make_app(tmp_path, OLD_SHA, build_id=OLD_BUILD_ID)
    new = staged_marker(tmp_path, NEW_SHA)
    r = run_gen(SCRIPT, f"""
        deploy_generation_begin "{app}" "{new}"
        deploy_generation_commit "{app}"
    """)
    assert r.returncode == 0, r.stderr
    assert marker_of(app) == NEW_SHA
    assert artifacts(app) == [], f"rollback artifacts survived a healthy deploy: {artifacts(app)}"


def test_rollback_with_prior_marker_restores_exact_bytes_and_metadata(tmp_path):
    """Failed health, prior marker present: old build AND old marker come back."""
    app = make_app(tmp_path, OLD_SHA, marker_mode=0o640, build_id=OLD_BUILD_ID)
    new = staged_marker(tmp_path, NEW_SHA)

    r = run_gen(SCRIPT, f'deploy_generation_begin "{app}" "{new}"')
    assert r.returncode == 0, r.stderr
    assert marker_of(app) == NEW_SHA, "begin must install the new marker"

    simulate_swap(app, NEW_BUILD_ID)

    r = run_gen(SCRIPT, f'deploy_generation_rollback "{app}" 1; echo "RC=$?"')
    assert "RC=0" in r.stdout, f"rollback reported unresolved:\n{r.stdout}\n{r.stderr}"

    # This is the assertion the shipped script fails today.
    assert marker_of(app) == OLD_SHA, (
        "marker was NOT restored — a rolled-back deploy still advertises the new commit"
    )
    assert live_build_id(app) == OLD_BUILD_ID, "old build was not restored"
    assert os.stat(app / ".deployment-id").st_mode & 0o777 == 0o640, (
        "marker metadata was not preserved by the snapshot"
    )
    assert artifacts(app) == [], f"rollback artifacts leaked: {artifacts(app)}"


def test_rollback_without_prior_marker_removes_the_new_marker(tmp_path):
    """Failed health, no prior marker: the marker must end up ABSENT, not new."""
    app = make_app(tmp_path, None, build_id=OLD_BUILD_ID)
    new = staged_marker(tmp_path, NEW_SHA)

    r = run_gen(SCRIPT, f'deploy_generation_begin "{app}" "{new}"')
    assert r.returncode == 0, r.stderr
    assert (app / ".deployment-id.absent").exists(), "absent sentinel not recorded"

    simulate_swap(app, NEW_BUILD_ID)
    r = run_gen(SCRIPT, f'deploy_generation_rollback "{app}" 1; echo "RC=$?"')
    assert "RC=0" in r.stdout, f"rollback reported unresolved:\n{r.stdout}\n{r.stderr}"

    assert marker_of(app) is None, (
        "a marker was invented for a build that never successfully deployed"
    )
    assert live_build_id(app) == OLD_BUILD_ID
    assert artifacts(app) == []


def test_swap_failure_after_marker_replacement_restores_marker(tmp_path):
    """Marker already replaced, new build never activated: still coherent."""
    app = make_app(tmp_path, OLD_SHA, build_id=OLD_BUILD_ID)
    new = staged_marker(tmp_path, NEW_SHA)

    r = run_gen(SCRIPT, f"""
        deploy_generation_begin "{app}" "{new}"
        deploy_generation_rollback "{app}" 0; echo "RC=$?"
    """)
    assert "RC=0" in r.stdout, f"{r.stdout}\n{r.stderr}"
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID, "untouched live build must stay untouched"
    assert artifacts(app) == []


def test_restart_health_failure_after_activation_restores_both(tmp_path):
    app = make_app(tmp_path, OLD_SHA, build_id=OLD_BUILD_ID)
    new = staged_marker(tmp_path, NEW_SHA)

    run_gen(SCRIPT, f'deploy_generation_begin "{app}" "{new}"')
    simulate_swap(app, NEW_BUILD_ID)
    r = run_gen(SCRIPT, f'deploy_generation_rollback "{app}" 1; echo "RC=$?"')

    assert "RC=0" in r.stdout, f"{r.stdout}\n{r.stderr}"
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID
    # the failed build is kept for diagnosis, not silently destroyed
    assert (app / ".next.broken" / "BUILD_ID").read_text().strip() == NEW_BUILD_ID


def test_stale_artifacts_are_purged_without_destroying_the_live_marker(tmp_path):
    """An interrupted prior attempt must not poison the next deploy's rollback."""
    app = make_app(tmp_path, OLD_SHA, build_id=OLD_BUILD_ID)
    (app / ".deployment-id.bak").write_text("dead-sha-from-an-interrupted-run\n")
    (app / ".deployment-id.absent").write_text("")
    (app / ".deployment-id.new").write_text("another-dead-sha\n")
    new = staged_marker(tmp_path, NEW_SHA)

    r = run_gen(SCRIPT, f'deploy_generation_begin "{app}" "{new}"')
    assert r.returncode == 0, r.stderr

    assert marker_of(app) == NEW_SHA, "the valid live marker was destroyed by the purge"
    assert (app / ".deployment-id.bak").read_text().strip() == OLD_SHA, (
        "stale .bak was reused as the rollback record — rollback would restore a dead SHA"
    )
    assert not (app / ".deployment-id.absent").exists(), (
        "stale absent sentinel survived; rollback would delete a valid marker"
    )
    assert not (app / ".deployment-id.new").exists()


def test_rollback_reports_unresolved_when_the_record_is_gone(tmp_path):
    """Restoration failure must be reported, never dressed up as a clean rollback."""
    app = make_app(tmp_path, OLD_SHA, build_id=OLD_BUILD_ID)
    new = staged_marker(tmp_path, NEW_SHA)

    run_gen(SCRIPT, f'deploy_generation_begin "{app}" "{new}"')
    simulate_swap(app, NEW_BUILD_ID)
    (app / ".deployment-id.bak").unlink()          # rollback record destroyed

    r = run_gen(SCRIPT, f'deploy_generation_rollback "{app}" 1; echo "RC=$?"')
    assert "RC=1" in r.stdout, (
        "rollback claimed success while the identity state was unrecoverable"
    )


def test_rollback_after_a_swap_with_no_previous_build_is_not_success(tmp_path):
    """"Nothing to restore" must never be reported as "restored".

    Reachable on a bootstrap deploy, and whenever an earlier run died between the
    marker install and the swap: the next run's `rm -rf .next.bak` destroys the last
    good build, so no .next.bak is created. If rollback returned 0 here the box would
    keep serving the build that just FAILED its health check while the log claimed a
    clean rollback — the inverse of the defect this branch fixes.
    """
    app = make_app(tmp_path, None, build_id=None)
    new = staged_marker(tmp_path, NEW_SHA)

    run_gen(SCRIPT, f'deploy_generation_begin "{app}" "{new}"')
    (app / ".next").mkdir()                       # the new build swapped in
    (app / ".next" / "BUILD_ID").write_text(NEW_BUILD_ID + "\n")

    r = run_gen(SCRIPT, f'deploy_generation_rollback "{app}" 1; echo "RC=$?"')
    assert "RC=1" in r.stdout, (
        "rollback reported success with no previous build to return to — the failing "
        f"build is still live:\n{r.stdout}\n{r.stderr}"
    )
    assert live_build_id(app) == NEW_BUILD_ID, "sanity: the failing build is indeed still live"


def test_pre_swap_rollback_with_no_previous_build_is_success(tmp_path):
    """The mirror case: nothing was swapped, so nothing needs restoring."""
    app = make_app(tmp_path, OLD_SHA, build_id=OLD_BUILD_ID)
    new = staged_marker(tmp_path, NEW_SHA)
    run_gen(SCRIPT, f'deploy_generation_begin "{app}" "{new}"')
    r = run_gen(SCRIPT, f'deploy_generation_rollback "{app}" 0; echo "RC=$?"')
    assert "RC=0" in r.stdout, f"{r.stdout}\n{r.stderr}"
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID


def test_rollback_reports_that_the_live_build_moved(tmp_path):
    """The caller must be able to tell a restart is mandatory.

    `next start` resolves .next/* at request time, so a server left bound to a
    renamed tree serves the restored build's chunks against the failed build's
    in-memory manifests. The restart cannot be conditional on the identity being
    resolvable.
    """
    app = make_app(tmp_path, OLD_SHA, build_id=OLD_BUILD_ID)
    new = staged_marker(tmp_path, NEW_SHA)
    run_gen(SCRIPT, f'deploy_generation_begin "{app}" "{new}"')
    simulate_swap(app, NEW_BUILD_ID)
    (app / ".deployment-id.bak").unlink()          # force the unresolved path

    r = run_gen(SCRIPT, f"""
        deploy_generation_rollback "{app}" 1; rc=$?
        echo "RC=$rc MOVED=$DEPLOY_ROLLBACK_MOVED_BUILD"
    """)
    assert "RC=1 MOVED=1" in r.stdout, (
        "an unresolved rollback that already moved .next must still demand a restart:\n"
        f"{r.stdout}\n{r.stderr}"
    )


def test_deploy_restarts_whenever_the_build_moved_even_if_unresolved():
    """Static: the restart must not sit inside the resolved-only branch."""
    lib = _library()
    guard = lib.index('if [ "$DEPLOY_ROLLBACK_MOVED_BUILD" = 1 ]')
    restart = lib.index("systemctl restart terminal", guard)
    resolved = lib.index('if [ "$rc" = 0 ]')
    assert restart < resolved, (
        "the rollback restart is gated on the identity being resolved; an unresolved "
        "rollback would leave the server bound to a directory that moved"
    )


# --------------------------------------------------------------------------
# the fail-closed three-identity gate
# --------------------------------------------------------------------------

def test_identity_gate_accepts_only_full_agreement(tmp_path):
    app = make_app(tmp_path, NEW_SHA, build_id=NEW_BUILD_ID)
    r = run_gen(SCRIPT,
                f'deploy_identity_verified "{app}" "{NEW_SHA}" "{NEW_BUILD_ID}"; echo "RC=$?"')
    assert "RC=0" in r.stdout, f"a fully coherent deploy was rejected:\n{r.stdout}\n{r.stderr}"


def test_identity_gate_rejects_stale_build_id(tmp_path):
    """The gate must reject on the BUILD_ID leg alone when the marker agrees.

    Note this state is not reachable in production: with deploymentId set, BUILD_ID is
    a constant literal, so the leg is a completeness check on .next rather than a
    generation discriminator. It is pinned because it must stay correct if
    deploymentId is ever removed.
    """
    app = make_app(tmp_path, NEW_SHA, build_id=OLD_BUILD_ID)
    r = run_gen(SCRIPT,
                f'deploy_identity_verified "{app}" "{NEW_SHA}" "{NEW_BUILD_ID}"; echo "RC=$?"')
    assert "RC=1" in r.stdout, (
        "verification passed on marker agreement alone while a rolled-back build was live"
    )


def test_identity_gate_rejects_a_rolled_back_generation(tmp_path):
    """End-to-end: the state the old script certified as a successful deploy.

    This is the acceptance test for the whole repair. Note the BUILD_ID passed in is
    the one the *new* build would have — under Next 16.2.9 with deploymentId set,
    .next/BUILD_ID is a constant literal, so it is identical for the old and new
    build and cannot discriminate them. The rejection therefore has to come from the
    restored marker, which is precisely what this change makes trustworthy.
    """
    app = make_app(tmp_path, OLD_SHA, build_id=NEW_BUILD_ID)
    new = staged_marker(tmp_path, NEW_SHA)

    run_gen(SCRIPT, f'deploy_generation_begin "{app}" "{new}"')
    simulate_swap(app, NEW_BUILD_ID)
    run_gen(SCRIPT, f'deploy_generation_rollback "{app}" 1')

    r = run_gen(SCRIPT,
                f'deploy_identity_verified "{app}" "{NEW_SHA}" "{NEW_BUILD_ID}"; echo "RC=$?"')
    assert "RC=1" in r.stdout, (
        "a rolled-back deploy was certified as successful — the P0 defect is back"
    )


def test_identity_gate_rejects_marker_mismatch(tmp_path):
    app = make_app(tmp_path, OLD_SHA, build_id=NEW_BUILD_ID)
    r = run_gen(SCRIPT,
                f'deploy_identity_verified "{app}" "{NEW_SHA}" "{NEW_BUILD_ID}"; echo "RC=$?"')
    assert "RC=1" in r.stdout


def test_identity_gate_rejects_missing_build_id(tmp_path):
    app = make_app(tmp_path, NEW_SHA)
    r = run_gen(SCRIPT,
                f'deploy_identity_verified "{app}" "{NEW_SHA}" "{NEW_BUILD_ID}"; echo "RC=$?"')
    assert "RC=1" in r.stdout


def test_identity_gate_rejects_missing_marker(tmp_path):
    app = make_app(tmp_path, None, build_id=NEW_BUILD_ID)
    r = run_gen(SCRIPT,
                f'deploy_identity_verified "{app}" "{NEW_SHA}" "{NEW_BUILD_ID}"; echo "RC=$?"')
    assert "RC=1" in r.stdout


# --------------------------------------------------------------------------
# mutation kills — proof the logic above is load-bearing, not decorative
# --------------------------------------------------------------------------

def _mutate(tmp_path: Path, anchor: str, replacement: str) -> Path:
    text = SCRIPT.read_text()
    assert anchor in text, (
        f"mutation anchor vanished from ops/terminal-build.sh:\n{anchor!r}\n"
        "The mutation test cannot silently pass — update the anchor with the code."
    )
    mutant = tmp_path / "mutant-terminal-build.sh"
    mutant.write_text(text.replace(anchor, replacement, 1))
    mutant.chmod(0o755)
    return mutant


def test_mutant_without_marker_restoration_is_caught(tmp_path):
    """Delete the marker restoration -> the original defect must reappear."""
    mutant = _mutate(
        tmp_path,
        'mv -f "$app/.deployment-id.bak" "$app/.deployment-id"',
        ':  # MUTANT: marker restoration removed',
    )
    app = make_app(tmp_path, OLD_SHA, build_id=OLD_BUILD_ID)
    new = staged_marker(tmp_path, NEW_SHA)

    run_gen(mutant, f'deploy_generation_begin "{app}" "{new}"')
    simulate_swap(app, NEW_BUILD_ID)
    run_gen(mutant, f'deploy_generation_rollback "{app}" 1')

    # The mutant reproduces the exact production bug: old build, new marker.
    assert live_build_id(app) == OLD_BUILD_ID
    assert marker_of(app) == NEW_SHA, (
        "mutation was inert — the marker-restoration assertions are not load-bearing"
    )


def test_mutant_accepting_marker_only_agreement_is_caught(tmp_path):
    """Drop the BUILD_ID comparison -> the gate must stop rejecting on that leg.

    This proves the comparison is wired in, not that it discriminates builds in
    production — with deploymentId set it cannot. See test_identity_gate_rejects_stale_build_id.
    """
    mutant = _mutate(
        tmp_path,
        '[ "$live_build" = "$want_build" ]',
        'true  # MUTANT: BUILD_ID agreement no longer required',
    )
    app = make_app(tmp_path, NEW_SHA, build_id=OLD_BUILD_ID)
    r = run_gen(mutant,
                f'deploy_identity_verified "{app}" "{NEW_SHA}" "{NEW_BUILD_ID}"; echo "RC=$?"')
    assert "RC=0" in r.stdout, (
        "mutation was inert — the BUILD_ID readback is not actually gating verification"
    )


# --------------------------------------------------------------------------
# integration: the EXECUTED deploy flow, not just the library in isolation
# --------------------------------------------------------------------------
#
# Unit-testing the generation functions proves they are correct WHEN CALLED. It says
# nothing about whether the deploy actually reaches them. Under `set -euo pipefail` a
# bare failing command aborts the script instantly, so a failed swap `mv` or a failed
# `systemctl restart` terminated the deploy with the marker already advanced (step 5)
# and .next possibly displaced — rollback never ran at all. That is an orchestration
# defect invisible to every unit test above, so these drive the real body.
#
# Hermetic by construction and WITHOUT adding any production seam: the script keeps
# its hardcoded /opt/terminal paths, and the test executes a rewritten COPY pointed at
# a temp sandbox, with git/npm/node/systemctl/curl/sleep/mv shimmed onto PATH. Every
# absolute path is rewritten, so even a runaway run cannot touch a real deploy root.

SHIMS = {
    "node": "#!/bin/sh\necho v20.0.0\n",
    "git": '#!/bin/sh\ncase "$*" in *rev-parse*) echo "$FAKE_SHA" ;; esac\nexit 0\n',
    "npm": (
        '#!/bin/sh\n'
        'if [ "$1" = run ] && [ "$2" = build ]; then\n'
        '  mkdir -p .next && printf "%s\\n" "$FAKE_BUILD_ID" > .next/BUILD_ID\n'
        'fi\nexit 0\n'
    ),
    "systemctl": (
        '#!/bin/sh\n'
        '[ -n "${FAIL_RESTART:-}" ] && { echo "systemctl: simulated failure" >&2; exit 1; }\n'
        'exit 0\n'
    ),
    "curl": '#!/bin/sh\n[ -n "${FAIL_HEALTH:-}" ] && exit 22\nexit 0\n',
    "sleep": "#!/bin/sh\nexit 0\n",
    "mv": (
        '#!/bin/sh\n'
        'if [ -n "${FAIL_MV_MATCH:-}" ]; then\n'
        '  case "$*" in *"$FAIL_MV_MATCH"*) echo "mv: simulated failure: $*" >&2; exit 1 ;; esac\n'
        'fi\nexec /bin/mv "$@"\n'
    ),
}


def run_deploy(tmp_path: Path, script: Path = SCRIPT, **flags) -> tuple:
    """Execute a sandboxed copy of the real deploy script. Returns (proc, app)."""
    # NOT named "opt": the post-rewrite guard below greps for /opt/terminal, and a
    # sandbox ending in /opt would make the rewritten text match it spuriously.
    root = tmp_path / "deployroot"
    app, src = root / "terminal", root / ".gitsrc"
    tsrc = src / "terminal"
    usrbin = tmp_path / "usrbin"
    for d in (app / "node_modules", app / "public" / "data", tsrc, src / ".git", usrbin):
        d.mkdir(parents=True, exist_ok=True)
    # identical lockfiles so the deploy skips `npm ci`
    (app / "package-lock.json").write_text("lock\n")
    (tsrc / "package-lock.json").write_text("lock\n")
    (tsrc / "package.json").write_text("{}\n")
    (app / "node_modules" / "marker").write_text("x")
    # the PREVIOUS generation that a rollback must restore
    (app / ".next").mkdir()
    (app / ".next" / "BUILD_ID").write_text(OLD_BUILD_ID + "\n")
    (app / ".deployment-id").write_text(OLD_SHA + "\n")

    text = script.read_text()
    assert "/opt/terminal/" in text, "deploy root anchor vanished — cannot sandbox"
    text = text.replace("/usr/local/bin", str(usrbin)).replace("/opt/terminal/", f"{root}/")
    assert "/opt/terminal" not in text, "a real deploy path survived the rewrite"
    copy = tmp_path / "sandboxed-terminal-build.sh"
    copy.write_text(text)
    copy.chmod(0o755)

    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    for name, body in SHIMS.items():
        s = bindir / name
        s.write_text(body)
        s.chmod(0o755)

    env = dict(os.environ)
    env.update({
        "PATH": f"{bindir}:{env['PATH']}",
        "FAKE_SHA": NEW_SHA,
        "FAKE_BUILD_ID": NEW_BUILD_ID,
    })
    env.update({k: str(v) for k, v in flags.items()})
    proc = subprocess.run(
        [_bash(), str(copy)], capture_output=True, text=True, timeout=180, env=env
    )
    return proc, app


def test_swap_move_failure_enters_rollback(tmp_path):
    """A failed `mv` of the new build must NOT abort past rollback.

    The marker was already advanced in step 5 and the old .next has already been moved
    aside, so a bare `set -e` abort here leaves the box with the NEW commit's marker and
    no live build at all — strictly worse than the defect this branch set out to fix.
    """
    proc, app = run_deploy(tmp_path, FAIL_MV_MATCH=".stage.")

    assert proc.returncode != 0, "a failed swap reported success"
    assert marker_of(app) == OLD_SHA, (
        "marker still advertises the commit that never went live — the deploy aborted "
        f"without rolling back:\n{proc.stdout}\n{proc.stderr}"
    )
    assert live_build_id(app) == OLD_BUILD_ID, (
        f"the previous build was not restored:\n{proc.stdout}\n{proc.stderr}"
    )
    assert "rolling back" in proc.stdout.lower(), (
        f"rollback never ran:\n{proc.stdout}\n{proc.stderr}"
    )


def test_restart_failure_enters_rollback(tmp_path):
    """`systemctl restart` failing must route into rollback, not abort the script."""
    proc, app = run_deploy(tmp_path, FAIL_RESTART="1")

    assert proc.returncode != 0, "a failed restart reported success"
    assert "rolling back" in proc.stdout.lower(), (
        f"rollback never ran after a failed restart:\n{proc.stdout}\n{proc.stderr}"
    )
    assert marker_of(app) == OLD_SHA, (
        "marker was left advanced after a restart that never succeeded:\n"
        f"{proc.stdout}\n{proc.stderr}"
    )
    assert live_build_id(app) == OLD_BUILD_ID


def test_health_failure_enters_rollback_end_to_end(tmp_path):
    """The path that already worked, now pinned against the executed flow."""
    proc, app = run_deploy(tmp_path, FAIL_HEALTH="1")

    assert proc.returncode != 0
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID
    assert "rolling back" in proc.stdout.lower()


def test_restart_failure_reports_unresolved_not_clean(tmp_path):
    """If the service cannot be restarted at all, the box is not provably serving
    anything — say so rather than logging a tidy rollback."""
    proc, _ = run_deploy(tmp_path, FAIL_RESTART="1")
    assert "UNRESOLVED" in proc.stdout, (
        f"a deploy that could never restart the service claimed a clean rollback:\n{proc.stdout}"
    )


def test_mutant_unguarded_swap_move_is_caught(tmp_path):
    """Remove the swap guard -> the abort-without-rollback defect must come back."""
    mutant = _mutate(
        tmp_path,
        'if ! mv "$STAGE/.next" "$APP/.next"; then',
        'mv "$STAGE/.next" "$APP/.next"  # MUTANT: unguarded, set -e aborts\nif false; then',
    )
    proc, app = run_deploy(tmp_path, script=mutant, FAIL_MV_MATCH=".stage.")
    assert proc.returncode != 0
    assert marker_of(app) == NEW_SHA, (
        "mutation was inert — the swap guard is not what routes a failed move into rollback"
    )


def test_mutant_unguarded_restart_is_caught(tmp_path):
    """Remove the restart guard -> `set -e` must abort before rollback again."""
    mutant = _mutate(
        tmp_path,
        'if ! systemctl restart terminal; then',
        'systemctl restart terminal  # MUTANT: unguarded, set -e aborts\nif false; then',
    )
    proc, app = run_deploy(tmp_path, script=mutant, FAIL_RESTART="1")
    assert proc.returncode != 0
    assert marker_of(app) == NEW_SHA, (
        "mutation was inert — the restart guard is not what routes a failed restart "
        "into rollback"
    )


# --------------------------------------------------------------------------
# static structure: the defect must not be re-inlined later
# --------------------------------------------------------------------------

def _library() -> str:
    """Everything BEFORE the sourced-ness guard: the generation state machine."""
    text = SCRIPT.read_text()
    return text[: text.rindex('if [ "${BASH_SOURCE[0]}" != "$0" ]')]


def _deploy_body(code_only: bool = False) -> str:
    """Everything after the sourced-ness guard. code_only strips comment lines, so a
    passing mention of a function name in prose can never satisfy an ordering test."""
    text = SCRIPT.read_text()
    body = text[text.rindex('if [ "${BASH_SOURCE[0]}" != "$0" ]'):]
    if code_only:
        body = "\n".join(l for l in body.splitlines() if not l.lstrip().startswith("#"))
    return body


def test_script_syntax_is_valid():
    r = subprocess.run([_bash(), "-n", str(SCRIPT)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_deploy_body_never_mutates_the_marker_directly():
    """All marker writes go through the generation functions, which own rollback."""
    body = _deploy_body(code_only=True)
    assert not re.search(r"\$\{?APP\}?/\.deployment-id", body), (
        "the deploy body mutates $APP/.deployment-id directly; that is exactly how the "
        "marker escaped rollback in the first place"
    )


def test_every_failure_path_routes_through_the_single_abort():
    """No failure may reach `exit` without passing through deploy_generation_abort.

    A second, ad-hoc rollback path is how the swap and restart aborts came to bypass
    rollback in the first place.
    """
    body = _deploy_body(code_only=True)
    assert "deploy_generation_abort" in body, "the deploy has no guarded failure exit"
    assert "deploy_generation_rollback" not in body, (
        "the deploy body rolls back directly instead of going through the single abort "
        "path — that is the shape that let `set -e` skip rollback entirely"
    )
    assert "deploy_identity_verified" in body, "the deploy does not run the three-identity gate"
    assert "deploy_generation_commit" in body, "rollback artifacts are never committed away"
    # the three failure points that previously aborted past rollback
    assert 'if ! mv "$STAGE/.next" "$APP/.next"; then' in body, "swap move is unguarded"
    assert "if ! systemctl restart terminal; then" in body, "restart is unguarded"
    assert body.count("deploy_generation_abort") >= 4, (
        "not every guarded failure routes into the abort path"
    )


def test_success_is_only_committed_after_the_identity_gate():
    body = _deploy_body(code_only=True)
    assert body.index("deploy_identity_verified") < body.index("deploy_generation_commit"), (
        "artifacts are cleared before the three identities are checked — rollback would be "
        "impossible by the time the deploy discovers it is incoherent"
    )


def test_identity_report_names_all_three(tmp_path):
    """Behavioural: one reporter, and it cannot report only two of the three."""
    app = make_app(tmp_path, NEW_SHA, build_id=OLD_BUILD_ID)
    r = run_gen(SCRIPT, f'deploy_identity_line "{app}" "{NEW_SHA}"')
    out = r.stdout
    assert NEW_SHA in out, "intended SHA missing from the identity report"
    assert OLD_BUILD_ID in out, "live BUILD_ID missing from the identity report"
    assert "marker=" in out, "live marker missing from the identity report"


def test_identity_report_marks_a_missing_marker_absent(tmp_path):
    app = make_app(tmp_path, None, build_id=OLD_BUILD_ID)
    r = run_gen(SCRIPT, f'deploy_identity_line "{app}" "{NEW_SHA}"')
    assert "marker=<absent>" in r.stdout, (
        "a missing marker must be reported as absent, never as blank agreement"
    )


def test_both_outcomes_report_the_full_identity_triple():
    assert _deploy_body().count("deploy_identity_line") >= 1, (
        "the success path must report intended SHA, live marker and live BUILD_ID"
    )
    assert _library().count("deploy_identity_line") >= 2, (
        "both the rolled-back and the unresolved outcome must report the full triple"
    )
