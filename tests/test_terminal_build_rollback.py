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

import json
import os
import re
import shutil
import signal
import subprocess
import textwrap
import time
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


def test_pre_swap_abort_never_overwrites_the_still_good_live_build_with_a_stale_bak(tmp_path):
    """The exact review repro (#504 M1): swapped=0 must not open the `.next.bak`
    restore branch, even when a leftover `.next.bak` exists (e.g. a prior deploy's
    `rm -rf .next.bak` failed to clear it, or died between generations).

        .next      = the currently LIVE GOOD build (never touched — swap never ran)
        .next.bak  = a STALE build from TWO generations ago
        marker     = the OLD sha, about to be superseded

    Before this fix, `deploy_generation_rollback` branched on `[ -d .next.bak ]`
    alone: it moved the still-good live `.next` to `.next.broken` and restored the
    stale two-generations-old `.next.bak` in its place — replacing a healthy live
    build with a dead one, on a rollback path that is supposed to be a no-op.
    """
    app = make_app(tmp_path, OLD_SHA, build_id=OLD_BUILD_ID)
    stale_bak = app / ".next.bak"
    stale_bak.mkdir()
    (stale_bak / "BUILD_ID").write_text("build-STALEtwoGensOld\n")
    new = staged_marker(tmp_path, NEW_SHA)

    run_gen(SCRIPT, f'deploy_generation_begin "{app}" "{new}"')
    # sanity: begin only touches the marker, never .next / .next.bak
    assert live_build_id(app) == OLD_BUILD_ID

    r = run_gen(SCRIPT, f'deploy_generation_rollback "{app}" 0; echo "RC=$?"')
    assert "RC=0" in r.stdout, f"{r.stdout}\n{r.stderr}"
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID, (
        "the still-good live build was overwritten by a stale .next.bak on a "
        f"pre-swap (swapped=0) abort:\n{r.stdout}\n{r.stderr}"
    )
    assert stale_bak.is_dir() and (stale_bak / "BUILD_ID").read_text().strip() == (
        "build-STALEtwoGensOld"
    ), "the stale .next.bak must be left exactly where it was — swapped=0 restores nothing"
    assert not (app / ".next.broken").exists(), (
        "nothing should have been moved aside — .next was never touched"
    )


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
    "git": (
        '#!/bin/sh\n'
        'printf "git %s\\n" "$*" >> "$MMX_EFFECT_LOG"\n'
        # These two fixture revisions are valid old commits with no IW2 gate.
        # Unknown identities remain errors; the real candidate cases live in
        # test_terminal_investigation_install_admission.py.
        'case "$*" in\n'
        '  *"cat-file -t "*) case "$*" in *'
        + OLD_SHA + '|*' + NEW_SHA + ') echo commit ;; *) exit 1 ;; esac ;;\n'
        '  *rev-parse*) echo "$FAKE_SHA" ;;\n'
        # Optional tracked public/data tree for the production staging tests.
        # Without FAKE_TRACKED_ROOT the commit has NO tracked public/data.
        '  *"cat-file -e HEAD:terminal/public/data") [ -n "${FAKE_TRACKED_ROOT:-}" ] || exit 128 ;;\n'
        '  *"archive HEAD -- terminal/public/data") [ -n "${FAKE_TRACKED_ROOT:-}" ] && '
        'exec tar -c -f - -C "$FAKE_TRACKED_ROOT" terminal/public/data ;;\n'
        'esac\n'
        'exit 0\n'
    ),
    "npm": (
        '#!/bin/sh\n'
        'printf "npm %s\\n" "$*" >> "$MMX_EFFECT_LOG"\n'
        # `npm ci` does what the real one does to the directory it runs in: the
        # existing tree is deleted and a new one is written from the lockfile there.
        # HOLD_NPM_CI parks it mid-install so a test can interrupt the deploy.
        'if [ "$1" = ci ]; then\n'
        '  rm -rf node_modules && mkdir node_modules || exit 1\n'
        '  cp package-lock.json node_modules/installed-from-lock || exit 1\n'
        '  if [ -n "${HOLD_NPM_CI:-}" ]; then\n'
        '    : > "$HOLD_NPM_CI.started"\n'
        '    while [ ! -e "$HOLD_NPM_CI.release" ]; do /bin/sleep 0.05; done\n'
        '  fi\n'
        'fi\n'
        'if [ "$1" = run ] && [ "$2" = build ]; then\n'
        # Record exactly what public/data the build saw, from inside the stage.
        '  if [ -n "${RECORD_STAGE_DATA:-}" ]; then\n'
        '    { printf "cwd=%s\\n" "$PWD"; (cd public/data && find . -type f | sort); } > "$RECORD_STAGE_DATA"\n'
        '  fi\n'
        # The 2026-11-10 shape: the kernel kills the build, npm reports 137.
        '  [ -n "${FAIL_BUILD:-}" ] && { echo Killed >&2; exit 137; }\n'
        '  mkdir -p .next && printf "%s\\n" "$FAKE_BUILD_ID" > .next/BUILD_ID\n'
        'fi\nexit 0\n'
    ),
    "systemctl": (
        '#!/bin/sh\n'
        'printf "systemctl %s\\n" "$*" >> "$MMX_EFFECT_LOG"\n'
        # What a (re)started service would load: the lockfile beside its node_modules.
        'if [ "$1" = restart ] && [ -n "${MMX_DEPS_PROBE:-}" ]; then\n'
        '  printf "restart-saw-lock %s\\n" "$(cat "$MMX_DEPS_PROBE" 2>/dev/null)" >> "$MMX_EFFECT_LOG"\n'
        'fi\n'
        '[ "$1" = restart ] && [ -n "${FAIL_RESTART:-}" ] && { echo "systemctl: simulated failure" >&2; exit 1; }\n'
        'exit 0\n'
    ),
    "curl": '#!/bin/sh\n[ -n "${FAIL_HEALTH:-}" ] && exit 22\nexit 0\n',
    "sleep": "#!/bin/sh\nexit 0\n",
    "install": (
        '#!/bin/sh\n'
        'if [ "$1" = -d ]; then\n'
        '  [ -n "${FAIL_INSTALL_DIR:-}" ] && { echo "install -d: simulated failure" >&2; exit 1; }\n'
        '  shift; mode=0755\n'
        '  while [ "$#" -gt 0 ]; do\n'
        '    case "$1" in -o|-g) shift 2 ;; -m) mode=$2; shift 2 ;; *) mkdir -p "$1" || exit $?; chmod "$mode" "$1" || exit $?; shift ;; esac\n'
        '  done\n'
        '  exit 0\n'
        'fi\n'
        'mode=0755\n'
        'while [ "$#" -gt 0 ]; do case "$1" in -m) mode=$2; shift 2 ;; -o|-g) shift 2 ;; *) break ;; esac; done\n'
        '[ "$#" -eq 2 ] || exit 64\n'
        'cp "$1" "$2" || exit $?\n'
        'chmod "$mode" "$2"\n'
    ),
    "stat": (
        '#!/bin/sh\n'
        'if [ "$1" = -c ] && [ "$2" = "%F:%a:%u:%g" ]; then\n'
        '  [ -d "$3" ] || exit 1\n'
        '  echo directory:750:0:0\n'
        '  exit 0\n'
        'fi\n'
        'exit 64\n'
    ),
    "mv": (
        '#!/bin/sh\n'
        'if [ -n "${FAIL_MV_MATCH:-}" ]; then\n'
        '  case "$*" in *"$FAIL_MV_MATCH"*) echo "mv: simulated failure: $*" >&2; exit 1 ;; esac\n'
        'fi\nexec /bin/mv "$@"\n'
    ),
}


