import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateSovereignAuctionContext, auctionDisplayRows } from '../terminal/lib/sovereignAuctionContext.ts';
const fixtureBytes = readFileSync(new URL('../terminal/lib/__tests__/fixtures/sovereign_auction_context_w1.json', import.meta.url));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), 'b3e7eb3b5ca32e0ebe3d23011d9fa917841f38e9fb436c73c8ca62b53b01d0cb');
const original = JSON.parse(fixtureBytes).sovereign_auction_context;
const now = Date.parse('2026-10-08T22:16:00Z');
let cases = 0;
const validate = value => validateSovereignAuctionContext(value, now);
function rejected(change) { const c = structuredClone(original); change(c); assert.equal(validate(c).ok, false); cases++; }
function accepted(change = () => {}) { const c = structuredClone(original); change(c); const r = validate(c); assert.equal(r.ok, true); assert.deepEqual(validate(r.context), r); cases++; return r.context; }
const c = accepted();
assert.equal(c.events[2].offering_amount_usd, '95000000000');
assert.equal(c.events[2].episode_id, 'auction:912797SU2:2026-10-13');
assert.equal(c.source_observed_at, '2026-10-08T22:12:22.414829+00:00');
for (const [base, raw] of [['Bill','Note'],['Note','Bond'],['Bond','Bill']]) rejected(c => Object.assign(c.events[0], { raw_security_type: base, raw_type: raw, normalized_class: raw }));
accepted(c => Object.assign(c.events[0], { raw_security_type:' Bill ', raw_type:'', raw_class_flags:{ tips:'', floatingRate:' ', cashManagementBillCMB:null } }));
rejected(c => c.events[0].first_observed_at = '2026-10-08T22:12:22.414830+00:00');
rejected(c => c.events[0].physical_state = 'AWAITING_RESULT');
rejected(c => c.events[0].issue_calendar_state = 'ISSUE_DATE_PASSED');
rejected(c => c.source_health[0].last_valid_observation_age_seconds = 0);
rejected(c => c.source_health[0].last_valid_observation_age_seconds += .000001);
rejected(c => {
  c.source_observed_at = c.source_health[0].last_valid_observation_at = c.source_health[0].latest_attempt_at = '2026-10-08T22:15:00.000001Z';
  c.source_health[0].last_valid_observation_age_seconds = 0; c.events[0].known_at = c.source_observed_at;
});
for (const x of [true,false,NaN,Infinity,-Infinity,'Infinity','NaN','1e309','',' 0 ',-1,'-1']) rejected(c => c.events[0].offering_amount_usd = x);
for (const x of [null,0,'0','95000000000','1.25']) accepted(c => c.events[0].offering_amount_usd = x);
for (const x of ['javascript:alert(1)','http://home.treasury.gov/','https://evil.example/','https://home.treasury.gov.evil.example/','https://user@home.treasury.gov/']) rejected(c => c.events[0].source_url = c.events[0].source = x);
for (const x of ['2026-10-08T22:12:22','2026-02-30T12:00:00Z','2026-10-08T24:00:00Z','2026-10-08T22:12:22+99:00','2026-10-09T00:00:00Z']) rejected(c => c.events[0].known_at = x);
for (const change of [c => c.probabilities=.5,c => c.forecast_authority='TRADE',c => c.is_context_only=false,c => c.importance='HIGH',c => c.events[0].importance='HIGH',c => c.source_health[0].stale_after_seconds=1]) rejected(change);
const stripped = accepted(c => { c.band='critical';c.stressed=true;c.events[0].risk_score=1; });
assert.doesNotMatch(JSON.stringify(stripped), /critical|stressed|risk_score/);
assert.equal(auctionDisplayRows({...c,events:Array(100).fill(c.events[0])},999).rows.length,24);
const frozenLater = validateSovereignAuctionContext(original, Date.parse('2026-11-08T00:00:00Z'));
assert.deepEqual(frozenLater, validate(original)); cases++;
const later = structuredClone(original);
const delta = (Date.parse('2026-10-14T00:00:00Z')-Date.parse(later.decision_cutoff_utc))/1000;
later.as_of=later.decision_cutoff_utc='2026-10-14T00:00:00Z';
later.events.forEach(e=>e.physical_state='AWAITING_RESULT');
later.source_health.forEach(h=>h.last_valid_observation_age_seconds+=delta);
assert.equal(validateSovereignAuctionContext(later,Date.parse('2026-10-14T00:01:00Z')).ok,true); cases++;
let fullCapture = null;
if(process.argv[2]) {
 const bytes=readFileSync(process.argv[2]); const data=JSON.parse(bytes);
 const result=validateSovereignAuctionContext(data,Date.parse('2026-10-08T22:55:00Z'));
 assert.equal(result.ok,true); assert.equal(result.context.events.length,74);
 assert.deepEqual(validateSovereignAuctionContext(result.context,Date.parse('2026-10-08T22:55:00Z')),result);
 fullCapture={sha256:createHash('sha256').update(bytes).digest('hex'),events:74,classes:[...new Set(result.context.events.map(e=>e.normalized_class))].sort(),resultObserved:result.context.events.filter(e=>e.result!==null).length,tentative:result.context.events.filter(e=>e.source_state==='TENTATIVE').length};
}
console.log(JSON.stringify({runtime:process.version,modelCases:cases,fixtureSha256:createHash('sha256').update(fixtureBytes).digest('hex'),fullCapture,scope:'Actual pure model execution only; no Vitest, React, Next typecheck, responsive browser, entitlement host or production claim'},null,2));
