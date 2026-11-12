"""Compose real Git, the actual source audit, and the existing beta owner.

Only npm/service/HTTP are confined fixture effects. The old overlay is recreated
once to obtain a real UNKNOWN_STOP and dirty pending record, then the current
owner recovers that same attempt without changing policy or application source.
"""
import json
import os

import pytest

from test_terminal_beta_bootstrap import Owner, git, snapshot_modes, status_file
from test_terminal_beta_transaction import digest_tree


def snapshot(root):
    return snapshot_modes(root), digest_tree(root)


def failed_overlay(tmp_path):
    box = Owner(tmp_path).build_origin(second_generation=True)
    newer = box.origin / 'hub/lib/newer-source.js'
    newer.parent.mkdir()
    newer.write_text('export const newerSource = true;\n')
    git(box.origin, 'add', '.')
    git(box.origin, 'commit', '-qm', 'newer owned runtime source')
    box.sha2 = git(box.origin, 'rev-parse', 'HEAD')
    box.assemble(bootstrap_target_empty=True, production_tree=True)
    # The generated-output custody guard has its own Linux-only qualification;
    # use that real guard in Linux CI, isolate it only on macOS without fd-xattr.
    if not hasattr(os, 'listxattr'):
        box.script.write_text(box.script.read_text().replace(
            '# Sourced -> expose the library and stop. Executed -> deploy.',
            'beta_prepare_build_output(){ return 0; }\n# Sourced -> expose the library and stop. Executed -> deploy.'))
    npm = box.bindir / 'npm'
    npm.write_text(npm.read_text().replace(
        '  mkdir -p .next && printf',
        '  mkdir -p .next\n  printf \'{"config":{"deploymentId":"%s"}}\\n\' "$GIT_SHA" > .next/required-server-files.json\n  printf'))
    unit = box.bindir / 'systemctl'
    unit.write_text(unit.read_text().replace('      LoadState) echo loaded ;;',
        '      MainPID|ControlPID) echo 0 ;;\n      LoadState) echo loaded ;;'))
    status = status_file(tmp_path, build_id=box.sha)
    common = {'status_file': status, 'MMX_STATUS_FOLLOWS_RUNTIME': '1'}
    production = snapshot(box.prod_app)
    first = box.run(['--target', 'beta', '--bootstrap', '--target-sha', box.sha], **common)
    assert first.returncode == 0, first.stdout + first.stderr
    second = box.run(['--target', 'beta', '--target-sha', box.sha2], **common)
    assert second.returncode == 0, second.stdout + second.stderr
    qualified_owner = box.script.read_text()
    call = 'beta_runtime_prune_owned "$BETA_PRIOR_SHA" "$FULL_SHA"'
    assert qualified_owner.count(call) == 1
    # Negative control: precisely the incumbent tar-overlay deletion omission.
    box.script.write_text(qualified_owner.replace(call, ': # no prior-source deletion'))
    reverse = box.run(['--target', 'beta', '--target-sha', box.sha], **common)
    assert reverse.returncode != 0
    failed = box.pointer_record('.release-pending')
    assert failed['phase'] == 'failed' and failed['live_inputs_dirty'] is True
    receipt = json.loads(box.receipts()[-1].read_text())
    assert receipt['result'] == 'UNKNOWN_STOP'
    assert any(f['code'] == 'HOST_ONLY_UNTRACKED' and f['path'] == 'lib/newer-source.js'
               for f in receipt['source_audit']['findings'])
    assert (box.beta_root / 'hub/lib/newer-source.js').read_bytes() == newer.read_bytes()
    box.script.write_text(qualified_owner)
    assert snapshot(box.prod_app) == production
    return box, failed, common, production


@pytest.mark.parametrize('unknown_host_file', [False, True])
def test_real_failed_overlay_recovers_same_attempt_or_preserves_unknown_audit_refusal(tmp_path, unknown_host_file):
    box, failed, common, production = failed_overlay(tmp_path)
    original = (box.beta_root / '.release-pending').resolve()
    original_bytes = original.read_bytes()
    prior = (box.beta_root / '.runtime-accepted').resolve()
    prior_bytes = prior.read_bytes()
    retained = {name: snapshot(box.beta_app / name) for name in ('.next.bak', '.next.broken')}
    unknown = box.beta_root / 'hub/private-host-cache.json'
    if unknown_host_file:
        unknown.write_text('{"preserve":"unknown host data"}\n')
    result = box.run(['--target', 'beta', '--recover-attempt', failed['attempt_id'],
                     '--pending-record-id', failed['record_id'], '--target-sha', box.sha], **common)
    assert not (box.beta_root / 'hub/lib/newer-source.js').exists()
    assert original.read_bytes() == original_bytes and prior.read_bytes() == prior_bytes
    assert snapshot(box.prod_app) == production
    for name in retained:
        assert snapshot(box.beta_app / name) == retained[name]
    if unknown_host_file:
        assert result.returncode != 0
        assert unknown.read_text() == '{"preserve":"unknown host data"}\n'
        assert (box.beta_root / '.runtime-accepted').resolve() == prior
        assert box.pointer_record('.release-pending')['attempt_id'] == failed['attempt_id']
        assert box.unit_active.read_text().strip() == 'inactive'
        assert box.unit_enabled.read_text().strip() == 'disabled'
        receipt = json.loads(box.receipts()[-1].read_text())
        assert receipt['result'] == 'UNKNOWN_STOP'
        assert any(f['code'] == 'HOST_ONLY_UNTRACKED' and f['path'] == 'private-host-cache.json'
                   for f in receipt['source_audit']['findings'])
    else:
        assert result.returncode == 0, result.stdout + result.stderr
        accepted = box.pointer_record('.runtime-accepted')
        assert accepted['accepted_sha'] == box.sha
        assert accepted['acceptance_attempt_id'] == failed['attempt_id']
        assert accepted['recovery_from_record_id'] == failed['record_id']
        assert json.loads(open(accepted['release_receipt_path']).read())['result'] == 'CLEAN'
        assert not (box.beta_root / '.release-pending').exists()
