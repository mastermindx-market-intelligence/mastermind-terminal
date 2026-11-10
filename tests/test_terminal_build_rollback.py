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
    """The caller must be able to tell that the process cannot be left as it is.

    `next start` resolves .next/* at request time, so a server left bound to a
    renamed tree serves the restored build's chunks against the failed build's
    in-memory manifests. The rollback therefore reports the move even when it could
    not resolve the identity; deploy_generation_abort then restarts a generation it
    proved complete and stops the selected unit otherwise (the abort tests below).
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
        "an unresolved rollback that already moved .next must still report the move:\n"
        f"{r.stdout}\n{r.stderr}"
    )


def _abort_code() -> list[str]:
    lib = _library()
    abort = lib[lib.index("deploy_generation_abort(){"):]
    abort = abort[: abort.index("\n}\n")]
    return [l.strip() for l in abort.splitlines() if l.strip() and not l.lstrip().startswith("#")]


def test_abort_is_a_qualified_restart_or_a_selected_unit_stop():
    """Static: once restoration has run, the abort either reactivates a generation
    whose every leg is proven, or stops the selected unit. There is no path that
    restarts an unresolved generation and none that leaves it serving untouched."""
    code = _abort_code()
    rollback = code.index('deploy_generation_rollback "$app" "$swapped" || rc=$?')
    restore = code.index('if deps_snapshot_restore "$app"; then')
    gate = code.index('if [ "$rc" -ne 0 ]; then')
    moved = code.index('if [ "$DEPLOY_ROLLBACK_MOVED_BUILD" = 1 ]; then')
    restart = next(i for i, l in enumerate(code) if l.startswith("systemctl restart terminal"))
    resolved = code.index('if [ "$rc" = 0 ]; then')
    assert rollback < restore < gate < moved < restart < resolved
    assert code[gate + 1 : gate + 3] == ["deploy_generation_contain", "else"], (
        "an unresolved restoration leg must stop the selected unit, and the "
        "reactivation must be its else"
    )
    assert code[resolved - 1].startswith("fi"), code[resolved - 1]
    assert not any("systemctl" in l for l in code[:gate]), (
        "a service action runs before every restoration leg has been attempted"
    )
    assert all("systemctl restart" not in l for l in code[resolved:]), (
        "the reactivation sits in the reporting branch"
    )
    lib = _library()
    contain = lib[lib.index("deploy_generation_contain(){"):]
    contain = contain[: contain.index("\n}\n")]
    assert 'systemctl stop "$SERVICE_NAME"' in contain
    assert "restart" not in contain.replace("restarted", "")
    assert "systemctl stop terminal" not in contain, "containment names a fixed unit"


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

def _mutate(tmp_path: Path, anchor: str, replacement: str, *more: tuple) -> Path:
    """Write a mutant of the deploy script. `more` is further (anchor, replacement)
    pairs, applied in order; every anchor must still be present exactly as given."""
    text = SCRIPT.read_text()
    for old, new in ((anchor, replacement), *more):
        assert old in text, (
            f"mutation anchor vanished from ops/terminal-build.sh:\n{old!r}\n"
            "The mutation test cannot silently pass — update the anchor with the code."
        )
        text = text.replace(old, new, 1)
    mutant = tmp_path / "mutant-terminal-build.sh"
    mutant.write_text(text)
    mutant.chmod(0o755)
    return mutant


# The PIPE ignore taken with the build lock, for both profiles. Every mutant that
# needs PIPE at its default disposition has to remove this one first.
EARLY_PIPE_IGNORE = "\ntrap '' PIPE\nif [ \"$TARGET\" = beta ]; then\n"
NO_EARLY_PIPE_IGNORE = (
    EARLY_PIPE_IGNORE,
    "\n:  # MUTANT: PIPE keeps its default disposition while the lock is held\n"
    "if [ \"$TARGET\" = beta ]; then\n",
)

# The exit path's own route into the single abort (cleanup_deploy_attempt): an
# open, uncommitted production generation is rolled back there too. A mutant
# that removes a guard in the deploy body must remove this as well before the
# original abort-without-rollback defect can come back.
EXIT_PATH_ABORT = 'if [ "$TARGET" = production ] && [ "${DEPLOY_GENERATION_OPEN:-0}" = 1 ] \\\n'
NO_EXIT_PATH_ABORT = (EXIT_PATH_ABORT, 'if false \\\n')


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
        '[ "$1" = stop ] && [ -n "${FAIL_STOP:-}" ] && { echo "systemctl: simulated stop failure" >&2; exit 1; }\n'
        'exit 0\n'
    ),
    "curl": (
        '#!/bin/sh\n'
        # HOLD_HEALTH parks the post-restart health request, so a test can signal
        # the deploy (or close its output) inside the health-check window.
        'if [ -n "${HOLD_HEALTH:-}" ]; then\n'
        '  : > "$HOLD_HEALTH.started"\n'
        '  while [ ! -e "$HOLD_HEALTH.release" ]; do /bin/sleep 0.05; done\n'
        'fi\n'
        '[ -n "${FAIL_HEALTH:-}" ] && exit 22\nexit 0\n'
    ),
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
        # HOLD_MV_MATCH parks one matching move (before it happens) so a test can
        # signal the deploy while its rollback is in progress.
        'if [ -n "${HOLD_MV_MATCH:-}" ]; then\n'
        '  case "$*" in *"$HOLD_MV_MATCH"*)\n'
        '    : > "$HOLD_MV.started"\n'
        '    while [ ! -e "$HOLD_MV.release" ]; do /bin/sleep 0.05; done ;;\n'
        '  esac\n'
        'fi\n'
        'if [ -n "${FAIL_MV_MATCH:-}" ]; then\n'
        '  case "$*" in *"$FAIL_MV_MATCH"*) echo "mv: simulated failure: $*" >&2; exit 1 ;; esac\n'
        'fi\n'
        # DIE_AFTER_MV_MATCH: a signal sent to the whole process group, landing on
        # one matching move after its rename has happened and before `mv` exits.
        # The owner gets the signal too; this process then dies of it.
        'if [ -n "${DIE_AFTER_MV_MATCH:-}" ]; then\n'
        '  case "$*" in *"$DIE_AFTER_MV_MATCH"*)\n'
        '    /bin/mv "$@" || exit $?\n'
        '    kill -TERM "$PPID"\n'
        '    kill -TERM $$ ;;\n'
        '  esac\n'
        'fi\nexec /bin/mv "$@"\n'
    ),
    # The real rsync, behind one hold: HOLD_RSYNC parks the FIRST call (the stage
    # step's copy of the target source), before any signal trap is taken.
    "rsync": (
        '#!/bin/sh\n'
        'if [ -n "${HOLD_RSYNC:-}" ] && [ ! -e "$HOLD_RSYNC.started" ]; then\n'
        '  : > "$HOLD_RSYNC.started"\n'
        '  while [ ! -e "$HOLD_RSYNC.release" ]; do /bin/sleep 0.05; done\n'
        'fi\n'
        'PATH=${PATH#*:}\n'
        'exec rsync "$@"\n'
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
        NO_EXIT_PATH_ABORT,
    )
    proc, app = run_deploy(tmp_path, script=mutant, FAIL_MV_MATCH=".stage.")
    assert proc.returncode != 0
    assert marker_of(app) == NEW_SHA, (
        "mutation was inert — the swap guard is not what routes a failed move into rollback"
    )


def test_unguarded_swap_move_is_still_rolled_back_on_the_exit_path(tmp_path):
    """The guard alone removed: `set -e` aborts, and the exit path finds the open
    generation and takes it through the same abort."""
    mutant = _mutate(
        tmp_path,
        'if ! mv "$STAGE/.next" "$APP/.next"; then',
        'mv "$STAGE/.next" "$APP/.next"  # MUTANT: unguarded, set -e aborts\nif false; then',
    )
    proc, app = run_deploy(tmp_path, script=mutant, FAIL_MV_MATCH=".stage.")
    assert proc.returncode != 0
    assert marker_of(app) == OLD_SHA, proc.stdout + proc.stderr
    assert live_build_id(app) == OLD_BUILD_ID, proc.stdout + proc.stderr
    assert _service_actions(tmp_path) == ["systemctl restart terminal"]


def test_mutant_unguarded_restart_is_caught(tmp_path):
    """Remove the restart guard -> `set -e` must abort before rollback again."""
    mutant = _mutate(
        tmp_path,
        'if ! systemctl restart terminal; then',
        'systemctl restart terminal  # MUTANT: unguarded, set -e aborts\nif false; then',
        NO_EXIT_PATH_ABORT,
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


def resolved_snapshot_dir(app: Path) -> Path:
    """Where a snapshot lives between a completed restore and its reap."""
    return app.parent / ".deps-rollback.resolved"


def test_dependency_snapshot_restores_files_metadata_and_the_same_tree(tmp_path):
    app = make_deps_app(tmp_path)
    before = dependency_inputs(app)

    r = run_gen(SCRIPT, f'''
        deps_snapshot_begin "{app}" || exit 90
        [ ! -e "{app}/node_modules" ] || exit 91
        [ "$DEPS_SNAPSHOT_DIR" = "{snapshot_dir(app)}" ] || exit 92
        {install_target_deps(app)}
        deps_snapshot_restore "{app}"
        echo "RC=$? OPEN=[$DEPS_SNAPSHOT_DIR] RESOLVED=[$DEPS_SNAPSHOT_RESOLVED_DIR]"
        [ -d "{resolved_snapshot_dir(app)}/node_modules.failed" ] && echo "FAILED_TREE_KEPT_UNTIL_REAP"
        [ ! -e "{snapshot_dir(app)}" ] && echo "UNRESOLVED_NAME_RELEASED"
        deps_snapshot_reap
        echo "REAP_RC=$? RESOLVED=[$DEPS_SNAPSHOT_RESOLVED_DIR]"
        [ ! -e "{resolved_snapshot_dir(app)}" ] && echo "REAPED"
    ''')

    # The restore only puts things back and marks the snapshot resolved, on disk
    # as well as in memory: it takes the resolved name. Deleting it (the failed
    # tree included) is a separate, later step: deps_snapshot_reap.
    assert f"RC=0 OPEN=[] RESOLVED=[{resolved_snapshot_dir(app)}]" in r.stdout, r.stdout + r.stderr
    assert "FAILED_TREE_KEPT_UNTIL_REAP" in r.stdout, r.stdout + r.stderr
    assert "UNRESOLVED_NAME_RELEASED" in r.stdout, r.stdout + r.stderr
    assert "REAP_RC=0 RESOLVED=[]" in r.stdout, r.stdout + r.stderr
    assert "REAPED" in r.stdout, r.stdout + r.stderr
    assert dependency_inputs(app) == before
    assert (app / "node_modules" / "next" / "version").read_text() == "16.2.9\n"
    assert not snapshot_dir(app).exists(), "a reaped snapshot must not be left behind"


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
        deps_snapshot_reap
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


def test_resolved_snapshot_from_a_killed_attempt_is_purged_and_an_open_one_is_not(tmp_path):
    """A snapshot whose restore completed holds only a failed attempt's tree. It
    carries its own name, and only that name is ever purged at the start of a run:
    an unresolved snapshot beside it is not this function's to touch."""
    app = make_deps_app(tmp_path)
    resolved, unresolved = resolved_snapshot_dir(app), snapshot_dir(app)
    (resolved / "node_modules.failed" / "next").mkdir(parents=True)
    (unresolved / "node_modules" / "next").mkdir(parents=True)
    (unresolved / "package-lock.json").write_text("still owed to the live app\n")
    before = dependency_inputs(app)

    r = run_gen(SCRIPT, f'''
        deps_snapshot_purge_resolved "{app}"
        echo "RC=$?"
    ''')

    assert "RC=0" in r.stdout, r.stdout + r.stderr
    assert "discarding a resolved dependency rollback snapshot left by an interrupted " \
        f"earlier attempt: {resolved}" in r.stdout
    assert not resolved.exists()
    assert (unresolved / "package-lock.json").read_text() == "still owed to the live app\n"
    assert (unresolved / "node_modules" / "next").is_dir()
    assert dependency_inputs(app) == before

    quiet = run_gen(SCRIPT, f'deps_snapshot_purge_resolved "{app}"; echo "RC=$?"')
    assert quiet.stdout.strip() == "RC=0", quiet.stdout + quiet.stderr