def sandbox_deploy(tmp_path: Path, script: Path = SCRIPT, *, prepare=None,
                   meminfo: Path | None = None, **flags) -> tuple:
    """Build the sandbox for one deploy run. Returns (argv, env, app).

    `prepare(app, tsrc)` adjusts the fixture before the run (the default fixture has
    identical lockfiles, so the dependency install is skipped). `meminfo` points the
    build memory admission at a fixture instead of this machine's /proc/meminfo;
    without it the session default in conftest.py keeps that admission out of play.
    """
    # NOT named "opt": the post-rewrite guard below greps for /opt/terminal, and a
    # sandbox ending in /opt would make the rewritten text match it spuriously.
    root = tmp_path / "deployroot"
    app, src = root / "terminal", root / ".gitsrc"
    tsrc = src / "terminal"
    ops = src / "ops"
    usrbin = tmp_path / "usrbin"
    receipt_root = tmp_path / "varlib" / "mastermind-terminal"
    for d in (app / "node_modules", app / "public" / "data", tsrc, src / ".git", ops, usrbin):
        d.mkdir(parents=True, exist_ok=True)
    (ops / "terminal_source_audit.production.json").write_text("{}\n")
    (ops / "terminal_audit").mkdir()
    (ops / "terminal_audit" / "__init__.py").write_text("# sandbox runtime\n")
    (ops / "terminal_release_preflight.py").write_text(
        """import argparse
import hashlib
import json
import os
import sys
from pathlib import Path


def receipt_id(payload):
    canonical = {
        key: value
        for key, value in payload.items()
        if key not in {'generated_at', 'receipt_id'}
    }
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(',', ':')).encode()
    ).hexdigest()


parser = argparse.ArgumentParser()
parser.add_argument('--canonical-repo')
parser.add_argument('--policy', type=Path)
parser.add_argument('--receipt-dir', type=Path)
args = parser.parse_args()
mode = os.environ.get('MMX_PREFLIGHT_MODE', 'clean')
if mode == 'exit2':
    print('sandbox UNKNOWN_STOP', file=sys.stderr)
    raise SystemExit(2)
if mode == 'nonclean':
    print(json.dumps({
        'schema': 'mastermind.terminal.release_preflight_receipt.v1',
        'result': 'UNKNOWN_STOP',
        'accepted_sha': '""" + OLD_SHA + """',
        'receipt_path': str(args.receipt_dir / 'not-created.json'),
        'receipt_id': 'not-clean',
        'source_audit_receipt_id': 'not-clean-inner',
    }))
    raise SystemExit(0)

policy = json.loads(args.policy.read_text(encoding='utf-8'))
policy_digest = hashlib.sha256(
    json.dumps(policy, sort_keys=True, separators=(',', ':')).encode()
).hexdigest()
inner = {
    'schema': 'mastermind.terminal.source_audit_receipt.v1',
    'generated_at': '2026-09-17T00:00:00Z',
    'status': 'CLEAN',
    'accepted_sha': '""" + OLD_SHA + """',
    'policy_digest': policy_digest,
    'summary': {'blocking_findings': 0, 'tracked_paths': 0, 'allowed_paths': 0},
    'findings': [],
}
inner['receipt_id'] = receipt_id(inner)
outer = {
    'schema': 'mastermind.terminal.release_preflight_receipt.v1',
    'generated_at': '2026-09-17T00:00:01Z',
    'result': 'CLEAN',
    'accepted_sha': '""" + OLD_SHA + """',
    'policy_digest': policy_digest,
    'source_audit_receipt_id': inner['receipt_id'],
    'source_audit': inner,
}
outer['receipt_id'] = receipt_id(outer)
args.receipt_dir.mkdir(parents=True, exist_ok=True)
receipt = args.receipt_dir / 'sandbox-receipt.json'
receipt.write_text(
    json.dumps(outer, sort_keys=True, separators=(',', ':')) + '\\n',
    encoding='utf-8',
)
os.chmod(receipt, 0o640)
print(json.dumps({
    'schema': 'mastermind.terminal.release_preflight_receipt.v1',
    'result': 'CLEAN',
    'accepted_sha': outer['accepted_sha'],
    'receipt_path': str(receipt),
    'receipt_id': outer['receipt_id'],
    'source_audit_receipt_id': inner['receipt_id'],
}))
""",
        encoding="utf-8",
    )
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
    text = (
        text.replace("/usr/local/bin", str(usrbin))
        .replace("/var/lib/mastermind-terminal", str(receipt_root))
        .replace("/opt/terminal/", f"{root}/")
        .replace(
            'select_preflight_artifacts 0 "$AUTHORING_OPS_DIR" "$SRC/ops"',
            f'select_preflight_artifacts {os.getuid()} "$AUTHORING_OPS_DIR" "$SRC/ops"',
        )
    )
    assert "/opt/terminal" not in text, "a real deploy path survived the rewrite"
    assert "/var/lib/mastermind-terminal" not in text, "a real receipt path survived the rewrite"
    if meminfo is not None:
        anchor = "require_build_memory /proc/meminfo"
        assert text.count(anchor) == 1, "build memory admission call vanished — cannot sandbox"
        text = text.replace(anchor, f'require_build_memory "{meminfo}"')
    if prepare is not None:
        prepare(app, tsrc)
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
        "MMX_EFFECT_LOG": str(tmp_path / "effects.log"),
    })
    env.update({k: str(v) for k, v in flags.items()})
    return [_bash(), str(copy), "--target-sha", NEW_SHA], env, app


def run_deploy(tmp_path: Path, script: Path = SCRIPT, **options) -> tuple:
    """Execute a sandboxed copy of the real deploy script. Returns (proc, app)."""
    argv, env, app = sandbox_deploy(tmp_path, script, **options)
    proc = subprocess.run(argv, capture_output=True, text=True, timeout=180, env=env)
    return proc, app


def _effect_lines(tmp_path: Path) -> list[str]:
    effect_log = tmp_path / "effects.log"
    if not effect_log.exists():
        return []
    return effect_log.read_text(encoding="utf-8").splitlines()


@pytest.mark.parametrize(
    ("mode", "expected_returncode"),
    [("exit2", 2), ("nonclean", 64)],
)
def test_preflight_refusal_stops_before_git_build_or_service_effects(
    tmp_path: Path, mode: str, expected_returncode: int
) -> None:
    proc, app = run_deploy(tmp_path, MMX_PREFLIGHT_MODE=mode)

    assert proc.returncode == expected_returncode, proc.stdout + proc.stderr
    assert _effect_lines(tmp_path) == [], proc.stdout + proc.stderr
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID
    assert "next build" not in proc.stdout


def test_mutant_ignoring_preflight_failure_reaches_downstream_effects(
    tmp_path: Path,
) -> None:
    anchor = (
        'run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" '
        '"$SRC" "$PREFLIGHT_RECEIPT_DIR" auto'
    )
    mutant = _mutate(tmp_path, anchor, anchor + " || true  # MUTANT")

    proc, _ = run_deploy(
        tmp_path, script=mutant, MMX_PREFLIGHT_MODE="exit2"
    )

    effects = _effect_lines(tmp_path)
    assert any(line.startswith("git ") for line in effects), (
        "mutation was inert — ignoring UNKNOWN_STOP did not cross the Git gate; "
        f"returncode={proc.returncode} stdout={proc.stdout!r} stderr={proc.stderr!r}"
    )


def test_receipt_directory_failure_stops_before_downstream_effects(
    tmp_path: Path,
) -> None:
    proc, app = run_deploy(tmp_path, FAIL_INSTALL_DIR="1")

    assert proc.returncode != 0
    assert _effect_lines(tmp_path) == [], proc.stdout + proc.stderr
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID


