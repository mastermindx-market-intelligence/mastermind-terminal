const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2]);
const terminal = path.join(root, 'terminal');
const ts = require(require.resolve('typescript', { paths: [terminal] }));
const file = path.join(terminal, 'lib/__tests__/prophetPerf.test.ts');
const text = fs.readFileSync(file, 'utf8');
const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

function literal(node) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -literal(node.operand);
  if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'Number') {
    assert(['MIN_VALUE', 'MAX_VALUE'].includes(node.name.text));
    return Number[node.name.text];
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map((property) => {
      assert(ts.isPropertyAssignment(property));
      return [property.name.getText(source).replace(/^['"]|['"]$/g, ''), literal(property.initializer)];
    }));
  }
  throw new Error(`Unexpected test-data expression: ${node.getText(source)}`);
}

const candidates = [];
function visit(node) {
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 8 && node.elements.every((element) =>
    ts.isObjectLiteralExpression(element) && element.properties.some((property) =>
      ts.isPropertyAssignment(property) && property.name.getText(source) === 'label'))) candidates.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(candidates.length, 1);
const encode = (value) => ({ value, negativeZero: typeof value === 'number' && Object.is(value, -0) });
const controls = literal(candidates[0]).map(({ label, returns, stats }) => ({
  label, returns: returns.map(encode), statistics: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, encode(value)])),
}));
process.stdout.write(JSON.stringify({
  schema: 'terminal.perf-native-numeric-positive-controls.v1',
  testPath: 'terminal/lib/__tests__/prophetPerf.test.ts',
  testSha256: crypto.createHash('sha256').update(text).digest('hex'),
  controls,
}, null, 2) + '\n');
