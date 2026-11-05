import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
const sourcePath = 'terminal_patch/terminal/components/SovereignAuctionContext.tsx';
const source = readFileSync(sourcePath, 'utf8');
const helperBlock = source.slice(source.indexOf('const CLASS_LABELS:'), source.indexOf('/** Independent authenticated'));
const helpers = new Function(stripTypeScriptTypes(helperBlock.replace('export function', 'function')) + '\nreturn {formatAuctionDollars,eventTitle,readableDeadline};')();
const cases = [
 ['95000000000','95,000,000,000 USD'],
 ['9007199254740993.0100','9,007,199,254,740,993.0100 USD'],
 ['0.000001','0.000001 USD'],
 ['0000001.2300','0,000,001.2300 USD'],
 ['1.00','1.00 USD'],
 [0,'0 USD'],
];
for (const [value, expected] of cases) assert.equal(helpers.formatAuctionDollars(value),expected);
const lexSource = readFileSync('terminal_patch/terminal/lib/i18n.tsx','utf8');
const lex = Object.fromEntries([...lexSource.matchAll(/^  (sa\w+): (\[.*\]),$/gm)].map(([,k,v])=>[k,JSON.parse(v)]));
const full = JSON.parse(readFileSync('ui_verification/terminal/e2e/fixtures/sovereign_auction_context_full_capture.json','utf8'));
const samples = [];
for (const [index, lang] of ['en','zh'].entries()) {
 const t = key => { assert.ok(lex[key], `missing ${key}`); return lex[key][index]; };
 for (const event of full.events) {
  const title = helpers.eventTitle(event,t);
  assert.ok(title.length > 0);
  if (lang === 'zh') assert.ok(!/Bill|Note|Bond|Year|Month|Week|Day|auction/.test(title),title);
 }
 samples.push({lang, title: helpers.eventTitle(full.events.find(e=>e.label==='6-Week Bill auction'),t)});
}
assert.equal(helpers.readableDeadline('2026-10-13T17:00:00+00:00'),'2026-10-13 17:00:00 UTC');
assert.equal(helpers.readableDeadline('2026-10-13T17:00:00.123456Z'),'2026-10-13 17:00:00.123456 UTC');
assert.equal(helpers.readableDeadline('2026-10-13T13:00:00.123456-04:00'),'2026-10-13 17:00:00.123456 UTC');
const sha = createHash('sha256').update(source).digest('hex');
console.log(JSON.stringify({status:'passed',source:sourcePath,sha256:sha,amountCases:cases.length,localizedTitleChecks:full.events.length*2,deadlineCases:3,samples,scope:'Exact authored helper execution through Node native TypeScript stripping; not TSX, React, Vitest, tsc, layout, browser or auth proof.'},null,2));
