// Replay the incumbent capture producer with its output directory redirected.
// All rendering, fixture, URL, viewport and assertion behavior stays incumbent.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const terminal = path.resolve(__dirname, '../../../..');
const producer = path.join(terminal, 'e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs');
const source = fs.readFileSync(producer, 'utf8');
const needle = 'const OUT = join(ROOT, "docs", "pr-crops", "b-f11-10-analysis-theses-entry");';
if (source.split(needle).length !== 2) throw new Error('Incumbent output declaration changed');
const redirected = source.replace(needle, `const OUT = ${JSON.stringify(__dirname)};`);
const witness = require(path.join(terminal, 'e2e/tools/visualEvidence.cjs'));
const sources = witness.sourceSnapshot(path.dirname(terminal));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(__dirname, 'start.json'), JSON.stringify({
  schema: 'terminal.theses-entry-output-redirect.v1',
  producer: 'terminal/e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs',
  producerSha256: hash(source), change: 'OUT declaration only', sourceFiles: sources,
  command: 'MMX_SHARED_SHELL=0 TERMINAL_CROP_PORT=64146 TERMINAL_VISUAL_EVIDENCE_OPERATION=ci-lightning-terminal-context-20261107-c2 NODE_OPTIONS=--no-experimental-webstorage /opt/homebrew/bin/node docs/pr-crops/company-origin-context-20261107/theses-entry-20261107/capture.cjs',
  head: require('node:child_process').execFileSync('git', ['rev-parse','HEAD'], {cwd:terminal,encoding:'utf8'}).trim()
}, null, 2)+'\n', {flag:'wx'});
const replay = new Module(producer, module);
replay.filename = producer;
replay.paths = Module._nodeModulePaths(path.dirname(producer));
replay._compile(redirected, producer);
process.on('exit', code => {
  if (code !== 0) return;
  if (JSON.stringify(sources) !== JSON.stringify(witness.sourceSnapshot(path.dirname(terminal)))) throw new Error('Source changed during capture');
  const images = ['desktop-en','desktop-zh','tablet-en','tablet-zh','mobile-en','mobile-zh'].map(name => {
    const file = `${name}.png`;
    return {file, ...witness.imageInfo(fs.readFileSync(path.join(__dirname,file)))};
  });
  fs.writeFileSync(path.join(__dirname,'result.json'),JSON.stringify({schema:'terminal.theses-entry-output-redirect-result.v1',status:'passed',cases:images,sourceUnchanged:true},null,2)+'\n',{flag:'wx'});
});