def test_receipt_validator_still_blocks_if_directory_failure_is_ignored(
    tmp_path: Path,
) -> None:
    anchor = 'prepare_preflight_receipt_dir "$PREFLIGHT_RECEIPT_DIR"'
    mutant = _mutate(tmp_path, anchor, anchor + " || true  # MUTANT")

    proc, app = run_deploy(tmp_path, script=mutant, FAIL_INSTALL_DIR="1")

    assert proc.returncode == 64, proc.stdout + proc.stderr
    assert _effect_lines(tmp_path) == []
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID
    assert "prepare_preflight_receipt_dir \"$PREFLIGHT_RECEIPT_DIR\" || true" not in _deploy_body(
        code_only=True
    )


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def make_canonical_mismatch_fixture(tmp_path: Path, *, drift: bool = False):
    repo = tmp_path / "canonical"
    live = tmp_path / "live-terminal"
    receipts = tmp_path / "receipts"
    policy_path = tmp_path / "policy.json"
    repo.mkdir()
    live.mkdir()
    receipts.mkdir(mode=0o750)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "deploy-test@example.com")
    _git(repo, "config", "user.name", "Deploy Test")
    source = repo / "terminal"
    source.mkdir()
    (source / "file.txt").write_text("old\n", encoding="utf-8")
    _git(repo, "add", "terminal/file.txt")
    _git(repo, "commit", "-q", "-m", "old generation")
    old_sha = _git(repo, "rev-parse", "HEAD")

    (source / "file.txt").write_text("new\n", encoding="utf-8")
    _git(repo, "add", "terminal/file.txt")
    _git(repo, "commit", "-q", "-m", "admitted target")
    new_sha = _git(repo, "rev-parse", "HEAD")
    _git(repo, "update-ref", "refs/remotes/origin/master", new_sha)

    (live / "file.txt").write_text("drift\n" if drift else "old\n", encoding="utf-8")
    marker = live / ".deployment-id"
    marker.write_text(old_sha + "\n", encoding="ascii")
    policy = {
        "schema": "mastermind.terminal.source_audit_policy.v1",
        "accepted_ref": "refs/remotes/origin/master",
        "deployment_id_file": str(marker),
        "mappings": [
            {
                "name": "terminal-app",
                "repo_path": "terminal",
                "live_path": str(live),
                "allowances": [
                    {
                        "path": ".deployment-id",
                        "classification": "deployment_marker",
                        "expected_live_type": "file",
                    }
                ],
            }
        ],
    }
    policy_path.write_text(json.dumps(policy), encoding="utf-8")
    return repo, live, marker, receipts, policy_path, old_sha, new_sha


