'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = process.argv[2];
assert.ok(repo, 'Pass the exact source worktree');
const ts = require(path.join(repo, 'terminal/node_modules/typescript'));
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const source = fs.readFileSync(path.join(repo, 'terminal/components/prophet/prophetPerfTypes.ts'), 'utf8');
const parseExports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText, { exports: parseExports });
const specPath = 'terminal/e2e/prophet-perf-responsive.spec.ts';
const specText = git(['show', '56760d570407c8e17c7b321b74e3096c2e490ce6:' + specPath]);
const ast = ts.createSourceFile(specPath, specText, ts.ScriptTarget.Latest, true);
const fixtures = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['empty', 'partial'].includes(node.name.text)) {
    assert.ok(node.initializer && ts.isObjectLiteralExpression(node.initializer));
    assert.ok(!fixtures.has(node.name.text));
    const fixtureExports = {};
    const initializer = node.initializer.getText(ast);
    vm.runInNewContext(ts.transpileModule('exports.value = (' + initializer + ');', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: fixtureExports });
    fixtures.set(node.name.text, JSON.parse(JSON.stringify(fixtureExports.value)));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.deepEqual([...fixtures.keys()], ['empty', 'partial']);
const results = [];
for (const [name, payload] of fixtures) {
  const before = JSON.stringify(payload);
  const value = parseExports.normalizeProphetPerfPayload(payload);
  assert.ok(value, name + ' actual authored payload rejected');
  assert.equal(JSON.stringify(payload), before);
  assert.deepEqual(JSON.parse(JSON.stringify(value.source)), payload.source);
  assert.deepEqual(JSON.parse(JSON.stringify(value.summary)), payload.summary);
  assert.deepEqual(JSON.parse(JSON.stringify(value.plans)), payload.plans);
  results.push({ case: name, admitted: true, inputUnchanged: true, suppliedSourceUnchanged: true, suppliedSummaryAndPlansUnchanged: true, plans: value.plans.length });
}
console.log(JSON.stringify({ schema: 'prophet.perf-authored-payload-qualification.v1', sourceSpec: specPath, sourceSpecBlob: git(['rev-parse', '56760d570407c8e17c7b321b74e3096c2e490ce6:' + specPath]).trim(), method: 'Evaluate only the existing literal empty/partial fixtures and apply the compiled actual normalizer; no Playwright/browser or request execution.', cases: results }, null, 2));
