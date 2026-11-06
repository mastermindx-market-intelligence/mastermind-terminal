import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('shipping Lab transport/client contract', () => {
  it('passes the deterministic Node suite against the actual shared modules', () => {
    const script = fileURLToPath(new URL('../../scripts/test_thesis_lab.mjs', import.meta.url));
    const output = execFileSync(process.execPath, ['--test', script], { encoding: 'utf8', timeout: 20000 });
    expect(output).toContain('# fail 0');
    expect(output).toContain('# skipped 0');
  }, 30000);
});