def test_recovery_receipt_accepts_only_the_single_canonical_head_mismatch(tmp_path):
    repo, _, _, receipts, policy, old_sha, new_sha = make_canonical_mismatch_fixture(tmp_path)
    preflight = REPO / "ops" / "terminal_release_preflight.py"
    r = run_gen(
        SCRIPT,
        f'''
        run_release_preflight "{preflight}" "{policy}" "{repo}" "{receipts}" canonical-head-mismatch
        rc=$?
        echo "RC=$rc ACCEPTED=$PREFLIGHT_ACCEPTED_SHA HEAD=$PREFLIGHT_CANONICAL_HEAD"
        exit "$rc"
        ''',
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert f"ACCEPTED={old_sha}" in r.stdout
    assert f"HEAD={new_sha}" in r.stdout
    assert _git(repo, "rev-parse", "HEAD") == new_sha, "evidence collection must be read-only"


def test_recovery_receipt_refuses_any_second_source_finding(tmp_path):
    repo, _, _, receipts, policy, _, new_sha = make_canonical_mismatch_fixture(tmp_path, drift=True)
    preflight = REPO / "ops" / "terminal_release_preflight.py"
    r = run_gen(
        SCRIPT,
        f'''
        run_release_preflight "{preflight}" "{policy}" "{repo}" "{receipts}" canonical-head-mismatch
        rc=$?
        echo "RC=$rc"
        exit "$rc"
        ''',
    )
    assert r.returncode == 64, r.stdout + r.stderr
    assert _git(repo, "rev-parse", "HEAD") == new_sha


def test_canonical_mismatch_recovery_restores_only_the_receipted_live_generation(tmp_path):
    repo, _, marker, receipts, policy, old_sha, new_sha = make_canonical_mismatch_fixture(tmp_path)
    preflight = REPO / "ops" / "terminal_release_preflight.py"
    r = run_gen(
        SCRIPT,
        f'''
        run_release_preflight "{preflight}" "{policy}" "{repo}" "{receipts}" auto
        recover_canonical_head_mismatch "{repo}" "{marker}"
        rc=$?
        echo "RC=$rc"
        exit "$rc"
        ''',
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert _git(repo, "rev-parse", "HEAD") == old_sha
    assert _git(repo, "status", "--porcelain=v1", "--untracked-files=all") == ""
    assert f"head={new_sha} live={old_sha}" in r.stdout


def test_preswap_exit_recovery_returns_source_head_after_failed_build(tmp_path):
    repo, live, marker, _, _, old_sha, _ = make_canonical_mismatch_fixture(tmp_path)
    r = run_gen(
        SCRIPT,
        f'''
        SRC="{repo}"
        APP="{live}"
        DEPLOYMENT_MARKER="{marker}"
        CANONICAL_RECOVERY_SHA="{old_sha}"
        CANONICAL_RECOVERY_ARMED=1
        STAGE_ROOT=
        false
        cleanup_deploy_attempt
        ''',
    )
    assert r.returncode == 1, r.stdout + r.stderr
    assert _git(repo, "rev-parse", "HEAD") == old_sha
    assert "pre-swap canonical checkout recovery OK" in r.stdout


def test_preswap_disk_exhaustion_frees_owned_stage_before_restoring_source(tmp_path):
    repo, live, marker, _, _, old_sha, _ = make_canonical_mismatch_fixture(tmp_path)
    stage = tmp_path / "owned-failed-stage"
    stage.mkdir()
    (stage / "incomplete-build").write_text("occupied staging capacity")
    r = run_gen(
        SCRIPT,
        f'''
        SRC="{repo}"
        APP="{live}"
        DEPLOYMENT_MARKER="{marker}"
        CANONICAL_RECOVERY_SHA="{old_sha}"
        CANONICAL_RECOVERY_ARMED=1
        STAGE_ROOT="{stage}"
        git() {{
          if [ "$3" = reset ] && [ -d "$STAGE_ROOT" ]; then
            echo "synthetic ENOSPC: index cannot be written while failed stage remains" >&2
            return 1
          fi
          command git "$@"
        }}
        false
        cleanup_deploy_attempt
        ''',
    )
    assert r.returncode == 1, r.stdout + r.stderr
    assert not stage.exists()
    assert _git(repo, "rev-parse", "HEAD") == old_sha
    assert _git(repo, "status", "--porcelain=v1", "--untracked-files=all") == ""
    assert marker.read_text().strip() == old_sha
    assert "pre-swap canonical checkout recovery OK" in r.stdout


def test_preswap_exit_recovery_refuses_if_live_identity_changed(tmp_path):
    repo, live, marker, _, _, old_sha, new_sha = make_canonical_mismatch_fixture(tmp_path)
    marker.write_text(new_sha + "\n", encoding="ascii")
    r = run_gen(
        SCRIPT,
        f'''
        SRC="{repo}"
        APP="{live}"
        DEPLOYMENT_MARKER="{marker}"
        CANONICAL_RECOVERY_SHA="{old_sha}"
        CANONICAL_RECOVERY_ARMED=1
        STAGE_ROOT=
        false
        cleanup_deploy_attempt
        ''',
    )
    assert r.returncode == 74, r.stdout + r.stderr
    assert _git(repo, "rev-parse", "HEAD") == new_sha
    assert "pre-swap recovery refused" in r.stdout


def test_empty_gated_archive_stages_the_app_alone(tmp_path):
    """A git that archives nothing for the gated dirs (a commit without them, or the stub
    here) must not abort the deploy: GNU tar rejects an empty stream, so the stage step
    writes the archive to a file and extracts only when it has bytes."""
    proc, app = run_deploy(tmp_path)

    # The sandbox has no ops/terminal-data, so the script's later install step exits
    # non-zero on every platform; this test pins only the staging step.
    # (step 8's runtime sync still pipes the stubbed git into tar after the swap, so GNU tar
    # may print its empty-archive complaint on stderr there; that step is not this test's.)
    assert "staging the app alone" in proc.stdout, f"empty archive was not tolerated:\n{proc.stdout}\n{proc.stderr}"
    assert "new build OK" in proc.stdout, f"staging never reached the build:\n{proc.stdout}\n{proc.stderr}"
    assert marker_of(app) == NEW_SHA


def _seed_live_and_tracked_data(tmp_path: Path) -> tuple[Path, Path]:
    live = tmp_path / "deployroot" / "terminal" / "public" / "data"
    (live / "intraday").mkdir(parents=True)
    (live / "intraday" / "LIVE.json").write_text('{"live":true}\n')
    tracked = tmp_path / "tracked"
    (tracked / "terminal" / "public" / "data").mkdir(parents=True)
    (tracked / "terminal" / "public" / "data" / "AAPL.json").write_text('{"fixture":true}\n')
    return live, tracked


def test_production_build_sees_tracked_fixtures_not_live_runtime_data(tmp_path):
    """The Turbopack build's memory grows with public/data; the live tree got the VPS
    build OOM-killed on 2026-11-10. The production stage must hold only the commit's
    tracked fixtures, and the live tree must be left exactly as it was."""
    live, tracked = _seed_live_and_tracked_data(tmp_path)
    record = tmp_path / "stage-data.txt"

    proc, app = run_deploy(
        tmp_path, FAKE_TRACKED_ROOT=tracked, RECORD_STAGE_DATA=record
    )

    out = proc.stdout + proc.stderr
    assert "new build OK" in proc.stdout, out
    seen = record.read_text().splitlines()
    assert "/.stage." in seen[0], seen
    assert seen[1:] == ["./AAPL.json"], seen
    assert "production stage runtime data: 1 git-tracked public/data fixture file(s)" in proc.stdout, out
    assert (live / "intraday" / "LIVE.json").read_text() == '{"live":true}\n'
    assert not (app / "public" / "data" / "AAPL.json").exists(), "stage data leaked into the live tree"
    assert marker_of(app) == NEW_SHA


def test_production_stage_without_tracked_fixtures_builds_with_empty_data(tmp_path):
    """A commit with no tracked public/data (`git cat-file -e` fails) still builds,
    from an empty public/data, never asks git for the archive, and still never stages
    the live tree."""
    _seed_live_and_tracked_data(tmp_path)
    record = tmp_path / "stage-data.txt"

    proc, _ = run_deploy(tmp_path, RECORD_STAGE_DATA=record)

    assert "new build OK" in proc.stdout, proc.stdout + proc.stderr
    effects = _effect_lines(tmp_path)
    assert any("cat-file -e HEAD:terminal/public/data" in line for line in effects), effects
    assert not any("archive HEAD -- terminal/public/data" in line for line in effects), effects
    assert record.read_text().splitlines()[1:] == []
    assert "production stage runtime data: 0 git-tracked" in proc.stdout


def test_mutant_hardlinking_live_data_into_the_stage_is_caught(tmp_path):
    _, tracked = _seed_live_and_tracked_data(tmp_path)
    record = tmp_path / "stage-data.txt"
    anchor = '  mkdir -p "$STAGE/public/data"\n  DATA_TAR="$STAGE_ROOT/.public-data.tar"\n'
    mutant = _mutate(
        tmp_path,
        anchor,
        '  cp -al "$APP/public/data" "$STAGE/public/data"  # MUTANT: incumbent staging\n'
        + anchor,
    )

    proc, _ = run_deploy(
        tmp_path, script=mutant, FAKE_TRACKED_ROOT=tracked, RECORD_STAGE_DATA=record
    )

    assert "new build OK" in proc.stdout, proc.stdout + proc.stderr
    assert "./intraday/LIVE.json" in record.read_text().splitlines(), (
        "mutation was inert: the incumbent hardlink staging did not reach the build"
    )


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


# --------------------------------------------------------------------------
# dependency inputs are part of the generation: the 2026-11-10 incident
# --------------------------------------------------------------------------
#
# The production deps step installs into the LIVE app. When the staged build was
# OOM-killed after it, the pre-swap recovery put the canonical checkout back and
# nothing else: the accepted .next and the running server were left beside the
# TARGET's package.json, package-lock.json and node_modules. Every later release
# preflight then refused on two TRACKED_MODIFIED findings. These tests pin the
# snapshot that closes it, at three levels: the functions, the exit path against a
# real repository and the real preflight, and the executed deploy body.

ACCEPTED_PACKAGE = '{"name":"terminal","dependencies":{"next":"16.2.9"}}\n'
TARGET_PACKAGE = '{"name":"terminal","dependencies":{"next":"16.4.6"}}\n'
ACCEPTED_LOCK = '{"lockfileVersion":3,"next":"16.2.9"}\n'
TARGET_LOCK = '{"lockfileVersion":3,"next":"16.4.6"}\n'
ACCEPTED_MTIME = 1_700_000_000


def dependency_inputs(app: Path) -> dict:
    """Everything the accepted generation's dependency inputs are, by identity.

    A directory's inode number alone can be reused by a delete-and-recreate on
    ext4, so the tree is always described by its inode AND its contents.
    """
    state: dict = {}
    for name in ("package.json", "package-lock.json"):
        path = app / name
        if path.exists():
            info = path.stat()
            state[name] = (path.read_bytes(), info.st_mode, int(info.st_mtime))
        else:
            state[name] = None
    tree = app / "node_modules"
    if tree.exists():
        state["node_modules"] = (
            tree.stat().st_ino,
            sorted(str(p.relative_to(tree)) for p in tree.rglob("*")),
        )
    else:
        state["node_modules"] = None
    return state


def make_deps_app(tmp_path: Path, *, package: bool = True, tree: bool = True) -> Path:
    app = tmp_path / "host" / "terminal"
    app.mkdir(parents=True)
    if package:
        manifest = app / "package.json"
        manifest.write_text(ACCEPTED_PACKAGE)
        manifest.chmod(0o640)
        os.utime(manifest, (ACCEPTED_MTIME, ACCEPTED_MTIME))
    lock = app / "package-lock.json"
    lock.write_text(ACCEPTED_LOCK)
    os.utime(lock, (ACCEPTED_MTIME, ACCEPTED_MTIME))
    if tree:
        (app / "node_modules" / "next").mkdir(parents=True)
        (app / "node_modules" / "next" / "version").write_text("16.2.9\n")
    return app


def install_target_deps(app: Path) -> str:
    """Bash for what the deps step does to the live app: target manifests copied
    over the accepted ones, node_modules deleted and rewritten by `npm ci`."""
    return (
        f"printf '%s\\n' '{TARGET_PACKAGE.strip()}' > \"{app}/package.json\"\n"
        f"printf '%s\\n' '{TARGET_LOCK.strip()}' > \"{app}/package-lock.json\"\n"
        f'rm -rf "{app}/node_modules"\n'
        f'mkdir -p "{app}/node_modules/next"\n'
        f"printf '16.4.6\\n' > \"{app}/node_modules/next/version\"\n"
    )


def snapshot_dir(app: Path) -> Path:
    return app.parent / ".deps-rollback"


def test_dependency_snapshot_restores_files_metadata_and_the_same_tree(tmp_path):
    app = make_deps_app(tmp_path)
    before = dependency_inputs(app)

    r = run_gen(SCRIPT, f'''
        deps_snapshot_begin "{app}" || exit 90
        [ ! -e "{app}/node_modules" ] || exit 91
        [ "$DEPS_SNAPSHOT_DIR" = "{snapshot_dir(app)}" ] || exit 92
        {install_target_deps(app)}
        deps_snapshot_restore "{app}"
        echo "RC=$? OPEN=[$DEPS_SNAPSHOT_DIR]"
    ''')

    assert "RC=0 OPEN=[]" in r.stdout, r.stdout + r.stderr
    assert dependency_inputs(app) == before
    assert (app / "node_modules" / "next" / "version").read_text() == "16.2.9\n"
    assert not snapshot_dir(app).exists(), "a restored snapshot must not be left behind"


def test_dependency_snapshot_lives_beside_the_app_never_inside_it(tmp_path):
    """The source audit maps $APP. A snapshot inside it would itself be drift."""
    app = make_deps_app(tmp_path)
    r = run_gen(SCRIPT, f'''
        deps_snapshot_path "{app}"
        deps_snapshot_begin "{app}" || exit 90
        ls -A "{app}"
    ''')
    assert r.stdout.splitlines()[0] == str(snapshot_dir(app))
    assert sorted(p.name for p in app.iterdir()) == ["package-lock.json", "package.json"]
    assert (snapshot_dir(app) / "node_modules" / "next" / "version").read_text() == "16.2.9\n"
    assert oct(snapshot_dir(app).stat().st_mode & 0o777) == "0o700"


def test_dependency_snapshot_restores_absence(tmp_path):
    """An accepted generation with no package.json and no tree gets neither back."""
    app = make_deps_app(tmp_path, package=False, tree=False)
    before = dependency_inputs(app)
    assert before["package.json"] is None and before["node_modules"] is None

    r = run_gen(SCRIPT, f'''
        deps_snapshot_begin "{app}" || exit 90
        {install_target_deps(app)}
        deps_snapshot_restore "{app}"
        echo "RC=$?"
    ''')

    assert "RC=0" in r.stdout, r.stdout + r.stderr
    assert "node_modules absent" in r.stdout
    assert dependency_inputs(app) == before
    assert not snapshot_dir(app).exists()


def test_dependency_snapshot_discard_keeps_the_new_generation(tmp_path):
    app = make_deps_app(tmp_path)
    r = run_gen(SCRIPT, f'''
        deps_snapshot_discard; echo "IDLE_RC=$?"
        deps_snapshot_begin "{app}" || exit 90
        {install_target_deps(app)}
        deps_snapshot_discard
        echo "RC=$? OPEN=[$DEPS_SNAPSHOT_DIR]"
    ''')
    assert "IDLE_RC=0" in r.stdout
    assert r.stdout.count("dependency rollback snapshot discarded") == 1, (
        "discarding with no open snapshot must be silent"
    )
    assert "RC=0 OPEN=[]" in r.stdout, r.stdout + r.stderr
    assert not snapshot_dir(app).exists()
    assert (app / "package-lock.json").read_text() == TARGET_LOCK
    assert (app / "node_modules" / "next" / "version").read_text() == "16.4.6\n"


def test_stale_dependency_snapshot_is_discarded_loudly(tmp_path):
    """A snapshot that outlived a SIGKILLed attempt must never be restored by a later
    one: by then the preflight has accepted the live tree as it stands."""
    app = make_deps_app(tmp_path)
    stale = snapshot_dir(app)
    (stale / "node_modules" / "ancient").mkdir(parents=True)
    (stale / "package-lock.json").write_text("two generations old\n")
    before = dependency_inputs(app)

    r = run_gen(SCRIPT, f'''
        deps_snapshot_begin "{app}" || exit 90
        {install_target_deps(app)}
        deps_snapshot_restore "{app}"
        echo "RC=$?"
    ''')

    assert "WARN: discarding a dependency rollback snapshot left by an interrupted earlier attempt" in r.stdout
    assert "RC=0" in r.stdout, r.stdout + r.stderr
    assert dependency_inputs(app) == before
    assert not (app / "node_modules" / "ancient").exists()


def test_dependency_snapshot_refuses_a_non_regular_manifest(tmp_path):
    app = make_deps_app(tmp_path)
    (app / "package.json").unlink()
    (app / "package.json").symlink_to(app / "package-lock.json")

    r = run_gen(SCRIPT, f'deps_snapshot_begin "{app}"; echo "RC=$? OPEN=[$DEPS_SNAPSHOT_DIR]"')

    assert "RC=73 OPEN=[]" in r.stdout, r.stdout + r.stderr
    assert "is not a regular file" in r.stdout
    assert (app / "node_modules" / "next" / "version").read_text() == "16.2.9\n"
    assert not snapshot_dir(app).exists(), "a refused snapshot must not be left half-made"


def test_failed_move_aside_leaves_the_accepted_inputs_in_place(tmp_path):
    """The tree rename is the last step of the snapshot; if it fails nothing in the
    app has changed, and the restore that follows must agree."""
    app = make_deps_app(tmp_path)
    before = dependency_inputs(app)

    r = run_gen(SCRIPT, f'''
        mv() {{ case "$*" in *".deps-rollback/node_modules"*) return 1 ;; esac; command mv "$@"; }}
        deps_snapshot_begin "{app}"; echo "BEGIN_RC=$?"
        deps_snapshot_restore "{app}"; echo "RESTORE_RC=$? OPEN=[$DEPS_SNAPSHOT_DIR]"
    ''')

    assert "BEGIN_RC=73" in r.stdout, r.stdout + r.stderr
    assert "RESTORE_RC=0 OPEN=[]" in r.stdout, r.stdout + r.stderr
    assert dependency_inputs(app) == before
    assert not snapshot_dir(app).exists()


def test_failed_restore_keeps_the_snapshot_for_attended_recovery(tmp_path):
    app = make_deps_app(tmp_path)

    r = run_gen(SCRIPT, f'''
        deps_snapshot_begin "{app}" || exit 90
        {install_target_deps(app)}
        mv() {{ case "$*" in *"node_modules.failed"*) return 1 ;; esac; command mv "$@"; }}
        deps_snapshot_restore "{app}"
        echo "RC=$? OPEN=[$DEPS_SNAPSHOT_DIR]"
    ''')

    assert f"RC=1 OPEN=[{snapshot_dir(app)}]" in r.stdout, r.stdout + r.stderr
    # the accepted tree is still intact in the snapshot, not destroyed by the attempt
    assert (snapshot_dir(app) / "node_modules" / "next" / "version").read_text() == "16.2.9\n"


def test_restore_without_a_snapshot_is_a_failure_not_a_silent_success(tmp_path):
    app = make_deps_app(tmp_path)
    r = run_gen(SCRIPT, f'deps_snapshot_restore "{app}"; echo "RC=$?"')
    assert "RC=1" in r.stdout
    assert "there is no dependency rollback snapshot to restore" in r.stdout


# -- the exit path, against a real repository and the real release preflight --

def make_dependency_incident_fixture(tmp_path: Path):
    """Accepted and target generations that differ in their TRACKED dependency
    manifests, a live app on the accepted one, and the canonical checkout already
    reset to the target — the state the deploy is in when its build is killed."""
    repo = tmp_path / "canonical"
    live = tmp_path / "host" / "terminal"
    receipts = tmp_path / "receipts"
    policy_path = tmp_path / "policy.json"
    repo.mkdir()
    live.mkdir(parents=True)
    receipts.mkdir(mode=0o750)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "deploy-test@example.com")
    _git(repo, "config", "user.name", "Deploy Test")
    source = repo / "terminal"
    source.mkdir()
    (source / "file.txt").write_text("same in both generations\n", encoding="utf-8")
    (source / "package.json").write_text(ACCEPTED_PACKAGE, encoding="utf-8")
    (source / "package-lock.json").write_text(ACCEPTED_LOCK, encoding="utf-8")
    _git(repo, "add", "terminal")
    _git(repo, "commit", "-q", "-m", "accepted generation")
    old_sha = _git(repo, "rev-parse", "HEAD")

    (source / "package.json").write_text(TARGET_PACKAGE, encoding="utf-8")
    (source / "package-lock.json").write_text(TARGET_LOCK, encoding="utf-8")
    _git(repo, "add", "terminal")
    _git(repo, "commit", "-q", "-m", "admitted target: dependency bump")
    new_sha = _git(repo, "rev-parse", "HEAD")
    _git(repo, "update-ref", "refs/remotes/origin/master", new_sha)

    (live / "file.txt").write_text("same in both generations\n", encoding="utf-8")
    (live / "package.json").write_text(ACCEPTED_PACKAGE, encoding="utf-8")
    (live / "package-lock.json").write_text(ACCEPTED_LOCK, encoding="utf-8")
    (live / "node_modules" / "next").mkdir(parents=True)
    (live / "node_modules" / "next" / "version").write_text("16.2.9\n")
    marker = live / ".deployment-id"
    marker.write_text(old_sha + "\n", encoding="ascii")
    policy = {
        "schema": "mastermind.terminal.source_audit_policy.v1",
        "accepted_ref": "refs/remotes/origin/master",
        "deployment_id_file": str(marker),
        "mappings": [
            {
                "name": "terminal-app",
                "repo_path": "terminal",
                "live_path": str(live),
                "allowances": [
                    {
                        "path": ".deployment-id",
                        "classification": "deployment_marker",
                        "expected_live_type": "file",
                    },
                    {
                        "path": "node_modules",
                        "classification": "generated_dependency_tree",
                        "expected_live_type": "directory",
                    },
                ],
            }
        ],
    }
    policy_path.write_text(json.dumps(policy), encoding="utf-8")
    return repo, live, marker, receipts, policy_path, old_sha, new_sha


def killed_build_exit(repo: Path, live: Path, marker: Path, old_sha: str, *,
                      snapshot: bool = True, status: str = "false",
                      armed: int = 1) -> str:
    """Bash for: deps installed into the live app, then the attempt ends pre-swap."""
    return f'''
        SRC="{repo}"
        APP="{live}"
        DEPLOYMENT_MARKER="{marker}"
        CANONICAL_RECOVERY_SHA="{old_sha}"
        CANONICAL_RECOVERY_ARMED={armed}
        STAGE_ROOT=
        {'deps_snapshot_begin "$APP" || exit 90' if snapshot else ': # the pre-fix deploy saved nothing'}
        {install_target_deps(live)}
        {status}
        cleanup_deploy_attempt
    '''


def release_preflight(repo: Path, receipts: Path, policy: Path) -> subprocess.CompletedProcess:
    preflight = REPO / "ops" / "terminal_release_preflight.py"
    return run_gen(SCRIPT, f'''
        run_release_preflight "{preflight}" "{policy}" "{repo}" "{receipts}" auto
        rc=$?
        echo "RC=$rc RECOVERY=$PREFLIGHT_RECOVERY_REQUIRED"
        exit "$rc"
    ''')


def test_killed_build_after_install_leaves_the_next_preflight_clean(tmp_path):
    repo, live, marker, receipts, policy, old_sha, _ = make_dependency_incident_fixture(tmp_path)
    before = dependency_inputs(live)

    r = run_gen(SCRIPT, killed_build_exit(repo, live, marker, old_sha))

    assert r.returncode == 1, r.stdout + r.stderr
    assert "pre-swap dependency recovery OK" in r.stdout
    assert "pre-swap canonical checkout recovery OK" in r.stdout
    assert r.stdout.index("pre-swap dependency recovery OK") < r.stdout.index(
        "pre-swap canonical checkout recovery OK"
    )
    assert dependency_inputs(live) == before
    assert (live / "node_modules" / "next" / "version").read_text() == "16.2.9\n"
    assert not snapshot_dir(live).exists()
    assert _git(repo, "rev-parse", "HEAD") == old_sha

    # The consequence that bricked production: the NEXT deploy's preflight.
    nxt = release_preflight(repo, receipts, policy)
    assert nxt.returncode == 0, nxt.stdout + nxt.stderr
    assert "source preflight CLEAN" in nxt.stdout
    assert "RC=0 RECOVERY=0" in nxt.stdout


def test_without_the_snapshot_the_next_preflight_refuses_as_it_did_in_production(tmp_path):
    """The incident, reproduced with the real preflight: canonical checkout
    recovered, dependency manifests left on the target, every later deploy refused."""
    repo, live, marker, receipts, policy, old_sha, _ = make_dependency_incident_fixture(tmp_path)

    r = run_gen(SCRIPT, killed_build_exit(repo, live, marker, old_sha, snapshot=False))

    assert r.returncode == 1, r.stdout + r.stderr
    assert "pre-swap canonical checkout recovery OK" in r.stdout
    assert (live / "package-lock.json").read_text() == TARGET_LOCK
    assert (live / "node_modules" / "next" / "version").read_text() == "16.4.6\n"

    nxt = release_preflight(repo, receipts, policy)
    assert nxt.returncode != 0, (
        "fixture is inert — the real preflight accepts the incident state, so the "
        "clean result above proves nothing"
    )
    assert "source preflight CLEAN" not in nxt.stdout


def test_open_snapshot_is_a_failure_even_when_the_exit_status_is_zero(tmp_path):
    """An untrapped signal can run the EXIT path with $? of the last finished
    command. An attempt that changed the live inputs and never reached acceptance is
    recovered, and reported non-zero, whatever that status says."""
    repo, live, marker, _, _, old_sha, _ = make_dependency_incident_fixture(tmp_path)
    before = dependency_inputs(live)

    r = run_gen(SCRIPT, killed_build_exit(repo, live, marker, old_sha, status="true"))

    assert r.returncode == 1, r.stdout + r.stderr
    assert "pre-swap dependency recovery OK" in r.stdout
    assert "pre-swap canonical checkout recovery OK" in r.stdout
    assert dependency_inputs(live) == before
    assert _git(repo, "rev-parse", "HEAD") == old_sha


def test_dependency_restore_does_not_depend_on_the_canonical_recovery_leg(tmp_path):
    """The canonical leg refuses when the live marker moved. The snapshot is this
    attempt's own record of what it changed; it goes back regardless."""
    repo, live, marker, _, _, old_sha, new_sha = make_dependency_incident_fixture(tmp_path)
    before = dependency_inputs(live)
    marker.write_text(new_sha + "\n", encoding="ascii")

    r = run_gen(SCRIPT, killed_build_exit(repo, live, marker, old_sha))

    assert r.returncode == 74, r.stdout + r.stderr
    assert "pre-swap recovery refused" in r.stdout
    assert "pre-swap dependency recovery OK" in r.stdout
    assert dependency_inputs(live) == before


def test_failed_dependency_restore_is_fatal_and_retains_the_snapshot(tmp_path):
    repo, live, marker, _, _, old_sha, _ = make_dependency_incident_fixture(tmp_path)
    body = killed_build_exit(repo, live, marker, old_sha).replace(
        "cleanup_deploy_attempt",
        'mv() { case "$*" in *"node_modules.failed"*) return 1 ;; esac; command mv "$@"; }\n'
        "false\ncleanup_deploy_attempt",
    )

    r = run_gen(SCRIPT, body)

    assert r.returncode == 74, r.stdout + r.stderr
    assert "FATAL: pre-swap dependency recovery failed; the saved inputs are retained at " \
        f"{snapshot_dir(live)}" in r.stdout
    assert "pre-swap dependency recovery OK" not in r.stdout
    assert (snapshot_dir(live) / "node_modules" / "next" / "version").read_text() == "16.2.9\n"


def test_snapshot_left_open_after_identity_moved_is_never_guessed_at(tmp_path):
    """Past deploy_generation_begin the abort path owns the restore. An exit that
    bypassed it keeps the snapshot and says so; it does not restore blind."""
    repo, live, marker, _, _, old_sha, _ = make_dependency_incident_fixture(tmp_path)

    r = run_gen(SCRIPT, killed_build_exit(repo, live, marker, old_sha, armed=0))

    assert r.returncode == 74, r.stdout + r.stderr
    assert "dependency rollback snapshot is unresolved after live identity began moving" in r.stdout
    assert "pre-swap dependency recovery OK" not in r.stdout
    assert (live / "package-lock.json").read_text() == TARGET_LOCK
    assert (snapshot_dir(live) / "node_modules" / "next" / "version").read_text() == "16.2.9\n"


# -- the executed deploy body --

def lockfile_changed(record: dict):
    """Fixture adjustment: the target's dependency manifests differ from the live
    app's, so the deploy installs. Records the accepted inputs before the run."""
    def prepare(app: Path, tsrc: Path) -> None:
        (app / "package.json").write_text(ACCEPTED_PACKAGE)
        (app / "package-lock.json").write_text(ACCEPTED_LOCK)
        (tsrc / "package.json").write_text(TARGET_PACKAGE)
        (tsrc / "package-lock.json").write_text(TARGET_LOCK)
        record.update(dependency_inputs(app))
    return prepare


def test_deploy_restores_dependency_inputs_when_the_build_is_killed(tmp_path):
    before: dict = {}
    proc, app = run_deploy(tmp_path, prepare=lockfile_changed(before), FAIL_BUILD="1")
    out = proc.stdout + proc.stderr

    assert proc.returncode != 0, out
    assert "installing deps (npm ci)" in proc.stdout, out
    assert "npm ci" in _effect_lines(tmp_path)
    assert "dependency rollback snapshot taken at" in proc.stdout, out
    assert "Killed" in proc.stderr
    assert "pre-swap dependency recovery OK" in proc.stdout, out
    assert dependency_inputs(app) == before, out
    assert (app / "node_modules" / "marker").read_text() == "x"
    assert not (app / "node_modules" / "installed-from-lock").exists()
    assert not snapshot_dir(app).exists()
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID
    assert not list(app.parent.glob(".stage.*")), "the failed stage was left behind"


def test_mutant_without_the_snapshot_reproduces_the_incident(tmp_path):
    """Remove the snapshot -> the live app must be left on the target's inputs."""
    mutant = _mutate(
        tmp_path,
        '    deps_snapshot_begin "$APP" || exit $?\n',
        '    :  # MUTANT: dependency inputs are not saved\n',
    )
    before: dict = {}
    proc, app = run_deploy(
        tmp_path, script=mutant, prepare=lockfile_changed(before), FAIL_BUILD="1"
    )

    assert proc.returncode != 0
    assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID
    assert (app / "package-lock.json").read_text() == TARGET_LOCK, (
        "mutation was inert — the snapshot is not what returns the accepted lockfile"
    )
    assert (app / "package.json").read_text() == TARGET_PACKAGE
    assert (app / "node_modules" / "installed-from-lock").read_text() == TARGET_LOCK
    assert not (app / "node_modules" / "marker").exists()


def test_deploy_with_unchanged_deps_takes_no_snapshot(tmp_path):
    before: dict = {}
    proc, app = run_deploy(
        tmp_path, prepare=lambda app, tsrc: before.update(dependency_inputs(app)),
        FAIL_BUILD="1",
    )
    out = proc.stdout + proc.stderr

    assert proc.returncode != 0, out
    assert "deps unchanged — skipping npm ci" in proc.stdout, out
    assert "dependency rollback snapshot" not in proc.stdout
    assert "dependency recovery" not in proc.stdout
    assert "npm ci" not in _effect_lines(tmp_path)
    assert dependency_inputs(app) == before
    assert not snapshot_dir(app).exists()


def test_accepted_deploy_discards_the_snapshot_and_keeps_the_new_deps(tmp_path):
    before: dict = {}
    proc, app = run_deploy(tmp_path, prepare=lockfile_changed(before))
    out = proc.stdout + proc.stderr

    # (the sandbox has no ops/terminal-data, so step 8 exits non-zero after acceptance)
    assert "identity verified" in proc.stdout, out
    assert "dependency rollback snapshot discarded: the new generation is accepted" in proc.stdout
    assert proc.stdout.index("dependency rollback snapshot discarded") < proc.stdout.index(
        "identity verified"
    )
    assert "dependency recovery" not in proc.stdout, out
    assert not snapshot_dir(app).exists()
    assert marker_of(app) == NEW_SHA
    assert (app / "package.json").read_text() == TARGET_PACKAGE
    assert (app / "package-lock.json").read_text() == TARGET_LOCK
    assert (app / "node_modules" / "installed-from-lock").read_text() == TARGET_LOCK


def test_post_swap_rollback_restores_dependency_inputs_before_the_restart(tmp_path):
    """A rolled-back generation is restarted. It must come up on the accepted
    dependencies, so they go back before the rollback's restart, not after."""
    before: dict = {}
    probe = tmp_path / "deployroot" / "terminal" / "package-lock.json"
    proc, app = run_deploy(
        tmp_path, prepare=lockfile_changed(before), FAIL_HEALTH="1", MMX_DEPS_PROBE=probe
    )
    out = proc.stdout + proc.stderr

    assert proc.returncode != 0, out
    assert "rolling back" in proc.stdout.lower(), out
    assert "rollback dependency recovery OK" in proc.stdout, out
    assert dependency_inputs(app) == before, out
    assert (app / "node_modules" / "marker").read_text() == "x"
    assert not snapshot_dir(app).exists()
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID
    seen = [l for l in _effect_lines(tmp_path) if l.startswith("restart-saw-lock ")]
    assert seen == [
        f"restart-saw-lock {TARGET_LOCK.strip()}",    # the candidate's activation
        f"restart-saw-lock {ACCEPTED_LOCK.strip()}",  # the rollback's reactivation
    ], seen
    assert "dependency rollback snapshot is unresolved" not in proc.stdout


def test_deploy_that_starts_without_node_modules_recovers_to_none(tmp_path):
    """No tree is itself a reason to install (lockfile identical). The accepted
    generation had none, so a killed build leaves none."""
    before: dict = {}

    def prepare(app: Path, tsrc: Path) -> None:
        shutil.rmtree(app / "node_modules")
        before.update(dependency_inputs(app))

    proc, app = run_deploy(tmp_path, prepare=prepare, FAIL_BUILD="1")
    out = proc.stdout + proc.stderr

    assert before["node_modules"] is None
    assert "npm ci" in _effect_lines(tmp_path), out
    assert "pre-swap dependency recovery OK" in proc.stdout, out
    assert dependency_inputs(app) == before, out
    assert not snapshot_dir(app).exists()


def test_snapshot_failure_refuses_the_install_with_nothing_changed(tmp_path):
    before: dict = {}
    proc, app = run_deploy(
        tmp_path, prepare=lockfile_changed(before),
        FAIL_MV_MATCH=".deps-rollback/node_modules",
    )
    out = proc.stdout + proc.stderr

    assert proc.returncode != 0, out
    assert "could not move" in proc.stdout and "aside for dependency rollback" in proc.stdout, out
    assert "npm ci" not in _effect_lines(tmp_path), "installed without a rollback snapshot"
    assert "npm run build" not in _effect_lines(tmp_path)
    assert dependency_inputs(app) == before, out
    assert not snapshot_dir(app).exists()


def _interrupt_held_install(tmp_path: Path, script: Path, before: dict):
    """Start a deploy, park its `npm ci`, send the owner SIGTERM. Returns
    (popen, release, log, app); the caller decides what must happen next."""
    hold = tmp_path / "npm-ci-hold"
    started, release = Path(f"{hold}.started"), Path(f"{hold}.release")
    argv, env, app = sandbox_deploy(
        tmp_path, script, prepare=lockfile_changed(before), HOLD_NPM_CI=hold
    )
    log = tmp_path / "deploy-output.log"
    with log.open("w") as sink:
        popen = subprocess.Popen(argv, stdout=sink, stderr=subprocess.STDOUT, env=env)
    deadline = time.monotonic() + 120
    while not started.exists():
        assert popen.poll() is None, f"deploy ended before installing:\n{log.read_text()}"
        assert time.monotonic() < deadline, f"install never started:\n{log.read_text()}"
        time.sleep(0.05)
    popen.send_signal(signal.SIGTERM)
    return popen, release, log, app


def test_sigterm_during_the_install_waits_for_it_and_then_recovers(tmp_path):
    """Recovery must not run underneath a still-writing install: the signal is held
    until `npm ci` returns, then ends the attempt as an ordinary recovered failure."""
    before: dict = {}
    popen, release, log, app = _interrupt_held_install(tmp_path, SCRIPT, before)
    try:
        with pytest.raises(subprocess.TimeoutExpired):
            popen.wait(timeout=2)
        assert "dependency recovery" not in log.read_text()
        release.touch()
        popen.wait(timeout=120)
    finally:
        release.touch()
        if popen.poll() is None:
            popen.kill()
    out = log.read_text()

    assert popen.returncode != 0, out
    assert "pre-swap dependency recovery OK" in out, out
    assert "npm run build" not in _effect_lines(tmp_path), "the interrupted deploy kept going"
    assert dependency_inputs(app) == before, out
    assert not snapshot_dir(app).exists()
    assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID


def test_mutant_without_the_signal_traps_recovers_under_a_running_install(tmp_path):
    """Drop the traps -> the owner dies at once and its exit path restores the tree
    while `npm ci` is still running against it. That is the race the traps close."""
    mutant = _mutate(
        tmp_path,
        "    DEPLOY_SIGNALS_TRAPPED=1\n    trap 'exit 129' HUP\n    trap 'exit 130' INT\n"
        "    trap 'exit 143' TERM\n",
        "    :  # MUTANT: production keeps default signal dispositions\n",
    )
    popen, release, log, _ = _interrupt_held_install(tmp_path, mutant, {})
    try:
        popen.wait(timeout=60)
        assert not release.exists(), "the install had already been released"
    finally:
        release.touch()
        if popen.poll() is None:
            popen.kill()
    assert "pre-swap dependency recovery OK" in log.read_text(), (
        "mutation was inert — the deferred-signal test is not exercising the traps"
    )


# -- static structure --

def test_only_production_opens_a_dependency_snapshot():
    """Beta's dependency inputs belong to its own transaction. Exactly one call,
    inside the production-only block of the deps step, before anything is written."""
    body = _deploy_body(code_only=True)
    assert body.count("deps_snapshot_begin") == 1
    deps = body[body.index("installing deps (npm ci)"):body.index("deps unchanged")]
    guard = deps.index('if [ "$TARGET" = production ]; then')
    begin = deps.index('deps_snapshot_begin "$APP" || exit $?')
    assert guard < begin < deps.index("fi", begin)
    assert "fi" not in deps[guard:begin], "the snapshot escaped the production-only block"
    assert begin < deps.index('cp -f "$TSRC/package.json"') < deps.index("npm ci ||")
    assert deps.index("trap 'exit 143' TERM") < begin, (
        "the snapshot opens before the signals that could interrupt it are held"
    )


def test_dependency_snapshot_has_exactly_three_exits():
    body = _deploy_body(code_only=True)
    library = _library()
    assert "deps_snapshot_restore" not in body, (
        "the deploy body restores dependencies itself instead of through the exit "
        "path or the single abort"
    )
    assert library.count('deps_snapshot_restore "$APP"') == 1   # cleanup_deploy_attempt
    assert library.count('deps_snapshot_restore "$app"') == 1   # deploy_generation_abort
    assert body.count("deps_snapshot_discard") == 1
    commit = body.index('deploy_generation_commit "$APP"')
    assert body[commit:].split("\n")[1].strip() == "deps_snapshot_discard", (
        "the snapshot must be discarded only at acceptance, immediately after the "
        "generation is committed"
    )
    abort = library[library.index("deploy_generation_abort(){"):]
    assert abort.index('deps_snapshot_restore "$app"') < abort.index("systemctl restart"), (
        "a rollback restarts the service before its dependencies are back"
    )


# --------------------------------------------------------------------------
# build memory admission, end to end: the refusal is the deploy's first answer
# --------------------------------------------------------------------------
#
# The unit and ordering tests live in test_terminal_build_admission.py. These run
# the real deploy body against a meminfo fixture, with the floor left at its
# default ("" overrides the session pin in conftest.py).

def _meminfo_fixture(tmp_path: Path, available_kb: int, swap_free_kb: int) -> Path:
    path = tmp_path / "meminfo"
    path.write_text(
        "MemTotal:        4014824 kB\n"
        f"MemAvailable:   {available_kb:>8} kB\n"
        "SwapTotal:       8388604 kB\n"
        f"SwapFree:       {swap_free_kb:>8} kB\n"
    )
    return path


def test_deploy_refuses_on_insufficient_memory_before_any_mutation(tmp_path):
    """The incident host: ~1 GiB reclaimable, ~100 MiB swap left, lockfile changed.
    The deploy must stop before the install that began the damage."""
    before: dict = {}
    proc, app = run_deploy(
        tmp_path,
        prepare=lockfile_changed(before),
        meminfo=_meminfo_fixture(tmp_path, 1048576, 102400),
        BUILD_MIN_AVAILABLE_MB="",
    )
    out = proc.stdout + proc.stderr

    assert proc.returncode == 75, out
    assert (
        "FATAL: build memory admission refused: reason=insufficient-build-memory "
        "available_mb=1124 (MemAvailable_mb=1024 SwapFree_mb=100) required_mb=4096"
    ) in proc.stdout, out
    # nothing ran: no preflight, no Git, no install, no build, no service action
    assert _effect_lines(tmp_path) == [], out
    for later in ("source preflight", "installing deps", "next build", "snapshot"):
        assert later not in proc.stdout, out
    receipts = tmp_path / "varlib" / "mastermind-terminal" / "release-preflight"
    assert not receipts.exists(), "a preflight receipt directory was created"
    assert dependency_inputs(app) == before
    assert (app / "node_modules" / "marker").read_text() == "x"
    assert not snapshot_dir(app).exists()
    assert marker_of(app) == OLD_SHA
    assert live_build_id(app) == OLD_BUILD_ID
    assert artifacts(app) == []
    assert not list(app.parent.glob(".stage.*"))
    # The one thing that did happen: the shared build lock was taken, so the
    # measurement is not of a host another deploy is building on, and released.
    assert "build lock acquired" in proc.stdout and "build lock released" in proc.stdout, out
    assert proc.stdout.index("build lock acquired") < proc.stdout.index("admission refused")
    assert not (app.parent / ".terminal-build-resource.lock" / "hold").exists()


def test_deploy_proceeds_when_memory_is_sufficient(tmp_path):
    proc, app = run_deploy(
        tmp_path,
        meminfo=_meminfo_fixture(tmp_path, 2097152, 8283652),
        BUILD_MIN_AVAILABLE_MB="",
    )
    out = proc.stdout + proc.stderr

    assert (
        "build memory admission OK: available_mb=10137 "
        "(MemAvailable_mb=2048 SwapFree_mb=8089) required_mb=4096"
    ) in proc.stdout, out
    assert "identity verified" in proc.stdout, out
    assert proc.stdout.index("build memory admission OK") < proc.stdout.index("source preflight")
    assert marker_of(app) == NEW_SHA
    assert live_build_id(app) == NEW_BUILD_ID


def test_mutant_without_the_memory_admission_runs_into_the_build(tmp_path):
    """Drop the admission -> the same starved host installs and builds."""
    mutant = _mutate(
        tmp_path,
        "require_build_memory /proc/meminfo || exit $?\n",
        "require_build_memory /proc/meminfo || true  # MUTANT\n",
    )
    before: dict = {}
    proc, _ = run_deploy(
        tmp_path,
        script=mutant,
        prepare=lockfile_changed(before),
        meminfo=_meminfo_fixture(tmp_path, 1048576, 102400),
        BUILD_MIN_AVAILABLE_MB="",
    )

    assert "reason=insufficient-build-memory" in proc.stdout
    assert "npm ci" in _effect_lines(tmp_path), (
        "mutation was inert — the admission is not what stops the install"
    )


def test_beta_deploy_refuses_on_insufficient_memory_before_its_workspace_exists(tmp_path):
    """Beta builds on the same host, so it is refused by the same admission — and
    before its own workspace, bootstrap or transaction is touched."""
    argv, env, app = sandbox_deploy(
        tmp_path,
        meminfo=_meminfo_fixture(tmp_path, 1048576, 102400),
        BUILD_MIN_AVAILABLE_MB="",
    )
    proc = subprocess.run(
        argv[:2] + ["--target", "beta"] + argv[2:],
        capture_output=True, text=True, timeout=180, env=env,
    )
    out = proc.stdout + proc.stderr

    assert proc.returncode == 75, out
    assert "target profile resolved: target=beta" in proc.stdout, out
    assert (
        "reason=insufficient-build-memory available_mb=1124 "
        "(MemAvailable_mb=1024 SwapFree_mb=100) required_mb=4096"
    ) in proc.stdout, out
    assert _effect_lines(tmp_path) == [], out
    root = app.parent
    assert not (root / "beta").exists(), "the beta workspace was created before the refusal"
    assert not (root / ".gitsrc-beta").exists()
    beta_state = tmp_path / "varlib" / "mastermind-terminal-beta"
    assert sorted(p.name for p in beta_state.iterdir()) == ["build-lock"], out
    assert "build lock released" in proc.stdout, out
    assert not (root / ".terminal-build-resource.lock" / "hold").exists()
    # production's live generation is not this run's to touch either
    assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID
