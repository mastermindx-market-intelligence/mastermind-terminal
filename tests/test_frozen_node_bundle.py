"""Execute the production bundle shell block with synthetic npx, never install."""
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).parents[1]


@pytest.mark.parametrize('failure', ['', 'build', 'rename'])
def test_atomic_bundle_preserves_previous_on_failure(tmp_path, failure):
    source = (ROOT / 'ops/terminal-build.sh').read_text()
    start = source.index('# BEGIN frozen-node source bundle')
    end = source.index('# END frozen-node source bundle', start)
    assert source.rfind('if [ "$INSTALLS_GLOBAL_RUNTIME" = 1 ]; then', 0, start) >= 0
    block = source[start:end]
    assert '--conditions=react-server' in block
    app = tmp_path / 'terminal'; app.mkdir()
    dist = tmp_path / 'ingest/dist'; dist.mkdir(parents=True)
    destination = dist / 'frozen_node_source.mjs'; destination.write_text('previous')
    binary = tmp_path / 'bin'; binary.mkdir()
    npx = binary / 'npx'
    npx.write_text('''#!/bin/bash
test "$1" = esbuild || exit 90
test "$2" = ../ingest/frozen_node_source_cli.ts || exit 91
for arg in "$@"; do
  case "$arg" in --outfile=*) outfile="${arg#--outfile=}";; esac
done
test "$outfile" = ../ingest/dist/frozen_node_source.mjs.new || exit 92
printf generated > "$outfile"
test "$FAIL" != build
'''); npx.chmod(0o755)
    mv = binary / 'mv'
    mv.write_text('#!/bin/bash\ntest "$FAIL" != rename || exit 93\nexec /bin/mv "$@"\n')
    mv.chmod(0o755)
    result = subprocess.run(['bash', '-c', 'set -eu\nlog() { printf "%s\\n" "$*"; }\n' + block],
                            env={**os.environ, 'APP': str(app), 'PATH': f'{binary}:/usr/bin:/bin', 'FAIL': failure},
                            capture_output=True, text=True, timeout=5)
    assert result.returncode == 0
    assert destination.read_text() == ('previous' if failure else 'generated')
    assert not Path(str(destination) + '.new').exists()
    assert ('bundle FAILED' in result.stdout) == bool(failure)
    assert ('installed ingest/dist/frozen_node_source.mjs' in result.stdout) != bool(failure)
