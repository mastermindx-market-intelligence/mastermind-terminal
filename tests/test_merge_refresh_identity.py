"""Prove the trusted sweep cannot refresh with GitHub's approval-gated default token."""
from pathlib import Path
import os
import subprocess
import yaml
import pytest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/merge-on-green.yml'


def workflow():
    # BaseLoader keeps GitHub's `on` key rather than treating it as YAML 1.1 true.
    return yaml.load(WORKFLOW.read_text(), Loader=yaml.BaseLoader)


def steps():
    return workflow()['jobs']['sweep']['steps']


def enrollment_step():
    return next(s for s in steps() if s.get('name') == 'require merge-refresh GitHub App enrollment')


@pytest.mark.parametrize('configured', [(), ('TERMINAL_MERGE_REFRESH_APP_ID',), ('TERMINAL_MERGE_REFRESH_APP_PRIVATE_KEY',), ('TERMINAL_MERGE_REFRESH_APP_ID', 'TERMINAL_MERGE_REFRESH_APP_PRIVATE_KEY')])
def test_actual_preflight_requires_both_credentials_without_echoing_them(configured):
    env = {k:v for k,v in os.environ.items() if not k.startswith('TERMINAL_MERGE_REFRESH_')}
    for name in configured:
        env[name] = 'test-credential-never-log-this'
    result = subprocess.run(['bash', '-eu', '-c', enrollment_step()['run']], env=env, text=True, capture_output=True)
    assert result.returncode == (0 if len(configured) == 2 else 1)
    output = result.stdout + result.stderr
    assert 'test-credential-never-log-this' not in output
    if len(configured) != 2:
        assert 'MERGE_REFRESH_APP_ENROLLMENT_REQUIRED' in output


@pytest.mark.parametrize('blank', ['', '   ', '\n'])
def test_whitespace_credential_is_missing(blank):
    env = dict(os.environ, TERMINAL_MERGE_REFRESH_APP_ID='fixture-app', TERMINAL_MERGE_REFRESH_APP_PRIVATE_KEY=blank)
    result = subprocess.run(['bash', '-eu', '-c', enrollment_step()['run']], env=env, text=True, capture_output=True)
    assert result.returncode == 1
    assert 'MERGE_REFRESH_APP_ENROLLMENT_REQUIRED' in result.stderr


def test_mint_precedes_any_controller_effect_and_has_no_default_token_fallback():
    selected = steps()
    guard = selected.index(enrollment_step())
    mint = next(s for s in selected if s.get('id') == 'merge-refresh-app')
    controller = next(s for s in selected if s.get('run') == 'python3 scripts/merge_on_green.py')
    assert guard < selected.index(mint) < selected.index(controller)
    assert controller['env']['MERGE_TOKEN'] == '${{ steps.merge-refresh-app.outputs.token }}'
    assert 'GITHUB_TOKEN' not in controller['env']['MERGE_TOKEN']
    assert '||' not in controller['env']['MERGE_TOKEN']
    assert 'if' not in mint and 'continue-on-error' not in mint
    assert 'if' not in enrollment_step() and 'continue-on-error' not in enrollment_step()


def test_token_is_current_repository_only_and_revoked_after_job():
    mint = next(s for s in steps() if s.get('id') == 'merge-refresh-app')
    assert mint['uses'] == 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1'
    config = mint['with']
    assert config['repositories'] == '${{ github.event.repository.name }}'
    assert 'owner' not in config and 'enterprise' not in config
    assert config['skip-token-revoke'] == 'false'
    actual = {k:v for k,v in config.items() if k.startswith('permission-')}
    assert actual == {'permission-actions':'write', 'permission-checks':'read', 'permission-contents':'write', 'permission-issues':'write', 'permission-pull-requests':'write'}


def test_app_key_never_enters_checkout_or_candidate_code():
    selected = steps()
    checkout = selected[0]
    assert checkout['uses'] == 'actions/checkout@v4'
    assert checkout['with']['ref'] == 'master'
    assert checkout['with']['sparse-checkout'] == 'scripts/merge_on_green.py'
    assert 'token' not in checkout['with']
    assert checkout['with'].get('persist-credentials') == 'false'
    assert 'PRIVATE_KEY' not in str(next(s for s in selected if s.get('run') == 'python3 scripts/merge_on_green.py'))


def test_existing_serial_owner_and_recovery_triggers_remain():
    config = workflow()
    assert config['concurrency'] == {'group':'merge-on-green','cancel-in-progress':'false'}
    assert config['on']['schedule'] == [{'cron':'*/10 * * * *'}]
    assert config['on']['workflow_run']['workflows'] == ['CI']
    assert config['on']['pull_request_target']['types'] == ['labeled','reopened','ready_for_review']
    assert config['jobs']['sweep']['timeout-minutes'] == '10'
