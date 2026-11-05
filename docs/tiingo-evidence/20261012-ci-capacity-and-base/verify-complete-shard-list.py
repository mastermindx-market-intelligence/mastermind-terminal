import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

w = Path('/Volumes/Mastermind/agent-workspaces/claude/5600d31ffa29643a/tiingo-boats-quotehub-b2b25c10fd296613')
e = Path('/Users/chriswong/.codex/visualizations/2026/10/11/01a12ab6-92cb-7c42-a711-42673ebb6b50/tiingo-phase1')
out = e / 'terminal-955-base8520-complete-shard-list-proof.json'
assert not out.exists()
env = dict(os.environ, CI='1')
proof = {'method_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
         'workflow_sha256': hashlib.sha256((w / '.github/workflows/ci.yml').read_bytes()).hexdigest(),
         'assertions_weakened': False, 'server_started': False, 'projects': {}}
for project in ('desktop', 'tablet', 'mobile'):
    selections = []
    for part in (None, '1/2', '2/2'):
        args = ['npx', 'playwright', 'test', '--list', '--reporter=list', '--project=' + project]
        if part:
            args.append('--shard=' + part)
        result = subprocess.run(args, cwd=w / 'terminal', env=env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
        assert result.returncode == 0, result.stdout[-4000:]
        selected = [line.strip() for line in result.stdout.splitlines()
                    if re.match(r'^\s*\[' + project + r'\]\s+›', line)]
        assert selected and len(selected) == len(set(selected))
        selections.append(set(selected))
    whole, first, second = selections
    assert not first & second
    assert first | second == whole
    proof['projects'][project] = {'whole_count': len(whole), 'first_half_count': len(first),
                                 'second_half_count': len(second), 'overlap_count': 0,
                                 'missing_count': 0,
                                 'whole_test_identity_sha256': hashlib.sha256('\n'.join(sorted(whole)).encode()).hexdigest()}
out.write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof, indent=2))
