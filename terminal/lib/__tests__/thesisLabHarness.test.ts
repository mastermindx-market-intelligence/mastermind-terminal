import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('shipping Lab transport/client and UI contract', () => {
  it('passes the deterministic Node suites against the actual shared modules and UI', () => {
    const script = fileURLToPath(new URL('../../scripts/test_thesis_lab.mjs', import.meta.url));
    const uiScript = fileURLToPath(new URL('../../scripts/test_thesis_lab_ui.mjs', import.meta.url));
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', script, uiScript], { encoding: 'utf8', timeout: 20000 });
    expect(output).toContain('# fail 0');
    expect(output).toContain('# skipped 0');
  }, 30000);
});
