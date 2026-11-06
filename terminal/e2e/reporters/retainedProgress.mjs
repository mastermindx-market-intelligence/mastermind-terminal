// Artifact-only reporter. No browser, service, errors/bodies, environment or verdict.
// Every callback flushes its bounded record before returning, so cancellation
// need not reach onEnd to retain finished cases and the last observed begin.
import fs from 'node:fs';
import path from 'node:path';

function refused() { return new Error('retained_progress_unavailable'); }
function text(value, max) {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw refused();
  return value;
}
function integer(value, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw refused();
  return value;
}
function relative(root, file) {
  if (!path.isAbsolute(text(file, 4096))) throw refused();
  const name = path.relative(root, file);
  if (!name || path.isAbsolute(name) || name === '..' || name.startsWith('..' + path.sep)) throw refused();
  return text(name.split(path.sep).join('/'), 512);
}
function directory(root, output) {
  const name = relative(root, output);
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw refused(); }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw refused();
  }
  return current;
}

class RetainedProgress {
  constructor() { this.fd = null; this.count = 0; this.selected = new Map(); }
  printsToStdio() { return false; }
  onBegin(config, suite) {
    try {
      if (this.root || !path.isAbsolute(config.configFile) || !Array.isArray(config.projects) || !config.projects.length) throw refused();
      this.root = path.dirname(config.configFile);
      const outputs = [...new Set(config.projects.map(p => p.outputDir))];
      if (outputs.length !== 1 || !path.isAbsolute(outputs[0])) throw refused();
      const tests = suite.allTests();
      if (!Array.isArray(tests)) throw refused();
      this.limit = 0;
      for (const test of tests) {
        const identity = this.identity(test);
        if (!config.projects.some(p => p.name === identity.project && p.outputDir === outputs[0])) throw refused();
        const key = this.key(identity);
        if (this.selected.has(key)) throw refused();
        this.selected.set(key, identity);
        this.limit = integer(this.limit + 2 * (integer(test.retries) + 1));
      }
      if (typeof fs.constants.O_NOFOLLOW !== 'number') throw refused();
      const output = directory(this.root, outputs[0]);
      this.fd = fs.openSync(path.join(output, `retained-progress-${process.pid}.ndjson`),
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      if (!fs.fstatSync(this.fd).isFile()) throw refused();
      this.started = process.hrtime.bigint();
    } catch { this.close(); throw refused(); }
  }
  identity(test) {
    return { test_id: text(test.id, 256), file: relative(this.root, test.location.file),
      line: integer(test.location.line, 1), column: integer(test.location.column, 1),
      project: text(test.parent.project().name, 120), repeat: integer(test.repeatEachIndex), retries: integer(test.retries) };
  }
  key(identity) { return JSON.stringify([identity.test_id, identity.project, identity.repeat]); }
  record(event, test, result) {
    try {
      if (this.fd === null || this.count >= this.limit) throw refused();
      const identity = this.identity(test);
      if (JSON.stringify(identity) !== JSON.stringify(this.selected.get(this.key(identity)))) throw refused();
      const retry = integer(result.retry);
      if (retry > identity.retries) throw refused();
      const row = { schema: 'terminal.playwright.progress.v1', event, ...identity,
        retry, worker: integer(result.workerIndex, -1), at_ms: Date.now(),
        elapsed_ms: Number(process.hrtime.bigint() - this.started) / 1e6 };
      if (event === 'end') {
        if (!['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(result.status)
          || typeof result.duration !== 'number' || !Number.isFinite(result.duration) || result.duration < 0) throw refused();
        row.status = result.status; row.duration_ms = result.duration;
      }
      const bytes = Buffer.from(JSON.stringify(row) + '\n');
      if (bytes.length > 4096) throw refused();
      let offset = 0;
      while (offset < bytes.length) {
        const wrote = fs.writeSync(this.fd, bytes, offset, bytes.length - offset);
        if (!Number.isSafeInteger(wrote) || wrote <= 0) throw refused();
        offset += wrote;
      }
      fs.fsyncSync(this.fd);
      this.count++;
    } catch { this.close(); throw refused(); }
  }
  onTestBegin(test, result) { this.record('begin', test, result); }
  onTestEnd(test, result) { this.record('end', test, result); }
  close() {
    const fd = this.fd; this.fd = null;
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* bounded failure above; no borrowed descriptors */ } }
  }
  onEnd() { this.close(); }
}
export default RetainedProgress;