def test_restore_keeps_the_open_name_when_the_resolved_name_is_taken(tmp_path):
    """The rename to the resolved name is a label, not a restoration leg: when the
    name is occupied the restore still succeeds and the reap still deletes what
    this attempt resolved, and nothing else."""
    app = make_deps_app(tmp_path)
    (resolved_snapshot_dir(app) / "someone-elses").mkdir(parents=True)
    before = dependency_inputs(app)

    r = run_gen(SCRIPT, f'''
        deps_snapshot_begin "{app}" || exit 90
        {install_target_deps(app)}
        deps_snapshot_restore "{app}"
        echo "RC=$? OPEN=[$DEPS_SNAPSHOT_DIR] RESOLVED=[$DEPS_SNAPSHOT_RESOLVED_DIR]"
        deps_snapshot_reap
    ''')

    assert f"RC=0 OPEN=[] RESOLVED=[{snapshot_dir(app)}]" in r.stdout, r.stdout + r.stderr
    assert dependency_inputs(app) == before
    assert not snapshot_dir(app).exists()
    assert (resolved_snapshot_dir(app) / "someone-elses").is_dir()


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
        deps_snapshot_reap
    ''')

    assert "BEGIN_RC=73" in r.stdout, r.stdout + r.stderr
    assert "RESTORE_RC=0 OPEN=[]" in r.stdout, r.stdout + r.stderr
    assert dependency_inputs(app) == before
    assert not snapshot_dir(app).exists()


def assert_failed_tree_swap_left_the_attempt_in_place(app: Path) -> None:
    """The state a failed node_modules swap must leave: nothing half-restored.

    Returning the accepted package files beside the attempt's tree would produce a
    generation that never existed AND hide it from the next release preflight. So
    the target's files stay (TRACKED_MODIFIED keeps the next deploy refused), the
    attempt's tree stays, and every saved input is still in the snapshot.
    """
    snap = snapshot_dir(app)
    assert (app / "package.json").read_text() == TARGET_PACKAGE
    assert (app / "package-lock.json").read_text() == TARGET_LOCK
    assert (app / "node_modules" / "next" / "version").read_text() == "16.4.6\n"
    assert (snap / "package.json").read_text() == ACCEPTED_PACKAGE
    assert (snap / "package-lock.json").read_text() == ACCEPTED_LOCK
    assert (snap / "node_modules" / "next" / "version").read_text() == "16.2.9\n"
    assert not (snap / "node_modules.failed").exists()


def test_failed_restore_keeps_the_snapshot_for_attended_recovery(tmp_path):
    app = make_deps_app(tmp_path)

    r = run_gen(SCRIPT, f'''
        deps_snapshot_begin "{app}" || exit 90
        {install_target_deps(app)}
        mv() {{ case "$*" in *"node_modules.failed"*) return 1 ;; esac; command mv "$@"; }}
        deps_snapshot_restore "{app}"
        echo "RC=$? OPEN=[$DEPS_SNAPSHOT_DIR] RESOLVED=[$DEPS_SNAPSHOT_RESOLVED_DIR]"
        deps_snapshot_reap
    ''')

    assert f"RC=1 OPEN=[{snapshot_dir(app)}] RESOLVED=[]" in r.stdout, r.stdout + r.stderr
    assert "package files are left exactly as this attempt wrote them" in r.stdout
    # the accepted tree is still intact in the snapshot, not destroyed by the attempt,
    # and an unresolved snapshot is never reaped
    assert_failed_tree_swap_left_the_attempt_in_place(app)


@pytest.mark.parametrize("name", ["package.json", "package-lock.json"])
def test_restore_refuses_a_saved_manifest_that_is_not_the_snapshotted_one(tmp_path, name):
    """The digest recorded at snapshot time is the proof, not a second copy. A
    saved file that no longer matches it restores NOTHING: the check runs before
    the first move."""
    app = make_deps_app(tmp_path)

    r = run_gen(SCRIPT, f'''
        deps_snapshot_begin "{app}" || exit 90
        {install_target_deps(app)}
        printf 'tampered\\n' > "{snapshot_dir(app)}/{name}"
        deps_snapshot_restore "{app}"
        echo "RC=$? OPEN=[$DEPS_SNAPSHOT_DIR]"
    ''')

    assert f"RC=1 OPEN=[{snapshot_dir(app)}]" in r.stdout, r.stdout + r.stderr
    assert f"the saved {name} is not the file that was snapshotted" in r.stdout
    assert "nothing was restored" in r.stdout
    assert (app / "package.json").read_text() == TARGET_PACKAGE
    assert (app / "package-lock.json").read_text() == TARGET_LOCK
    assert (app / "node_modules" / "next" / "version").read_text() == "16.4.6\n"
    assert (snapshot_dir(app) / "node_modules" / "next" / "version").read_text() == "16.2.9\n"


def test_restore_on_a_full_disk_needs_no_new_blocks(tmp_path):
    """A failed build is exactly when the filesystem is full. Every restore step is
    a rename inside one filesystem, proved by digests recorded when the snapshot
    was taken; with every copy and compare failing as they would on ENOSPC the
    accepted inputs still come back, byte and metadata exact."""
    app = make_deps_app(tmp_path)
    before = dependency_inputs(app)

    r = run_gen(SCRIPT, f'''
        deps_snapshot_begin "{app}" || exit 90
        {install_target_deps(app)}
        cp() {{ echo "cp: simulated ENOSPC: $*" >&2; return 1; }}
        cmp() {{ echo "cmp: simulated failure: $*" >&2; return 1; }}
        install() {{ echo "install: simulated ENOSPC: $*" >&2; return 1; }}
        mktemp() {{ echo "mktemp: simulated ENOSPC" >&2; return 1; }}
        deps_snapshot_restore "{app}"
        echo "RC=$? OPEN=[$DEPS_SNAPSHOT_DIR]"
    ''')

    assert "RC=0 OPEN=[]" in r.stdout, r.stdout + r.stderr
    assert "simulated" not in r.stderr, (
        "the restore tried to write new data; on a full disk that step fails:\n" + r.stderr
    )
    assert dependency_inputs(app) == before
    assert (app / "node_modules" / "next" / "version").read_text() == "16.2.9\n"


def test_restore_is_rename_only_by_construction():
    """Static twin of the full-disk test: nothing in the restore allocates."""
    lib = _library()
    restore = lib[lib.index("deps_snapshot_restore(){"):]
    restore = restore[: restore.index("\n}\n")]
    code = "\n".join(
        l for l in restore.splitlines() if l.strip() and not l.lstrip().startswith("#")
    )
    for writer in ("cp ", "cmp ", "install ", "mktemp", "rsync", "tar ", "rm -rf", " > "):
        assert writer not in code, f"the restore uses {writer!r}"
    assert code.count("mv ") == 3, (
        "tree back, each saved file back, then the snapshot to its resolved name: renames only"
    )
    assert "deps_file_sha256" in code


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
    """Bash for: deps installed into the live app, then the attempt ends pre-swap.
    Service effects are recorded, never executed (see exit_path_service_calls)."""
    return f'''
        SRC="{repo}"
        APP="{live}"
        SERVICE_NAME=terminal
        systemctl() {{ printf '%s\\n' "$*" >> "{live.parent}/service-calls"; }}
        DEPLOYMENT_MARKER="{marker}"
        CANONICAL_RECOVERY_SHA="{old_sha}"
        CANONICAL_RECOVERY_ARMED={armed}
        STAGE_ROOT=
        {'deps_snapshot_begin "$APP" || exit 90' if snapshot else ': # the pre-fix deploy saved nothing'}
        {install_target_deps(live)}
        {status}
        cleanup_deploy_attempt
    '''


def exit_path_service_calls(live: Path) -> list[str]:
    calls = live.parent / "service-calls"
    return calls.read_text().splitlines() if calls.exists() else []


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
    assert not snapshot_dir(live).exists() and not resolved_snapshot_dir(live).exists()
    assert _git(repo, "rev-parse", "HEAD") == old_sha
    assert exit_path_service_calls(live) == [], "a clean pre-swap recovery touched the service"

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


def failed_pre_swap_restore_exit(repo: Path, live: Path, marker: Path, old_sha: str) -> str:
    return killed_build_exit(repo, live, marker, old_sha).replace(
        "cleanup_deploy_attempt",
        'mv() { case "$*" in *"node_modules.failed"*) return 1 ;; esac; command mv "$@"; }\n'
        "false\ncleanup_deploy_attempt",
    )


def test_failed_dependency_restore_is_fatal_and_retains_the_snapshot(tmp_path):
    repo, live, marker, receipts, policy, old_sha, _ = make_dependency_incident_fixture(tmp_path)

    r = run_gen(SCRIPT, failed_pre_swap_restore_exit(repo, live, marker, old_sha))

    assert r.returncode == 74, r.stdout + r.stderr
    assert "FATAL: pre-swap dependency recovery failed; the saved inputs are retained at " \
        f"{snapshot_dir(live)}" in r.stdout
    assert "pre-swap dependency recovery OK" not in r.stdout
    # The accepted build is still running, beside a dependency tree that is not the
    # accepted one: the selected unit is stopped, as for any unresolved leg.
    assert exit_path_service_calls(live) == ["stop terminal"], r.stdout + r.stderr
    assert "containment: terminal was stopped" in r.stdout, r.stdout + r.stderr
    # The live app is left as this attempt wrote it, not half-restored: accepted
    # package files beside the attempt's tree would look clean and be wrong.
    assert_failed_tree_swap_left_the_attempt_in_place(live)
    assert _git(repo, "rev-parse", "HEAD") == old_sha

    # ...which is what keeps the failure visible: the next deploy is refused.
    nxt = release_preflight(repo, receipts, policy)
    assert nxt.returncode != 0, (
        "a failed dependency restore left a state the next preflight accepts:\n"
        + nxt.stdout + nxt.stderr
    )
    assert "source preflight CLEAN" not in nxt.stdout


def test_mutant_without_pre_swap_containment_leaves_the_unit_running(tmp_path):
    """Remove the stop -> exit 74 with the accepted process still serving from a
    dependency tree nobody proved."""
    repo, live, marker, _, _, old_sha, _ = make_dependency_incident_fixture(tmp_path)
    mutant = _mutate(
        tmp_path,
        "        deploy_generation_contain\n      fi\n    else\n",
        "        :  # MUTANT: a failed pre-swap restore stops nothing\n      fi\n    else\n",
    )

    r = run_gen(mutant, failed_pre_swap_restore_exit(repo, live, marker, old_sha))

    assert r.returncode == 74, r.stdout + r.stderr
    assert "FATAL: pre-swap dependency recovery failed" in r.stdout, r.stdout + r.stderr
    assert exit_path_service_calls(live) == [], (
        "mutation was inert — the stop does not come from the pre-swap failure branch"
    )


def test_deploy_whose_pre_swap_dependency_restore_fails_stops_the_unit(tmp_path):
    """The same branch through the executed deploy: the build is killed, the tree
    will not go back, and the exit is 74 with the selected unit stopped."""
    before: dict = {}
    proc, app = run_deploy(
        tmp_path, prepare=lockfile_changed(before), FAIL_BUILD="1",
        FAIL_MV_MATCH="node_modules.failed",
    )
    out = proc.stdout + proc.stderr

    assert proc.returncode == 74, out
    assert "FATAL: pre-swap dependency recovery failed" in proc.stdout, out
    assert _service_actions(tmp_path) == ["systemctl stop terminal"], out
    assert "containment: terminal was stopped" in proc.stdout, out
    assert snapshot_dir(app).is_dir(), "the unresolved snapshot must be retained"
    assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID


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


def test_every_production_deploy_purges_a_resolved_snapshot_and_only_that(tmp_path):
    """Not only on a lockfile change: a deploy that installs nothing still deletes
    a resolved snapshot left by a killed attempt, at its start. An unresolved one
    keeps its existing rule (discarded, loudly, by the next dependency install)."""
    before: dict = {}

    def prepare(app: Path, tsrc: Path) -> None:
        (resolved_snapshot_dir(app) / "node_modules.failed" / "next").mkdir(parents=True)
        (snapshot_dir(app) / "node_modules").mkdir(parents=True)
        (snapshot_dir(app) / "package-lock.json").write_text("unresolved\n")
        before.update(dependency_inputs(app))

    proc, app = run_deploy(tmp_path, prepare=prepare, FAIL_BUILD="1")
    out = proc.stdout + proc.stderr

    assert proc.returncode != 0, out
    assert "deps unchanged — skipping npm ci" in proc.stdout, out
    assert "discarding a resolved dependency rollback snapshot" in proc.stdout, out
    assert proc.stdout.index("discarding a resolved dependency rollback snapshot") \
        < proc.stdout.index("GIT-GATED: deploying accepted target"), out
    assert not resolved_snapshot_dir(app).exists()
    assert (snapshot_dir(app) / "package-lock.json").read_text() == "unresolved\n"
    assert dependency_inputs(app) == before


def test_mutant_without_the_start_of_run_purge_keeps_the_resolved_snapshot(tmp_path):
    mutant = _mutate(
        tmp_path,
        'if [ "$TARGET" = production ]; then deps_snapshot_purge_resolved "$APP"; fi\n',
        ':  # MUTANT: a resolved snapshot waits for the next lockfile change\n',
    )
    proc, app = run_deploy(
        tmp_path, script=mutant, FAIL_BUILD="1",
        prepare=lambda app, tsrc: (resolved_snapshot_dir(app) / "node_modules.failed").mkdir(parents=True),
    )
    assert proc.returncode != 0
    assert resolved_snapshot_dir(app).is_dir(), (
        "mutation was inert — the start-of-run purge is not what removes the snapshot"
    )


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
        '    deploy_take_signal_traps\n    deps_snapshot_begin "$APP" || exit $?\n',
        "    :  # MUTANT: production keeps default signal dispositions here\n"
        '    deps_snapshot_begin "$APP" || exit $?\n',
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


# -- the abort's containment decision: a qualified restart, or the unit stopped --
#
# deploy_generation_abort runs three restoration legs: the build, the marker and
# the dependency inputs. The decision that follows is cumulative. Only a
# generation whose every leg is proven is reactivated; if any leg is unresolved
# the selected unit is stopped, whether or not the build moved. First against the
# function itself (service effects and the Investigation admission stubbed, every
# restoration step real), then against the executed deploy body.

STALE_BUILD_ID = "build-STALE-TWO-GENS"


def _service_actions(tmp_path: Path) -> list[str]:
    return [
        line for line in _effect_lines(tmp_path)
        if line.startswith(("systemctl restart", "systemctl stop"))
    ]


def _abort_fault(app: Path, leg: str | None) -> str | None:
    """The one `mv` argument pair that fails for a leg — the exact backup-to-live
    move, so the forward swap and every other leg keep working."""
    return {
        None: None,
        "deps-tree": "node_modules.failed",
        "package.json": f"{snapshot_dir(app)}/package.json {app}/package.json",
        "package-lock.json": f"{snapshot_dir(app)}/package-lock.json {app}/package-lock.json",
        "build": f"{app}/.next.bak {app}/.next",
        "marker": f"{app}/.deployment-id.bak {app}/.deployment-id",
        "no-backup": None,
    }[leg]


def run_abort(tmp_path: Path, script: Path = SCRIPT, *, leg: str | None = None,
              swapped: int = 1, stale_backup: bool = False,
              service: str = "terminal", stop_fails: bool = False) -> tuple:
    """Drive deploy_generation_abort itself. Returns (result, app, calls, before)."""
    app = make_deps_app(tmp_path)
    (app / ".deployment-id").write_text(OLD_SHA + "\n")
    (app / ".next").mkdir()
    (app / ".next" / "BUILD_ID").write_text(OLD_BUILD_ID + "\n")
    staged = staged_marker(tmp_path, NEW_SHA)
    calls = tmp_path / "service-calls"
    before = dependency_inputs(app)
    if swapped and leg != "no-backup":
        swap = (
            f'command mv "$APP/.next" "$APP/.next.bak" || exit 92\n'
            f'mkdir "$APP/.next" || exit 92\n'
            f"printf '%s\\n' '{NEW_BUILD_ID}' > \"$APP/.next/BUILD_ID\"\n"
        )
    elif swapped:
        # A first deploy, or a backup that was lost: the failed candidate is the
        # live build and there is nothing to return to.
        swap = f"printf '%s\\n' '{NEW_BUILD_ID}' > \"$APP/.next/BUILD_ID\"\n"
    elif stale_backup:
        swap = (
            f'mkdir "$APP/.next.bak" || exit 92\n'
            f"printf '%s\\n' '{STALE_BUILD_ID}' > \"$APP/.next.bak/BUILD_ID\"\n"
        )
    else:
        swap = ""
    fault = _abort_fault(app, leg)
    inject = (
        f'mv() {{ case "$*" in *"{fault}"*) echo "mv: simulated failure: $*" >&2; return 1 ;; '
        f'esac; command mv "$@"; }}\n' if fault else ""
    )
    r = run_gen(script, f'''
        APP="{app}"
        SERVICE_NAME="{service}"
        systemctl() {{
          printf '%s\\n' "$*" >> "{calls}"
          if [ "$1" = stop ] && [ "{int(stop_fails)}" = 1 ]; then return 1; fi
          return 0
        }}
        investigation_restoration_activation_allowed() {{ return 0; }}
        require_investigation_closed_after_start() {{ return 0; }}
        deps_snapshot_begin "$APP" || exit 90
        {install_target_deps(app)}
        deploy_generation_begin "$APP" "{staged}" || exit 91
        {swap}
        {inject}
        deploy_generation_abort "$APP" "{NEW_SHA}" {swapped} fixture-failure
        echo "ABORT_RC=$? OPEN=[$DEPS_SNAPSHOT_DIR] MOVED=$DEPLOY_ROLLBACK_MOVED_BUILD"
    ''')
    recorded = calls.read_text().splitlines() if calls.exists() else []
    return r, app, recorded, before


def test_abort_restarts_the_prior_generation_when_every_leg_is_proven(tmp_path):
    r, app, calls, before = run_abort(tmp_path)

    assert "ABORT_RC=1 OPEN=[] MOVED=1" in r.stdout, r.stdout + r.stderr
    assert calls == ["restart terminal"], calls
    assert "rollback dependency recovery OK" in r.stdout
    assert "rolled back —" in r.stdout and "ROLLBACK INCOMPLETE" not in r.stdout
    assert "rollback activation withheld" not in r.stdout
    assert dependency_inputs(app) == before
    assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID
    assert (app / ".next.broken" / "BUILD_ID").read_text().strip() == NEW_BUILD_ID


@pytest.mark.parametrize(
    "leg", ["deps-tree", "package.json", "package-lock.json", "build", "marker", "no-backup"]
)
def test_abort_stops_the_selected_unit_when_any_restoration_leg_is_unresolved(tmp_path, leg):
    """Fault injection at deploy_generation_abort itself, one leg at a time. The
    unit is stopped and never restarted: no process may keep serving, or be brought
    back up on, a generation the rollback could not prove."""
    r, app, calls, before = run_abort(tmp_path, leg=leg)
    out = r.stdout + r.stderr
    snap = snapshot_dir(app)

    assert "ABORT_RC=1" in r.stdout, out
    assert calls == ["stop terminal"], f"{leg}: {calls}\n{out}"
    assert "rollback activation withheld: a restoration leg" in r.stdout, out
    assert "containment: terminal was stopped" in r.stdout, out
    assert "ROLLBACK INCOMPLETE" in r.stdout and "rolled back —" not in r.stdout, out

    if leg in ("deps-tree", "package.json", "package-lock.json"):
        # the build and marker legs succeeded; the dependency leg alone decides
        assert f"OPEN=[{snap}] MOVED=1" in r.stdout, out
        assert "FATAL: rollback dependency recovery failed; the saved inputs are retained at " \
            f"{snap}" in r.stdout, out
        assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID
    else:
        assert "OPEN=[]" in r.stdout, out
        assert "rollback dependency recovery OK" in r.stdout, out
        assert dependency_inputs(app) == before

    if leg == "deps-tree":
        assert_failed_tree_swap_left_the_attempt_in_place(app)
    elif leg in ("package.json", "package-lock.json"):
        other = "package-lock.json" if leg == "package.json" else "package.json"
        accepted = {"package.json": ACCEPTED_PACKAGE, "package-lock.json": ACCEPTED_LOCK}
        target = {"package.json": TARGET_PACKAGE, "package-lock.json": TARGET_LOCK}
        # the tree did go back, and so did the other file; the one that could not
        # move is still the target's in the app and still saved in the snapshot
        assert (app / "node_modules" / "next" / "version").read_text() == "16.2.9\n"
        assert (app / leg).read_text() == target[leg]
        assert (snap / leg).read_text() == accepted[leg]
        assert (app / other).read_text() == accepted[other]
        assert not (snap / other).exists()
        assert (snap / "node_modules.failed" / "next" / "version").read_text() == "16.4.6\n"
    elif leg == "build":
        assert "MOVED=1" in r.stdout, out
        assert not (app / ".next").exists(), "the build restore was not the move that failed"
        assert (app / ".next.bak" / "BUILD_ID").read_text().strip() == OLD_BUILD_ID
        assert (app / ".next.broken" / "BUILD_ID").read_text().strip() == NEW_BUILD_ID
        assert marker_of(app) == OLD_SHA
    elif leg == "marker":
        assert "MOVED=1" in r.stdout, out
        assert live_build_id(app) == OLD_BUILD_ID
        assert marker_of(app) == NEW_SHA, "the marker restore was not the move that failed"
    else:
        # The important one: nothing moved, so the moved flag is 0 — and the
        # failed candidate is still the live build a process may be serving.
        assert "MOVED=0" in r.stdout, out
        assert live_build_id(app) == NEW_BUILD_ID
        assert not (app / ".next.broken").exists()
        assert marker_of(app) == OLD_SHA


def test_abort_before_the_swap_neither_restarts_nor_stops(tmp_path):
    """A good pre-swap recovery: nothing moved and every leg is proven, so the
    running generation is left exactly as it is — stale build backup included."""
    r, app, calls, before = run_abort(tmp_path, swapped=0, stale_backup=True)

    assert "ABORT_RC=1 OPEN=[] MOVED=0" in r.stdout, r.stdout + r.stderr
    assert calls == [], calls
    assert "rollback dependency recovery OK" in r.stdout
    assert "rolled back —" in r.stdout and "ROLLBACK INCOMPLETE" not in r.stdout
    assert live_build_id(app) == OLD_BUILD_ID
    assert (app / ".next.bak" / "BUILD_ID").read_text().strip() == STALE_BUILD_ID
    assert not (app / ".next.broken").exists()
    assert marker_of(app) == OLD_SHA
    assert dependency_inputs(app) == before


@pytest.mark.parametrize("leg", [None, "deps-tree", "no-backup"])
def test_abort_acts_only_on_the_selected_service(tmp_path, leg):
    r, _, calls, _ = run_abort(tmp_path, leg=leg, service="terminal-canary")

    expected = "restart" if leg is None else "stop"
    assert calls == [f"{expected} terminal-canary"], calls
    assert all(call.split()[-1] != "terminal" for call in calls)
    assert "terminal was stopped" not in r.stdout


def test_failed_containment_stop_is_unresolved_never_reported_as_stopped(tmp_path):
    r, _, calls, _ = run_abort(
        tmp_path, leg="deps-tree", service="terminal-canary", stop_fails=True
    )
    out = r.stdout + r.stderr

    assert calls == ["stop terminal-canary"], calls
    assert "FATAL: containment stop of terminal-canary FAILED" in r.stdout, out
    assert "a process may still be serving an unresolved generation" in r.stdout, out
    assert "was stopped" not in r.stdout, "a failed stop was reported as process absence"
    assert "ROLLBACK INCOMPLETE" in r.stdout and "rolled back —" not in r.stdout, out
    assert "ABORT_RC=1" in r.stdout, out


@pytest.mark.parametrize(
    ("leg", "inherited"),
    [
        ("no-backup", []),                    # the failed candidate is left serving
        ("deps-tree", ["restart terminal"]),  # restarted onto a tree that is not its own
    ],
)
def test_mutant_without_cumulative_containment_is_caught(tmp_path, leg, inherited):
    """Take the cumulative gate out -> the decision falls back to the moved flag
    alone, and both defects it closes must reappear."""
    mutant = _mutate(
        tmp_path,
        '  if [ "$rc" -ne 0 ]; then\n    deploy_generation_contain\n  else\n',
        '  if false; then  # MUTANT: the moved flag alone decides\n'
        '    deploy_generation_contain\n  else\n',
    )
    _, _, calls, _ = run_abort(tmp_path, mutant, leg=leg)
    assert calls == inherited, (
        "mutation was inert — the cumulative gate is not what stops the unit: "
        f"{calls}"
    )


# The same decision, in the executed deploy body. The candidate's own activation
# is the one `systemctl restart terminal` every post-swap failure starts with.

def test_post_swap_rollback_with_every_leg_proven_restarts_and_never_stops(tmp_path):
    before: dict = {}
    proc, app = run_deploy(tmp_path, prepare=lockfile_changed(before), FAIL_HEALTH="1")
    out = proc.stdout + proc.stderr

    assert proc.returncode == 1, out
    assert _service_actions(tmp_path) == ["systemctl restart terminal"] * 2, out
    assert "rolled back —" in proc.stdout and "ROLLBACK INCOMPLETE" not in proc.stdout, out
    assert dependency_inputs(app) == before, out
    assert not snapshot_dir(app).exists()


@pytest.mark.parametrize("stop_fails", [False, True])
def test_post_swap_failed_tree_swap_stops_the_unit_and_keeps_the_saved_tree(
    tmp_path, stop_fails
):
    """Health fails after activation, then the attempt's node_modules cannot be
    moved aside. No second restart; the selected unit alone is stopped; the saved
    accepted tree is kept; the live state says exactly what is there."""
    before: dict = {}
    flags = {"FAIL_STOP": "1"} if stop_fails else {}
    proc, app = run_deploy(
        tmp_path, prepare=lockfile_changed(before), FAIL_HEALTH="1",
        FAIL_MV_MATCH="node_modules.failed", **flags,
    )
    out = proc.stdout + proc.stderr
    snap = snapshot_dir(app)

    assert proc.returncode == 74, out
    assert _service_actions(tmp_path) == [
        "systemctl restart terminal",   # the candidate's activation
        "systemctl stop terminal",      # containment; never a second restart
    ], out
    assert f"FATAL: rollback dependency recovery failed; the saved inputs are retained at {snap}" \
        in proc.stdout, out
    assert "rollback dependency recovery OK" not in proc.stdout
    assert "ROLLBACK INCOMPLETE" in proc.stdout and "rolled back —" not in proc.stdout, out
    assert "dependency rollback snapshot is unresolved after live identity began moving" \
        in proc.stdout, out
    if stop_fails:
        assert "FATAL: containment stop of terminal FAILED" in proc.stdout, out
        assert "was stopped" not in proc.stdout, out
    else:
        assert "containment: terminal was stopped" in proc.stdout, out

    # build and marker did go back; the dependency inputs are the attempt's, whole
    assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID
    assert (app / "package.json").read_text() == TARGET_PACKAGE
    assert (app / "package-lock.json").read_text() == TARGET_LOCK
    assert (app / "node_modules" / "installed-from-lock").read_text() == TARGET_LOCK
    assert not (app / "node_modules" / "marker").exists()
    assert (snap / "node_modules" / "marker").read_text() == "x"
    assert (snap / "package.json").read_text() == ACCEPTED_PACKAGE
    assert (snap / "package-lock.json").read_text() == ACCEPTED_LOCK
    assert not (snap / "node_modules.failed").exists()


@pytest.mark.parametrize("name", ["package.json", "package-lock.json"])
def test_post_swap_failed_manifest_restore_stops_the_unit(tmp_path, name):
    """Each saved manifest failing to move back, separately. The tree is already
    back by then; the file that could not move stays the target's in the app (so
    the next preflight refuses) and stays saved in the snapshot."""
    before: dict = {}
    proc, app = run_deploy(
        tmp_path, prepare=lockfile_changed(before), FAIL_HEALTH="1",
        FAIL_MV_MATCH=f".deps-rollback/{name} ",
    )
    out = proc.stdout + proc.stderr
    snap = snapshot_dir(app)
    other = "package-lock.json" if name == "package.json" else "package.json"
    accepted = {"package.json": ACCEPTED_PACKAGE, "package-lock.json": ACCEPTED_LOCK}
    target = {"package.json": TARGET_PACKAGE, "package-lock.json": TARGET_LOCK}

    assert proc.returncode == 74, out
    assert _service_actions(tmp_path) == [
        "systemctl restart terminal", "systemctl stop terminal",
    ], out
    assert f"FATAL: could not move the saved {name} back to" in proc.stdout, out
    assert "ROLLBACK INCOMPLETE" in proc.stdout and "rolled back —" not in proc.stdout, out
    assert (app / name).read_text() == target[name]
    assert (snap / name).read_text() == accepted[name]
    assert (app / other).read_bytes() == before[other][0]
    assert (app / "node_modules" / "marker").read_text() == "x"
    assert dependency_inputs(app)["node_modules"] == before["node_modules"]
    assert (snap / "node_modules.failed" / "installed-from-lock").read_text() == TARGET_LOCK
    assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID


@pytest.mark.parametrize("leg", ["build", "marker"])
def test_post_swap_failed_build_or_marker_restore_stops_the_unit(tmp_path, leg):
    """The failure injected only at the exact backup-to-live move. Dependencies
    recover; the generation is still unproven, so nothing is reactivated."""
    before: dict = {}
    app_path = tmp_path / "deployroot" / "terminal"
    proc, app = run_deploy(
        tmp_path, prepare=lockfile_changed(before), FAIL_HEALTH="1",
        FAIL_MV_MATCH=_abort_fault(app_path, leg),
    )
    out = proc.stdout + proc.stderr

    assert app == app_path
    assert proc.returncode == 1, out
    assert "new build OK" in proc.stdout, f"the injected failure hit the forward path:\n{out}"
    assert _service_actions(tmp_path) == [
        "systemctl restart terminal", "systemctl stop terminal",
    ], out
    assert "rollback dependency recovery OK" in proc.stdout, out
    assert "ROLLBACK INCOMPLETE" in proc.stdout and "rolled back —" not in proc.stdout, out
    assert dependency_inputs(app) == before, out
    assert not snapshot_dir(app).exists()
    if leg == "build":
        assert not (app / ".next").exists()
        assert (app / ".next.bak" / "BUILD_ID").read_text().strip() == OLD_BUILD_ID
        assert marker_of(app) == OLD_SHA
    else:
        assert live_build_id(app) == OLD_BUILD_ID
        assert marker_of(app) == NEW_SHA


def test_pre_swap_recovery_with_a_stale_build_backup_touches_no_service(tmp_path):
    """The other half of the distinction: a pre-swap failure that recovers cleanly
    leaves the running generation alone. Nothing is restarted and nothing stopped;
    the accepted build and a stale backup from an older deploy are both untouched."""
    before: dict = {}

    def prepare(app: Path, tsrc: Path) -> None:
        (app / ".next.bak").mkdir()
        (app / ".next.bak" / "BUILD_ID").write_text(STALE_BUILD_ID + "\n")
        lockfile_changed(before)(app, tsrc)

    proc, app = run_deploy(tmp_path, prepare=prepare, FAIL_BUILD="1")
    out = proc.stdout + proc.stderr

    assert proc.returncode != 0, out
    assert "pre-swap dependency recovery OK" in proc.stdout, out
    assert _service_actions(tmp_path) == [], out
    assert "rolling back" not in proc.stdout.lower(), out
    assert live_build_id(app) == OLD_BUILD_ID
    assert (app / ".next.bak" / "BUILD_ID").read_text().strip() == STALE_BUILD_ID
    assert not (app / ".next.broken").exists()
    assert marker_of(app) == OLD_SHA
    assert dependency_inputs(app) == before, out
    assert not snapshot_dir(app).exists()


def deps_unchanged(record: dict):
    """Fixture adjustment for the default path: identical lockfiles, so the deploy
    skips its install and opens no snapshot. Records the inputs before the run."""
    def prepare(app: Path, tsrc: Path) -> None:
        record.update(dependency_inputs(app))
    return prepare


DEPS_PATHS = pytest.mark.parametrize(
    "deps", [lockfile_changed, deps_unchanged], ids=["deps-changed", "deps-unchanged"]
)


def _interrupt_held_rollback(tmp_path: Path, script: Path, before: dict,
                             deps=lockfile_changed):
    """Run a deploy into its post-swap abort, park the rollback's first move, send
    the owner SIGTERM while it is parked, then let the move finish."""
    hold = tmp_path / "rollback-mv-hold"
    started, release = Path(f"{hold}.started"), Path(f"{hold}.release")
    argv, env, app = sandbox_deploy(
        tmp_path, script, prepare=deps(before), FAIL_HEALTH="1",
        HOLD_MV_MATCH=".next.broken", HOLD_MV=hold,
    )
    log = tmp_path / "deploy-output.log"
    with log.open("w") as sink:
        popen = subprocess.Popen(argv, stdout=sink, stderr=subprocess.STDOUT, env=env)
    try:
        deadline = time.monotonic() + 120
        while not started.exists():
            assert popen.poll() is None, f"deploy ended before rolling back:\n{log.read_text()}"
            assert time.monotonic() < deadline, f"rollback never started:\n{log.read_text()}"
            time.sleep(0.05)
        assert _service_actions(tmp_path) == ["systemctl restart terminal"]
        popen.send_signal(signal.SIGTERM)
        time.sleep(0.5)             # the signal is pending on the owner by now
        release.touch()
        popen.wait(timeout=120)
    finally:
        release.touch()
        if popen.poll() is None:
            popen.kill()
    return popen, log.read_text(), app


@DEPS_PATHS
def test_sigterm_during_the_abort_still_reaches_the_restart(tmp_path, deps):
    """A rollback that has begun is finished. A signal taken after the build moved
    back and before the restart would leave the candidate's process serving the
    restored tree; the abort holds HUP/INT/TERM off until it has decided — on the
    default path (dependencies unchanged, no snapshot) exactly as on the other."""
    before: dict = {}
    popen, out, app = _interrupt_held_rollback(tmp_path, SCRIPT, before, deps)

    assert popen.returncode == 1, out
    assert _service_actions(tmp_path) == ["systemctl restart terminal"] * 2, out
    assert "rolled back —" in out and "ROLLBACK INCOMPLETE" not in out, out
    assert "dependency rollback snapshot is unresolved" not in out, out
    if deps is lockfile_changed:
        assert "rollback dependency recovery OK" in out, out
    else:
        assert "dependency rollback snapshot" not in out, out
    assert dependency_inputs(app) == before, out
    assert not snapshot_dir(app).exists() and not resolved_snapshot_dir(app).exists()
    assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID
    assert not build_lock_hold(app).exists(), out


@DEPS_PATHS
def test_mutant_without_the_abort_signal_hold_skips_the_restart(tmp_path, deps):
    """Drop the hold -> the trapped signal ends the owner mid-rollback: the build
    is half moved and nothing was restarted. The exit path does not start the
    rollback a second time, so nothing behind it repairs this."""
    mutant = _mutate(
        tmp_path,
        "  trap '' HUP INT TERM PIPE\n  DEPLOY_GENERATION_OPEN=0\n"
        '  log "DEPLOY FAILED: $reason"\n',
        "  DEPLOY_GENERATION_OPEN=0\n"
        '  log "DEPLOY FAILED: $reason"  # MUTANT: signals are not held in the abort\n',
    )
    popen, out, app = _interrupt_held_rollback(tmp_path, mutant, {}, deps)

    assert popen.returncode != 0, out
    assert _service_actions(tmp_path) == ["systemctl restart terminal"], (
        "mutation was inert — the abort's signal hold is not what gets an "
        f"interrupted rollback to its restart:\n{out}"
    )
    assert "rollback dependency recovery OK" not in out, out
    assert live_build_id(app) != OLD_BUILD_ID, out


# -- an interruption after the generation opened and before its verdict --
#
# From deploy_generation_begin to the commit, every production run holds its
# signal traps and the exit path owns the open generation: an interruption there
# leaves through the same single abort as a guarded failure. Each window below
# must end in a proven restart of the prior generation or a stop of the selected
# unit — or, where the live build never moved, in the running process untouched
# on its own restored identity. Never a moved tree with no service action.

def build_lock_hold(app: Path) -> Path:
    """The shared build lock this process holds for the whole attempt."""
    return app.parent / ".terminal-build-resource.lock" / "hold"


class _ParkedDeploy:
    """A sandboxed deploy started in the background and parked at one shim hold.

    Its output goes to a pipe this object drains, so `close_channel()` can do what
    a cancelled Actions job does to `ssh … bash -s`: the reader goes away, no
    signal is delivered, and the deploy's next write raises SIGPIPE."""

    def __init__(self, tmp_path: Path, script: Path, hold_flag: str, *,
                 prepare=None, **flags):
        hold = tmp_path / "parked-hold"
        self.started, self.release = Path(f"{hold}.started"), Path(f"{hold}.release")
        flags[hold_flag] = hold
        argv, env, self.app = sandbox_deploy(tmp_path, script, prepare=prepare, **flags)
        self._read, write = os.pipe()
        os.set_blocking(self._read, False)
        self.popen = subprocess.Popen(argv, stdout=write, stderr=write, env=env)
        os.close(write)
        self._chunks: list[bytes] = []

    @property
    def out(self) -> str:
        return b"".join(self._chunks).decode(errors="replace")

    def _drain(self) -> None:
        while self._read is not None:
            try:
                chunk = os.read(self._read, 65536)
            except BlockingIOError:
                return
            if not chunk:
                return
            self._chunks.append(chunk)

    def wait_parked(self) -> None:
        deadline = time.monotonic() + 120
        while not self.started.exists():
            self._drain()
            assert self.popen.poll() is None, f"deploy ended before parking:\n{self.out}"
            assert time.monotonic() < deadline, f"deploy never parked:\n{self.out}"
            time.sleep(0.05)
        self._drain()

    def close_channel(self) -> None:
        self._drain()
        os.close(self._read)
        self._read = None

    def finish(self) -> int:
        try:
            self.release.touch()
            deadline = time.monotonic() + 120
            while self.popen.poll() is None:
                self._drain()
                assert time.monotonic() < deadline, f"deploy never ended:\n{self.out}"
                time.sleep(0.05)
            self._drain()
        finally:
            self.release.touch()
            if self.popen.poll() is None:
                self.popen.kill()
            if self._read is not None:
                os.close(self._read)
                self._read = None
        return self.popen.returncode


def _interrupted(tmp_path: Path, script: Path, hold_flag: str, *, deps, before: dict,
                 close: bool = False, **flags):
    """Park a deploy, interrupt it there (SIGTERM, or its output channel closed),
    let it go. Returns (returncode, output, app)."""
    parked = _ParkedDeploy(tmp_path, script, hold_flag, prepare=deps(before), **flags)
    try:
        parked.wait_parked()
        assert build_lock_hold(parked.app).is_dir(), "fixture: the build lock is not where the test looks"
        if close:
            parked.close_channel()
        else:
            parked.popen.send_signal(signal.SIGTERM)
            time.sleep(0.5)         # the signal is pending on the owner by now
            assert parked.popen.poll() is None, (
                "the owner did not wait for its foreground command:\n" + parked.out
            )
    finally:
        rc = parked.finish()
    return rc, parked.out, parked.app


def assert_prior_generation_whole(app: Path, before: dict, out: str) -> None:
    assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID, out
    assert dependency_inputs(app) == before, out
    assert not snapshot_dir(app).exists() and not resolved_snapshot_dir(app).exists(), out
    assert not (app / ".deployment-id.bak").exists(), out
    assert not build_lock_hold(app).exists(), "the build lock was never released:\n" + out
    assert not list(app.parent.glob(".stage.*")), "the interrupted stage was left behind"


@DEPS_PATHS
def test_sigterm_during_the_forward_swap_restarts_the_prior_generation(tmp_path, deps):
    """The live build has just been moved aside and SWAPPED is still 0. The exit
    path reads the vacated slot as the swapped state, puts the build back and
    restarts the prior generation onto it."""
    before: dict = {}
    rc, out, app = _interrupted(
        tmp_path, SCRIPT, "HOLD_MV", HOLD_MV_MATCH=".next.bak", deps=deps, before=before,
    )

    assert rc != 0, out
    assert "interrupted before the deploy generation reached its verdict" in out, out
    assert _service_actions(tmp_path) == ["systemctl restart terminal"], out
    assert "rolled back —" in out and "ROLLBACK INCOMPLETE" not in out, out
    assert_prior_generation_whole(app, before, out)


@DEPS_PATHS
def test_sigterm_in_the_health_check_window_restarts_the_prior_generation(tmp_path, deps):
    """The candidate is running and unverified. Interrupted there, the deploy does
    not leave it serving an uncommitted generation: it rolls back and restarts."""
    before: dict = {}
    rc, out, app = _interrupted(tmp_path, SCRIPT, "HOLD_HEALTH", deps=deps, before=before)

    assert rc == 143, out
    assert "interrupted before the deploy generation reached its verdict" in out, out
    assert _service_actions(tmp_path) == ["systemctl restart terminal"] * 2, out
    assert "rolled back —" in out and "ROLLBACK INCOMPLETE" not in out, out
    assert_prior_generation_whole(app, before, out)


def test_sigterm_in_the_health_check_window_stops_the_unit_when_a_leg_is_unresolved(tmp_path):
    """The other permitted ending: the interrupted generation cannot be put back
    whole (the dependency tree will not return), so the selected unit is stopped."""
    before: dict = {}
    rc, out, app = _interrupted(
        tmp_path, SCRIPT, "HOLD_HEALTH", deps=lockfile_changed, before=before,
        FAIL_MV_MATCH="node_modules.failed",
    )

    assert rc != 0, out
    assert _service_actions(tmp_path) == [
        "systemctl restart terminal", "systemctl stop terminal",
    ], out
    assert "ROLLBACK INCOMPLETE" in out, out
    assert snapshot_dir(app).is_dir(), "the unresolved snapshot must be retained"


def test_sigterm_before_the_live_build_moves_touches_no_service(tmp_path):
    """Interrupted with the generation open and the live build still in place (the
    move aside failed): the marker goes back, and the running process — which never
    lost its tree — is neither restarted nor stopped."""
    before: dict = {}
    rc, out, app = _interrupted(
        tmp_path, SCRIPT, "HOLD_MV", HOLD_MV_MATCH=".next.bak", FAIL_MV_MATCH=".next.bak",
        deps=lockfile_changed, before=before,
    )

    assert rc != 0, out
    assert _service_actions(tmp_path) == [], out
    assert_prior_generation_whole(app, before, out)


@pytest.mark.parametrize("hold_flag, flags, actions", [
    ("HOLD_MV", {"HOLD_MV_MATCH": ".next.bak"}, []),
    ("HOLD_HEALTH", {}, ["systemctl restart terminal"]),
], ids=["forward-swap", "health-window"])
def test_mutant_without_the_exit_path_abort_leaves_the_interruption_uncontained(
        tmp_path, hold_flag, flags, actions):
    """Remove the exit path's route into the abort -> the signal ends the deploy
    where it stands: no build in the live slot (forward swap) or the unverified
    candidate still serving (health window), the marker on the target, and no
    restart of the prior generation and no stop."""
    mutant = _mutate(tmp_path, *NO_EXIT_PATH_ABORT)
    rc, out, app = _interrupted(
        tmp_path, mutant, hold_flag, deps=deps_unchanged, before={}, **flags
    )

    assert rc != 0, out
    assert _service_actions(tmp_path) == actions, (
        f"mutation was inert — the exit path is not what contains this window:\n{out}"
    )
    assert marker_of(app) == NEW_SHA, out
    assert live_build_id(app) != OLD_BUILD_ID, out


def test_mutant_reading_the_vacated_slot_as_unswapped_restores_no_build(tmp_path):
    """Take SWAPPED at its word during the forward swap -> the marker goes back
    over an empty live slot and no service is touched."""
    mutant = _mutate(
        tmp_path,
        '    if [ "$swapped" != 1 ] && [ ! -e "$APP/.next" ]',
        '    if false && [ ! -e "$APP/.next" ]',
    )
    rc, out, app = _interrupted(
        tmp_path, mutant, "HOLD_MV", HOLD_MV_MATCH=".next.bak", deps=deps_unchanged, before={},
    )

    assert rc != 0, out
    assert live_build_id(app) is None, (
        f"mutation was inert — the vacated-slot check is not what restores the build:\n{out}"
    )
    assert _service_actions(tmp_path) == [], out


def test_mutant_without_the_generation_traps_recovers_under_a_running_move(tmp_path):
    """Drop the traps taken at the generation (the default path has no others) ->
    the owner dies at once, its exit path finds the live build still in place and
    touches no service, and then the orphaned move takes the live build away."""
    mutant = _mutate(
        tmp_path,
        "  deploy_take_signal_traps\n  DEPLOY_SIGNAL_DEFER=1\n",
        "  DEPLOY_SIGNAL_DEFER=1  # MUTANT: default signal dispositions at the generation\n",
    )
    parked = _ParkedDeploy(
        tmp_path, mutant, "HOLD_MV", HOLD_MV_MATCH=".next.bak", prepare=deps_unchanged({}),
    )
    app = parked.app
    try:
        parked.wait_parked()
        parked.popen.send_signal(signal.SIGTERM)
        parked.popen.wait(timeout=60)
        assert not parked.release.exists(), "the move had already been released"
    finally:
        parked.finish()
    deadline = time.monotonic() + 30
    while not (app / ".next.bak").exists() and time.monotonic() < deadline:
        time.sleep(0.05)

    assert live_build_id(app) is None, (
        "mutation was inert — the deferred signal is not what keeps recovery from "
        f"running under the forward move:\n{parked.out}"
    )
    assert _service_actions(tmp_path) == [], parked.out


def test_sigterm_while_the_generation_opens_puts_the_marker_back(tmp_path):
    """The signal lands inside deploy_generation_begin, on the move that advances
    the marker. It is deferred until the generation is open AND flagged, so the
    exit path takes it through the abort: marker back, live build never moved."""
    before: dict = {}
    rc, out, app = _interrupted(
        tmp_path, SCRIPT, "HOLD_MV", HOLD_MV_MATCH=".deployment-id.new",
        deps=deps_unchanged, before=before,
    )

    assert rc == 143, out
    assert "interrupted before the deploy generation reached its verdict" in out, out
    assert _service_actions(tmp_path) == [], out
    assert_prior_generation_whole(app, before, out)


def test_mutant_without_the_begin_deferral_strands_the_advanced_marker(tmp_path):
    """Let the signal exit inside deploy_generation_begin, and take away the
    `opening` state that would let the exit path read the result off the disk ->
    begun but not flagged: the exit path takes the pre-swap route and leaves the
    target's marker over the prior build. (Either one alone still rolls this
    interruption back; the opening state has its own mutant below.)"""
    mutant = _mutate(
        tmp_path,
        "  DEPLOY_SIGNAL_DEFER=1\n  # `opening` until begin returns.",
        "  DEPLOY_SIGNAL_DEFER=0  # MUTANT: a signal exits mid-begin\n  # `opening` until begin returns.",
        ("  DEPLOY_GENERATION_OPEN=opening\n",
         "  :  # MUTANT: a begin that never returns is never resolved\n"),
    )
    rc, out, app = _interrupted(
        tmp_path, mutant, "HOLD_MV", HOLD_MV_MATCH=".deployment-id.new",
        deps=deps_unchanged, before={},
    )

    assert rc != 0, out
    assert marker_of(app) == NEW_SHA and live_build_id(app) == OLD_BUILD_ID, (
        f"mutation was inert — the deferral is not what keeps begin and its flag together:\n{out}"
    )


def test_begin_whose_final_move_dies_after_renaming_is_rolled_back(tmp_path):
    """A signal to the whole process group kills deploy_generation_begin's `mv`
    after the rename and before it exits. Begin never returns, so its flag is
    never set; the exit path reads the advanced marker and the whole record of
    what it replaced as the open generation and takes it through the abort."""
    before: dict = {}
    proc, app = run_deploy(
        tmp_path, prepare=deps_unchanged(before), DIE_AFTER_MV_MATCH=".deployment-id.new",
    )
    out = proc.stdout + proc.stderr

    assert proc.returncode == 143, out
    assert "interrupted before the deploy generation reached its verdict" in proc.stdout, out
    assert "pre-swap recovery refused" not in proc.stdout, out
    assert _service_actions(tmp_path) == [], out
    assert_prior_generation_whole(app, before, out)


def test_mutant_without_the_opening_state_strands_the_advanced_marker(tmp_path):
    """Leave the flag at 0 while begin runs -> the same death exits through the
    pre-swap route, which refuses on the moved marker: 74, with the target's
    marker left over the prior build."""
    mutant = _mutate(
        tmp_path,
        "  DEPLOY_GENERATION_OPEN=opening\n",
        "  :  # MUTANT: a begin that never returns is never resolved\n",
    )
    proc, app = run_deploy(tmp_path, script=mutant, DIE_AFTER_MV_MATCH=".deployment-id.new")
    out = proc.stdout + proc.stderr

    assert proc.returncode != 0, out
    assert marker_of(app) == NEW_SHA and live_build_id(app) == OLD_BUILD_ID, (
        f"mutation was inert — the opening state is not what rolls a half-returned begin back:\n{out}"
    )
    assert "interrupted before the deploy generation reached its verdict" not in proc.stdout, out


def test_begin_that_fails_before_the_rename_stays_a_pre_swap_failure(tmp_path):
    """The other side of the same decision: the move failed and the marker never
    advanced. Nothing live moved, so nothing is rolled back; the attempt leaves
    through the ordinary pre-swap recovery."""
    before: dict = {}
    proc, app = run_deploy(
        tmp_path, prepare=deps_unchanged(before), FAIL_MV_MATCH=".deployment-id.new",
    )
    out = proc.stdout + proc.stderr

    assert proc.returncode != 0, out
    assert "interrupted before the deploy generation reached its verdict" not in proc.stdout, out
    assert "pre-swap failure: restoring canonical checkout to live accepted generation" in proc.stdout, out
    assert "pre-swap recovery refused" not in proc.stdout, out
    assert _service_actions(tmp_path) == [], out
    assert marker_of(app) == OLD_SHA and live_build_id(app) == OLD_BUILD_ID, out
    assert not build_lock_hold(app).exists(), out


@pytest.mark.parametrize(
    ("live", "record", "expected"),
    [
        (NEW_SHA, ("bak", OLD_SHA + "\n"), 0),        # moved, prior identity saved whole
        (NEW_SHA, ("absent", ""), 0),                 # moved, and there was no prior marker
        (OLD_SHA, ("bak", OLD_SHA + "\n"), 1),        # the rename never happened
        (NEW_SHA, ("bak", OLD_SHA[:17]), 1),          # a half-written record is never used
        (NEW_SHA, ("bak", ""), 1),                    # ... nor an empty one
        (NEW_SHA, ("bak", NEW_SHA + "\n"), 1),        # same identity: nothing to return to
        (NEW_SHA, None, 1),                           # no record at all
    ],
    ids=["moved", "moved-from-absent", "not-moved", "partial-record", "empty-record",
         "same-identity", "no-record"],
)
def test_an_unreturned_begin_is_open_only_on_a_moved_marker_and_a_whole_record(
        tmp_path, live, record, expected):
    app = make_app(tmp_path, live, build_id=OLD_BUILD_ID)
    if record is not None:
        (app / f".deployment-id.{record[0]}").write_text(record[1])

    r = run_gen(SCRIPT, f'''
        deploy_generation_opening_resolved "{app}" "{NEW_SHA}"
        echo "RC=$?"
    ''')

    assert f"RC={expected}" in r.stdout, r.stdout + r.stderr


def test_failure_after_acceptance_never_reopens_the_committed_generation(tmp_path):
    """The exit path's abort is for an UNCOMMITTED generation. A later step failing
    after the commit (here: step 8, which the sandbox cannot run) leaves the
    accepted generation exactly as accepted."""
    proc, app = run_deploy(tmp_path)
    out = proc.stdout + proc.stderr

    assert "identity verified" in proc.stdout, out
    assert proc.returncode != 0, "fixture: the sandbox no longer fails after acceptance"
    assert "DEPLOY FAILED" not in proc.stdout, out
    assert _service_actions(tmp_path) == ["systemctl restart terminal"], out
    assert marker_of(app) == NEW_SHA and live_build_id(app) == NEW_BUILD_ID
    assert not build_lock_hold(app).exists(), out


def test_mutant_ignoring_the_commit_rolls_an_accepted_generation_back(tmp_path):
    """Drop the on-disk record check -> a failure after acceptance is read as an
    open generation and the accepted build is taken out of service."""
    mutant = _mutate(
        tmp_path,
        '      && { [ -e "$APP/.deployment-id.bak" ] || [ -e "$APP/.deployment-id.absent" ]; }; then\n',
        "      && true; then  # MUTANT: the commit is not consulted\n",
    )
    proc, app = run_deploy(tmp_path, script=mutant)
    out = proc.stdout + proc.stderr

    assert "identity verified" in proc.stdout, out
    assert live_build_id(app) == OLD_BUILD_ID and "DEPLOY FAILED" in proc.stdout, (
        f"mutation was inert — the rollback records are not what closes the generation:\n{out}"
    )


# TEST DRIVER, not a behaviour change: deliver SIGTERM to the deploy at the one
# point no shim can park, between deploy_generation_commit and the acceptance
# path's own deps_snapshot_discard.
SIGTERM_BETWEEN_COMMIT_AND_DISCARD = (
    '  deploy_generation_commit "$APP"\n  deps_snapshot_discard\n',
    '  deploy_generation_commit "$APP"\n  kill -TERM $$\n  deps_snapshot_discard\n',
)


def test_sigterm_between_commit_and_discard_leaves_an_accepted_generation(tmp_path):
    """The generation is accepted and committed; the signal exits before the
    snapshot is discarded. The exit path finishes that discard: no FATAL, no 74,
    and no old dependency snapshot left where an attended restore would put the
    replaced generation's dependencies under the accepted build."""
    driver = _mutate(tmp_path, *SIGTERM_BETWEEN_COMMIT_AND_DISCARD)
    before: dict = {}
    proc, app = run_deploy(tmp_path, script=driver, prepare=lockfile_changed(before))
    out = proc.stdout + proc.stderr

    assert proc.returncode == 143, out
    assert "identity verified" not in proc.stdout, "fixture: the signal did not land before the discard"
    assert "dependency rollback snapshot is unresolved" not in proc.stdout, out
    assert "dependency rollback snapshot discarded: the new generation is accepted" in proc.stdout, out
    assert "dependency recovery" not in proc.stdout, out
    assert not snapshot_dir(app).exists() and not resolved_snapshot_dir(app).exists(), out
    assert _service_actions(tmp_path) == ["systemctl restart terminal"], out
    assert marker_of(app) == NEW_SHA and live_build_id(app) == NEW_BUILD_ID
    assert not (app / ".deployment-id.bak").exists()
    assert (app / "package-lock.json").read_text() == TARGET_LOCK
    assert (app / "node_modules" / "installed-from-lock").read_text() == TARGET_LOCK
    assert not build_lock_hold(app).exists(), out


def test_mutant_without_the_committed_discard_reports_an_accepted_deploy_as_fatal(tmp_path):
    """Remove the exit path's discard -> the accepted generation ends 74 with the
    replaced generation's dependency snapshot kept under the unresolved name."""
    mutant = _mutate(
        tmp_path,
        *SIGTERM_BETWEEN_COMMIT_AND_DISCARD,
        ('      && [ "${DEPLOY_GENERATION_OPEN:-0}" = 1 ] && [ "${DEPLOY_OK:-0}" = 1 ] \\\n',
         '      && false \\\n'),
    )
    proc, app = run_deploy(tmp_path, script=mutant, prepare=lockfile_changed({}))
    out = proc.stdout + proc.stderr

    assert marker_of(app) == NEW_SHA and live_build_id(app) == NEW_BUILD_ID, out
    assert proc.returncode == 74 and snapshot_dir(app).is_dir(), (
        f"mutation was inert — the exit path's discard is not what closes the snapshot "
        f"of a committed generation (rc={proc.returncode}):\n{out}"
    )
    assert "dependency rollback snapshot is unresolved after live identity began moving" in proc.stdout, out


@pytest.mark.parametrize(
    "state",
    ["DEPLOY_GENERATION_OPEN=1; DEPLOY_OK=0", "DEPLOY_GENERATION_OPEN=0; DEPLOY_OK=1"],
    ids=["no-verdict", "rolled-back"],
)
def test_an_open_snapshot_without_an_accepted_generation_is_still_retained(tmp_path, state):
    """The exit path's discard is for an ACCEPTED, committed generation only. A
    generation that never reached its verdict, or one the abort already took
    (and whose dependency restore then failed), keeps the rule: the snapshot is
    retained and the exit is 74."""
    repo, live, marker, _, _, old_sha, _ = make_dependency_incident_fixture(tmp_path)

    r = run_gen(SCRIPT, "TARGET=production\n" + killed_build_exit(
        repo, live, marker, old_sha, armed=0, status=state + "; false",
    ))

    assert r.returncode == 74, r.stdout + r.stderr
    assert "dependency rollback snapshot is unresolved after live identity began moving" in r.stdout
    assert "dependency rollback snapshot discarded" not in r.stdout
    assert (snapshot_dir(live) / "node_modules" / "next" / "version").read_text() == "16.2.9\n"


def test_generation_begin_takes_the_signal_traps_on_every_production_run():
    """The traps are taken at the generation, not only with a dependency install,
    and the begin and its flag are one step to a signal."""
    body = _deploy_body(code_only=True)
    block = (
        'elif [ "$TARGET" = production ]; then\n'
        "  deploy_take_signal_traps\n"
        "  DEPLOY_SIGNAL_DEFER=1\n"
        "  DEPLOY_GENERATION_OPEN=opening\n"
        '  deploy_generation_begin "$APP" "$STAGE/.deployment-id"\n'
        "  DEPLOY_GENERATION_OPEN=1\n"
        "  CANONICAL_RECOVERY_ARMED=0\n"
        "  DEPLOY_SIGNAL_DEFER=0\n"
        '  [ -z "$DEPLOY_SIGNAL_PENDING" ] || exit "$DEPLOY_SIGNAL_PENDING"\n'
    )
    assert body.count(block) == 1, "the production generation no longer opens under its traps"
    assert body.count("deploy_take_signal_traps") == 2      # deps step, generation begin
    assert body.count("DEPLOY_GENERATION_OPEN=1") == 1
    # Begin keeps errexit inside it: never the left side of a `||` or `&&` list,
    # never a condition.
    begins = [l.strip() for l in body.splitlines() if "deploy_generation_begin" in l]
    assert begins == ['deploy_generation_begin "$APP" "$STAGE/.deployment-id"'] * 2, begins

    library = _library()
    cleanup = library[library.index("cleanup_deploy_attempt(){"):]
    abort = cleanup.index('deploy_generation_abort "$APP" "${FULL_SHA:-}" "$swapped"')
    assert cleanup.index("trap '' HUP INT TERM PIPE") < abort
    assert cleanup.index('deploy_generation_opening_resolved "$APP" "${FULL_SHA:-}"') < abort, (
        "a begin that never returned is resolved after the abort that would roll it back"
    )
    assert abort < cleanup.index("beta_bootstrap_archive_cleanup"), (
        "the exit path's abort is behind a slow recovery step"
    )
    assert abort < cleanup.index("deps_snapshot_reap")


def test_a_signal_while_the_generation_opens_is_deferred_not_dropped():
    """Between deploy_generation_begin and its flag a trapped signal is recorded
    and the deploy exits on it once both are done; outside that step it exits."""
    r = run_gen(SCRIPT, """
        deploy_take_signal_traps
        DEPLOY_SIGNAL_DEFER=1
        kill -TERM $$
        echo "RAN_ON PENDING=[$DEPLOY_SIGNAL_PENDING]"
        DEPLOY_SIGNAL_DEFER=0
        [ -z "$DEPLOY_SIGNAL_PENDING" ] || exit "$DEPLOY_SIGNAL_PENDING"
        echo NOT_REACHED
    """)
    assert r.returncode == 143, r.stdout + r.stderr
    assert "RAN_ON PENDING=[143]" in r.stdout and "NOT_REACHED" not in r.stdout

    r = run_gen(SCRIPT, """
        deploy_take_signal_traps
        kill -HUP $$
        echo NOT_REACHED
    """)
    assert r.returncode == 129, r.stdout + r.stderr
    assert "NOT_REACHED" not in r.stdout


# -- a closed deploy channel: SIGPIPE, not HUP --
#
# vps-main-deploy runs this script as `ssh … bash -s` with no tty. When the job is
# cancelled the channel closes and no signal arrives; the deploy's next write to
# its output raises SIGPIPE. Untrapped, that ends bash without its EXIT trap.

@DEPS_PATHS
def test_closed_output_during_the_abort_still_restarts_and_cleans_up(tmp_path, deps):
    """The channel closes while the rollback's first move is parked. Every later
    log line fails to write; the abort still reaches its restart and the exit path
    still runs to the end (snapshot reaped, stage removed, build lock released)."""
    before: dict = {}
    rc, out, app = _interrupted(
        tmp_path, SCRIPT, "HOLD_MV", HOLD_MV_MATCH=".next.broken", FAIL_HEALTH="1",
        deps=deps, before=before, close=True,
    )

    assert rc == 1, out
    assert _service_actions(tmp_path) == ["systemctl restart terminal"] * 2, out
    assert not (app / ".next.broken").exists() or live_build_id(app) == OLD_BUILD_ID
    assert_prior_generation_whole(app, before, out)


def test_closed_output_during_the_abort_stops_the_unit_when_a_leg_is_unresolved(tmp_path):
    before: dict = {}
    rc, out, app = _interrupted(
        tmp_path, SCRIPT, "HOLD_MV", HOLD_MV_MATCH=".next.broken", FAIL_HEALTH="1",
        FAIL_MV_MATCH="node_modules.failed",
        deps=lockfile_changed, before=before, close=True,
    )

    assert rc != 0, out
    assert _service_actions(tmp_path) == [
        "systemctl restart terminal", "systemctl stop terminal",
    ], out
    assert snapshot_dir(app).is_dir(), "the unresolved snapshot must be retained"
    assert not build_lock_hold(app).exists(), "the build lock was never released"


def test_closed_output_in_the_health_window_lets_the_deploy_reach_its_verdict(tmp_path):
    """PIPE is ignored, not turned into an exit: a deploy whose channel closed goes
    on to its own verdict. Healthy, it commits and cleans up as it would have."""
    before: dict = {}
    rc, out, app = _interrupted(
        tmp_path, SCRIPT, "HOLD_HEALTH", deps=lockfile_changed, before=before, close=True,
    )

    # (the sandbox has no ops/terminal-data, so step 8 exits non-zero after acceptance)
    assert rc >= 0, f"the deploy was killed by signal {-rc}"
    assert _service_actions(tmp_path) == ["systemctl restart terminal"], out
    assert marker_of(app) == NEW_SHA and live_build_id(app) == NEW_BUILD_ID
    assert not (app / ".deployment-id.bak").exists(), "the accepted generation was not committed"
    assert (app / "package-lock.json").read_text() == TARGET_LOCK
    assert not snapshot_dir(app).exists() and not resolved_snapshot_dir(app).exists()
    assert not build_lock_hold(app).exists(), "the build lock was never released"


def test_mutant_without_the_pipe_hold_dies_on_the_closed_channel(tmp_path):
    """Leave PIPE at its default everywhere -> the first log line after the close
    kills the shell. With a dependency restore in the rollback that line comes
    before the restart, so the rollback's restart (or stop) never happens.

    Only that is asserted. What is left on disk afterwards is not a property of
    this script: bash 5.2 (the Linux runners) enters the EXIT trap on a fatal
    SIGPIPE and runs it until the trap's own first write kills it again, which
    releases the build lock and reaps the snapshot on the way; bash 5.3 does not
    enter the trap at all. The abort itself is skipped on both: it is not
    re-entered once it has taken the generation."""
    mutant = _mutate(
        tmp_path,
        *NO_EARLY_PIPE_IGNORE,
        ("  trap '' PIPE\n}\n", "  :  # MUTANT: PIPE keeps its default disposition\n}\n"),
        ("  trap '' HUP INT TERM PIPE\n  DEPLOY_GENERATION_OPEN=0\n",
         "  trap '' HUP INT TERM\n  DEPLOY_GENERATION_OPEN=0\n"),
        ("then trap '' HUP INT TERM PIPE; fi\n", "then trap '' HUP INT TERM; fi\n"),
    )
    rc, out, app = _interrupted(
        tmp_path, mutant, "HOLD_MV", HOLD_MV_MATCH=".next.broken", FAIL_HEALTH="1",
        deps=lockfile_changed, before={}, close=True,
    )

    assert rc == -signal.SIGPIPE, (
        f"mutation was inert — ignoring PIPE is not what survives the closed channel "
        f"(rc={rc}):\n{out}"
    )
    assert _service_actions(tmp_path) == ["systemctl restart terminal"], (
        "the rollback reached its restart or stop after all:\n" + out
    )


# -- a closed deploy channel before any signal trap is taken --
#
# A deps-unchanged production run takes its signal traps only when its generation
# opens. Through fetch, stage and `next build` the only thing between a cancelled
# caller and a dead shell is the PIPE ignore taken with the build lock.

def _reset_to_accepted(tmp_path: Path) -> list[str]:
    return [l for l in _effect_lines(tmp_path) if l.startswith("git ") and f"reset -q --hard {OLD_SHA}" in l]


def test_closed_output_while_staging_recovers_a_failed_build(tmp_path):
    """The channel closes while the stage step is parked; the build is then killed.
    The run ends as the same recovered pre-swap failure it would have been with
    someone listening: checkout back on the accepted generation, stage removed,
    build lock released, nothing live touched."""
    before: dict = {}
    rc, out, app = _interrupted(
        tmp_path, SCRIPT, "HOLD_RSYNC", FAIL_BUILD="1",
        deps=deps_unchanged, before=before, close=True,
    )

    assert rc > 0, f"the deploy was killed by signal {-rc} (or reported success):\n{out}"
    assert "npm run build" in _effect_lines(tmp_path), "the run never reached its build"
    assert _reset_to_accepted(tmp_path), "the canonical checkout was not put back"
    assert _service_actions(tmp_path) == [], out
    assert_prior_generation_whole(app, before, out)


def test_closed_output_while_staging_lets_a_good_build_reach_its_verdict(tmp_path):
    """Same close, healthy build: the deploy goes on to its own verdict, commits
    and cleans up exactly as it would have."""
    before: dict = {}
    rc, out, app = _interrupted(
        tmp_path, SCRIPT, "HOLD_RSYNC", deps=deps_unchanged, before=before, close=True,
    )

    # (the sandbox has no ops/terminal-data, so step 8 exits non-zero after acceptance)
    assert rc >= 0, f"the deploy was killed by signal {-rc}"
    assert _service_actions(tmp_path) == ["systemctl restart terminal"], out
    assert marker_of(app) == NEW_SHA and live_build_id(app) == NEW_BUILD_ID
    assert not (app / ".deployment-id.bak").exists(), "the accepted generation was not committed"
    assert not build_lock_hold(app).exists(), "the build lock was never released"
    assert not list(app.parent.glob(".stage.*")), "the stage was left behind"


def test_mutant_without_the_early_pipe_ignore_dies_before_the_build(tmp_path):
    """Remove only the ignore taken with the lock -> the first log line after the
    close ("next build (staging)") kills the shell: SIGPIPE, the build never
    starts and the canonical checkout is never put back on the accepted
    generation.

    Both bash behaviours end there, and only that is asserted. 5.3 never enters
    the EXIT trap, so the build lock stays held and the stage stays on disk. 5.2
    enters it with the status of the last command that completed, which is 0:
    the trap sees a successful run, skips the checkout recovery, removes the
    stage, releases the lock and dies on its own next log line."""
    mutant = _mutate(tmp_path, *NO_EARLY_PIPE_IGNORE)
    rc, out, app = _interrupted(
        tmp_path, mutant, "HOLD_RSYNC", FAIL_BUILD="1",
        deps=deps_unchanged, before={}, close=True,
    )

    assert rc == -signal.SIGPIPE, (
        f"mutation was inert — the ignore taken with the lock is not what survives "
        f"a channel closed before the traps (rc={rc}):\n{out}"
    )
    assert "npm run build" not in _effect_lines(tmp_path)
    assert not _reset_to_accepted(tmp_path), "the exit path recovered the checkout after all"


def test_log_survives_a_closed_output_channel():
    """`log` itself: with PIPE ignored, a write to a closed stdout fails quietly and
    returns 0, so no log line can end a deploy under `set -e`."""
    read, write = os.pipe()
    driver = textwrap.dedent(f"""
        . "{SCRIPT}"
        set -e
        trap '' PIPE
        /bin/sleep 0.3          # the reader is gone by now
        log one
        log two
        echo SURVIVED >&{write}
    """)
    try:
        popen = subprocess.Popen(
            [_bash(), "-c", driver],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, pass_fds=(write,),
        )
        popen.stdout.close()
        popen.stderr.close()
        os.close(write)
        write = None
        assert popen.wait(timeout=60) == 0
        assert os.read(read, 64) == b"SURVIVED\n"
    finally:
        os.close(read)
        if write is not None:
            os.close(write)


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
    assert deps.index("deploy_take_signal_traps") < begin, (
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


def test_resolved_snapshot_is_deleted_only_on_the_exit_path():
    """Restoring puts things back; deleting the snapshot (this attempt's failed
    tree included) is the slow part and happens once, in cleanup_deploy_attempt —
    after the pre-swap restore, and after an abort's restart or stop because every
    abort caller exits straight into it."""
    library = _library()
    code = [l.strip() for l in library.splitlines() if not l.lstrip().startswith("#")]
    assert code.count("deps_snapshot_reap") == 1, "exactly one reap call site"

    def body(name: str) -> str:
        text = library[library.index(f"{name}(){{"):]
        return text[: text.index("\n}\n")]

    cleanup = body("cleanup_deploy_attempt")
    reap = cleanup.index("\n  deps_snapshot_reap\n")
    assert cleanup.index('deps_snapshot_restore "$APP"') < reap
    assert reap < cleanup.index('git -C "$SRC" reset'), (
        "the failed tree's space is not released before Git needs it"
    )
    for name in ("deploy_generation_abort", "deps_snapshot_restore", "deploy_generation_contain"):
        code_only = "\n".join(
            l for l in body(name).splitlines() if not l.lstrip().startswith("#")
        )
        assert "deps_snapshot_reap" not in code_only, f"{name} deletes the snapshot itself"
        assert "rm -rf" not in code_only, f"{name} deletes a tree itself"
    assert 'rm -rf "$snap"' in body("deps_snapshot_reap")
    assert "DEPS_SNAPSHOT_RESOLVED_DIR" in body("deps_snapshot_reap")
    # every abort call leaves through the EXIT trap, so the reap is behind it
    deploy = _deploy_body(code_only=True)
    aborts = [l for l in deploy.splitlines() if "deploy_generation_abort" in l]
    assert aborts and all(
        l.rstrip().endswith("|| exit 1") or l.rstrip().endswith("\\") for l in aborts
    ), aborts


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
