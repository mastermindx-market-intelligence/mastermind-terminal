"""Same-attempt recovery entrance, using the existing confined release fixture.

Build IDs are deliberately identical across generations. Every recovery must run
an exact-target build; neither that string nor quarantined bytes are promoted.
The separate runtime-prune tests exercise real Git and filesystem deletion.
"""
import os
import json
import subprocess

import pytest

from test_terminal_beta_transaction import A, B, BUILD, Fixture, digest_tree


def fixture(tmp_path):
    box = Fixture(tmp_path)
    for path in (box.root / 'bin').iterdir():
        text = path.read_text()
        text = text.replace("'Environment':'MMX_SHARED_SHELL=1'", "'Environment':'MMX_SHARED_SHELL=1',\n          'MainPID':'0' if read('active')=='inactive' else '42', 'ControlPID':'0'")
        path.write_text(text)
    # macOS Python has no Linux fd-xattr API. The separately qualified Linux
    # output-custody guard is unchanged; this local fixture isolates recovery.
    # Linux CI executes that real guard with no replacement.
    if not hasattr(os, 'listxattr'):
        text = box.owner.read_text().replace(
            '# Sourced -> expose the library and stop. Executed -> deploy.',
            'beta_prepare_build_output(){ return 0; }\n# Sourced -> expose the library and stop. Executed -> deploy.')
        box.owner.write_text(text)
    return box


def failed_reverse(tmp_path):
    box = fixture(tmp_path)
    box.bootstrap()
    upgraded = box.run(B)
    assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
    box.flag('fail_audit_sha', A)
    failed = box.run(A)
    assert failed.returncode != 0
    assert box.read('active') == 'inactive' and box.read('enabled') == 'disabled'
    assert not (box.app / '.next').exists()
    assert box.pending()['phase'] == 'failed' and box.pending()['live_inputs_dirty'] is True
    assert box.accepted()['accepted_sha'] == B
    # Actual retained server-manifest identities are required in addition to the
    # intentionally reused BUILD_ID, matching the observed A2 host state.
    for name, sha in (('.next.bak', B), ('.next.broken', A)):
        (box.app / name / 'required-server-files.json').write_text(json.dumps({'config': {'deploymentId': sha}}))
    (box.root / 'fail_audit_sha').unlink()
    return box


def recover(box, *, attempt=None, record=None, target=A):
    pending = box.pending()
    args = ['bash', str(box.owner), '--target', 'beta', '--recover-attempt',
            attempt or pending['attempt_id'], '--pending-record-id',
            record or pending['record_id'], '--target-sha', target]
    before = box.production_before
    out = subprocess.run(args, env=box.env, text=True, capture_output=True, timeout=25)
    assert digest_tree(box.prod) == before
    return out


def test_failed_reverse_rebuilds_under_same_attempt_and_preserves_both_retained_builds(tmp_path):
    box = failed_reverse(tmp_path)
    failed_path = (box.target / '.release-pending').resolve()
    failed_bytes = failed_path.read_bytes()
    pending = box.pending()
    prior = (box.target / '.runtime-accepted').resolve()
    prior_bytes = prior.read_bytes()
    retained = {name: digest_tree(box.app / name) for name in ('.next.bak', '.next.broken')}
    before = len(box.effects())

    out = recover(box)

    assert out.returncode == 0, out.stdout + out.stderr
    effects = box.effects()[before:]
    assert effects.count('npm:run build') == 1
    assert (box.app / '.next/fixture-build-sha').read_text().strip() == A
    assert (box.app / '.next/BUILD_ID').read_text().strip() == BUILD
    accepted = box.accepted()
    assert accepted['accepted_sha'] == A
    assert accepted['acceptance_attempt_id'] == pending['attempt_id']
    assert accepted['recovery_from_record_id'] == pending['record_id']
    assert accepted['recovery_from_record'] == str(failed_path)
    assert accepted['previous_runtime_record'] == str(prior)
    assert prior.read_bytes() == prior_bytes and failed_path.read_bytes() == failed_bytes
    assert not (box.target / '.release-pending').exists()
    for name in retained:
        assert digest_tree(box.app / name) == retained[name]
    assert (box.app / '.deployment-id.bak').read_text().strip() == B
    assert box.read('active') == 'active' and box.read('enabled') == 'enabled'
    assert effects.index('npm:run build') < effects.index('audit:' + A)


@pytest.mark.parametrize('bad', ['record', 'target', 'active', 'pointer', 'manifest', 'live-build', 'policy'])
def test_recovery_refuses_changed_identity_before_build_or_claim(tmp_path, bad):
    box = failed_reverse(tmp_path)
    kwargs = {}
    if bad == 'record': kwargs['record'] = '0' * 64
    elif bad == 'target': kwargs['target'] = B
    elif bad == 'active': box.flag('active', 'active')
    elif bad == 'pointer': (box.target / '.runtime-accepted').unlink()
    elif bad == 'manifest': (box.app / '.next.broken/required-server-files.json').write_text('{"config":{"deploymentId":"' + B + '"}}')
    elif bad == 'live-build': (box.app / '.next').mkdir()
    elif bad == 'policy': (box.root / 'policy.json').write_text('{"changed":true}')
    original_path = (box.target / '.release-pending').resolve()
    original = original_path.read_bytes()
    before = len(box.effects())
    out = recover(box, **kwargs)
    assert out.returncode != 0
    assert (box.target / '.release-pending').resolve() == original_path
    assert original_path.read_bytes() == original
    assert 'npm:run build' not in box.effects()[before:]


def test_failed_recovery_keeps_original_failure_and_cannot_consume_second_allowance(tmp_path):
    box = failed_reverse(tmp_path)
    original = (box.target / '.release-pending').resolve()
    original_bytes = original.read_bytes()
    prior = (box.target / '.runtime-accepted').resolve()
    box.flag('fail_build')
    failed = recover(box)
    assert failed.returncode != 0
    pending = box.pending()
    assert pending['phase'] == 'failed'
    assert pending['recovery_from_record'] == str(original)
    assert original.read_bytes() == original_bytes
    assert (box.target / '.runtime-accepted').resolve() == prior
    assert box.read('active') == 'inactive' and box.read('enabled') == 'disabled'
    (box.root / 'fail_build').unlink()
    before = len(box.effects())
    repeated = recover(box)
    assert repeated.returncode != 0
    assert 'one recovery entrance' in repeated.stdout + repeated.stderr
    assert 'npm:run build' not in box.effects()[before:]


def test_final_recovery_audit_failure_never_accepts_or_overwrites_original_quarantine(tmp_path):
    box = failed_reverse(tmp_path)
    original = box.pending()
    prior = (box.target / '.runtime-accepted').resolve()
    retained = {name: digest_tree(box.app / name) for name in ('.next.bak', '.next.broken')}
    box.flag('fail_audit_sha', A)
    result = recover(box)
    assert result.returncode != 0
    assert (box.target / '.runtime-accepted').resolve() == prior
    assert box.pending()['phase'] == 'failed'
    assert box.pending()['attempt_id'] == original['attempt_id']
    assert box.read('active') == 'inactive' and box.read('enabled') == 'disabled'
    for name in retained:
        assert digest_tree(box.app / name) == retained[name]
    assert (box.app / ('.next.recovery-failed-' + original['attempt_id'])).is_dir()


def test_interrupted_recovery_is_consumed_not_automatically_replayed(tmp_path):
    box = failed_reverse(tmp_path)
    box.flag('interrupt_start')
    result = recover(box)
    assert result.returncode != 0
    assert box.pending()['recovery_from_record_id']
    assert box.pending()['phase'] == 'failed'
    assert box.read('active') == 'inactive'
    before = len(box.effects())
    again = recover(box)
    assert again.returncode != 0
    assert 'npm:run build' not in box.effects()[before:]


def test_completed_recovery_is_not_accepted_again(tmp_path):
    box = failed_reverse(tmp_path)
    pending = box.pending()
    first = recover(box)
    assert first.returncode == 0, first.stdout + first.stderr
    accepted_path = (box.target / '.runtime-accepted').resolve()
    accepted_bytes = accepted_path.read_bytes()
    before = len(box.effects())
    second = subprocess.run([
        'bash', str(box.owner), '--target', 'beta', '--recover-attempt',
        pending['attempt_id'], '--pending-record-id', pending['record_id'],
        '--target-sha', A], env=box.env, capture_output=True, text=True, timeout=25)
    assert second.returncode != 0
    assert (box.target / '.runtime-accepted').resolve() == accepted_path
    assert accepted_path.read_bytes() == accepted_bytes
    assert 'npm:run build' not in box.effects()[before:]


def test_production_cannot_select_recovery_entrance(tmp_path):
    box = fixture(tmp_path)
    before = box.effects()
    result = subprocess.run([
        'bash', str(box.owner), '--target', 'production', '--recover-attempt',
        'a' * 32, '--pending-record-id', 'b' * 64, '--target-sha', A],
        env=box.env, capture_output=True, text=True, timeout=10)
    assert result.returncode == 64
    assert box.effects() == before
    assert not (box.target / '.release-pending').exists()
